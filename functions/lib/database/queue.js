'use strict';

const admin = require('firebase-admin');
const debug = require('debug');
const uuid = require('uuid/v4');

const promise = require('../promise');
const cancellation = require('../cancellation');

const noop = () => {};
const logger = (id, {type = 'worker', level = 'info'} = {}) => debug(`firebase-lti:database:queue:${type}:${id}:${level}`);

exports.QUEUE_PATH = 'queue/tasks';
exports.POOL_SIZE = 10;
exports.WORKER_TIMEOUT = 5 * 60 * 1000;
exports.PROCESSING_TIMEOUT = 10 * 1000;
exports.RETRY_TIMEOUT = 60 * 1000;

promise.shim();

/**
 * Create queue worker pool.
 *
 * @param {function(taskId: string, task: object, options: object): Promise<void>} processor Task handler
 * @param {object} options Pool options
 * @param {number} options.size Pool maximum size
 * @param {string} options.path Firebase database Path to the tasks to run
 * @param {CancellationToken} options.cancelToken Token signaling the queue should close
 * @param {{job: number, idle: number, retry: number}} options.timeOut Delays for task, idled worker and retry timers
 * @returns {Promise<void>}
 */
exports.create = function (processor, options = {}) {
  const log = logger(uuid(), {type: 'master'});
  const {
    size = exports.POOL_SIZE,
    path = exports.QUEUE_PATH,
    cancelToken = cancellation.Token.none
  } = options;
  const cancelable = new cancellation.TokenSource([cancelToken]);

  if (cancelable.token.cancellationRequested) {
    return Promise.resolve();
  }

  log(`Starting monitoring queue at <${path}> with up to ${size} workers`);

  const ctx = new exports.Context({cancelToken: cancelable.token});
  const cleaner = new exports.Cleaner(ctx, options);
  const addWorker = () => {
    const worker = new exports.Worker(ctx, processor, options);

    worker.start().catch(console.error);
  };
  const unsubscribe = ctx.subscribe(({pool, idle}) => ((idle < 1 && pool < size) ? addWorker() : null));

  addWorker();
  cleaner.start()
    .catch(console.error)
    .finally(() => cancelable.cancel());

  cancelable.token.register(() => {
    log(`Stopping monitoring queue at <${path}>.`);
    unsubscribe();
  });

  return ctx.closed()
    .finally(() => cancelable.close());
};

/**
 * Queue Context monitor the size of the worker pool and notify workers
 * (via a promise or a time out delay) when the worker should shutdown.
 *
 */
exports.Context = class Context {

  /**
   * Queue Context constructor.
   *
   * @param {object} options Context options
   * @param {Promise<void>} options.done Resolves when the pool should shutdown
   * @param {number} options.timeOut delay before the pool should shutdown
   */
  constructor({cancelToken = cancellation.Token.none}) {
    this._pool = new Map();
    this._idle = new Map();
    this._listeners = [];
    this.cancelToken = cancelToken;
  }

  /**
   * Return size of the pool and how many workers are idled.
   *
   * @returns {{pool: number, idle: number}}
   */
  size() {
    return {
      pool: Array.from(this._pool.values()).filter(v => v === true).length,
      idle: Array.from(this._idle.values()).filter(v => v === true).length
    };
  }

  /**
   * Test the Queue still have worker alive.
   *
   * @returns {boolean}
   */
  hasWorker() {
    const {pool} = this.size();

    return pool > 0;
  }

  /**
   * Test if any worker is active.
   *
   * @returns {boolean}
   */
  isActive() {
    const {pool, idle} = this.size();

    return pool > 0 && idle < pool;
  }

  /**
   * Test if the pool is running.
   *
   * @returns {boolean}
   */
  isClosed() {
    return this.cancelToken.cancellationRequested && !this.hasWorker();
  }

  /**
   * Notify the context a worker is joining the pool.
   *
   * @param {string} id Worker id
   */
  enter(id) {
    this._pool.set(id, true);
    this._idle.set(id, true);
    this.broadcast();
  }

  /**
   * Notify the context a worker is joining the pool.
   *
   * @param {string} id Worker id
   */
  leave(id) {
    this._pool.delete(id);
    this._idle.delete(id);
    this.broadcast();
  }

  /**
   * Notify the context a worker is waiting for a task.
   *
   * @param {string} id Worker id
   */
  waiting(id) {
    this._pool.set(id, true);
    this._idle.set(id, true);
    this.broadcast();
  }

  /**
   * Notify the context a worker is processing a task.
   *
   * @param {string} id Worker id
   */
  working(id) {
    this._pool.set(id, true);
    this._idle.set(id, false);
    this.broadcast();
  }

  /**
   * Resolves once the pool is closed and empty.
   *
   * @returns {Promise<void>}
   */
  closed() {
    return new Promise(resolve => {
      if (this.isClosed()) {
        resolve();
        return;
      }

      this.subscribe(() => {
        if (this.isClosed()) {
          resolve();
        }
      });
    });
  }

  /**
   * Register a change notification handlers.
   *
   * Returns a function to unsubscribe the handler.
   *
   * @param {function({pool: number, idle:number}): void} handler Change notification handler
   * @returns {function(): void}
   */
  subscribe(handler) {
    if (this.isClosed()) {
      return;
    }

    this._listeners.push(handler);

    return () => this.unsubscribe(handler);
  }

  /**
   * Unsubscribe a change notification handlers.
   *
   * @param {function({pool: number, idle:number}): void} handler Change notification handler
   */
  unsubscribe(handler) {
    this._listeners = this._listeners.filter(h => h !== handler);
  }

  /**
   * Broadcast a pool size change event.
   */
  broadcast() {
    const size = this.size();

    this._listeners.forEach(handler => {
      try {
        handler(size);
      } catch (e) {}
    });

    if (this.isClosed()) {
      this._listeners = Object.freeze([]);
    }
  }

};

/**
 * A worker fetch task to process them.
 *
 */
exports.Worker = class Worker {

  /**
   * Worker constructor.
   *
   * @param {Context} ctx Worker pool context to notify activity to
   * @param {function(taskId: string, task: object, options: object): Promise<void>} processor Task handler
   * @param {object} options Worker options
   * @param {string} options.path path to tasks in the database
   * @param {{idle: number, job: number}} options.timeOut Time out options
   */
  constructor(ctx, processor = noop, {
    path = exports.QUEUE_PATH,
    timeOut = {}
  } = {}) {
    this.id = uuid();
    this.log = logger(this.id);
    this.error = logger(this.id, {level: 'error'});
    this.ctx = ctx;
    this.query = admin.database().ref(path).orderByChild('started').equalTo(false);
    this.processor = processor;
    this.timeOut = Object.assign({
      idle: exports.WORKER_TIMEOUT,
      job: exports.PROCESSING_TIMEOUT
    }, timeOut);
  }

  /**
   * Start fetching and processing task.
   *
   * @returns {Promise<void>}
   */
  start() {
    this.ctx.enter(this.id);
    this.log(`starting monitoring <${this.query}>...`);

    return this._run()
      .finally(() => {
        this.log(`Stopping monitoring <${this.query}>.`);
        this.ctx.leave(this.id);
      });
  }

  /**
   * Keep processing tasks as long as `_nextTask` resolves.
   *
   * Note: could use async iterator once it's implemented in Node.
   *
   * @returns {Promise<void>}
   */
  _run() {
    this.ctx.waiting(this.id);
    this.log(`waiting for task to process...`);

    return this._nextTask().then(snapshot => {
      if (!snapshot) {
        return;
      }

      const {ref, key} = snapshot;
      const task = snapshot.val();

      this.ctx.working(this.id);
      this.log(`processing task <${ref}>...`);

      return this._claimTask(ref)
        .then(() => this._process(key, task))
        .then(() => this._completeTask(ref))
        .catch(err => {
          this.error(`Failed to process task <${ref}>: ${err}`);
        })
        .then(() => this._run());
    });
  }

  _process(taskId, task) {
    const timer = new cancellation.TimedTokenSource(this.timeOut.job);

    return Promise.try(() => this.processor(taskId, task, timer.token))
      .finally(() => timer.close());
  }

  /**
   * Fetch next task from the queue unless a idled timer expires or the worker
   * pool is closing.
   *
   * @returns {Promise<admin.database.DataSnapshot>}
   */
  _nextTask() {
    const timer = new cancellation.TimedTokenSource(this.timeOut.idle, [this.ctx.cancelToken]);

    return nextChange(this.query, 'child_added', timer.token)
      .finally(() => timer.close());
  }

  _claimTask(taskRef) {
    return taskRef.update({
      started: true,
      startedAt: admin.database.ServerValue.TIMESTAMP
    });
  }

  _completeTask(taskRef) {
    return taskRef.remove();
  }

};

/**
 * Cleaner reset each task that failed to complete.
 *
 */
exports.Cleaner = class Cleaner {

  /**
   * Fetch each started task and reset them if they still exists once the retry
   * timeout expire.
   *
   * @param {Context} ctx Worker pool context to notify activity to
   * @param {object} options Worker options
   * @param {string} options.path path to tasks in the database
   * @param {{retry: number}} options.timeOut Time out options
   */
  constructor(ctx, {path = exports.QUEUE_PATH, timeOut = {}} = {}) {
    this.id = uuid();
    this.log = logger(this.id, {type: 'cleaner'});
    this.error = logger(this.id, {level: 'error', type: 'cleaner'});
    this.ctx = ctx;
    this.query = admin.database().ref(path).orderByChild('startedAt').startAt(0);
    this.timeOut = Object.assign({
      retry: exports.RETRY_TIMEOUT
    }, timeOut);
  }

  /**
   * Start monitoring started tasks
   *
   * @returns {Promise<void>}
   */
  start() {
    this.log(`starting monitoring <${this.query}> for task to reset...`);
    return this._run()
      .finally(() => {
        this.log(`Stopping monitoring <${this.query}> for task to reset.`);
        this.ctx.leave(this.id);
      });
  }

  /**
   * Keep fetching a started task as long as _resetTask can resolve one.
   *
   * @returns {Promise<void>}
   */
  _run() {
    this.log(`waiting for task to reset...`);

    return this._nextTask().then(snapshot => {
      if (!snapshot) {
        return;
      }

      const {ref} = snapshot;
      const task = snapshot.val();

      this.log(`Planing resetting task <${ref}>...`);

      return this._resetTask(ref, task).then(() => this._run());
    });
  }

  /**
   * Fetch a started task unless the worker pool closes.
   *
   * @returns {Promise<void>}
   */
  _nextTask() {
    return nextChange(this.query, 'child_added', this.ctx.cancelToken);
  }

  /**
   * Reset a task when it retry timer expire.
   *
   * @param {admin.database.Reference} ref Task reference
   * @param {object} task Task data
   * @returns {promise<void>}
   */
  _resetTask(ref, task) {
    const now = Date.now();
    const delay = task.startedAt + (this.timeOut.retry) - now;

    if (delay < 0) {
      return this._doResetTask(ref);
    }

    this.log(`Waiting ${delay}ms to reset task <${ref}>`);

    return promise.timer(delay, this.ctx.cancelToken)
      .then(() => this._doResetTask(ref))
      .catch(err => {
        if (err instanceof cancellation.Error) {
          this.log(`Cancelling scheduled reset of task <${ref}>`);
          return;
        }

        return Promise.reject(err);
      });
  }

  _doResetTask(ref) {
    return ref.transaction(data => {
      if (data == null) {
        // A transaction starts with the local state of the node which is null
        // unless the node is being watch.
        //
        // By saving the node to null again, it will force the transaction to
        // rerun the transaction handler if the node was not actually null.
        return null;
      }

      data.started = false;
      data.startedAt = null;

      return data;
    }).then(({committed, snapshot}) => {
      if (!snapshot.exists()) {
        this.log(`Task <${ref}> completed and didn't reset.`);

        return;
      }

      if (committed) {
        this.log(`Task <${ref}> has been reset`);

        return;
      }

      this.error(`Failed to reset task <ref>`);
    });
  }

};

function nextChange(query, eventType, cancelToken) {
  return new Promise((resolve, reject) => {
    if (cancelToken.cancellationRequested) {
      resolve();
      return;
    }

    const q = query.limitToFirst(1);
    const registration = cancelToken.register(onCancel);

    q.on(eventType, onChange, onError);

    function onChange(snapshot) {
      registration.unregister();
      resolve(snapshot);
    }

    function onError(err) {
      registration.unregister();
      reject(err);
    }

    function onCancel() {
      q.off(eventType, onChange);
      resolve();
    }
  });
}

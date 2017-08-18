'use strict';

const admin = require('firebase-admin');
const debug = require('debug');
const uuid = require('uuid/v4');
const once = require('lodash.once');

const promise = require('../promise');

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
 * @param {{job: number, idle: number, retry: number}} options.timeOut Delays for task, idled worker and retry timers
 * @returns {{running: Promise<void>, stop: function(): Promise<void>}}
 */
exports.create = function (processor, options = {}) {
  const log = logger(uuid(), {type: 'master'});
  const error = logger(uuid(), {type: 'master', level: 'error'});
  const {size = exports.POOL_SIZE, path = exports.QUEUE_PATH} = options;

  log(`Starting monitoring queue at <${path}> with up to ${size} workers`);

  const {ctx, cancel} = exports.Context.create();
  const cleaner = new exports.Cleaner(ctx, options);
  const addWorker = () => {
    const worker = new exports.Worker(ctx, processor, options);

    worker.start();
  };
  const unsubscribe = ctx.subscribe(({pool, idle}) => ((idle < 1 && pool < size) ? addWorker() : null));
  const running = promise.deferrer();
  const stop = once(() => {
    unsubscribe();

    return cancel().then(running.resolve);
  });

  addWorker();
  cleaner.start().catch(stop);

  return {
    stop,
    running: running.promise.then(
      () => log(`stopped monitoring <${path}>.`),
      err => {
        error(`monitoring <${path}> failed: ${err}`);

        return Promise.reject(err);
      }
    )};
};

/**
 * Queue Context monitor the size of the worker pool and notify workers
 * (via a promise or a time out delay) when the worker should shutdown.
 *
 */
exports.Context = class Context {

  /**
   * Create a Context a cancellation handler for it.
   *
   * @param {{timeOut: number}} options Context options
   * @returns {{ctx: Context, cancel: function(): void}}
   */
  static create() {
    const defer = promise.deferrer();
    const ctx = new exports.Context({done: defer.promise});

    return {
      ctx,

      cancel: once(() => {
        defer.resolve();

        return new Promise(resolve => {
          if (!ctx.hasWorker()) {
            resolve();

            return;
          }

          ctx.subscribe(() => (ctx.hasWorker() ? null : resolve()));
        });
      })
    };
  }

  /**
   * Queue Context constructor.
   *
   * @param {object} options Context options
   * @param {Promise<void>} options.done Resolves when the pool should shutdown
   * @param {number} options.timeOut delay before the pool should shutdown
   */
  constructor({done = promise.never()}) {
    this._pool = new Map();
    this._idle = new Map();
    this._listeners = [];
    this._shutdown = done;
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
   * Notify workers they should shutdown.
   *
   * @returns {Promise<void>}
   */
  closing() {
    return this._shutdown;
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
    this._listeners.forEach(handler => {
      try {
        handler(this.size());
      } catch (e) {}
    });
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

    return this._run().catch(err => {
      this.log(`Stopping monitoring <${this.query}>: ${err}`);
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
    this.log(`waiting...`);

    return this._nextTask().then(snapshot => {
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
    const timer = promise.timer(this.timeOut.job);

    return Promise.race([
      timer,
      Promise.try(() => this.processor(taskId, task, timer))
    ]).finally(() => timer.cancel());
  }

  /**
   * Fetch next task from the queue unless a idled timer expires or the worker
   * pool is closing.
   *
   * @returns {Promise<admin.database.DataSnapshot>}
   */
  _nextTask() {
    const timer = promise.timer(this.timeOut.idle);
    const shutdown = this.ctx.closing();

    return Promise.race([
      this.query.once('child_added'),
      shutdown.then(() => Promise.reject(new Error('Cancelled.'))),
      timer.then(() => Promise.reject(new Error('Worker Timed out.')))
    ]).finally(() => timer.cancel());
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
    return this._run().catch(err => {
      this.error(`stopping monitoring <${this.query}> for task to reset: ${err}`);

      return Promise.reject(err);
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
    const shutdown = this.ctx.closing();

    return Promise.race([
      shutdown.then(() => Promise.reject(new Error('Cancelled.'))),
      this.query.once('child_added')
    ]);
  }

  /**
   * Reset a task when it retry timer expire.
   *
   * @param {admin.database.Reference} ref Task reference
   * @param {object} task Task data
   * @returns {promise<void>}
   */
  _resetTask(ref, task) {
    const reset = () => ref.transaction(data => {
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

    const now = Date.now();
    const delay = task.startedAt + (this.timeOut.retry) - now;

    if (delay > 0) {
      this.log(`Waiting ${delay}ms to reset task <${ref}>`);

      return promise.timer(delay).then(reset);
    }

    return reset();
  }

};

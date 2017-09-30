'use strict';

const {expect, sinon} = require('./chai');

const admin = require('firebase-admin');

const queue = require('../lib/database/queue');
const promise = require('../lib/promise');
const cancellation = require('../lib/cancellation');

const now = () => admin.database.ServerValue.TIMESTAMP;
const noop = () => {};
const snapshot = (val, {key, ref = {toString: () => 'some/path'}} = {}) => ({
  key,
  ref,
  val: () => val,
  exists: () => val != null
});

describe('database queue', function () {
  let db;

  beforeEach(function () {
    db = {ref: sinon.stub()};

    sinon.stub(admin, 'database').returns(db);
  });

  afterEach(function () {
    admin.database.restore();
  });

  describe('Context', function () {
    let cancelable, ctx;

    beforeEach(function () {
      cancelable = new cancellation.TokenSource();
      ctx = new queue.Context({cancelToken: cancelable.token});
    });

    afterEach(function () {
      cancelable.cancel();
      cancelable.close();
    });

    it('should be cancelable', function () {
      const other = Symbol('other');
      const t = () => promise.timer(0).then(() => other);

      return Promise.race([ctx.closed(), t()])
        .then(result => expect(result).to.equal(other))
        .then(() => cancelable.cancel())
        .then(() => Promise.race([ctx.closed(), t()]))
        .then(result => expect(result).not.to.equal(other));
    });

    it('should monitor workers', function () {
      const id = 'someWorker';

      expect(ctx.isActive()).to.be.false();
      ctx.enter(id);
      expect(ctx.hasWorker()).to.be.true();
      expect(ctx.isActive()).to.be.false();
      ctx.working(id);
      expect(ctx.hasWorker()).to.be.true();
      expect(ctx.isActive()).to.be.true();
      ctx.waiting(id);
      expect(ctx.hasWorker()).to.be.true();
      expect(ctx.isActive()).to.be.false();
      ctx.working(id);
      ctx.leave(id);
      expect(ctx.hasWorker()).to.be.false();
      expect(ctx.isActive()).to.be.false();
    });

  });

  describe('Worker', function () {
    let ctx, cancelable, ref, orderByChild, equalTo, limitToFirst;

    beforeEach(function () {
      cancelable = new cancellation.TokenSource();
      ctx = new queue.Context({cancelToken: cancelable.token});

      limitToFirst = {on: sinon.stub(), off: sinon.stub()};
      equalTo = {limitToFirst: sinon.stub().returns(limitToFirst)};
      orderByChild = {equalTo: sinon.stub().returns(equalTo)};
      ref = {orderByChild: sinon.stub().returns(orderByChild)};
      db.ref.returns(ref);
    });

    afterEach(function () {
      cancelable.cancel();
      cancelable.close();
    });

    it('should monitor /queue/tasks by default', function () {
      const worker = new queue.Worker(ctx);

      expect(worker.query).to.equal(equalTo);
      expect(db.ref).to.have.been.calledOnce();
      expect(db.ref).to.have.been.calledWithExactly('queue/tasks');
    });

    it('can monitor any queue', function () {
      const worker = new queue.Worker(ctx, noop, {path: 'some/other/tasks'});

      expect(worker.query).to.equal(equalTo);
      expect(db.ref).to.have.been.calledOnce();
      expect(db.ref).to.have.been.calledWithExactly('some/other/tasks');
    });

    it('should monitor not started task', function () {
      const worker = new queue.Worker(ctx);

      expect(worker.query).to.equal(equalTo);
      expect(ref.orderByChild).to.have.been.calledOnce();
      expect(ref.orderByChild).to.have.been.calledWithExactly('started');
      expect(orderByChild.equalTo).to.have.been.calledOnce();
      expect(orderByChild.equalTo).to.have.been.calledWithExactly(false);
    });

    it('should query tasks one at a time', function () {
      const worker = new queue.Worker(ctx);
      const snapshot = {};

      limitToFirst.on.yields(snapshot);

      return worker._nextTask().then(result => expect(result).to.equal(snapshot));
    });

    it('should resolve to void if idle timer expires', function () {
      const worker = new queue.Worker(ctx, noop, {timeOut: {idle: 0}});

      return worker._nextTask().then(snapshot => expect(snapshot).to.be.undefined());
    });

    it('should reject if pool is shutting down', function () {
      const worker = new queue.Worker(ctx);

      cancelable.cancel();

      return worker._nextTask().then(snapshot => expect(snapshot).to.be.undefined());
    });

    describe('start', function () {
      const timeOut = 123000;
      let worker, processor, task, taskRef, taskSnapshot, _TimedTokenSource;

      beforeEach(function () {
        processor = sinon.stub().resolves();
        task = {some: 'task'};
        taskRef = {
          update: sinon.stub().withArgs({started: true, startedAt: now()}).resolves(),
          remove: sinon.stub().resolves()
        };
        taskSnapshot = snapshot(task, {ref: taskRef, key: 'someTaskId'});

        worker = new queue.Worker(ctx, processor, {timeOut: {job: timeOut}});
        sinon.stub(worker, '_nextTask');
        worker._nextTask.resolves();
        worker._nextTask.onFirstCall().resolves(taskSnapshot);

        _TimedTokenSource = cancellation.TimedTokenSource;
        cancellation.TimedTokenSource = sinon.spy(function () {
          return sinon.createStubInstance(_TimedTokenSource);
        });
      });

      afterEach(function () {
        cancellation.TimedTokenSource = _TimedTokenSource;
      });

      it('should process tasks', function () {
        return worker.start().then(() => {
          expect(processor).to.have.been.calledOnce();
          expect(processor).to.have.been.calledWith('someTaskId', task);
        });
      });

      it('should provide a timed cancel token', function () {
        return worker.start().then(() => {
          expect(cancellation.TimedTokenSource).to.have.been.calledOnce();
          expect(cancellation.TimedTokenSource).to.have.been.calledWithNew();

          const {token} = cancellation.TimedTokenSource.lastCall.returnValue;

          expect(processor).to.have.been.calledOnce();
          expect(processor).to.have.been.calledWith('someTaskId', task, token);
        });
      });

      it('should claim a tasks before running it', function () {
        return worker.start().then(() => {
          expect(taskRef.update).to.have.been.calledOnce();
          expect(taskRef.update).to.have.been.calledBefore(processor);
        });
      });

      it('should delete a tasks after processing it', function () {
        return worker.start().then(() => {
          expect(taskRef.remove).to.have.been.calledOnce();
          expect(taskRef.remove).to.have.been.calledAfter(processor);
        });
      });

      it('should abort the processing if the claim failed', function () {
        taskRef.update.rejects();

        return worker.start().then(() => {
          expect(taskRef.update).to.have.been.calledOnce();
          expect(processor).to.not.have.been.called();
        });
      });

      it('should query next task', function () {
        return worker.start().then(() => expect(worker._nextTask).to.have.been.calledTwice());
      });

      it('should query next task after a task claiming failure', function () {
        taskRef.update.rejects();

        return worker.start().then(() => expect(worker._nextTask).to.have.been.calledTwice());
      });

      it('should query next task after a task processing failure', function () {
        processor.rejects();

        return worker.start().then(() => expect(worker._nextTask).to.have.been.calledTwice());
      });

      it('should query next task after a task removal failure', function () {
        taskRef.remove.rejects();

        return worker.start().then(() => expect(worker._nextTask).to.have.been.calledTwice());
      });

      it('should notify worker pool context when starting and stopping', function () {
        const changes = [];

        worker._nextTask.callsFake(() => {
          changes.push(ctx.size());
          return Promise.resolve();
        });

        return worker.start().then(() => {
          changes.push(ctx.size());
          expect(changes).to.eql([{
            pool: 1, idle: 1
          }, {
            pool: 0, idle: 0
          }]);
        });
      });

      it('should notify worker pool context when waiting and working and stopping', function () {
        const changes = [];
        let called = false;

        worker._nextTask.reset();
        worker._nextTask.callsFake(() => {
          const result = Promise.resolve(called ? undefined : taskSnapshot);

          called = true;
          changes.push(ctx.size());

          return result;
        });

        taskRef.update.callsFake(() => {
          changes.push(ctx.size());

          return Promise.resolve();
        });

        return worker.start().then(() => expect(changes).to.eql([{
          pool: 1, idle: 1
        }, {
          pool: 1, idle: 0
        }, {
          pool: 1, idle: 1
        }]));
      });

    });

  });

  describe('Cleaner', function () {
    let ctx, cancelable, ref, orderByChild, startAt, limitToFirst;

    beforeEach(function () {
      cancelable = new cancellation.TokenSource();
      ctx = new queue.Context({cancelToken: cancelable.token});

      limitToFirst = {on: sinon.stub(), off: sinon.stub()};
      startAt = {limitToFirst: sinon.stub().returns(limitToFirst)};
      orderByChild = {startAt: sinon.stub().returns(startAt)};
      ref = {orderByChild: sinon.stub().returns(orderByChild)};
      db.ref.returns(ref);
    });

    afterEach(function () {
      cancelable.cancel();
      cancelable.close();
    });

    it('should monitor /queue/tasks by default', function () {
      const cleaner = new queue.Cleaner(ctx);

      expect(cleaner.query).to.equal(startAt);
      expect(db.ref).to.have.been.calledOnce();
      expect(db.ref).to.have.been.calledWithExactly('queue/tasks');
    });

    it('can monitor any queue', function () {
      const cleaner = new queue.Cleaner(ctx, {path: 'some/other/tasks'});

      expect(cleaner.query).to.equal(startAt);
      expect(db.ref).to.have.been.calledOnce();
      expect(db.ref).to.have.been.calledWithExactly('some/other/tasks');
    });

    it('should monitor started task', function () {
      const cleaner = new queue.Cleaner(ctx);

      expect(cleaner.query).to.equal(startAt);
      expect(ref.orderByChild).to.have.been.calledOnce();
      expect(ref.orderByChild).to.have.been.calledWithExactly('startedAt');
      expect(orderByChild.startAt).to.have.been.calledOnce();
      expect(orderByChild.startAt).to.have.been.calledWithExactly(0);
    });

    describe('_nextTask', function () {

      it('should query tasks one at a time', function () {
        const cleaner = new queue.Cleaner(ctx);
        const snapshot = {};

        limitToFirst.on.yields(snapshot);

        return cleaner._nextTask().then(result => expect(result).to.equal(snapshot));
      });

      it('should resolve to void if the worker pool is shutting down', function () {
        const cleaner = new queue.Cleaner(ctx);

        cancelable.cancel();

        return cleaner._nextTask().then(result => expect(result).to.be.undefined());
      });

    });

    describe('_resetTask', function () {
      const now = 100000;
      const retry = 10000;
      let ref, txResult;

      beforeEach(function () {
        sinon.stub(Date, 'now').returns(now);
        sinon.stub(promise, 'timer').resolves(promise.never());

        txResult = {
          committed: true,
          snapshot: {exists: sinon.stub().returns(true)}
        };
        ref = {transaction: sinon.stub().resolves(txResult)};
      });

      afterEach(function () {
        Date.now.restore();
        promise.timer.restore();
      });

      it('should reset the task immediately if the retry date expired', function () {
        const cleaner = new queue.Cleaner(ctx, {timeOut: {retry}});

        return cleaner._resetTask(ref, {startedAt: now - retry - 1}).then(() => {
          expect(ref.transaction).to.have.been.calledOnce();
          expect(promise.timer).to.not.have.been.called();

          const [txHandler] = ref.transaction.lastCall.args;
          const task = {foo: 'bar'};

          expect(txHandler(null)).to.be.null();
          expect(txHandler(task)).to.eql({
            foo: 'bar',
            started: false,
            startedAt: null
          });
        });
      });

      it('should reset the task immediately after the retry date expired', function () {
        const cleaner = new queue.Cleaner(ctx, {timeOut: {retry}});
        const onceSettled = sinon.spy();

        promise.timer.returns(Promise.resolve().then(onceSettled));

        return cleaner._resetTask(ref, {startedAt: now}).then(() => {
          expect(promise.timer).to.have.been.calledOnce();
          expect(promise.timer).to.have.been.calledWithExactly(retry, ctx.cancelToken);
          expect(ref.transaction).to.have.been.calledOnce();
          expect(ref.transaction).to.have.been.calledAfter(onceSettled);
        });
      });

    });

    describe('start', function () {
      let cleaner, task, taskRef, taskSnapshot;

      beforeEach(function () {
        cleaner = new queue.Cleaner(ctx);
        sinon.stub(cleaner, '_nextTask');
        sinon.stub(cleaner, '_resetTask').resolves();

        task = {};
        taskRef = {};
        taskSnapshot = snapshot(task, {ref: taskRef});

        cleaner._nextTask.resolves(taskSnapshot);
      });

      it('should query tasks until _nextTask reject', function () {
        const err = new Error();

        cleaner._nextTask.onCall(2).rejects(err);

        return cleaner.start().then(
          () => Promise.reject(new Error('unexpected')),
          e => {
            expect(e).to.equal(err);
            expect(cleaner._nextTask).to.have.been.calledThrice();
            expect(cleaner._resetTask).to.have.been.calledTwice();
          }
        );
      });

      it('should reset each task', function () {
        cleaner._nextTask.onCall(1).rejects();

        return cleaner.start().then(
          () => Promise.reject(new Error('unexpected')),
          () => expect(cleaner._resetTask).to.have.been.calledWithExactly(taskRef, task)
        );
      });

    });

  });

  describe('create', function () {
    let ctx, worker, cleaner, unsubscribe, _TokenSource;

    beforeEach(function () {
      sinon.stub(queue, 'Cleaner');
      sinon.stub(queue, 'Context');
      sinon.stub(queue, 'Worker');
      _TokenSource = cancellation.TokenSource;

      cancellation.TokenSource = sinon.spy(function () {
        return sinon.createStubInstance(_TokenSource);
      });

      unsubscribe = sinon.spy();
      cleaner = {start: sinon.stub().returns(promise.never())};
      worker = {start: sinon.stub().returns(promise.never())};
      ctx = {
        subscribe: sinon.stub().returns(unsubscribe),
        closed: sinon.stub().resolves()
      };

      queue.Cleaner.returns(cleaner);
      queue.Worker.returns(worker);
      queue.Context.returns(ctx);
    });

    afterEach(function () {
      queue.Cleaner.restore();
      queue.Context.restore();
      queue.Worker.restore();
      cancellation.TokenSource = _TokenSource;
    });

    it('should create a worker pool context', function () {
      queue.create(noop);

      expect(queue.Context).to.have.been.calledOnce();
      expect(queue.Context).to.have.been.calledWithNew();

      expect(cancellation.TokenSource).to.have.been.calledOnce();
      expect(cancellation.TokenSource).to.have.been.calledWithNew();
      expect(cancellation.TokenSource).to.have.been.calledWithExactly([cancellation.Token.none]);

      expect(queue.Context).to.have.been.calledWithExactly({
        cancelToken: cancellation.TokenSource.lastCall.returnValue.token
      });
    });

    it('should create a worker pool context link to provided cancel token', function () {
      const src = new _TokenSource();

      queue.create(noop, {cancelToken: src.token});

      expect(queue.Context).to.have.been.calledOnce();
      expect(queue.Context).to.have.been.calledWithNew();

      expect(cancellation.TokenSource).to.have.been.calledOnce();
      expect(cancellation.TokenSource).to.have.been.calledWithNew();
      expect(cancellation.TokenSource).to.have.been.calledWithExactly([src.token]);

      expect(queue.Context).to.have.been.calledWithExactly({
        cancelToken: cancellation.TokenSource.lastCall.returnValue.token
      });
    });

    it('should start a worker', function () {
      const options = {foo: 'bar'};

      queue.create(noop, options);

      expect(queue.Worker).to.have.been.calledOnce();
      expect(queue.Worker).to.have.been.calledWithNew();
      expect(queue.Worker).to.have.been.calledWithExactly(ctx, noop, options);
      expect(worker.start).to.have.been.calledOnce();
    });

    it('should start more worker when the pool has no idled worker', function () {
      const options = {foo: 'bar'};
      const trigger = size => ctx.subscribe.getCalls()
        .map(call => call.args[0])
        .map(listener => listener(size));

      queue.create(noop, options);

      queue.Worker.resetHistory();
      worker.start.resetHistory();

      trigger({pool: 1, idle: 1});
      expect(queue.Worker).to.not.have.been.called();

      trigger({pool: 1, idle: 0});
      expect(queue.Worker).to.have.been.calledOnce();
      expect(queue.Worker).to.have.been.calledWithNew();
      expect(queue.Worker).to.have.been.calledWithExactly(ctx, noop, options);
      expect(worker.start).to.have.been.calledOnce();
    });

    it('should limit the size of the pool to the default size', function () {
      const options = {some: 'option'};
      const trigger = size => ctx.subscribe.getCalls()
        .map(call => call.args[0])
        .map(listener => listener(size));

      queue.create(noop, options);

      queue.Worker.resetHistory();
      worker.start.resetHistory();

      trigger({pool: queue.POOL_SIZE, idle: 0});
      expect(queue.Worker).to.not.have.been.called();

      trigger({pool: queue.POOL_SIZE - 1, idle: 0});
      expect(queue.Worker).to.have.been.calledOnce();
      expect(queue.Worker).to.have.been.calledWithNew();
      expect(queue.Worker).to.have.been.calledWithExactly(ctx, noop, options);
      expect(worker.start).to.have.been.calledOnce();
    });

    it('should limit the size of the pool to the user provided size', function () {
      const options = {size: 5};
      const trigger = size => ctx.subscribe.getCalls()
        .map(call => call.args[0])
        .map(listener => listener(size));

      queue.create(noop, options);

      queue.Worker.resetHistory();
      worker.start.resetHistory();

      trigger({pool: 5, idle: 0});
      expect(queue.Worker).to.not.have.been.called();

      trigger({pool: 4, idle: 0});
      expect(queue.Worker).to.have.been.calledOnce();
      expect(queue.Worker).to.have.been.calledWithNew();
      expect(queue.Worker).to.have.been.calledWithExactly(ctx, noop, options);
      expect(worker.start).to.have.been.calledOnce();
    });

    it('should start a cleaner', function () {
      const options = {foo: 'bar'};

      queue.create(noop, options);

      expect(queue.Cleaner).to.have.been.calledOnce();
      expect(queue.Cleaner).to.have.been.calledWithNew();
      expect(queue.Cleaner).to.have.been.calledWithExactly(ctx, options);
      expect(cleaner.start).to.have.been.calledOnce();
    });

    it('should shutdown if the cleaner reject', function () {
      cleaner.start = sinon.stub().rejects();

      return queue.create(noop);
    });

  });

});

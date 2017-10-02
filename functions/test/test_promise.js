'use strict';

const {expect, sinon} = require('./chai');

const promise = require('../lib/promise');
const cancellation = require('../lib/cancellation');
const unexpected = () => Promise.reject(new Error('Unexpected'));

describe('promise', function () {

  describe('try', function () {

    it('should resolve to the function returned value', function () {
      return promise.try(() => 'foo').then(result => expect(result).to.equal('foo'));
    });

    it('should reject with the error the function throws', function () {
      const err = new Error();

      return promise.try(() => {
        throw err;
      }).then(unexpected, e => expect(e).to.equal(err));
    });

  });

  describe('finally', function () {

    it('should run the onFinally function (1/2)', function () {
      const p = Promise.resolve('foo');
      const onFinally = sinon.spy();

      return promise.finallyMethod.call(p, onFinally)
        .then(() => expect(onFinally).to.have.been.calledOnce());
    });

    it('should run the onFinally function (2/2)', function () {
      const p = Promise.reject(new Error());
      const onFinally = sinon.spy();
      const test = () => expect(onFinally).to.have.been.calledOnce();

      return promise.finallyMethod.call(p, onFinally)
        .then(test, test);
    });

    it('should resolve to the original promise value', function () {
      const p = Promise.resolve('foo');
      const onFinally = () => 'bar';

      return promise.finallyMethod.call(p, onFinally)
        .then(result => expect(result).to.equal('foo'));
    });

    it('should reject if onFinally reject (1/2)', function () {
      const p = Promise.resolve('foo');
      const err = new Error();
      const onFinally = () => Promise.reject(err);

      return promise.finallyMethod.call(p, onFinally)
        .then(unexpected, e => expect(e).to.equal(err));
    });

    it('should reject if onFinally reject (2/2)', function () {
      const p = Promise.reject(new Error('original'));
      const err = new Error('finally');
      const onFinally = () => Promise.reject(err);

      return promise.finallyMethod.call(p, onFinally)
        .then(unexpected, e => expect(e).to.equal(err));
    });

  });

  describe('timer', function () {
    this.slow(2000);

    it('should delay resolve after delay has elapsed', function () {
      const t1 = Date.now();

      return promise.timer(50).then(() => expect(Date.now() - t1).to.be.greaterThan(49));
    });

    it('should reject token is cancelled before the delay (1/2)', function () {
      const cancelable = new cancellation.TimedTokenSource(10);

      return promise.timer(50, cancelable.token).then(unexpected, e => expect(e).to.match(/cancell?ed/i));
    });

    it('should reject token is cancelled before the delay (2/2)', function () {
      const token = cancellation.Token.canceled;

      return promise.timer(50, token).then(unexpected, e => expect(e).to.match(/cancell?ed/i));
    });

  });

  describe('never', function () {
    this.slow(2000);

    it('should never settle', function () {
      // We cannot test for never; we will settle with longer than 500ms.
      return Promise.race([
        promise.never().then(unexpected),
        promise.timer(500)
      ]);
    });

  });

  describe('deferrer', function () {

    it('should resolve', function () {
      const deferrer = promise.deferrer();

      deferrer.resolve('foo');

      return deferrer.promise.then(v => expect(v).to.equal('foo'));
    });

    it('should reject', function () {
      const deferrer = promise.deferrer();
      const err = new Error();

      deferrer.reject(err);

      return deferrer.promise.then(unexpected, e => expect(e).to.equal(err));
    });

  });

  describe('tap', function () {

    it('should observe a promise value', function () {
      const onValue = sinon.stub().returns('bar');

      return Promise.resolve('foo').then(promise.tap(onValue)).then(value => {
        expect(value).to.equal('foo');
        expect(onValue).to.have.been.calledOnce();
        expect(onValue).to.have.been.calledWithExactly('foo');
      });
    });

    it('should not change the promise chain status', function () {
      const onValue = sinon.stub().throws();

      return Promise.resolve('foo').then(promise.tap(onValue)).then(value => {
        expect(value).to.equal('foo');
        expect(onValue).to.have.been.calledOnce();
        expect(onValue).to.have.been.calledWithExactly('foo');
      });
    });

  });

});

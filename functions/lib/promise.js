/* eslint no-extend-native: ["error", { "exceptions": ["Promise"] }] */

'use strict';

const once = require('lodash.once');

exports.shim = once(() => {
  exports.shimFinally();
  exports.shimTry();
});

exports.shimFinally = once(() => {
  if (typeof Promise.prototype.finally === 'function') {
    return;
  }

  Object.defineProperty(Promise.prototype, 'finally', {
    enumerable: false,
    value: exports.finallyMethod
  });
});

exports.finallyMethod = function (onFinally) {
  const resolve = value => Promise.resolve(onFinally()).then(() => value);

  return this.then(resolve, err => resolve(Promise.reject(err)));
};

exports.shimTry = once(() => {
  if (typeof Promise.try === 'function') {
    return;
  }

  Object.defineProperty(Promise, 'try', {
    enumerable: false,
    value: exports.try
  });
});

exports.try = function (handler) {
  return new Promise(resolve => resolve(handler()));
};

/**
 * Set a timer and settles once the timer expires.
 *
 * @param {number} delay Timer expiring delay
 * @returns {Promise<void>}
 */
exports.timer = function (delay = 0) {
  let timer, reject;
  let resolved = false;

  const promise = new Promise((resolve, _reject) => {
    reject = _reject;
    timer = setTimeout(() => {
      resolve();
      resolved = true;
    }, delay);
  });

  promise.cancel = (err = new Error('cancelled')) => {
    if (resolved) {
      return;
    }

    clearTimeout(timer);
    reject(err);
  };

  return promise;
};

/**
 * Create a promise that will never settle.
 *
 * @returns {Promise<void>}
 */
exports.never = function () {
  return Promise.race([]);
};

/**
 * Deferrer type promise.
 *
 * @returns {{promise: Promise<any>, resolve: function, reject: function}}
 */
exports.deferrer = function () {
  const result = {};

  result.promise = new Promise(((resolve, reject) => {
    result.resolve = resolve;
    result.reject = reject;
  }));

  return result;
};

/**
 * Pass-through function used to inspect the resolving value of promise.
 *
 * @example
 * Promise.resolve(true).then(tap(console.log))
 *   .then(v => assert(v == true))
 *
 * @param {function(value: any): void} cb Called with the resolving value
 * @returns {function(value: any): any}
 */
exports.tap = function (cb) {
  return value => {
    try {
      cb(value);
    } catch (e) {}

    return value;
  };
};

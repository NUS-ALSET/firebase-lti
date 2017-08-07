'use strict';

const admin = require('firebase-admin');
const lti = require('@dinoboff/ims-lti');

const utils = require('./utils');

const EXPIRE_NONCE = 5 * 60 * 1000;

/**
 * NonceStore implement ims-lti NonceStore interface to store the Nonce in
 * a Firebase database.
 *
 * @todo Clear up expired Nonce
 */
class NonceStore extends lti.Stores.NonceStore {

  static hasExpire(ts) {
    if (!Number.isInteger(ts)) {
      return true;
    }

    const delta = Date.now() - (ts * 1000);

    return delta > EXPIRE_NONCE;
  }

  constructor(consumerKey) {
    if (!utils.isValidKey(consumerKey)) {
      throw new Error(`"${consumerKey}" is not a valid firebase key.`);
    }

    super();
    this.consumerKey = consumerKey;
  }

  isNew(nonce, timestamp, next) {
    if (!utils.isValidKey(nonce)) {
      return next(new Error('Invalid nonce format'), false);
    }

    const ts = parseInt(timestamp, 10);

    if (ts == null) {
      return next(new Error('Timestamp required'), false);
    }

    if (NonceStore.hasExpire(ts)) {
      return next(new Error('Expired timestamp'), false);
    }

    this.setUsed(nonce, ts, err => next(err, err == null));
  }

  setUsed(nonce, ts, next) {
    if (!utils.isValidKey(nonce)) {
      next(new Error('Invalid nonce format'), false);
    }

    const db = admin.database();
    const ref = db.ref(`provider/oauth1/${this.consumerKey}/nonces/${nonce}/expireAt`);
    const handler = expireAt => {
      const now = Date.now();

      if (expireAt != null && expireAt > now) {
        return undefined;
      }

      return now + EXPIRE_NONCE;
    };
    const onCompleted = (err, committed) => {
      if (err != null) {
        console.error(err);
        next(new Error('failed to save the nonce in store'));
      } else if (committed) {
        next();
      } else {
        next(new Error('Nonce already seen'));
      }
    };

    ref.transaction(handler, onCompleted);
  }
}

/**
 * Return a Firebase based oauth nonce store.
 *
 * @param {string} key Customer key (domain) to save nonce for
 * @returns {NonceStore}
 */
exports.create = function (key) {
  return new NonceStore(key);
};

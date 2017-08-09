'use strict';

const crypto = require('crypto');
const base64 = require('base64url');

const INVALID_KEY_CHAR = new Set(['$', '#', '[', ']', '/', '.']);

/**
 * Check the key is valid.
 *
 * @param {string[]} keys A string intended to be used as firebase database key
 * @returns {boolean}
 */
exports.isValidKey = function (...keys) {
  return keys.every(key => {
    if (!key || typeof key !== 'string') {
      return false;
    }

    return Array.from(key).some(c => INVALID_KEY_CHAR.has(c)) === false;
  });
};

exports.randomString = function (length) {
  return base64(crypto.randomBytes(length));
};

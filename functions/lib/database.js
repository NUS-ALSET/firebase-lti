'use strict';

const crypto = require('crypto');

const admin = require('firebase-admin');
const base64 = require('base64url');
const functions = require('firebase-functions');

admin.initializeApp(Object.assign(
  {
    databaseAuthVariableOverride: {
      uid: `functions:${randomString(8)}`,
      isWorker: true
    }
  },
  functions.config().firebase
));

module.exports = {

  /**
   * Generate and save oauth1 credentials to firebase.
   *
   * @returns {Promise<{key: string, secret: string}>}
   */
  newCredentials() {
    const db = admin.database();
    const keysRef = db.ref('provider/oauth1');

    const secret = randomString(32);
    const newKeyRef = keysRef.push();

    return newKeyRef
      .set({secret, createdAt: now()})
      .then(() => ({secret, key: newKeyRef.key}));
  }

};

function randomString(length) {
  return base64(crypto.randomBytes(length));
}

function now() {
  return admin.database.ServerValue.TIMESTAMP;
}

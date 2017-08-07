'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const url = require('url');

const admin = require('firebase-admin');
const base64 = require('base64url');
const functions = require('firebase-functions');

const nonceStore = require('./nonce-store');
const utils = require('./utils');

const BASIC_REQUEST = 'basic-lti-launch-request';

admin.initializeApp(config());

/**
 * Return configuration for admin client initialization.
 *
 * Simply using `functions.config()` doesn't allow to create auth token; the
 * client needs service account keys.
 *
 * `functions.config()` is uses to find the project name and the lookup the
 * the service account info at `../${projectId}-service-account.json`.
 *
 * @return {object}
 */
function config() {
  const databaseURL = functions.config().firebase.databaseURL;
  const {hostname} = url.parse(databaseURL);
  const [projectId] = hostname.split('.', 1);

  const jsonPath = path.join(__dirname, `../../${projectId}-service-account.json`);
  const content = fs.readFileSync(jsonPath, 'utf-8');
  const serviceAccount = JSON.parse(content);

  return {
    databaseURL,
    credential: admin.credential.cert(serviceAccount),
    databaseAuthVariableOverride: {
      uid: `functions:${randomString(8)}`,
      isWorker: true
    }
  };
}

module.exports = {

  nonceStore: nonceStore.create,

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
    const key = newKeyRef.key;

    return newKeyRef.child('credentials')
      .set({key, secret, createdAt: now()})
      .then(() => ({key, secret}));
  },

  /**
   * Query the secret for a consumer key.
   *
   * @param {string} key Consumer key
   * @return {Promise<{key: string, secret: string}>}
   */
  getCredentials(key) {

    if (!utils.isValidKey(key)) {
      return Promise.reject(new Error(`"${key}" is not a valid firebase key.`));
    }

    const db = admin.database();
    const ref = db.ref(`provider/oauth1/${key}/credentials`);

    return ref.once('value')
      .then(snapshot => {
        const credentials = snapshot.val();

        if (credentials == null) {
          return Promise.reject(new Error(`Failed query secret for consumer key "${key}"`));
        }

        return credentials;
      });
  },

  launches: {

    /**
     * Fetch or save the activity from the database.
     *
     * @param {@dinoboff/ims-lti.Provider} req lti request
     * @returns {Promise<admin.database.DataSnapshot>}
     */
    init(req) {
      const {consumer_key: domain, body: {resource_link_id: linkId}} = req;

      if (!utils.isValidKey(domain) || !utils.isValidKey(linkId)) {
        return Promise.reject(new Error(`"${domain}/${linkId}" is a valid path for firebase.`));
      }

      const db = admin.database();
      const ref = db.ref(`provider/launches/${domain}/${linkId}/info`);

      return ref.transaction(launch => {
        if (launch != null) {
          return;
        }

        return newLaunch(req);
      }).then(({snapshot}) => {
        if (!snapshot.exists()) {
          return Promise.reject(new Error('Failed to the create activity.'));
        }

        return snapshot;
      });
    },

    /**
     * Create auth token for the lti user.
     *
     * @param {@dinoboff/ims-lti.Provider} req lti request
     * @returns {Promise<string>}
     */
    authenticate(req) {
      return new Promise((resolve, reject) => {
        const {
          userId,
          user: isUser,
          instructor: isInstructor,
          consumer_key: domain
        } = req;

        if (!userId || !domain) {
          return reject(new Error('Users can only register for activity if they have "user" role.'));
        }

        const auth = admin.auth();
        const uid = `${domain}:${userId}`;

        resolve(auth.createCustomToken(uid, {userId, domain, isInstructor, isUser}));
      });
    }

  }

};

function newLaunch(req) {
  const domain = req.consumer_key;
  const {
    lti_message_type: messageType,
    lti_version: version,
    resource_link_id: resourceLinkId
  } = req.body;

  if (
    !messageType ||
    !version ||
    !resourceLinkId ||
    !domain ||
    !req.instructor ||
    messageType !== BASIC_REQUEST
  ) {
    return;
  }

  const custom = Object.keys(req.body)
    .filter(k => k.startsWith('custom_'))
    .reduce((result, k) => {
      result[k.slice(7)] = req.body[k];
      return result;
    }, {});

  return {
    custom,
    domain,
    resourceLinkId,
    contextId: req.body.context_id || null,
    toolConsumerGuid: req.body.tool_consumer_instance_guid || null,
    lti: {messageType, version},
    presentation: {
      target: req.body.launch_presentation_target || null,
      local: req.body.launch_presentation_local || null,
      cssURL: req.body.launch_presentation_css_url || null,
      width: req.body.launch_presentation_width || null,
      height: req.body.launch_presentation_height || null,
      returnURL: req.body.launch_presentation_return_url || null
    }
  };
}

function randomString(length) {
  return base64(crypto.randomBytes(length));
}

function now() {
  return admin.database.ServerValue.TIMESTAMP;
}

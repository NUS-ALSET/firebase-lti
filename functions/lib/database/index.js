'use strict';

const admin = require('firebase-admin');

const config = require('./config');
const nonceStore = require('./nonce-store');
const utils = require('./utils');

module.exports = {
  nonceStore: nonceStore.create,
  config: config.get,

  /**
   * Generate and save oauth1 credentials to firebase.
   *
   * @returns {Promise<{key: string, secret: string}>}
   */
  newCredentials() {
    const db = admin.database();
    const keysRef = db.ref('provider/oauth1');

    const secret = utils.randomString(32);
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
     * Fetch and create if it doesn't exist the activity info.
     *
     * @param {@dinoboff/ims-lti.Provider} req lti request
     * @returns {Promise<admin.database.DataSnapshot>}
     */
    getOrCreate(req) {
      return req.instructor ? module.exports.launches.init(req) : module.exports.launches.get(req);
    },

    /**
     * Fetch or save the activity from the database.
     *
     * @param {@dinoboff/ims-lti.Provider} req lti request
     * @returns {Promise<admin.database.DataSnapshot>}
     */
    init(req) {
      if (!req.instructor) {
        return Promise.reject(new Error('Activities can only be created by users with Instructor role.'));
      }

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
     * Fetch the launch info.
     *
     * @param {@dinoboff/ims-lti.Provider} req lti request
     * @returns {Promise<admin.database.DataSnapshot>}
     */
    get(req) {
      const {consumer_key: domain, body: {resource_link_id: linkId}} = req;
      const db = admin.database();
      const ref = db.ref(`provider/launches/${domain}/${linkId}/info`);

      return ref.once('value').then(snapshot => {
        if (!snapshot.exists()) {
          return Promise.reject(new Error(`No activity at "${ref.toString()}"`));
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
          student: isStudent,
          instructor: isInstructor,
          consumer_key: domain
        } = req;

        if (!userId || !domain) {
          return reject(new Error('Users can only register for activity if they have "user" role.'));
        }

        const auth = admin.auth();
        const uid = `${domain}:${userId}`;

        resolve(auth.createCustomToken(uid, {userId, domain, isInstructor, isStudent}));
      });
    },

    /**
     * Evaluate solution and give it a grade.
     *
     * For this demo, the solution just need to exist.
     *
     * @param {functions.database.DeltaSnapshot|admin.database.DataSnapshot} solution Solution to evaluate
     * @param {{customerKey: string, linkId: string, userId: string}} params Path parameters
     * @returns {Promise<admin.database.Reference>}
     */
    gradeSolution(solution, {consumerKey, linkId, userId}) {
      const path = `provider/launches/${consumerKey}/${linkId}/users/${userId}/grade`;

      if (!utils.isValidKey(consumerKey, linkId, userId)) {
        return new Error(`"${path}" is not a valid firebase path.`);
      }

      const db = admin.database();
      const ref = db.ref(path);

      return ref.set(solution.exists() ? 100 : 0);
    }

  }

};

function newLaunch(req) {
  if (!req.launch_request) {
    throw new Error('Not a launch request');
  }

  const domain = req.consumer_key;
  const {
    lti_message_type: messageType,
    lti_version: version,
    resource_link_id: resourceLinkId
  } = req.body;

  if (!resourceLinkId || !domain) {
    throw new Error('A launch request should have a resource link id and a consumer key.');
  }

  if (!messageType || !version) {
    throw new Error('A launch request should have lti message type and version.');
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
    contextId: req.context_id || null,
    toolConsumerGuid: req.body.tool_consumer_instance_guid || null,
    lti: {messageType, version}
  };
}

function now() {
  return admin.database.ServerValue.TIMESTAMP;
}

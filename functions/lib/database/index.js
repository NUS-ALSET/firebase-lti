'use strict';

const admin = require('firebase-admin');
const uuid = require('uuid/v4');

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
    const key = uuid();

    return keysRef.child(`${key}/credentials`)
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
     * Save/update the launch data to the database.
     *
     * Save the outcome service data; the service url is suppose to be mostly
     * stable but the use "result_sourcedid" from one user might change
     * between each of her requests.
     *
     * @param {@dinoboff/ims-lti.Provider} req lti request
     * @returns {Promise<admin.database.DataSnapshot>}
     */
    init(req) {
      const {consumer_key: domain, body: {resource_link_id: linkId}} = req;

      return new Promise(resolve => {
        const db = admin.database();

        resolve(db.ref(`provider/launches/${domain}/${linkId}`));
      }).then(
        ref => ref.update({
          info: launch(req),
          [`users/${uid(req)}/resultSourceDid`]: sourceDid(req)
        }).then(
          () => ref.child('info').once('value')
        )
      );

    },

    /**
     * Create auth token for the lti user.
     *
     * @param {@dinoboff/ims-lti.Provider} req lti request
     * @returns {Promise<string>}
     */
    authenticate(req) {
      return new Promise(resolve => {
        const {
          student: isStudent,
          instructor: isInstructor
        } = req;

        const auth = admin.auth();

        resolve(auth.createCustomToken(uid(req), {isInstructor, isStudent}));
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

function launch(req) {
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

  return {
    domain,
    resourceLinkId,
    contextId: req.context_id || null,
    toolConsumerGuid: req.body.tool_consumer_instance_guid || null,
    lti: {messageType, version},
    outcomeService: outcomeService(req)
  };
}

function uid(req) {
  const {
    userId,
    consumer_key: domain
  } = req;

  if (!userId || !domain) {
    throw new Error('Users can only register for activity if they have "user" role.');
  }

  return `${domain}:${userId}`;
}

function outcomeService(req) {
  if (!req.outcome_service) {
    return null;
  }

  const {service_url: serviceURL, result_data_types: types} = req.outcome_service;

  return {
    serviceURL,
    resultDataType: types.reduce(
      (acc, type) => Object.assign(acc, {[type]: true}),
      {}
    )
  };
}

function sourceDid(req) {
  return req.outcome_service == null ? null : req.outcome_service.source_did;
}

function now() {
  return admin.database.ServerValue.TIMESTAMP;
}

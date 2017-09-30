'use strict';

const admin = require('firebase-admin');
const uuid = require('uuid/v4');

const config = require('./config');
const nonceStore = require('./nonce-store');
const utils = require('./utils');
const queue = require('./queue');

const database = {
  nonceStore: nonceStore.create,
  config: config.get,

  /**
   * Generate and save oauth1 credentials to firebase.
   *
   * @returns {Promise<{key: string, secret: string}>}
   */
  newCredentials({random} = {}) {
    const db = admin.database();
    const keysRef = db.ref('provider/oauth1');

    const secret = utils.randomString(32);
    const key = uuid({random});

    return keysRef.child(`${key}/credentials`)
      .set({key, secret, createdAt: now()})
      .then(() => ({key, secret}));
  },

  /**
   * Query the secret for a consumer key.
   *
   * @param {string}  key   Consumer key
   * @param {object}  options Options
   * @param {boolean} options.force Reject if the credentials are not found (default to true)
   * @return {Promise<{key: string, secret: string}>}
   */
  getCredentials(key, {force = true} = {}) {

    if (!utils.isValidKey(key)) {
      return Promise.reject(new Error(`"${key}" is not a valid firebase key.`));
    }

    const db = admin.database();
    const ref = db.ref(`provider/oauth1/${key}/credentials`);

    return ref.once('value').then(unpackNode(force));
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
          [`users/${uid(req)}/sourceDid`]: sourceDid(req)
        }).then(
          () => ref.child('info').once('value')
        )
      );

    },

    /**
     * Fetch an activity info.
     *
     * @param {string}  domain        TC consumer key
     * @param {string}  linkId        Activity resource link id
     * @param {object}  options       Options
     * @param {boolean} options.force Reject if the info is not found
     * @returns {Promise<object>}
     */
    getInfo(domain, linkId, {force = false} = {}) {
      return new Promise(resolve => {
        const db = admin.database();

        resolve(db.ref(`provider/launches/${domain}/${linkId}/info`));
      })
        .then(ref => ref.once('value'))
        .then(unpackNode(force));
    },

    /**
     *
     * Fetch a user activity result data.
     *
     * @param {string}  domain        TC consumer key
     * @param {string}  linkId        Activity resource link id
     * @param {string}  userId        Firebase UID of the user
     * @param {object}  options       Options
     * @param {boolean} options.force Reject if the user info is not found
     * @returns {Promise<object>}
     */
    getUser(domain, linkId, userId, {force = false} = {}) {
      return new Promise(resolve => {
        const db = admin.database();

        resolve(db.ref(`provider/launches/${domain}/${linkId}/users/${userId}`));
      })
        .then(ref => ref.once('value'))
        .then(unpackNode(force));
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
    gradeSolution(solution, params) {
      const grade = solution.exists() ? 100 : 0;

      return database.launches.outcomes.push(grade, params);
    },

    outcomes: {

      /**
       * Enqueue an outcome update.
       *
       * Note that there is a race condition: two concurrent processes enqueuing
       * a request for the same launch and user might end up with two enqueue
       * tasks. The task runner must check the task is actually the current
       * pending task for the launch and user.
       *
       * @param {number} grade Grade to save and enqueue outcome request for
       * @param {{customerKey: string, linkId: string, userId: string}} params Path parameters
       * @return {Promise<void>}
       */
      push(grade, {consumerKey, linkId, userId, random}) {
        return database.launches.outcomes.task({consumerKey, linkId, userId}).then(({task, prevTaskId}) => {
          const db = admin.database();
          const providerRef = db.ref('provider');
          const patch = {
            [`launches/${consumerKey}/${linkId}/users/${userId}/grade`]: grade
          };

          if (prevTaskId != null) {
            patch[`outcomes/queue/${prevTaskId}`] = null;
            patch[`launches/${consumerKey}/${linkId}/users/${userId}/outcomeTask`] = null;
          }

          if (task) {
            const taskId = uuid({random});

            patch[`outcomes/queue/${taskId}`] = task;
            patch[`launches/${consumerKey}/${linkId}/users/${userId}/outcomeTask`] = taskId;
          }

          return providerRef.update(patch);
        });
      },

      /**
       * Monitor the queue.
       *
       * Only track a limited number of task at time. As task get completed,
       * more tasks are provided.
       *
       * @param {function(object): Promise<void>} outcomeHandler Function sending the the outcome
       * @param {object} options Options
       * @param {CancellationToken} options.cancelToken Token signaling the queue should close
       * @param {number} options.size Concurrent task limit
       * @param {object} options.timeOut Time out options
       * @param {number} options.timeOut.job Time out for a job
       * @param {number} options.timeOut.idle Time out for task worker idle state
       * @param {number} options.timeOut.retry Delay before resetting a started task
       * @returns {{running: Promise<void>, stop: function(): Promise<void>}}
       */
      process(outcomeHandler, options = {}) {
        const processor = (taskId, task, cancelToken) => database.launches.outcomes.request(taskId, task, cancelToken)
          .then(outcomeHandler);

        options.path = 'provider/outcomes/queue';

        return queue.create(processor, options);
      },

      /**
       * Outcome request task factory.
       *
       * loads details of consumer credentials, one of its activity and one the activity
       * user and returns a task object, ready to be pushed to the task queue.
       *
       * @param {string} taskId The task key in the queue
       * @param {{consumerKey: string, linkId: string, userId: string}} param Task parameters.
       * @returns {Promise<{task: object, prevTaskId: string}>}
       */
      task({consumerKey, linkId, userId}) {
        return Promise.all([
          database.getCredentials(consumerKey, {force: false}),
          database.launches.getInfo(consumerKey, linkId),
          database.launches.getUser(consumerKey, linkId, userId)
        ]).then(([consumer, launch, user]) => {
          if (
            consumer == null ||
            consumer.key == null ||
            consumer.secret == null ||
            launch == null ||
            user == null
          ) {
            return;
          }

          const {sourceDid, outcomeTask: prevTaskId} = user;
          const {outcomeService: service = {}} = launch;
          const {key, secret} = consumer;

          if (
            sourceDid == null ||
            service.url == null
          ) {
            return {prevTaskId};
          }

          return {
            prevTaskId,
            task: {
              consumerKey,
              linkId,
              userId,
              service,
              consumer: {key, secret},
              createdAt: now(),
              started: false
            }
          };
        });
      },

      /**
       * Load LTI outcome request details from the task definition.
       *
       * @param {string} taskId Task id (must be the current task for the user)
       * @param {object} task Task definition
       * @param {CancellationToken} cancelToken Token notifying processing cancellation
       * @returns {Promise<object?>}
       */
      request(taskId, {consumerKey, linkId, userId, service, consumer}, cancelToken) {
        return database.launches.getUser(consumerKey, linkId, userId).then(user => {
          if (user == null) {
            return;
          }

          const {sourceDid, outcomeTask, grade} = user;
          const {url} = service;

          if (!sourceDid || taskId !== outcomeTask) {
            return;
          }

          return {
            url,
            consumer,
            sourceDid,
            cancelToken,
            outcome: {
              score: grade == null ? 0 : grade / 100
            }
          };
        });
      }
    }

  }

};

module.exports = database;

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

  const {service_url: url, result_data_types: types} = req.outcome_service;

  return {
    url,
    dataType: types.reduce(
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

function unpackNode(force = true) {
  if (!force) {
    return snapshot => snapshot.val();
  }

  return snapshot => {
    if (!snapshot.exists()) {
      throw new Error(`${snapshot.ref.toString()} is null`);
    }

    return snapshot.val();
  };
}

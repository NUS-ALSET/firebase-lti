'use strict';

const fs = require('fs');
const path = require('path');

const admin = require('firebase-admin');
const minimist = require('minimist');
const uuid = require('uuid/v4');

const database = require('../lib/database');
const lti = require('../lib/lti');

main();

function main() {
  return new Promise(resolve => resolve(config()))
    .then(conf => admin.initializeApp(conf.firebase))
    .then(processTasks)
    .then(console.log, console.error)
    .then(() => admin.app().delete());
}

function processTasks() {
  const {running, stop} = database.launches.outcomes.process(onNewTask, {size: 5});

  shimSigint();
  process.on('SIGINT', stop);

  return running;
}

function onNewTask(data) {
  const req = lti.sendOutcome(data).catch(err => {
    if (req.canceled) {
      console.error(`Outcome request timed out. Data: ${data}`);

      return;
    }

    if (!err.statusCode || err.statusCode <= 500) {
      console.log(`Bad request: ${err}`);
    }

    return Promise.reject(err);
  });

  return req;
}

function shimSigint() {
  if (process.platform === 'win32') {
    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.on('SIGINT', () => process.emit('SIGINT'));
  }
}

/**
 * Parse cli arguments
 *
 * @param {string[]} argv CLI arguments to parse
 * @returns {{projectId: string, firebase: object}}
 */
function config(argv = process.argv.slice(2)) {
  const args = minimist(argv, {
    alias: {
      projectId: ['p', 'project-id'],
      databaseURL: ['u', 'database-url']
    }
  });
  const {projectId} = args;

  if (!projectId) {
    throw new Error('A project id is required');
  }

  const databaseURL = args.databaseURL || `https://${projectId}.firebaseio.com`;

  return {
    projectId,
    firebase: firebaseConfig({projectId, databaseURL})
  };
}

/**
 * Returns Firebase initialization settings.
 *
 * Assume the "functions/<projectId>-service-account.json" is setup with the
 * service account for this project.
 *
 * @param {{databaseURL: string, projectId: string}} options Firebase project ID and the database URL
 * @returns {object}
 */
function firebaseConfig({databaseURL, projectId}) {
  return {
    databaseURL,
    credential: admin.credential.cert(serviceAccount(projectId)),
    databaseAuthVariableOverride: {
      uid: `monitor:${uuid()}`,
      isWorker: true
    }
  };
}

/**
 * Load service account from "<projectId>-service-account.json" set in the
 * project functions package.
 *
 * @param {string} projectId Project ID to load service account for.
 * @returns {string}
 */
function serviceAccount(projectId) {
  const jsonPath = path.join(__dirname, `../${projectId}-service-account.json`);
  const content = fs.readFileSync(jsonPath, 'utf-8');

  return JSON.parse(content);
}

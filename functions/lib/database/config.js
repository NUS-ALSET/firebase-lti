'use strict';

const fs = require('fs');
const path = require('path');
const url = require('url');

const admin = require('firebase-admin');
const functions = require('firebase-functions');

const utils = require('./utils');

/**
 * Load service account from "<projectId>-service-account.json" set in the
 * project functions package.
 *
 * @param {string} projectId Project ID to load service account for.
 * @returns {string}
 */
exports.serviceAccount = function (projectId) {
  const jsonPath = path.join(__dirname, `../../${projectId}-service-account.json`);
  const content = fs.readFileSync(jsonPath, 'utf-8');

  return JSON.parse(content);
};

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
exports.get = function () {
  const config = functions.config();
  const {databaseURL} = config.firebase;
  const {hostname} = url.parse(databaseURL);
  const [projectId] = hostname.split('.', 1);

  return {
    databaseURL,
    credential: admin.credential.cert(exports.serviceAccount(projectId)),
    databaseAuthVariableOverride: {
      uid: `functions:${utils.randomString(8)}`,
      isWorker: true
    }
  };
};

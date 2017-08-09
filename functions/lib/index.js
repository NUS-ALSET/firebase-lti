/**
 * Functions main package.
 *
 * Register all cloud functions handlers.
 *
 */

'use strict';

const admin = require('firebase-admin');
const functions = require('firebase-functions');

const server = require('./server');
const database = require('./database');

admin.initializeApp(database.config());

exports.server = functions.https.onRequest(server);

exports.verify = functions.database.ref('provider/launches/{consumerKey}/{linkId}/users/{userId}/solution')
  .onWrite(event => database.launches.gradeSolution(event.data, event.params));

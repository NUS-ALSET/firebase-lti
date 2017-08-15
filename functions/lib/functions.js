'use strict';

const functions = require('firebase-functions');

const server = require('./server');
const database = require('./database');

exports.server = functions.https.onRequest(server.create());

exports.verify = functions.database.ref('provider/launches/{consumerKey}/{linkId}/users/{userId}/solution')
  .onWrite(event => database.launches.gradeSolution(event.data, event.params));

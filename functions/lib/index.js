/**
 * Functions main package.
 *
 * Register all cloud functions handlers.
 *
 */

'use strict';

const functions = require('firebase-functions');

const server = require('./server');

exports.server = functions.https.onRequest(server);

/**
 * Functions main package.
 *
 * Register all cloud functions handlers.
 *
 */

'use strict';

const admin = require('firebase-admin');

const database = require('./database');
const functions = require('./functions');

admin.initializeApp(database.config());

module.exports = functions;

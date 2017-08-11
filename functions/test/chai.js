/**
 * Prepare tests and exports test assertions functions (`sinon` and `expect`).
 *
 * This module should always be imported first.
 */

'use strict';

const admin = require('firebase-admin');
const chai = require('chai');
const dirtyChai = require('dirty-chai');
const functions = require('firebase-functions');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');

chai.use(sinonChai);
chai.use(dirtyChai);

exports.chai = chai;
exports.sinon = sinon;
exports.expect = chai.expect;

// Make sure those are never called directly during tests.
sinon.stub(admin, 'initializeApp');
sinon.stub(functions, 'config').returns({
  firebase: {
    databaseURL: 'https://not-a-project.firebaseio.com',
    storageBucket: 'not-a-project.appspot.com'
  }
});

// Restore them after test runs
after(function () {
  admin.initializeApp.restore();
  functions.config.restore();
});

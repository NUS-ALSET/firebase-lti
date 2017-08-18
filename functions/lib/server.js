'use strict';

const exphbs = require('express-handlebars');
const express = require('express');
const handlebars = require('handlebars');

const database = require('./database');
const lti = require('./lti');

const launchURL = '/lti/launch';

/**
 * Create a LTI request handler.
 *
 * @param {function(express.Application)} setup Function to register extra middleware
 * @returns {express.Application}
 */
exports.create = function (setup = app => app) {
  const app = setup(express());

  app.engine('handlebars', exphbs({
    defaultLayout: 'main',
    helpers: {
      json: data => new handlebars.SafeString(JSON.stringify(data))
    }
  }));
  app.set('view engine', 'handlebars');

  app.get(['/', '/lti/'], (req, res) => res.render('index'));
  app.post('/lti/credentials', (req, res, next) => {
    database.newCredentials()
      .then(credentials => res.render(
        'credentials',
        Object.assign(credentials, {launchURL})
      ))
      .catch(next);
  });

  app.post(launchURL, (req, res, next) => {
    lti.parseLaunchReq(req)
      .then(ltiReq => database.launches.init(ltiReq).then(snapshot => ({ltiReq, launch: snapshot.val()})))
      .then(({ltiReq, launch}) => database.launches.authenticate(ltiReq).then(token => ({ltiReq, launch, token})))
      .then(({ltiReq, launch, token}) => res.render('launch', {token, launch, presentation: lti.presentation(ltiReq)}))
      .catch(next);
  });

  return app;
};

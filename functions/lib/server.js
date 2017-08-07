'use strict';

const exphbs = require('express-handlebars');
const express = require('express');
const handlebars = require('handlebars');
const lti = require('@dinoboff/ims-lti');

const database = require('./database');

const app = express();
const launchURL = '/lti/launch';
const LTI_CONTENT_TYPES = {
  'application/x-www-form-urlencoded': true
};

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
  parseLTIReq(req)
    .then(ltiReq => database.launches.init(ltiReq).then(snapshot => ({ltiReq, launch: snapshot.val()})))
    .then(({ltiReq, launch}) => database.launches.authenticate(ltiReq).then(token => ({launch, token})))
    .then(({launch, token}) => res.render('launch', {token, launch}))
    .catch(next);
});

module.exports = app;

/**
 * Validate a request oauth1 credentials and resolve to a LTI provider.
 *
 * Note that
 *
 * @param {express.Request} req Request
 * @returns {Promise<ims-lti.Provider>}
 */
function parseLTIReq(req) {
  return supportedReq(req)
    .then(domain => {
      const key = domain.startsWith('lti') ? domain.slice(3) : domain;

      return database.getCredentials(key);
    })
    .then(({key, secret}) => validateSignature(req, key, secret));
}

function supportedReq(req) {
  return new Promise((resolve, reject) => {
    const {
      headers: {'content-type': enc},
      body: {
        oauth_signature_method: proto,
        oauth_consumer_key: domain
      }
    } = req;

    if (LTI_CONTENT_TYPES[enc] !== true) {
      reject(new Error(`"${enc}" is not a support content type for this application.`));
    }

    if (proto !== 'HMAC-SHA1') {
      reject(new Error(`"${proto}" oauth signature method is not a supported.`));
    }

    resolve(domain);
  });
}

function validateSignature(req, key, secret) {
  return new Promise((resolve, reject) => {
    const provider = new lti.Provider(key, secret, {trustProxy: true});

    provider.valid_request(req, (err, isValid) => {
      if (err != null) {
        return reject(err);
      }

      if (!isValid) {
        return reject(new Error());
      }

      resolve(provider);
    });
  });
}

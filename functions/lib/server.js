'use strict';

const exphbs = require('express-handlebars');
const express = require('express');
const handlebars = require('handlebars');
const lti = require('@dinoboff/ims-lti');
const _HmacSha1 = require('@dinoboff/ims-lti/lib/hmac-sha1');

const database = require('./database');

const launchURL = '/lti/launch';
const LTI_CONTENT_TYPES = {
  'application/x-www-form-urlencoded': true
};

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
    parseLTIReq(req)
      .then(ltiReq => database.launches.init(ltiReq).then(snapshot => ({ltiReq, launch: snapshot.val()})))
      .then(({ltiReq, launch}) => database.launches.authenticate(ltiReq).then(token => ({ltiReq, launch, token})))
      .then(({ltiReq, launch, token}) => res.render('launch', {token, launch, presentation: presentation(ltiReq)}))
      .catch(next);
  });

  return app;
};

class HmacSha1 extends _HmacSha1 {

  protocol(req) {
    if (req.headers['x-appengine-https'] === 'on') {
      return 'https';
    }

    return super.protocol(req);
  }

}

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
    const provider = new lti.Provider(key, secret, {
      // Firebase functions is accessed via a reverse proxy. The lti signature
      // validation needs to use the original hostname and not the functions
      // server one.
      signer: new HmacSha1({trustProxy: true}),

      // Save nonces in datastore and ensure the request oauth1 nonce cannot be
      // used twice.
      nonceStore: database.nonceStore(key)
    });

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

function presentation(req) {
  return {
    target: req.body.launch_presentation_target || null,
    local: req.body.launch_presentation_local || null,
    cssURL: req.body.launch_presentation_css_url || null,
    width: req.body.launch_presentation_width || null,
    height: req.body.launch_presentation_height || null,
    returnURL: req.body.launch_presentation_return_url || null
  };
}

/**
 * @todo move lti related code from server.js here.
 */

'use strict';

const _HmacSha1 = require('@dinoboff/ims-lti/lib/hmac-sha1');
const crypto = require('crypto');
const got = require('got');
const lti = require('@dinoboff/ims-lti');
const OAuth = require('oauth-1.0a');

const database = require('./database');
const promise = require('./promise');

const LTI_CONTENT_TYPES = {
  'application/x-www-form-urlencoded': true
};

promise.shimFinally();

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
exports.parseLaunchReq = function (req) {
  return new Promise(resolve => {
    const key = supportedReq(req);

    resolve(database.getCredentials(key));
  }).then(({key, secret}) => validateSignature(req, key, secret));
};

/**
 * Extract presentation data from LTI request.
 *
 * @param {Promise<ims-lti.Provider>} provider LTI request.
 * @returns {object}
 */
exports.presentation = function (provider) {
  return {
    target: provider.body.launch_presentation_target || null,
    local: provider.body.launch_presentation_local || null,
    cssURL: provider.body.launch_presentation_css_url || null,
    width: provider.body.launch_presentation_width || null,
    height: provider.body.launch_presentation_height || null,
    returnURL: provider.body.launch_presentation_return_url || null
  };
};

exports.sendOutcome = function ({sourceDid, outcome, url, consumer, cancelToken}) {
  const Outcomes = lti.Extensions.Outcomes;
  const body = Outcomes.OutcomeDocument
    .replace(sourceDid, outcome)
    .finalize();
  const request = postOBH({url, body, consumer}).then(res => new Promise((resolve, reject) => Outcomes.parseResponse(res.body, (err, ok) => {
    if (err) {
      reject(err);
    } else if (ok) {
      resolve();
    } else {
      reject(new Error(`Failed to replace outcome.`));
    }
  })));

  if (!cancelToken) {
    return request;
  }

  const registration = cancelToken.register(() => request.cancel());

  request.finally(() => registration.unregister());

  return request;
};

function supportedReq(req) {
  const {
    headers: {'content-type': enc},
    body: {
      oauth_signature_method: proto,
      oauth_consumer_key: domain
    }
  } = req;

  if (LTI_CONTENT_TYPES[enc] !== true) {
    throw new Error(`"${enc}" is not a support content type for this application.`);
  }

  if (proto !== 'HMAC-SHA1') {
    throw new Error(`"${proto}" oauth signature method is not a supported.`);
  }

  if (!domain) {
    throw new Error('No oauth consumer key provided.');
  }

  return domain;
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

function postOBH({url, body, consumer, contentType = 'application/xml'}) {
  /* eslint-disable camelcase */
  const oauth = new OAuth({
    consumer,
    signature_method: 'HMAC-SHA1',
    hash_function: hmacSha1,
    body_hash_function: sha1
  });
  /* eslint-enable camelcase */
  const oauthData = oauth.authorize({
    url,
    data: body,
    method: 'POST',
    includeBodyHash: true
  });
  const headers = Object.assign(oauth.toHeader(oauthData), {
    'content-type': contentType
  });

  return got.post(url, {headers, body, retries: 0});
}

function hmacSha1(baseString, key) {
  return crypto.createHmac('sha1', key).update(baseString).digest('base64');
}

function sha1(data) {
  return crypto.createHash('sha1').update(data).digest('base64');
}

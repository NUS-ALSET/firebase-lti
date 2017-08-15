/* eslint camelcase: off */

'use strict';

const {expect, sinon} = require('./chai');

const bodyParser = require('body-parser');
const oauthSignature = require('oauth-signature');
const request = require('supertest');

const database = require('../lib/database');
const server = require('../lib/server');

const app = server.create(
  app => app.use(bodyParser.urlencoded({extended: false}))
);

function auth(url, params, {method = 'POST', key = 'someKey', secret = 'someSecret', nonce = 'someNonce', ts = Date.now()} = {}) {
  const parameters = Object.assign({
    oauth_consumer_key: key,
    oauth_nonce: nonce,
    oauth_timestamp: (ts / 1000).toFixed(0),
    oauth_callback: 'about:blank'
  }, params, {
    oauth_signature_method: 'HMAC-SHA1',
    oauth_version: '1.0'
  });

  parameters.oauth_signature = oauthSignature.generate(method, url, parameters, secret, null, {
    encodeSignature: true
  });

  return parameters;
}

describe('server', function () {

  describe('POST /lti/launch', function () {

    beforeEach(function () {
      sinon.stub(database, 'getCredentials');
      sinon.stub(database, 'nonceStore');
      sinon.stub(database.launches, 'getOrCreate');
      sinon.stub(database.launches, 'authenticate');
    });

    afterEach(function () {
      database.getCredentials.restore();
      database.nonceStore.restore();
      database.launches.getOrCreate.restore();
      database.launches.authenticate.restore();
    });

    it('should verify request oauth1 signature', function () {
      const url = 'https://example.com/lti/launch';
      const params = auth(url, {
        lti_message_type: 'basic-lti-launch-request',
        lti_version: 'LTI-1p0',
        resource_link_id: 'someResource',
        user_id: 'someInstructor',
        roles: 'Instructor',
        context_id: 'some-context'
      });

      let req = request(app).post('/lti/launch')
        .set('Authorization', 'OAuth')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Forwarded-Host', 'example.com')
        .set('X-Forwarded-Proto', 'https');

      req = Object.keys(params).reduce(
        (r, k) => r.send(`${k}=${params[k]}`),
        req
      );

      const nonceStore = {isNew: sinon.stub().yields(null, true)};
      const launch = {
        domain: 'someKey',
        resourceLinkId: 'someResource'
      };

      database.getCredentials.returns(Promise.resolve({key: 'someKey', secret: 'someSecret'}));
      database.nonceStore.returns(nonceStore);
      database.launches.getOrCreate.returns(Promise.resolve({val: sinon.stub().returns(launch)}));
      database.launches.authenticate.returns(Promise.resolve('someToken'));

      return req.expect(200).then(res => {
        expect(database.getCredentials).to.have.been.calledOnce();
        expect(database.getCredentials).to.have.been.calledWithExactly('someKey');
        expect(nonceStore.isNew).to.have.been.calledOnce();
        expect(nonceStore.isNew).to.have.been.calledWithExactly('someNonce', params.oauth_timestamp, sinon.match.func);
        expect(database.launches.getOrCreate).to.have.been.calledOnce();
        expect(database.launches.getOrCreate).to.have.been.calledWithExactly(sinon.match({
          instructor: true,
          consumer_key: 'someKey',
          body: sinon.match({resource_link_id: 'someResource'})
        }));
        expect(database.launches.authenticate).to.have.been.calledOnce();
        expect(database.launches.authenticate).to.have.been.calledWithExactly(sinon.match({
          userId: 'someInstructor',
          student: false,
          instructor: true,
          consumer_key: 'someKey'
        }));

        expect(res.text).to.match(/token: "someToken"/);
        expect(res.text).to.match(/domain: "someKey"/);
        expect(res.text).to.match(/resourceLinkId: "someResource"/);
      });
    });

  });

});

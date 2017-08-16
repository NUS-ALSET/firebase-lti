/* eslint camelcase: off */

'use strict';

const {expect, sinon} = require('./chai');

const admin = require('firebase-admin');

const database = require('../lib/database');

describe('database', function () {
  let db;

  beforeEach(function () {
    db = {ref: sinon.stub()};
    sinon.stub(admin, 'database').returns(db);
  });

  afterEach(function () {
    admin.database.restore();
  });

  describe('launches', function () {

    describe('init', function () {
      let req, ref, childRef, snapshot;

      beforeEach(function () {
        req = {
          launch_request: true,
          consumer_key: 'foo',
          instructor: true,
          context_id: 'baz',
          userId: 'someUser',
          body: {
            resource_link_id: 'bar',
            lti_message_type: 'basic-lti-launch-request',
            lti_version: 'LTI-1p0',
            tool_consumer_instance_guid: 'someTC'
          }
        };

        snapshot = {};
        childRef = {
          once: sinon.stub().returns(Promise.resolve(snapshot))
        };
        ref = {
          update: sinon.stub().returns(Promise.resolve({})),
          child: sinon.stub().withArgs('info').returns(childRef)
        };

        db.ref.returns(ref);
      });

      it('should save request info', function () {
        return database.launches.init(req).then(result => {
          expect(result).to.equal(snapshot);

          expect(db.ref).to.have.been.calledOnce();
          expect(db.ref).to.have.been.calledWithExactly('provider/launches/foo/bar');

          expect(ref.update).to.have.been.calledOnce();
          expect(ref.update).to.have.been.calledWith({
            info: {
              domain: 'foo',
              resourceLinkId: 'bar',
              contextId: 'baz',
              toolConsumerGuid: 'someTC',
              lti: {
                messageType: 'basic-lti-launch-request',
                version: 'LTI-1p0'
              },
              outcomeService: null
            },
            'users/foo:someUser/resultSourceDid': null
          });
        });
      });

      it('should reject if the consumer key is missing', function () {
        delete req.consumer_key;

        return database.launches.init(req).then(
          () => Promise.reject(new Error('inspected')),
          () => {}
        );
      });

      it('should reject if the resource link is missing', function () {
        delete req.body.resource_link_id;

        return database.launches.init(req).then(
          () => Promise.reject(new Error('inspected')),
          () => {}
        );
      });

      it('should reject if the lti version is missing', function () {
        delete req.body.lti_version;

        return database.launches.init(req).then(
          () => Promise.reject(new Error('inspected')),
          () => {}
        );
      });

      it('should reject if the lti message type is missing', function () {
        delete req.body.lti_message_type;

        return database.launches.init(req).then(
          () => Promise.reject(new Error('inspected')),
          () => {}
        );
      });

    });

    describe('gradeSolution', function () {

      [
        {exists: true, grade: 100},
        {exists: false, grade: 0}
      ].forEach(function (test) {
        it(`should set the user grade to ${test.grade} if the solution ${test.exists ? '' : 'does not'} exist`, function () {
          const solution = {exists: sinon.stub().returns(test.exists)};
          const params = {
            consumerKey: 'someKey',
            linkId: 'someResource',
            userId: 'someKey:someUser'
          };
          const ref = {set: sinon.stub().returns(Promise.resolve())};

          db.ref.returns(ref);

          return database.launches.gradeSolution(solution, params).then(() => {
            expect(db.ref).to.have.been.calledOnce();
            expect(db.ref).to.have.been.calledWithExactly('provider/launches/someKey/someResource/users/someKey:someUser/grade');

            expect(ref.set).to.have.been.calledOnce();
            expect(ref.set).to.have.been.calledWithExactly(test.grade);
          });
        });
      });

    });

  });

});

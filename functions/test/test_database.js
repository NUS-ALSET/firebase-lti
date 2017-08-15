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

    describe('getOrCreate', function () {

      beforeEach(function () {
        sinon.stub(database.launches, 'get');
        sinon.stub(database.launches, 'init');
      });

      afterEach(function () {
        database.launches.get.restore();
        database.launches.init.restore();
      });

      it('should save the info the user has the instructor role', function () {
        const req = {instructor: true};

        database.launches.getOrCreate(req);
        expect(database.launches.init).to.have.been.calledOnce();
        expect(database.launches.init).to.have.been.calledWithExactly(req);
      });

      it('should only fetch the info the user has the instructor role', function () {
        const req = {instructor: false};

        database.launches.getOrCreate(req);
        expect(database.launches.init).to.not.have.been.calledOnce();
        expect(database.launches.get).to.have.been.calledOnce();
        expect(database.launches.get).to.have.been.calledWithExactly(req);
      });

    });

    describe('init', function () {
      let req, ref, snapshot;

      beforeEach(function () {
        req = {
          launch_request: true,
          consumer_key: 'foo',
          instructor: true,
          context_id: 'baz',
          body: {
            resource_link_id: 'bar',
            lti_message_type: 'basic-lti-launch-request',
            lti_version: 'LTI-1p0',
            tool_consumer_instance_guid: 'someTC'
          }
        };

        snapshot = {exists: sinon.stub().returns(true)};
        ref = {
          transaction: sinon.stub()
            .returns(Promise.resolve({snapshot, committed: true}))
        };

        db.ref.returns(ref);
      });

      it('should save request info if they do not exist', function () {
        return database.launches.init(req).then(result => {
          expect(result).to.equal(snapshot);
          expect(db.ref).to.have.been.calledOnce();
          expect(db.ref).to.have.been.calledWithExactly('provider/launches/foo/bar/info');
          expect(ref.transaction).to.have.been.calledOnce();
          expect(ref.transaction).to.have.been.calledWith(sinon.match.func);

          return ref.transaction.lastCall.args[0];
        }).then(
          txHandler => expect(txHandler(null)).to.eql({
            custom: {},
            domain: 'foo',
            resourceLinkId: 'bar',
            contextId: 'baz',
            toolConsumerGuid: 'someTC',
            lti: {
              messageType: 'basic-lti-launch-request',
              version: 'LTI-1p0'
            },
            presentation: {
              target: null,
              local: null,
              cssURL: null,
              width: null,
              height: null,
              returnURL: null
            }
          })
        );
      });

      it('should not save the info if it already exists', function () {
        return database.launches.init(req).then(() => {
          expect(ref.transaction).to.have.been.calledOnce();
          expect(ref.transaction).to.have.been.calledWith(sinon.match.func);

          return ref.transaction.lastCall.args[0];
        }).then(
          txHandler => expect(txHandler({})).to.be.undefined()
        );
      });

      it('should reject if the user is not an instructor', function () {
        delete req.instructor;

        return database.launches.init(req).then(
          () => Promise.reject(new Error('inspected')),
          () => {}
        );
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

        return database.launches.init(req).then(() => {
          expect(ref.transaction).to.have.been.calledOnce();
          expect(ref.transaction).to.have.been.calledWith(sinon.match.func);

          return ref.transaction.lastCall.args[0];
        }).then(
          txHandler => expect(() => txHandler(null)).to.throw()
        );
      });

      it('should reject if the lti message type is missing', function () {
        delete req.body.lti_message_type;

        return database.launches.init(req).then(() => {
          expect(ref.transaction).to.have.been.calledOnce();
          expect(ref.transaction).to.have.been.calledWith(sinon.match.func);

          return ref.transaction.lastCall.args[0];
        }).then(
          txHandler => expect(() => txHandler(null)).to.throw()
        );
      });

    });

    describe('get', function () {

      it('should fetch the launch info', function () {
        const snapshot = {exists: sinon.stub().returns(true)};
        const ref = {once: sinon.stub()};
        const req = {consumer_key: 'foo', body: {resource_link_id: 'bar'}};

        db.ref.returns(ref);
        ref.once.withArgs('value').returns(Promise.resolve(snapshot));

        return database.launches.get(req).then(result => {
          expect(result).to.equal(snapshot);
          expect(db.ref).to.have.been.calledOnce();
          expect(db.ref).to.have.been.calledWithExactly('provider/launches/foo/bar/info');
        });
      });

      it('should reject if the info are missing', function () {
        const snapshot = {exists: sinon.stub().returns(false)};
        const ref = {once: sinon.stub()};
        const req = {consumer_key: 'foo', body: {resource_link_id: 'bar'}};

        db.ref.returns(ref);
        ref.once.withArgs('value').returns(Promise.resolve(snapshot));

        return database.launches.get(req).then(
          () => Promise.reject(new Error('unexpected')),
          () => {}
        );
      });

    });

  });

});

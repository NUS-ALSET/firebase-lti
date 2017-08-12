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

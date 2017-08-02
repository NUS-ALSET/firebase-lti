'use strict';

const {expect, getRules, targaryen} = require('./chai');

const anom = () => null;
const bob = () => ({uid: 'bob'});
const worker = () => ({uid: 'functions:123', isWorker: true});
const now = () => ({'.sv': 'timestamp'});

describe('firebase rules', function () {
  const rules = getRules();

  beforeEach(function () {
    targaryen.setFirebaseData({});
    targaryen.setFirebaseRules(rules);
  });

  it('should deny read by default', function () {
    expect(anom()).cannot.read.path('/');
    expect(bob()).cannot.read.path('/');
    expect(worker()).cannot.read.path('/');
  });

  it('should deny write by default', function () {
    expect(anom()).cannot.write({foo: 'bar'}).path('/');
    expect(bob()).cannot.write({foo: 'bar'}).path('/');
    expect(worker()).cannot.write({foo: 'bar'}).path('/');
  });

  describe('for /provider/oauth1', function () {

    beforeEach(function () {
      targaryen.setFirebaseData({provider: {oauth1: {someKey: {
        createdAt: Date.now(),
        secret: 'some secret'
      }}}});
    });

    it('should deny read to anyone expect functions workers', function () {
      expect(anom()).cannot.read.path('/provider/oauth1/someKey');
      expect(bob()).cannot.read.path('/provider/oauth1/someKey');
      expect(worker()).can.read.path('/provider/oauth1/someKey');
    });

    it('should allow creating of new key', function () {
      expect(anom()).can.write({secret: 'some secret', createdAt: now()}).to.path('/provider/oauth1/someOtherKey');
    });

    it('should deny updating keys', function () {
      expect(anom()).cannot.write('some new secret').to.path('/provider/oauth1/someKey/secret');
      expect(worker()).cannot.write('some new secret').to.path('/provider/oauth1/someKey/secret');
    });

    it('should deny deleting keys', function () {
      expect(anom()).cannot.write(null).to.path('/provider/oauth1/someKey');
      expect(worker()).cannot.write(null).to.path('/provider/oauth1/someKey');
    });

  });

});

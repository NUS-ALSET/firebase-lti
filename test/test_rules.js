'use strict';

const { expect, getRules, targaryen} = require('./chai');

const anom = () => null;
const bob = () => ({uid: 'bob'});

describe('firebase rules', function () {
  const rules = getRules();

  beforeEach(function () {
    targaryen.setFirebaseData({});
    targaryen.setFirebaseRules(rules);
  });

  it('should deny read by default', function() {
    expect(anom()).cannot.read.path('/');
    expect(bob()).cannot.read.path('/');
  });

  it('should deny write by default', function () {
    expect(anom()).cannot.write({foo: 'bar'}).path('/');
    expect(bob()).cannot.write({foo: 'bar'}).path('/');
  });

});

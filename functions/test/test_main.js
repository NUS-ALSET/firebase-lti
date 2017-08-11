'use strict';

const {expect, sinon} = require('./chai');

const admin = require('firebase-admin');

const database = require('../lib/database');

describe('main', () => {
  const load = (path = '../') => {
    const mod = require(path);

    delete require.cache[require.resolve(path)];
    return mod;
  };

  beforeEach(function () {
    sinon.stub(database, 'config');
  });

  afterEach(function () {
    database.config.restore();
  });

  it('should initialize firebase admin client', function () {
    const config = {some: 'settings'};

    database.config.returns(config);
    load();

    expect(admin.initializeApp).to.have.been.calledOnce();
    expect(admin.initializeApp).to.have.been.calledWithExactly(config);
  });

});

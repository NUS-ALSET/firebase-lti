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
      targaryen.setFirebaseData({
        provider: {
          oauth1: {
            someKey: {
              credentials: {
                key: 'someKey',
                createdAt: Date.now(),
                secret: 'some secret'
              }
            }
          }
        }
      });
    });

    it('should deny read to anyone expect functions workers', function () {
      expect(anom()).cannot.read.path('/provider/oauth1/someKey/credentials');
      expect(bob()).cannot.read.path('/provider/oauth1/someKey/credentials');
      expect(worker()).can.read.path('/provider/oauth1/someKey/credentials');
    });

    it('should allow creating of new key', function () {
      expect(anom()).can.write({
        key: 'someOtherKey',
        secret: 'some secret',
        createdAt: now()
      }).to.path('/provider/oauth1/someOtherKey/credentials');
    });

    it('should deny updating keys', function () {
      expect(anom()).cannot.write('some new secret').to.path('/provider/oauth1/someKey/credentials/secret');
      expect(worker()).cannot.write('some new secret').to.path('/provider/oauth1/someKey/credentials/secret');
    });

    it('should deny deleting keys', function () {
      expect(anom()).cannot.write(null).to.path('/provider/oauth1/someKey/credentials');
      expect(worker()).cannot.write(null).to.path('/provider/oauth1/someKey/credentials');
    });

  });

  describe('for /provider/outcomes/queue', function () {
    const initialTimeStamp = 123000;
    const tick = delta => initialTimeStamp + (delta * 1000);
    let newTask;

    beforeEach(function () {
      newTask = {
        'launches/someResourceId/users/someConsumerKey:someThirdId/grade': 100,
        'outcomes/queue/someNewTaskId': {
          consumerKey: 'someConsumerKey',
          linkId: 'someResourceId',
          userId: 'someConsumerKey:someThirdId',
          consumer: {
            key: 'someConsumerKey',
            secret: 'someSecret'
          },
          service: {
            url: 'http://example.com'
          },
          createdAt: now(),
          started: false
        },
        'launches/someResourceId/users/someConsumerKey:someThirdId/outcomeTask': 'someNewTaskId'
      };

      targaryen.setFirebaseData({
        provider: {
          launches: {
            someConsumerKey: {
              someResourceId: {
                info: {
                  contextId: 'someContext',
                  domain: 'someConsumerKey',
                  lti: {
                    messageType: 'basic-lti-launch-request',
                    version: 'LTI-1p0'
                  },
                  outcomeService: {
                    url: 'http://example.com'
                  },
                  resourceLinkId: 'someResourceId'
                },
                users: {
                  'someConsumerKey:someId': {
                    grade: 100,
                    solution: {
                      clicked: true
                    },
                    sourceDid: 'someSourceDid'
                  },
                  'someConsumerKey:someOtherId': {
                    grade: 100,
                    solution: {
                      clicked: true
                    },
                    sourceDid: 'someSourceDid'
                  },
                  'someConsumerKey:someThirdId': {
                    sourceDid: 'someSourceDid'
                  }
                }
              }
            }
          },
          oauth1: {
            someConsumerKey: {
              credentials: {
                createdAt: tick(-1),
                key: 'someConsumerKey',
                secret: 'someSecret'
              }
            }
          },
          outcomes: {
            queue: {
              someTaskId: {
                consumerKey: 'someConsumerKey',
                linkId: 'someResourceId',
                userId: 'someConsumerKey:someId',
                consumer: {
                  key: 'someConsumerKey',
                  secret: 'someSecret'
                },
                service: {
                  url: 'http://example.com'
                },
                started: false,
                createdAt: now()
              },
              someStartedTaskId: {
                consumerKey: 'someConsumerKey',
                linkId: 'someResourceId',
                userId: 'someConsumerKey:someOtherId',
                consumer: {
                  key: 'someConsumerKey',
                  secret: 'someSecret'
                },
                service: {
                  url: 'http://example.com'
                },
                createdAt: tick(-1),
                started: true,
                startedAt: now()
              }
            }
          }
        }
      }, initialTimeStamp);
    });

    it('should allow worker to enqueue outcome tasks', function () {
      expect(worker()).can.patch(newTask).to.path('/provider');
    });

    it('should allow worker to start outcome tasks', function () {
      expect(anom()).cannot.write(now()).to.path('/provider/outcomes/queue/someTaskId/startedAt');
      expect(worker()).can.write(now()).to.path('/provider/outcomes/queue/someTaskId/startedAt');
    });

    it('should allow worker to reset timed out outcome tasks', function () {
      expect(anom()).cannot.patch({started: false, startedAt: null}, tick(20)).to.path('/provider/outcomes/queue/someStartedTaskId');
      expect(worker()).cannot.patch({started: false, startedAt: null}, tick(20)).to.path('/provider/outcomes/queue/someStartedTaskId');
      expect(anom()).cannot.patch({started: false, startedAt: null}, tick(21)).to.path('/provider/outcomes/queue/someStartedTaskId');
      expect(worker()).can.patch({started: false, startedAt: null}, tick(21)).to.path('/provider/outcomes/queue/someStartedTaskId');
    });

    it('should allow worker to complete outcome tasks', function () {
      expect(anom()).cannot.write(null).to.path('/provider/outcomes/queue/someTaskId');
      expect(worker()).can.write(null).to.path('/provider/outcomes/queue/someTaskId');
    });

  });

});

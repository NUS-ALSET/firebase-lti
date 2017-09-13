/* eslint camelcase: off */

'use strict';

const {expect, sinon} = require('./chai');

const admin = require('firebase-admin');

const database = require('../lib/database');
const queue = require('../lib/database/queue');

const noop = () => {};
const snapshot = (val, {ref = {toString: () => 'some/path'}} = {}) => ({
  ref,
  val: () => val,
  exists: () => val != null
});

describe('database', function () {
  let db;

  beforeEach(function () {
    db = {ref: sinon.stub()};
    sinon.stub(admin, 'database').returns(db);
  });

  afterEach(function () {
    admin.database.restore();
  });

  describe('getCredentials', function () {
    const domain = 'someDomain';

    it('should resolve to the domain credentials', function () {
      const credentials = {};
      const ref = {once: sinon.stub().withArgs('value').resolves(snapshot(credentials))};

      db.ref.withArgs('provider/oauth1/someDomain/credentials').returns(ref);

      return database.getCredentials(domain).then(
        result => expect(result).to.equal(credentials)
      );
    });

    it('should resolve to null when credentials are not set and force is set to false', function () {
      const credentials = null;
      const ref = {once: sinon.stub().withArgs('value').resolves(snapshot(credentials))};

      db.ref.withArgs('provider/oauth1/someDomain/credentials').returns(ref);

      return database.getCredentials(domain, {force: false}).then(
        result => expect(result).to.equal(credentials)
      );
    });

    it('should reject when credentials are not set (with default options)', function () {
      const credentials = null;
      const ref = {once: sinon.stub().withArgs('value').resolves(snapshot(credentials))};

      db.ref.withArgs('provider/oauth1/someDomain/credentials').returns(ref);

      return database.getCredentials(domain).then(
        () => Promise.reject(new Error('unexpected')),
        noop
      );
    });
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
            'users/foo:someUser/sourceDid': null
          });
        });
      });

      it('should reject if the consumer key is missing', function () {
        delete req.consumer_key;

        return database.launches.init(req).then(
          () => Promise.reject(new Error('inspected')),
          noop
        );
      });

      it('should reject if the resource link is missing', function () {
        delete req.body.resource_link_id;

        return database.launches.init(req).then(
          () => Promise.reject(new Error('inspected')),
          noop
        );
      });

      it('should reject if the lti version is missing', function () {
        delete req.body.lti_version;

        return database.launches.init(req).then(
          () => Promise.reject(new Error('inspected')),
          noop
        );
      });

      it('should reject if the lti message type is missing', function () {
        delete req.body.lti_message_type;

        return database.launches.init(req).then(
          () => Promise.reject(new Error('inspected')),
          noop
        );
      });

    });

    describe('getInfo', function () {
      const domain = 'someDomain';
      const linkId = 'someResource';

      it('should resolve to the launch info', function () {
        const info = {};
        const infoRef = {once: sinon.stub().withArgs('value').resolves(snapshot(info))};

        db.ref.withArgs('provider/launches/someDomain/someResource/info').returns(infoRef);

        return database.launches.getInfo(domain, linkId).then(
          result => expect(result).to.equal(info)
        );
      });

      it('should resolve to null when info is not set (with default options)', function () {
        const info = null;
        const infoRef = {once: sinon.stub().withArgs('value').resolves(snapshot(info))};

        db.ref.withArgs('provider/launches/someDomain/someResource/info').returns(infoRef);

        return database.launches.getInfo(domain, linkId).then(
          result => expect(result).to.equal(info)
        );
      });

      it('should reject when info not set and force is set to true', function () {
        const info = null;
        const infoRef = {once: sinon.stub().withArgs('value').resolves(snapshot(info))};

        db.ref.withArgs('provider/launches/someDomain/someResource/info').returns(infoRef);

        return database.launches.getInfo(domain, linkId, {force: true}).then(
          () => Promise.reject(new Error('unexpected')),
          noop
        );
      });
    });

    describe('getUser', function () {
      const domain = 'someDomain';
      const linkId = 'someResource';
      const userId = 'someDomain:someId';

      it('should resolve to the user info', function () {
        const user = {};
        const userRef = {once: sinon.stub().withArgs('value').resolves(snapshot(user))};

        db.ref.withArgs('provider/launches/someDomain/someResource/users/someDomain:someId').returns(userRef);

        return database.launches.getUser(domain, linkId, userId).then(
          result => expect(result).to.equal(user)
        );
      });

      it('should resolve to null when user info is not set (with default options)', function () {
        const user = null;
        const userRef = {once: sinon.stub().withArgs('value').resolves(snapshot(user))};

        db.ref.withArgs('provider/launches/someDomain/someResource/users/someDomain:someId').returns(userRef);

        return database.launches.getUser(domain, linkId, userId).then(
          result => expect(result).to.equal(user)
        );
      });

      it('should reject when user info is not set and force is set to true', function () {
        const user = null;
        const userRef = {once: sinon.stub().withArgs('value').resolves(snapshot(user))};

        db.ref.withArgs('provider/launches/someDomain/someResource/users/someDomain:someId').returns(userRef);

        return database.launches.getUser(domain, linkId, userId, {force: true}).then(
          () => Promise.reject(new Error('unexpected')),
          noop
        );
      });
    });

    describe('gradeSolution', function () {

      beforeEach(function () {
        sinon.stub(database.launches.outcomes, 'push');
        database.launches.outcomes.push.returns(Promise.resolve());
      });

      afterEach(function () {
        database.launches.outcomes.push.restore();
      });

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

          return database.launches.gradeSolution(solution, params).then(() => {
            expect(database.launches.outcomes.push).to.have.been.calledOnce();
            expect(database.launches.outcomes.push).to.have.been.calledWithExactly(test.grade, params);
          });
        });
      });

    });

    describe('outcomes', function () {

      describe('task', function () {

        beforeEach(function () {
          sinon.stub(database, 'getCredentials');
          sinon.stub(database.launches, 'getInfo');
          sinon.stub(database.launches, 'getUser');
        });

        afterEach(function () {
          database.getCredentials.restore();
          database.launches.getInfo.restore();
          database.launches.getUser.restore();
        });

        [{
          desc: 'should query credentials, launch info and user info for an outcome request'
        }, {
          desc: 'should resolve to void if the credentials are missing',
          consumer: () => null,
          expected: noop
        }, {
          desc: 'should resolve to void if the consumer key is missing',
          consumer: () => ({secret: 'someSecret'}),
          expected: noop
        }, {
          desc: 'should resolve to void if the consumer secret is missing',
          secret: () => null,
          expected: noop
        }, {
          desc: 'should resolve to void if the launch info are missing',
          info: () => null,
          expected: noop
        }, {
          desc: 'should resolve to void if the user info are missing',
          user: () => null,
          expected: noop
        }, {
          desc: 'should resolve to the the previous task id only if the service url is missing',
          url: () => null,
          expected: () => ({prevTaskId: 'somePreviousTaskId'})
        }, {
          desc: 'should resolve to the the previous task id only if the sourceDid is missing',
          sourceDid: () => null,
          expected: () => ({prevTaskId: 'somePreviousTaskId'})
        }].forEach(function (t) {
          const {
            desc,
            consumerKey = () => 'someDomain',
            linkId = () => 'someResource',
            userId = () => 'someDomain:someId',
            secret = () => 'someSecret',
            consumer = () => ({key: consumerKey(), secret: secret()}),
            url = () => 'http://example.com',
            info = () => ({outcomeService: {url: url()}}),
            sourceDid = () => 'someDid',
            prevTaskId = () => 'somePreviousTaskId',
            user = () => ({grade: 100, sourceDid: sourceDid(), outcomeTask: prevTaskId()}),
            expected = () => ({
              prevTaskId: prevTaskId(),
              task: {
                consumerKey: consumerKey(),
                linkId: linkId(),
                userId: userId(),
                service: {url: url()},
                consumer: consumer(),
                createdAt: admin.database.ServerValue.TIMESTAMP,
                started: false
              }
            })
          } = t;

          it(desc, function () {
            const params = {
              consumerKey: consumerKey(),
              linkId: linkId(),
              userId: userId()
            };

            database.getCredentials.withArgs(params.consumerKey, {force: false}).resolves(consumer());
            database.launches.getInfo.withArgs(params.consumerKey, params.linkId).resolves(info());
            database.launches.getUser.withArgs(params.consumerKey, params.linkId, params.userId).resolves(user());

            return database.launches.outcomes.task(params).then(result => {
              expect(database.getCredentials).to.have.been.calledOnce();
              expect(database.launches.getInfo).to.have.been.calledOnce();
              expect(database.launches.getUser).to.have.been.calledOnce();
              expect(result).to.eql(expected());
            });
          });
        });
      });

      describe('push', function () {
        const consumerKey = 'someDomain';
        const linkId = 'someLinkId';
        const userId = 'someDomain:someId';
        const grade = 100;
        // Uuid random source to get predictable ids
        const random = Array.from({length: 16}).fill(0);

        beforeEach(function () {
          sinon.stub(database.launches.outcomes, 'task').resolves();
        });

        afterEach(function () {
          database.launches.outcomes.task.restore();
        });

        it('should push a task and save the user grade and current pending task id', function () {
          const task = {some: 'prop'};
          const ref = {update: sinon.stub().resolves()};

          db.ref.withArgs('provider').returns(ref);
          database.launches.outcomes.task.withArgs({consumerKey, linkId, userId}).resolves({task});

          return database.launches.outcomes.push(grade, {consumerKey, linkId, userId, random}).then(() => {
            expect(database.launches.outcomes.task).to.have.been.calledOnce();
            expect(ref.update).to.have.been.calledOnce();
            expect(ref.update).to.have.been.calledWithExactly({
              'outcomes/queue/00000000-0000-4000-8000-000000000000': task,
              'launches/someDomain/someLinkId/users/someDomain:someId/grade': 100,
              'launches/someDomain/someLinkId/users/someDomain:someId/outcomeTask': '00000000-0000-4000-8000-000000000000'
            });
          });
        });

        it('should push a task, save the user grade and current pending task id and remove previous task', function () {
          const task = {some: 'prop'};
          const ref = {update: sinon.stub().resolves()};
          const prevTaskId = '00000000-0000-4000-8000-previous0000';

          db.ref.withArgs('provider').returns(ref);
          database.launches.outcomes.task.withArgs({consumerKey, linkId, userId}).resolves({task, prevTaskId});

          return database.launches.outcomes.push(grade, {consumerKey, linkId, userId, random}).then(() => {
            expect(database.launches.outcomes.task).to.have.been.calledOnce();
            expect(ref.update).to.have.been.calledOnce();
            expect(ref.update).to.have.been.calledWithExactly({
              'outcomes/queue/00000000-0000-4000-8000-previous0000': null,
              'outcomes/queue/00000000-0000-4000-8000-000000000000': task,
              'launches/someDomain/someLinkId/users/someDomain:someId/grade': 100,
              'launches/someDomain/someLinkId/users/someDomain:someId/outcomeTask': '00000000-0000-4000-8000-000000000000'
            });
          });
        });

        it('should remove previous task when there\'s no task to push', function () {
          const ref = {update: sinon.stub().resolves()};
          const prevTaskId = '00000000-0000-4000-8000-previous0000';

          db.ref.withArgs('provider').returns(ref);
          database.launches.outcomes.task.withArgs({consumerKey, linkId, userId}).resolves({prevTaskId});

          return database.launches.outcomes.push(grade, {consumerKey, linkId, userId, random}).then(() => {
            expect(database.launches.outcomes.task).to.have.been.calledOnce();
            expect(ref.update).to.have.been.calledOnce();
            expect(ref.update).to.have.been.calledWithExactly({
              'outcomes/queue/00000000-0000-4000-8000-previous0000': null,
              'launches/someDomain/someLinkId/users/someDomain:someId/grade': 100,
              'launches/someDomain/someLinkId/users/someDomain:someId/outcomeTask': null
            });
          });
        });

      });

      describe('request', function () {
        const consumerKey = 'someDomain';
        const linkId = 'someLinkId';
        const userId = 'someDomain:someId';
        const taskId = 'someTaskId';
        let task;

        beforeEach(function () {
          task = {
            consumerKey,
            linkId,
            userId,
            service: {url: 'http://example.com'},
            consumer: {key: 'someDomain', secret: 'someSecret'},
            createdAt: 123000,
            started: false
          };

          sinon.stub(database.launches, 'getUser');
        });

        afterEach(function () {
          database.launches.getUser.restore();
        });

        [{
          desc: 'should load the lti request parameters 1/3'
        }, {
          desc: 'should load the lti request parameters 2/3',
          grade: () => undefined,
          score: () => 0
        }, {
          desc: 'should load the lti request parameters 3/3',
          grade: () => 0,
          score: () => 0
        }, {
          desc: 'should resolve to void if the user data are null',
          user: () => null,
          expected: () => undefined
        }, {
          desc: 'should resolve to void if the user has no sourceDid',
          sourceDid: () => undefined,
          expected: () => undefined
        }, {
          desc: 'should resolve to void if the task is not the user current task',
          outcomeTask: () => 'someOtherTaskId',
          expected: () => undefined
        }].forEach(function ({
          desc,
          grade = () => 100,
          score = () => 1,
          sourceDid = () => 'someSourceDid',
          outcomeTask = () => taskId,
          user = () => ({
            grade: grade(),
            sourceDid: sourceDid(),
            outcomeTask: outcomeTask()
          }),
          expected = () => ({
            sourceDid: 'someSourceDid',
            outcome: {score: score()},
            url: 'http://example.com',
            consumer: {key: 'someDomain', secret: 'someSecret'}
          })
        }) {
          it(desc, function () {
            database.launches.getUser.withArgs(consumerKey, linkId, userId).resolves(user());

            return database.launches.outcomes.request(taskId, task).then(req => {
              expect(req).to.eql(expected());
            });
          });
        });

      });

      describe('process', function () {
        let outcomeQueue;

        beforeEach(function () {
          outcomeQueue = {some: 'prop'};

          sinon.stub(queue, 'create').returns(outcomeQueue);
          sinon.stub(database.launches.outcomes, 'request');
        });

        afterEach(function () {
          queue.create.restore();
          database.launches.outcomes.request.restore();
        });

        it('should create a queue for the outcome tasks', function () {
          const handler = () => {};

          expect(database.launches.outcomes.process(handler)).to.equal(outcomeQueue);
          expect(queue.create).to.have.been.calledOnce();
          expect(queue.create).to.have.been.calledWithExactly(sinon.match.func, {path: 'provider/outcomes/queue'});
        });

        it('should create task processing tasks', function () {
          const handler = sinon.stub();

          database.launches.outcomes.process(handler);

          const [processor] = queue.create.lastCall.args;
          const taskId = 'someTaskId';
          const task = {some: 'task'};
          const timer = {some: 'timer'};
          const req = {some: 'req'};

          database.launches.outcomes.request.resolves(req);

          return processor(taskId, task, timer).then(() => {
            expect(handler).to.have.been.calledOnce();
            expect(handler).to.have.been.calledWithExactly(req);
            expect(req.timer).to.equal(timer);
          });
        });

      });

    });

  });

});

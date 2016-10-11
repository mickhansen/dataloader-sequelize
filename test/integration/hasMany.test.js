import Sequelize from 'sequelize';
import {connection, randint} from '../helper';
import sinon from 'sinon';
import dataloaderSequelize from '../../src';
import expect from 'unexpected';

describe('hasMany', function () {
  beforeEach(async function () {
    this.sandbox = sinon.sandbox.create();
  });
  afterEach(function () {
    this.sandbox.restore();
  });

  describe('simple association', function () {
    beforeEach(async function () {
      this.sandbox = sinon.sandbox.create();

      this.User = connection.define('user', {
        awesome: Sequelize.BOOLEAN
      });
      this.Project = connection.define('project');

      this.Project.hasMany(this.User, {
        as: 'members'
      });

      await connection.sync({
        force: true
      });

      [this.project1, this.project2, this.project3, this.project4] = await this.Project.bulkCreate([
        { id: randint() },
        { id: randint() },
        { id: randint() },
        { id: randint() }
      ], {returning: true});
      this.users = await this.User.bulkCreate([
        { id: randint(), awesome: false},
        { id: randint(), awesome: true },
        { id: randint(), awesome: true },
        { id: randint(), awesome: false },
        { id: randint(), awesome: true },
        { id: randint(), awesome: false },
        { id: randint(), awesome: true },
        { id: randint(), awesome: true },
        { id: randint(), awesome: true }
      ], {returning: true});

      await this.project1.setMembers(this.users.slice(0, 3));
      await this.project2.setMembers(this.users.slice(3, 7));
      await this.project3.setMembers(this.users.slice(7));

      dataloaderSequelize(this.Project);
      this.sandbox.spy(this.User, 'findAll');
    });

    it('batches to a single findAll call when getting', async function () {
      let members1 = this.project1.getMembers()
        , members2 = this.project2.getMembers();

      await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[0],
        this.users[1],
        this.users[2],
      ]);
      await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[3],
        this.users[4],
        this.users[5],
        this.users[6]
      ]);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          projectId: [this.project1.get('id'), this.project2.get('id')]
        }
      }]);
    });

    it('supports rejectOnEmpty', async function () {
      let error = new Error('FooBar!');
      let members1 = this.project1.getMembers({ rejectOnEmpty: error })
        , members2 = this.project4.getMembers({ rejectOnEmpty: error })
        , members3 = this.project4.getMembers();

      await expect(members1, 'to be fulfilled with', Array);
      await expect(members2, 'to be rejected with', 'FooBar!');
      await expect(members3, 'to be fulfilled with', []);
    });

    it('batches to a single findAll call when counting', async function () {
      let project4 = await this.Project.create();

      let members1 = this.project1.countMembers()
        , members2 = this.project2.countMembers()
        , members3 = project4.countMembers();

      await expect(members1, 'to be fulfilled with', 3);
      await expect(members2, 'to be fulfilled with', 4);
      await expect(members3, 'to be fulfilled with', 0);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          projectId: [this.project1.get('id'), this.project2.get('id'), project4.get('id')]
        },
        attributes: [
          [connection.fn('COUNT', connection.col('id')), 'count'],
          'projectId'
        ],
        raw: true,
        group: ['projectId'],
        multiple: false
      }]);
    });

    it('batches to a single findAll call when limits are the same', async function () {
      let members1 = this.project1.getMembers({ limit: 2 })
        , members2 = this.project2.getMembers({ limit: 2 });

      await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[0],
        this.users[1]
      ]);
      await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[3],
        this.users[4]
      ]);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        groupedLimit: {
          limit: 2,
          on: 'projectId',
          values: [ this.project1.get('id'), this.project2.get('id') ]
        }
      }]);
    });

    it('batches to multiple findAll call when limits are different', async function () {
      let members1 = this.project1.getMembers({ limit: 4 })
        , members2 = this.project2.getMembers({ limit: 2 })
        , members3 = this.project3.getMembers({ limit: 2 });

      await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[0],
        this.users[1],
        this.users[2]
      ]);
      await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[3],
        this.users[4]
      ]);
      await expect(members3, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[7],
        this.users[8]
      ]);

      expect(this.User.findAll, 'was called twice');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          projectId: [this.project1.get('id')],
        },
        limit: 4
      }]);
      expect(this.User.findAll, 'to have a call satisfying', [{
        groupedLimit: {
          limit: 2,
          on: 'projectId',
          values: [ this.project2.get('id'), this.project3.get('id') ]
        }
      }]);
    });

    it('batches to multiple findAll call when where clauses are different', async function () {
      let members1 = this.project1.getMembers({ where: { awesome: true }})
        , members2 = this.project2.getMembers({ where: { awesome: false }})
        , members3 = this.project3.getMembers({ where: { awesome: true }});

      await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[1],
        this.users[2]
      ]);
      await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[3],
        this.users[5]
      ]);
      await expect(members3, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[7],
        this.users[8]
      ]);

      expect(this.User.findAll, 'was called twice');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          $and: [
            { projectId: [this.project1.get('id'), this.project3.get('id')]},
            { awesome: true }
          ]
        }
      }]);
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          $and: [
            { projectId: [this.project2.get('id')]},
            { awesome: false }
          ]
        }
      }]);
    });

    it('batches to multiple findAll call with where + limit', async function () {
      let members1 = this.project1.getMembers({ where: { awesome: true }, limit: 1 })
        , members2 = this.project2.getMembers({ where: { awesome: true }, limit: 1 })
        , members3 = this.project2.getMembers({ where: { awesome: false }, limit: 1 })
        , members4 = this.project3.getMembers({ where: { awesome: true }, limit: 2 });

      await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[1]
      ]);
      await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[4]
      ]);
      await expect(members3, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[3]
      ]);
      await expect(members4, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[7],
        this.users[8]
      ]);

      expect(this.User.findAll, 'was called thrice');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          awesome: true
        },
        groupedLimit: {
          limit: 1,
          values: [this.project1.get('id'), this.project2.get('id')]
        }
      }]);
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          $and: [
            { projectId: [this.project3.get('id')] },
            { awesome: true }
          ]
        },
        limit: 2
      }]);
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          $and: [
            { projectId: [this.project2.get('id')] },
            { awesome: false }
          ]
        },
        limit: 1
      }]);
    });
  });

  describe('paranoid', function () {
    beforeEach(async function () {
      this.sandbox = sinon.sandbox.create();

      this.User = connection.define('user', {}, {
        paranoid: true
      });
      this.Project = connection.define('project');

      this.Project.hasMany(this.User, {
        as: 'members'
      });

      await connection.sync({
        force: true
      });

      [this.project1, this.project2, this.project3] = await this.Project.bulkCreate([
        { id: randint() },
        { id: randint() },
        { id: randint() }
      ], {returning: true});
      this.users = await this.User.bulkCreate([
        { id: randint(), deletedAt: new Date() },
        { id: randint() },
        { id: randint() },
        { id: randint() },
        { id: randint() },
        { id: randint() },
        { id: randint() },
        { id: randint() },
        { id: randint(), deletedAt: new Date() }
      ], {returning: true});

      await this.project1.setMembers(this.users.slice(0, 3));
      await this.project2.setMembers(this.users.slice(3, 7));
      await this.project3.setMembers(this.users.slice(7));

      dataloaderSequelize(this.Project);
      this.sandbox.spy(this.User, 'findAll');
    });

    it('batches to a single findAll call', async function () {
      let members1 = this.project1.getMembers()
        , members2 = this.project2.getMembers();

      await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[1],
        this.users[2],
      ]);
      await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[3],
        this.users[4],
        this.users[5],
        this.users[6]
      ]);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          projectId: [this.project1.get('id'), this.project2.get('id')]
        }
      }]);
    });

    it('batches to a single findAll call when limits are the same', async function () {
      let members1 = this.project1.getMembers({ limit: 2 })
        , members2 = this.project2.getMembers({ limit: 2 });

      await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[1],
        this.users[2]
      ]);
      await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[3],
        this.users[4]
      ]);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        groupedLimit: {
          limit: 2,
          on: 'projectId',
          values: [ this.project1.get('id'), this.project2.get('id') ]
        }
      }]);
    });

    it('batches to multiple findAll call when limits are different', async function () {
      let members1 = this.project1.getMembers({ limit: 4 })
        , members2 = this.project2.getMembers({ limit: 2 })
        , members3 = this.project3.getMembers({ limit: 2 });

      await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[1],
        this.users[2]
      ]);
      await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[3],
        this.users[4]
      ]);
      await expect(members3, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[7]
      ]);

      expect(this.User.findAll, 'was called twice');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          projectId: [this.project1.get('id')],
        },
        limit: 4
      }]);
      expect(this.User.findAll, 'to have a call satisfying', [{
        groupedLimit: {
          limit: 2,
          on: 'projectId',
          values: [ this.project2.get('id'), this.project3.get('id') ]
        }
      }]);
    });
  });
});

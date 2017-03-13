import Sequelize from 'sequelize';
import {connection, randint} from '../helper';
import sinon from 'sinon';
import DataLoader from 'dataloader';
import dataloaderSequelize from '../../src';
import expect from 'unexpected';

async function createData() {
  [this.project1, this.project2, this.project3, this.project4] = await this.Project.bulkCreate([
    { id: randint() },
    { id: randint() },
    { id: randint() },
    { id: randint() }
  ], {returning: true});
  this.users = await this.User.bulkCreate([
    { id: randint(), awesome: false, deletedAt: new Date() },
    { id: randint(), awesome: true },
    { id: randint(), awesome: true },
    { id: randint(), awesome: false },
    { id: randint(), awesome: true },
    { id: randint(), awesome: false },
    { id: randint(), awesome: true },
    { id: randint(), awesome: true },
    { id: randint(), awesome: true, deletedAt: new Date() }
  ], {returning: true});

  await this.project1.setMembers(this.users.slice(0, 3));
  await this.project2.setMembers(this.users.slice(3, 7));
  await this.project3.setMembers(this.users.slice(7));
}

describe('hasMany', function () {
  beforeEach(async function () {
    this.sandbox = sinon.sandbox.create();
  });

  describe('simple association', function () {
    before(async function () {
      this.User = connection.define('user', {
        awesome: Sequelize.BOOLEAN
      });
      this.Project = connection.define('project');

      this.Project.hasMany(this.User, {
        as: 'members',
        foreignKey: {
          name: 'projectId',
          field: 'project_id'
        }
      });
      await connection.sync({ force: true });
      await createData.call(this);
      dataloaderSequelize(this.Project);
    });

    beforeEach(function () {
      this.sandbox.spy(this.User, 'findAll');
    });

    afterEach(function () {
      this.sandbox.restore();
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
          project_id: [this.project1.get('id'), this.project2.get('id')]
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
          project_id: [this.project1.get('id'), this.project2.get('id'), project4.get('id')]
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
          on: 'project_id',
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
          project_id: [this.project1.get('id')],
        },
        limit: 4
      }]);
      expect(this.User.findAll, 'to have a call satisfying', [{
        groupedLimit: {
          limit: 2,
          on: 'project_id',
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
            { project_id: [this.project1.get('id'), this.project3.get('id')]},
            { awesome: true }
          ]
        }
      }]);
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          $and: [
            { project_id: [this.project2.get('id')]},
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
            { project_id: [this.project3.get('id')] },
            { awesome: true }
          ]
        },
        limit: 2
      }]);
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          $and: [
            { project_id: [this.project2.get('id')] },
            { awesome: false }
          ]
        },
        limit: 1
      }]);
    });

    it('should skip batching if include is set', async function() {
      this.sandbox.spy(DataLoader.prototype, 'load');
      let project1 = await this.Project.findById(this.project1.id, { include: [ this.Project.associations.members ]});
      let project2 = await this.Project.findById(this.project2.id, { include: [ this.Project.associations.members ]});

      expect(project1.members, 'not to be undefined');
      expect(project2.members, 'not to be undefined');
      expect(project1.members, 'to have length', 3);
      expect(project2.members, 'to have length', 4);
      expect(DataLoader.prototype.load, 'was not called');
    });

  });

  describe('paranoid', function () {
    before(async function () {
      this.User = connection.define('user', {}, {
        paranoid: true
      });
      this.Project = connection.define('project');
      this.Project.hasMany(this.User, { as: 'members' });
      await connection.sync({ force: true });
      await createData.call(this);
      dataloaderSequelize(this.Project);
    });

    beforeEach(function () {
      this.sandbox.spy(this.User, 'findAll');
    });
    afterEach(function () {
      this.sandbox.restore();
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

  describe('scope on target', function () {
    before(async function () {
      this.User = connection.define('user', {
        awesome: Sequelize.BOOLEAN
      });
      this.Project = connection.define('project');
      this.Project.hasMany(this.User, { as: 'members' });
      this.Project.hasMany(this.User, {
        as: 'awesomeMembers',
        scope: {
          awesome: true
        },
        foreignKey: {
          name: 'projectId',
          field: 'project_id'
        }
      });

      await connection.sync({ force: true });
      await createData.call(this);
      dataloaderSequelize(this.Project);
    });

    beforeEach(function () {
      this.sandbox.spy(this.User, 'findAll');
    });

    afterEach(function () {
      this.sandbox.restore();
    });

    it('batches to multiple findAll call when different limits are applied', async function () {
      let members1 = this.project1.getAwesomeMembers({ limit: 10 })
        , members2 = this.project2.getAwesomeMembers({ limit: 10 })
        , members3 = this.project3.getAwesomeMembers({ limit: 1 });

      await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[1],
        this.users[2]
      ]);
      await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[4],
        this.users[6]
      ]);
      await expect(members3, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[7]
      ]);

      expect(this.User.findAll, 'was called twice');
    });

    it('batches to a single findAll call', async function () {
      let members1 = this.project1.getAwesomeMembers()
        , members2 = this.project2.getAwesomeMembers()
        , members3 = this.project3.getAwesomeMembers();

      await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[1],
        this.users[2]
      ]);
      await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[4],
        this.users[6]
      ]);
      await expect(members3, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[7],
        this.users[8]
      ]);

      expect(this.User.findAll, 'was called once');
    });

    it('batches to multiple findAll call when different scopes are applied', async function () {
      let members1 = this.project1.getAwesomeMembers({ limit: 10 })
        , members2 = this.project1.getMembers({ limit: 10 });

      await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[1],
        this.users[2]
      ]);
      await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[0],
        this.users[1],
        this.users[2]
      ]);

      expect(this.User.findAll, 'was called twice');
    });
  });

  describe('support sourceKey in hasMany associations', function () {
    before(async function () {
      this.User = connection.define('user', {
        project__c: Sequelize.STRING,
      });
      this.Project = connection.define('project', {
        sfid: {
          type: Sequelize.STRING,
          unique: true,
        },
      });
      this.User.belongsTo(this.Project, {
        foreignKey: 'project__c',
        targetKey: 'sfid',
      });
      this.Project.hasMany(this.User, {
        foreignKey: 'project__c',
        sourceKey: 'sfid',
      });

      await connection.sync({ force: true });

      this.project1 = await this.Project.create({
        id: randint(),
        sfid: '001abc',
      }, {returning: true});

      this.users = await this.User.bulkCreate([
        { id: randint() },
        { id: randint() },
        { id: randint() },
        { id: randint() },
      ], {returning: true});

      await this.project1.setUsers(this.users);
      dataloaderSequelize(this.Project);
    });

    afterEach(function () {
      this.sandbox.restore();
    });

    it('correctly links sourceKey and foreignKey', async function () {
      let members1 = this.project1.getUsers();

      await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', this.users);
    });
  });
});

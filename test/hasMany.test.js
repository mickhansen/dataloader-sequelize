import {connection, randint} from './helper';
import sinon from 'sinon';
import dataloaderSequelize from '../src';
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

      this.User = connection.define('user');
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
        { id: randint() },
        { id: randint() },
        { id: randint() },
        { id: randint() },
        { id: randint() },
        { id: randint() },
        { id: randint() },
        { id: randint() },
        { id: randint() }
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
          projectId: this.project1.get('id'),
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
          projectId: this.project1.get('id'),
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

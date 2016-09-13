import {connection, randint} from '../helper';
import sinon from 'sinon';
import dataloaderSequelize from '../../src';
import expect from 'unexpected';
import Sequelize from 'sequelize';

describe('belongsTo', function () {
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
        name: Sequelize.STRING
      });
      this.Project = connection.define('project');

      this.Project.Users = this.Project.belongsToMany(this.User, { as: 'members', through: 'project_members' });
      this.User.belongsToMany(this.Project, { through: 'project_members' });

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

      await this.project1.setMembers(this.users.slice(0, 4));
      await this.project2.setMembers(this.users.slice(3, 7));
      await this.project3.setMembers(this.users.slice(6));

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
        this.users[3],
      ]);
      await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[3],
        this.users[4],
        this.users[5],
        this.users[6]
      ]);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        include: [{
          association: this.Project.Users.manyFromTarget,
          where: { projectId: [ this.project1.get('id'), this.project2.get('id') ] }
        }]
      }]);
    });

    it('batches to multiple findAll call when different limits are applied', async function () {
      let members1 = this.project1.getMembers({ limit: 4 })
        , members2 = this.project2.getMembers({ limit: 2 })
        , members3 = this.project3.getMembers({ limit: 2 });

      await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[0],
        this.users[1],
        this.users[2],
        this.users[3]
      ]);
      await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[3],
        this.users[4]
      ]);
      await expect(members3, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
        this.users[6],
        this.users[7]
      ]);

      expect(this.User.findAll, 'was called twice');
    });
  });
});

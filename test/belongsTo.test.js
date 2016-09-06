import Sequelize from 'sequelize';
import {connection, randint} from './helper';
import sinon from 'sinon';
import dataloaderSequelize from '../src';
import Promise from 'bluebird';
import expect from 'unexpected';

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

      this.User = connection.define('user');
      this.Project = connection.define('project');

      this.ProjectOwner = this.Project.belongsTo(this.User, {
        as: 'owner'
      });

      dataloaderSequelize(connection);

      await connection.sync({
        force: true
      });

      this.project1 = await this.Project.create({
        id: 1,
        owner: {
          id: 44
        }
      }, { include: [this.ProjectOwner] });
      this.project2 = await this.Project.create({
        id: 2,
        owner: {
          id: 43
        }
      }, { include: [this.ProjectOwner] });
      this.users = await this.User.findAll();

      [this.user1, this.user2] = await this.User.bulkCreate([
        { id: randint() },
        { id: randint()  }
      ], { returning: true });
      [this.project1, this.project2] = await this.Project.bulkCreate([
        { id: randint() },
        { id: randint() }
      ], { returning: true });
      await Promise.join(
        this.project1.setOwner(this.user1),
        this.project2.setOwner(this.user2)
      );

      this.sandbox.spy(this.User, 'findAll');
    });

    it('batches to a single findAll call', async function () {
      let user1 = this.project1.getOwner()
        , user2 = this.project2.getOwner();

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be fulfilled with', this.user2);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          id: [this.user1.get('id'), this.user2.get('id')]
        }
      }]);
    });
  });

  describe('with targetKey', function () {
    beforeEach(async function () {
      this.sandbox = sinon.sandbox.create();

      this.User = connection.define('user', {
        someId: Sequelize.INTEGER
      });
      this.Project = connection.define('project');

      this.ProjectOwner = this.Project.belongsTo(this.User, {
        targetKey: 'someId',
        as: 'owner',
        constraints: false
      });

      dataloaderSequelize(connection);

      await connection.sync({
        force: true
      });

      [this.user1, this.user2] = await this.User.bulkCreate([
        { id: randint(), someId: randint() },
        { id: randint(), someId: randint() }
      ], { returning: true });
      [this.project1, this.project2] = await this.Project.bulkCreate([
        { id: randint() },
        { id: randint() }
      ], { returning: true });
      await Promise.join(
        this.project1.setOwner(this.user1),
        this.project2.setOwner(this.user2)
      );

      this.sandbox.spy(this.User, 'findAll');
    });

    it('batches to a single findAll call', async function () {
      let user1 = this.project1.getOwner()
        , user2 = this.project2.getOwner();

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be fulfilled with', this.user2);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          someId: [this.user1.get('someId'), this.user2.get('someId')]
        }
      }]);
    });
  });
});

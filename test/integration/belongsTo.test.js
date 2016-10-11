import Sequelize from 'sequelize';
import {connection, randint} from '../helper';
import sinon from 'sinon';
import dataloaderSequelize from '../../src';
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

      this.Project.belongsTo(this.User, {
        as: 'owner'
      });

      dataloaderSequelize(this.Project);

      await connection.sync({
        force: true
      });

      [this.user1, this.user2] = await this.User.bulkCreate([
        { id: randint() },
        { id: randint() }
      ], { returning: true });
      [this.project1, this.project2, this.project3] = await this.Project.bulkCreate([
        { id: randint() },
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

    it('works for project without owner', async function () {
      expect(await this.project3.getOwner(), 'to equal', null);
      expect(this.User.findAll, 'was not called');
    });

    it('supports rejectOnEmpty', async function () {
      let user1 = this.project1.getOwner({ rejectOnEmpty: Error })
        , user2 = this.project3.getOwner({ rejectOnEmpty: Error })
        , user3 = this.project3.getOwner();

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be rejected with', Error);
      await expect(user3, 'to be fulfilled with', null);
    });
  });

  describe('with targetKey', function () {
    beforeEach(async function () {
      this.sandbox = sinon.sandbox.create();

      this.User = connection.define('user', {
        someId: Sequelize.INTEGER
      });
      this.Project = connection.define('project');

      this.Project.belongsTo(this.User, {
        targetKey: 'someId',
        as: 'owner',
        constraints: false
      });

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

      dataloaderSequelize(this.Project);
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

import Sequelize from 'sequelize';
import {connection, randint} from '../helper';
import sinon from 'sinon';
import dataloaderSequelize from '../../src';
import expect from 'unexpected';

describe('findById', function () {
  beforeEach(function () {
    this.sandbox = sinon.sandbox.create();
  });
  afterEach(function () {
    this.sandbox.restore();
  });

  describe('id primary key', function () {
    beforeEach(async function () {
      this.User = connection.define('user');

      this.sandbox.spy(this.User, 'findAll');
      dataloaderSequelize(this.User);

      await this.User.sync({
        force: true
      });

      this.users = await this.User.bulkCreate([
        { id: randint() },
        { id: randint() },
        { id: randint() }
      ], { returning: true });
    });

    it('works with null', async function () {
      await expect(this.User.findById(null), 'to be fulfilled with', null);
      expect(this.User.findAll, 'was not called');
    });

    it('batches to a single findAll call', async function () {
      let user1 = this.User.findById(this.users[2].get('id'))
        , user2 = this.User.findById(this.users[1].get('id'));

      await expect(user1, 'to be fulfilled with', this.users[2]);
      await expect(user2, 'to be fulfilled with', this.users[1]);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          id: [this.users[2].get('id'), this.users[1].get('id')]
        }
      }]);
    });

    it('supports rejectOnEmpty', async function () {
      let user1 = this.User.findById(this.users[2].get('id'), { rejectOnEmpty: true })
        , user2 = this.User.findById(42, { rejectOnEmpty: true })
        , user3 = this.User.findById(42);

      await expect(user1, 'to be fulfilled with', this.users[2]);
      await expect(user2, 'to be rejected');
      await expect(user3, 'to be fulfilled with', null);
    });
  });

  describe('other primary key', function () {
    beforeEach(async function () {
      this.User = connection.define('user', {
        identifier: {
          primaryKey: true,
          type: Sequelize.INTEGER
        }
      });

      this.sandbox.spy(this.User, 'findAll');
      dataloaderSequelize(this.User);

      await this.User.sync({
        force: true
      });

      this.users = await this.User.bulkCreate([
        { identifier: randint() },
        { identifier: randint() },
        { identifier: randint() }
      ], { returning: true });
    });

    it('batches to a single findAll call', async function () {
      let user1 = this.User.findByPrimary(this.users[2].get('identifier'))
        , user2 = this.User.findByPrimary(this.users[1].get('identifier'));

      await expect(user1, 'to be fulfilled with', this.users[2]);
      await expect(user2, 'to be fulfilled with', this.users[1]);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          identifier: [this.users[2].get('identifier'), this.users[1].get('identifier')]
        }
      }]);
    });
  });

  describe('primary key with field', function () {
    beforeEach(async function () {
      this.User = connection.define('user', {
        id: {
          primaryKey: true,
          type: Sequelize.INTEGER,
          field: 'identifier'
        }
      });

      this.sandbox.spy(this.User, 'findAll');
      dataloaderSequelize(this.User);

      await this.User.sync({
        force: true
      });

      this.users = await this.User.bulkCreate([
        { id: randint() },
        { id: randint() },
        { id: randint() }
      ], { returning: true });
    });

    it('batches to a single findAll call', async function () {
      let user1 = this.User.findById(this.users[2].get('id'))
        , user2 = this.User.findById(this.users[1].get('id'));

      await expect(user1, 'to be fulfilled with', this.users[2]);
      await expect(user2, 'to be fulfilled with', this.users[1]);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          identifier: [this.users[2].get('id'), this.users[1].get('id')]
        }
      }]);
    });
  });

  describe('paranoid', function () {
    beforeEach(async function () {
      this.User = connection.define('user', {}, { paranoid: true });

      this.sandbox.spy(this.User, 'findAll');
      dataloaderSequelize(this.User);

      await this.User.sync({
        force: true
      });

      this.users = await this.User.bulkCreate([
        { id: randint() },
        { id: randint() },
        { id: randint(), deletedAt: new Date() }
      ], { returning: true });
    });

    it('batches to a single findAll call', async function () {
      let user1 = this.User.findById(this.users[2].get('id'))
        , user2 = this.User.findById(this.users[1].get('id'));

      await expect(user1, 'to be fulfilled with', null);
      await expect(user2, 'to be fulfilled with', this.users[1]);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          id: [this.users[2].get('id'), this.users[1].get('id')]
        }
      }]);
    });
  });
});

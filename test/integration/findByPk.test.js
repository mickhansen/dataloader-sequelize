import Sequelize from 'sequelize';
import {createConnection, randint} from '../helper';
import sinon from 'sinon';
import {createContext, removeContext, EXPECTED_OPTIONS_KEY} from '../../src';
import expect from 'unexpected';
import {method} from '../../src/helper';

describe('findByPk', function () {
  beforeEach(createConnection);
  beforeEach(function () {
    this.sandbox = sinon.sandbox.create();
  });
  afterEach(function () {
    this.sandbox.restore();
  });

  describe('id primary key', function () {
    beforeEach(async function () {
      this.User = this.connection.define('user');

      this.sandbox.spy(this.User, 'findAll');

      await this.User.sync({
        force: true
      });

      this.users = await this.User.bulkCreate([
        { id: randint() },
        { id: randint() },
        { id: randint() }
      ], { returning: true });

      this.context = createContext(this.connection);
    });

    it('works with null', async function () {
      await expect(this.User[method(this.User, 'findByPk')](null), 'to be fulfilled with', null);
      expect(this.User.findAll, 'was not called');
    });

    it('batches and caches to a single findAll call (createContext)', async function () {
      let user1 = this.User[method(this.User, 'findByPk')](this.users[2].get('id'), {[EXPECTED_OPTIONS_KEY]: this.context})
        , user2 = this.User[method(this.User, 'findByPk')](this.users[1].get('id'), {[EXPECTED_OPTIONS_KEY]: this.context});

      await expect(user1, 'to be fulfilled with', this.users[2]);
      await expect(user2, 'to be fulfilled with', this.users[1]);

      user1 = this.User[method(this.User, 'findByPk')](this.users[2].get('id'), {[EXPECTED_OPTIONS_KEY]: this.context});
      user2 = this.User[method(this.User, 'findByPk')](this.users[1].get('id'), {[EXPECTED_OPTIONS_KEY]: this.context});

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
      let user1 = this.User[method(this.User, 'findByPk')](this.users[2].get('id'), { rejectOnEmpty: true, [EXPECTED_OPTIONS_KEY]: this.context })
        , user2 = this.User[method(this.User, 'findByPk')](42, { rejectOnEmpty: true, [EXPECTED_OPTIONS_KEY]: this.context })
        , user3 = this.User[method(this.User, 'findByPk')](42, { [EXPECTED_OPTIONS_KEY]: this.context });

      await expect(user1, 'to be fulfilled with', this.users[2]);
      await expect(user2, 'to be rejected');
      await expect(user3, 'to be fulfilled with', null);
    });

    it('supports raw/attributes', async function () {
      await Promise.all([
        this.User[method(this.User, 'findByPk')](this.users[2].get('id'), {[EXPECTED_OPTIONS_KEY]: this.context}),
        this.User[method(this.User, 'findByPk')](this.users[1].get('id'), {[EXPECTED_OPTIONS_KEY]: this.context, raw: true}),
        this.User[method(this.User, 'findByPk')](this.users[0].get('id'), {[EXPECTED_OPTIONS_KEY]: this.context, raw: true})
      ]);

      expect(this.User.findAll, 'was called twice');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          id: [this.users[2].get('id')]
        }
      }]);
      expect(this.User.findAll, 'to have a call satisfying', [{
        raw: true,
        where: {
          id: [this.users[1].get('id'), this.users[0].get('id')]
        }
      }]);
    });

    it('works if model method is shimmed', async function () {
      removeContext(this.connection);

      const original = this.User[method(this.User, 'findByPk')];
      this.User[method(this.User, 'findByPk')] = function(...args) {
        return original.call(this, ...args);
      };

      this.context = createContext(this.connection);

      let user1 = this.User[method(this.User, 'findByPk')](this.users[2].get('id'), {[EXPECTED_OPTIONS_KEY]: this.context})
        , user2 = this.User[method(this.User, 'findByPk')](this.users[1].get('id'), {[EXPECTED_OPTIONS_KEY]: this.context});

      await expect(user1, 'to be fulfilled with', this.users[2]);
      await expect(user2, 'to be fulfilled with', this.users[1]);

      user1 = this.User[method(this.User, 'findByPk')](this.users[2].get('id'), {[EXPECTED_OPTIONS_KEY]: this.context});
      user2 = this.User[method(this.User, 'findByPk')](this.users[1].get('id'), {[EXPECTED_OPTIONS_KEY]: this.context});

      await expect(user1, 'to be fulfilled with', this.users[2]);
      await expect(user2, 'to be fulfilled with', this.users[1]);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          id: [this.users[2].get('id'), this.users[1].get('id')]
        }
      }]);
    });
  });

  describe('other primary key', function () {
    beforeEach(async function () {
      this.User = this.connection.define('user', {
        identifier: {
          primaryKey: true,
          type: Sequelize.INTEGER
        }
      });

      this.sandbox.spy(this.User, 'findAll');

      await this.User.sync({
        force: true
      });

      this.users = await this.User.bulkCreate([
        { identifier: randint() },
        { identifier: randint() },
        { identifier: randint() }
      ], { returning: true });

      this.context = createContext(this.connection);
    });

    it('batches to a single findAll call', async function () {
      let user1 = this.User[method(this.User, 'findByPk')](this.users[2].get('identifier'), {[EXPECTED_OPTIONS_KEY]: this.context})
        , user2 = this.User[method(this.User, 'findByPk')](this.users[1].get('identifier'), {[EXPECTED_OPTIONS_KEY]: this.context});

      await expect(user1, 'to be fulfilled with', this.users[2]);
      await expect(user2, 'to be fulfilled with', this.users[1]);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          identifier: [this.users[2].get('identifier'), this.users[1].get('identifier')]
        }
      }]);
    });

    it('batches and caches to a single findAll call (createContext)', async function () {
      let user1 = this.User[method(this.User, 'findByPk')](this.users[2].get('identifier'), {[EXPECTED_OPTIONS_KEY]: this.context})
        , user2 = this.User[method(this.User, 'findByPk')](this.users[1].get('identifier'), {[EXPECTED_OPTIONS_KEY]: this.context});

      await expect(user1, 'to be fulfilled with', this.users[2]);
      await expect(user2, 'to be fulfilled with', this.users[1]);

      user1 = this.User[method(this.User, 'findByPk')](this.users[2].get('identifier'), {[EXPECTED_OPTIONS_KEY]: this.context});
      user2 = this.User[method(this.User, 'findByPk')](this.users[1].get('identifier'), {[EXPECTED_OPTIONS_KEY]: this.context});

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
      this.User = this.connection.define('user', {
        id: {
          primaryKey: true,
          type: Sequelize.INTEGER,
          field: 'identifier'
        }
      });

      this.sandbox.spy(this.User, 'findAll');

      await this.User.sync({
        force: true
      });

      this.users = await this.User.bulkCreate([
        { id: randint() },
        { id: randint() },
        { id: randint() }
      ], { returning: true });

      this.context = createContext(this.connection);
    });

    it('batches to a single findAll call', async function () {
      let user1 = this.User[method(this.User, 'findByPk')](this.users[2].get('id'), {[EXPECTED_OPTIONS_KEY]: this.context})
        , user2 = this.User[method(this.User, 'findByPk')](this.users[1].get('id'), {[EXPECTED_OPTIONS_KEY]: this.context});

      await expect(user1, 'to be fulfilled with', this.users[2]);
      await expect(user2, 'to be fulfilled with', this.users[1]);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          id: [this.users[2].get('id'), this.users[1].get('id')]
        }
      }]);
    });
  });

  describe('paranoid', function () {
    beforeEach(async function () {
      this.User = this.connection.define('user', {}, { paranoid: true });

      this.sandbox.spy(this.User, 'findAll');

      await this.User.sync({
        force: true
      });

      this.users = await this.User.bulkCreate([
        { id: randint() },
        { id: randint() },
        { id: randint(), deletedAt: new Date() }
      ], { returning: true });

      this.context = createContext(this.connection);
    });

    it('batches to a single findAll call', async function () {
      let user1 = this.User[method(this.User, 'findByPk')](this.users[2].get('id'), {[EXPECTED_OPTIONS_KEY]: this.context})
        , user2 = this.User[method(this.User, 'findByPk')](this.users[1].get('id'), {[EXPECTED_OPTIONS_KEY]: this.context});

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

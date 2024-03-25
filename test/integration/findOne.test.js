import Promise from 'bluebird';
import Sequelize from 'sequelize';
import sinon from 'sinon';
import expect from 'unexpected';
import { EXPECTED_OPTIONS_KEY, createContext, removeContext } from '../../src';
import { method } from '../../src/helper';
import { createConnection, randint } from '../helper';

describe('findOne', function () {
  describe('id primary key', function () {
    beforeEach(createConnection);
    beforeEach(async function () {
      this.sandbox = sinon.sandbox.create();

      this.User = this.connection.define('user');

      this.sandbox.spy(this.User, 'findAll');

      await this.User.sync({
        force: true
      });

      [this.user0, this.user1, this.user2, this.user3] = await this.User.bulkCreate([
        { id: '0' },
        { id: randint() },
        { id: randint() },
        { id: randint() }
      ], { returning: true });

      this.context = createContext(this.connection);
      this.method = method(this.User, 'findOne');
    });

    afterEach(function () {
      this.sandbox.restore();
    });

    it('works with null', async function () {
      const user0 = this.User[this.method]({ [EXPECTED_OPTIONS_KEY]: this.context });

      await expect(user0, 'to be fulfilled with', this.user0);
      expect(this.User.findAll, 'was not called');
    });

    it('works with id of 0', async function () {
      const user0 = await this.User[this.method]({ where: { id: 0 }, [EXPECTED_OPTIONS_KEY]: this.context });

      expect(user0.get('id'), 'to equal', 0);
      expect(this.User.findAll, 'was called once');
    });

    it('batches and caches to a single findAll call (createContext)', async function () {
      let user1 = this.User[this.method]({ where: { id: this.user1.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context })
        , user2 = this.User[this.method]({ where: { id: this.user2.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context });

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be fulfilled with', this.user2);

      user1 = this.User[this.method]({ where: { id: this.user1.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context });
      user2 = this.User[this.method]({ where: { id: this.user2.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context });

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be fulfilled with', this.user2);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          id: [this.user1.get('id'), this.user2.get('id')]
        }
      }]);
    });

    it('supports rejectOnEmpty', async function () {
      const user1 = this.User[this.method]({ where: { id: this.user1.get('id') }, rejectOnEmpty: true, [EXPECTED_OPTIONS_KEY]: this.context })
        , user2 = this.User[this.method]({ where: { id: 42 }, rejectOnEmpty: true, [EXPECTED_OPTIONS_KEY]: this.context })
        , user3 = this.User[this.method]({ where: { id: 42 }, [EXPECTED_OPTIONS_KEY]: this.context });

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be rejected');
      await expect(user3, 'to be fulfilled with', null);
    });

    it('supports raw/attributes', async function () {
      await Promise.all([
        this.User[this.method]({ where: { id: this.user1.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context }),
        this.User[this.method]({ where: { id: this.user2.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context, raw: true}),
        this.User[this.method]({ where: { id: this.user3.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context, raw: true})
      ]);

      expect(this.User.findAll, 'was called twice');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          id: [this.user1.get('id')]
        }
      }]);
      expect(this.User.findAll, 'to have a call satisfying', [{
        raw: true,
        where: {
          id: [this.user2.get('id'), this.user3.get('id')]
        }
      }]);
    });

    it('works if model method is shimmed', async function () {
      removeContext(this.connection);

      const original = this.User[this.method];
      this.User[this.method] = function (...args) {
        return original.call(this, ...args);
      };

      this.context = createContext(this.connection);

      let user1 = this.User[this.method]({ where: { id: this.user1.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context })
        , user2 = this.User[this.method]({ where: { id: this.user2.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context });

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be fulfilled with', this.user2);

      user1 = this.User[this.method]({ where: { id: this.user1.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context });
      user2 = this.User[this.method]({ where: { id: this.user2.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context });

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

  describe('other primary key', function () {
    beforeEach(createConnection);
    beforeEach(async function () {
      this.sandbox = sinon.sandbox.create();

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

      [this.user1, this.user2, this.user3] = await this.User.bulkCreate([
        { identifier: randint() },
        { identifier: randint() },
        { identifier: randint() }
      ], { returning: true });

      this.context = createContext(this.connection);
      this.method = method(this.User, 'findOne');
    });

    afterEach(function () {
      this.sandbox.restore();
    });

    it('batches to a single findAll call', async function () {
      const user1 = this.User[this.method]({ where: { identifier: this.user1.get('identifier') }, [EXPECTED_OPTIONS_KEY]: this.context })
        , user2 = this.User[this.method]({ where: { identifier: this.user2.get('identifier') }, [EXPECTED_OPTIONS_KEY]: this.context });

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be fulfilled with', this.user2);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          identifier: [this.user1.get('identifier'), this.user2.get('identifier')]
        }
      }]);
    });

    it('batches and caches to a single findAll call (createContext)', async function () {
      let user1 = this.User[this.method]({ where: { identifier: this.user1.get('identifier') }, [EXPECTED_OPTIONS_KEY]: this.context })
        , user2 = this.User[this.method]({ where: { identifier: this.user2.get('identifier') }, [EXPECTED_OPTIONS_KEY]: this.context });

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be fulfilled with', this.user2);

      user1 = this.User[this.method]({ where: { identifier: this.user1.get('identifier') }, [EXPECTED_OPTIONS_KEY]: this.context });
      user2 = this.User[this.method]({ where: { identifier: this.user2.get('identifier') }, [EXPECTED_OPTIONS_KEY]: this.context });

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be fulfilled with', this.user2);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          identifier: [this.user1.get('identifier'), this.user2.get('identifier')]
        }
      }]);
    });
  });

  describe('other fields', function () {
    beforeEach(createConnection);
    beforeEach(async function () {
      this.sandbox = sinon.sandbox.create();

      this.User = this.connection.define('user', {
        id: {
          primaryKey: true,
          type: Sequelize.INTEGER
        },
        status: {
          type: Sequelize.STRING
        },
      });

      this.sandbox.spy(this.User, 'findAll');

      await this.User.sync({
        force: true
      });

      [this.user1, this.user2, this.user3] = await this.User.bulkCreate([
        { id: randint(), status: 'active' },
        { id: randint(), status: 'inactive' },
        { id: randint(), status: 'active' }
      ], { returning: true });

      this.context = createContext(this.connection);
      this.method = method(this.User, 'findOne');
    });

    afterEach(function () {
      this.sandbox.restore();
    });

    it('works with other where clauses', async function () {
      const user1 = await this.User[this.method]({ where: { id: this.user1.get('id'), status: this.user1.get('status') }, [EXPECTED_OPTIONS_KEY]: this.context });

      expect(user1.get('id'), 'to equal', this.user1.get('id'));
      expect(this.User.findAll, 'was not called');
    });
  });

  describe('primary key with field', function () {
    beforeEach(createConnection);
    beforeEach(async function () {
      this.sandbox = sinon.sandbox.create();

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

      [this.user1, this.user2, this.user3] = await this.User.bulkCreate([
        { id: randint() },
        { id: randint() },
        { id: randint() }
      ], { returning: true });

      this.context = createContext(this.connection);
      this.method = method(this.User, 'findOne');
    });

    afterEach(function () {
      this.sandbox.restore();
    });

    it('batches to a single findAll call', async function () {
      const user1 = this.User[this.method]({ where: { id: this.user1.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context })
        , user2 = this.User[this.method]({ where: { id: this.user2.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context });

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

  describe('paranoid', function () {
    beforeEach(createConnection);
    beforeEach(async function () {
      this.sandbox = sinon.sandbox.create();

      this.User = this.connection.define('user', {}, { paranoid: true });

      this.sandbox.spy(this.User, 'findAll');

      await this.User.sync({
        force: true
      });

      [this.user1, this.user2] = await this.User.bulkCreate([
        { id: randint(), deletedAt: new Date() },
        { id: randint() }
      ], { returning: true });

      this.context = createContext(this.connection);
      this.method = method(this.User, 'findOne');
    });
    afterEach(function () {
      this.sandbox.restore();
    });

    it('batches and caches to a single findAll call (paranoid)', async function () {
      let user1 = this.User[this.method]({ where: { id: this.user1.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context })
        , user2 = this.User[this.method]({ where: { id: this.user2.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context });

      await expect(user1, 'to be fulfilled with', null);
      await expect(user2, 'to be fulfilled with', this.user2);

      user1 = this.User[this.method]({ where: { id: this.user1.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context });
      user2 = this.User[this.method]({ where: { id: this.user2.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context });

      await expect(user1, 'to be fulfilled with', null);
      await expect(user2, 'to be fulfilled with', this.user2);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          id: [this.user1.get('id'), this.user2.get('id')]
        }
      }]);
    });

    it('batches and caches to a single findAll call (not paranoid)', async function () {
      let user1 = this.User[this.method]({ where: { id: this.user1.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context, paranoid: false})
        , user2 = this.User[this.method]({ where: { id: this.user2.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context, paranoid: false});

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be fulfilled with', this.user2);

      user1 = this.User[this.method]({ where: { id: this.user1.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context, paranoid: false});
      user2 = this.User[this.method]({ where: { id: this.user2.get('id') }, [EXPECTED_OPTIONS_KEY]: this.context, paranoid: false});

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be fulfilled with', this.user2);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        paranoid: false,
        where: {
          id: [this.user1.get('id'), this.user2.get('id')]
        }
      }]);
    });
  });
});

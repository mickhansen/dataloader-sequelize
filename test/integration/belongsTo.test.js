import Sequelize from 'sequelize';
import {createConnection, randint} from '../helper';
import sinon from 'sinon';
import {createContext, EXPECTED_OPTIONS_KEY} from '../../src';
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
    beforeEach(createConnection);
    beforeEach(async function () {
      this.sandbox = sinon.sandbox.create();

      this.User = this.connection.define('user');
      this.Project = this.connection.define('project');

      this.Project.belongsTo(this.User, {
        as: 'owner',
        foreignKey: {
          name: 'ownerId',
          field: 'owner_id'
        }
      });

      await this.connection.sync({
        force: true
      });

      [this.user0, this.user1, this.user2] = await this.User.bulkCreate([
        { id: '0' },
        { id: randint() },
        { id: randint() }
      ], { returning: true });
      [this.project0, this.project1, this.project2, this.project3] = await this.Project.bulkCreate([
        { id: '0' },
        { id: randint() },
        { id: randint() },
        { id: randint() }
      ], { returning: true });
      await Promise.join(
        this.project0.setOwner(this.user0),
        this.project1.setOwner(this.user1),
        this.project2.setOwner(this.user2)
      );

      this.sandbox.spy(this.User, 'findAll');

      this.context = createContext(this.connection);
    });

    it('batches and caches to a single findAll call', async function () {
      let user1 = this.project1.getOwner({[EXPECTED_OPTIONS_KEY]: this.context})
        , user2 = this.project2.getOwner({[EXPECTED_OPTIONS_KEY]: this.context});

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be fulfilled with', this.user2);

      user1 = this.project1.getOwner({[EXPECTED_OPTIONS_KEY]: this.context});
      user2 = this.project2.getOwner({[EXPECTED_OPTIONS_KEY]: this.context});

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be fulfilled with', this.user2);

      expect(this.User.findAll, 'was called once');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          id: [this.user1.get('id'), this.user2.get('id')]
        }
      }]);
    });

    it('caches based on priming', async function () {
      this.context.prime(await this.User.findAll());

      let user1 = this.project1.getOwner({[EXPECTED_OPTIONS_KEY]: this.context})
        , user2 = this.project2.getOwner({[EXPECTED_OPTIONS_KEY]: this.context});

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be fulfilled with', this.user2);

      expect(this.User.findAll, 'was called once');
    });

    it('works for project without owner', async function () {
      expect(await this.project3.getOwner(), 'to equal', null);
      expect(this.User.findAll, 'was not called');
    });

    it('works with id of 0', async function () {
      let user0 = await this.project0.getOwner();


      //await expect(user0, 'to be fulfilled with', this.user0);
      expect(user0.get('id'), 'to be', 0);
    });

    it('supports rejectOnEmpty', async function () {
      let user1 = this.project1.getOwner({ [EXPECTED_OPTIONS_KEY]: this.context, rejectOnEmpty: Error })
        , user2 = this.project3.getOwner({ [EXPECTED_OPTIONS_KEY]: this.context, rejectOnEmpty: Error })
        , user3 = this.project3.getOwner({ [EXPECTED_OPTIONS_KEY]: this.context });

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be rejected with', Error);
      await expect(user3, 'to be fulfilled with', null);
    });
  });

  describe('with targetKey', function () {
    beforeEach(createConnection);
    beforeEach(async function () {
      this.sandbox = sinon.sandbox.create();

      this.User = this.connection.define('user', {
        someId: {
          type: Sequelize.INTEGER,
          field: 'some_id'
        },
        deletedAt: {
          type: Sequelize.DATE,
          field: 'deleted_at'
        }
      });
      this.Project = this.connection.define('project', {
        ownerId: {
          type: Sequelize.INTEGER,
          field: 'owner_id'
        }
      });

      this.Project.belongsTo(this.User, {
        foreignKey: 'ownerId',
        targetKey: 'someId',
        as: 'owner',
        constraints: false
      });

      await this.connection.sync({
        force: true
      });

      [this.user1, this.user2, this.user3] = await Promise.join(
        this.User.create({ id: randint(), someId: randint() }),
        this.User.create({ id: randint(), someId: randint() }),
        this.User.create({ id: randint(), someId: randint(), deletedAt: new Date() })
      );
      [this.project1, this.project2, this.project3] = await this.Project.bulkCreate([
        { id: randint() },
        { id: randint() },
        { id: randint() }
      ], { returning: true });
      await Promise.join(
        this.project1.setOwner(this.user1),
        this.project2.setOwner(this.user2),
        this.project3.setOwner(this.user3)
      );

      this.sandbox.spy(this.User, 'findAll');

      this.context = createContext(this.connection);
    });

    it('batches and caches to a single findAll call (createContext)', async function () {
      let user1 = this.project1.getOwner({[EXPECTED_OPTIONS_KEY]: this.context})
        , user2 = this.project2.getOwner({[EXPECTED_OPTIONS_KEY]: this.context})
        , user3 = this.project3.getOwner({[EXPECTED_OPTIONS_KEY]: this.context, paranoid: false });

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be fulfilled with', this.user2);
      await expect(user3, 'to be fulfilled with', this.user3);

      user1 = this.project1.getOwner({[EXPECTED_OPTIONS_KEY]: this.context});
      user2 = this.project2.getOwner({[EXPECTED_OPTIONS_KEY]: this.context});
      user3 = this.project3.getOwner({[EXPECTED_OPTIONS_KEY]: this.context, paranoid: false});

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be fulfilled with', this.user2);
      await expect(user3, 'to be fulfilled with', this.user3);

      expect(this.User.findAll, 'was called twice');
      expect(this.User.findAll, 'to have a call satisfying', [{
        where: {
          someId: [
            this.project1.get('ownerId'),
            this.project2.get('ownerId')
          ]
        }
      }]);
      expect(this.User.findAll, 'to have a call satisfying', [{
        paranoid: false,
        where: {
          someId: [
            this.project3.get('ownerId')
          ]
        }
      }]);
    });

    it('caches based on priming', async function () {
      this.context.prime(await this.User.findAll());

      let user1 = this.project1.getOwner({[EXPECTED_OPTIONS_KEY]: this.context})
        , user2 = this.project2.getOwner({[EXPECTED_OPTIONS_KEY]: this.context});

      await expect(user1, 'to be fulfilled with', this.user1);
      await expect(user2, 'to be fulfilled with', this.user2);

      expect(this.User.findAll, 'was called once');
    });
  });
});

import {connection, randint} from '../helper';
import Sequelize from 'sequelize';
import sinon from 'sinon';
import dataloaderSequelize from '../../src';
import expect from 'unexpected';
import Promise from 'bluebird';
import cls from 'continuation-local-storage';
import {method} from '../../src/helper';

describe('Transactions', function () {
  beforeEach(async function () {
    this.sandbox = sinon.sandbox.create();
  });
  afterEach(function () {
    this.sandbox.restore();
  });

  describe('Managed', function () {
    beforeEach(async function () {
      this.sandbox = sinon.sandbox.create();

      this.User = connection.define('user');

      dataloaderSequelize(this.User);

      await connection.sync({
        force: true
      });

      this.users = await this.User.bulkCreate([
        { id: randint() },
        { id: randint() }
      ], { returning: true });

      this.sandbox.spy(this.User, 'findAll');
    });

    it('does not batch during managed transactions', async function () {
      let user1, user2;
      console.log(method(this.User, 'findByPk'));
      await connection.transaction(async (t) => {
        [user1, user2] = await Promise.all([
          this.User[method(this.User, 'findByPk')](this.users[1].get('id'), {transaction: t}),
          this.User[method(this.User, 'findByPk')](this.users[0].get('id'), {transaction: t})
        ]);
      });
      expect(user1, 'to equal', this.users[1]);
      expect(user2, 'to equal', this.users[0]);

      expect(this.User.findAll, 'not to have calls satisfying', [{
        where: {
          id: [this.users[1].get('id'), this.users[0].get('id')]
        }
      }]);
    });
  });

  describe('CLS', function () {
    beforeEach(async function () {
      this.namespace = cls.createNamespace('sequelize');
      if (/^[45]/.test(Sequelize.version)) {
        Sequelize.useCLS(this.namespace);
      } else {
        Sequelize.cls = this.namespace;
      }
      this.sandbox = sinon.sandbox.create();

      this.User = connection.define('user');

      dataloaderSequelize(this.User);

      await connection.sync({
        force: true
      });

      this.users = await this.User.bulkCreate([
        { id: randint() },
        { id: randint() }
      ], { returning: true });

      this.sandbox.spy(this.User, 'findAll');
    })

    after(function () {
      if (/^[45]/.test(Sequelize.version)) {
        delete Sequelize._cls;
      } else {
        delete Sequelize.cls;
      }
    })

    it('does not batch during CLS transactions', async function () {
      let user1, user2;
      await connection.transaction(async (t) => {
        [user1, user2] = await Promise.all([
          this.User[method(this.User, 'findByPk')](this.users[1].get('id')),
          this.User[method(this.User, 'findByPk')](this.users[0].get('id'))
        ]);
      });
      expect(user1, 'to equal', this.users[1]);
      expect(user2, 'to equal', this.users[0]);

      expect(this.User.findAll, 'not to have calls satisfying', [{
        where: {
          id: [this.users[1].get('id'), this.users[0].get('id')]
        }
      }]);
    });
  });
});

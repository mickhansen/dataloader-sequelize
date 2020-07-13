import {createConnection, randint} from '../helper';
import Sequelize from 'sequelize';
import sinon from 'sinon';
import {createContext, EXPECTED_OPTIONS_KEY} from '../../src';
import expect from 'unexpected';
import Promise from 'bluebird';
import cls from 'continuation-local-storage';
import clsh from 'cls-hooked';
import {method} from '../../src/helper';

describe('Transactions', function () {
  beforeEach(createConnection);
  beforeEach(async function () {
    this.sandbox = sinon.sandbox.create();
  });
  afterEach(function () {
    this.sandbox.restore();
  });

  describe('Managed', function () {
    beforeEach(async function () {
      this.sandbox = sinon.sandbox.create();

      this.User = this.connection.define('user');

      await this.connection.sync({
        force: true
      });

      this.users = await this.User.bulkCreate([
        { id: randint() },
        { id: randint() }
      ], { returning: true });

      this.sandbox.spy(this.User, 'findAll');

      this.context = createContext(this.connection);
    });

    it('does not batch during managed transactions', async function () {
      let user1, user2;
      console.log(method(this.User, 'findByPk'));
      await this.connection.transaction(async (t) => {
        [user1, user2] = await Promise.all([
          this.User[method(this.User, 'findByPk')](this.users[1].get('id'), {transaction: t, [EXPECTED_OPTIONS_KEY]: this.context}),
          this.User[method(this.User, 'findByPk')](this.users[0].get('id'), {transaction: t, [EXPECTED_OPTIONS_KEY]: this.context})
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

      this.namespace = (/^[6]/.test(Sequelize.version) ? clsh : cls).createNamespace('sequelize');
      if (/^[456]/.test(Sequelize.version)) {
        Sequelize.useCLS(this.namespace);
      } else {
        Sequelize.cls = this.namespace;
      }
      this.sandbox = sinon.sandbox.create();

      this.User = this.connection.define('user');

      this.context = createContext(this.connection);

      await this.connection.sync({
        force: true
      });

      this.users = await this.User.bulkCreate([
        { id: randint() },
        { id: randint() }
      ], { returning: true });

      this.sandbox.spy(this.User, 'findAll');
    })

    after(function () {
      if (/^[456]/.test(Sequelize.version)) {
        delete Sequelize._cls;
      } else {
        delete Sequelize.cls;
      }
    })

    it('does not batch during CLS transactions', async function () {
      let user1, user2;
      await this.connection.transaction(async (t) => {
        [user1, user2] = await Promise.all([
          this.User[method(this.User, 'findByPk')](this.users[1].get('id'), {[EXPECTED_OPTIONS_KEY]: this.context}),
          this.User[method(this.User, 'findByPk')](this.users[0].get('id'), {[EXPECTED_OPTIONS_KEY]: this.context})
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

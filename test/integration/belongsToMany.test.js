import {createConnection, randint} from '../helper';
import {intersection} from 'lodash';
import sinon from 'sinon';
import {createContext, EXPECTED_OPTIONS_KEY} from '../../src';
import Promise from 'bluebird';
import expect from 'unexpected';
import Sequelize from 'sequelize';

const setups = [
  ['string through', context => {
    context.Project.Users = context.Project.belongsToMany(context.User, {
      as: 'members',
      through: 'project_members',
      sourceKey: 'id',
      targetKey: 'id',
      foreignKey: {
        name: 'projectId',
        field: 'project_id'
      },
    });
    context.User.belongsToMany(context.Project, {
      through: 'project_members',
      sourceKey: 'id',
      targetKey: 'id',
      foreignKey: {
        name: 'userId',
        field: 'user_id'
      },
    });
  }],
  ['model through', context => {
    context.ProjectMembers = context.connection.define('project_members', {
      projectId: {
        type: Sequelize.INTEGER,
        field: 'project_id'
      },
      userId: {
        type: Sequelize.INTEGER,
        field: 'user_id'
      }
    });
    context.Project.Users = context.Project.belongsToMany(context.User, {
      as: 'members',
      through: context.ProjectMembers,
      foreignKey: 'projectId',
      targetKey: 'id'
    });
    context.User.belongsToMany(context.Project, {
      through: context.ProjectMembers,
      foreignKey: 'userId',
      targetKey: 'id'
    });
  }]
];

async function createData() {
  [this.project1, this.project2, this.project3, this.project4, this.project5] = await this.Project.bulkCreate([
    { id: randint() },
    { id: randint() },
    { id: randint() },
    { id: randint() },
    { id: randint() }
  ], {returning: true});
  this.users = await this.User.bulkCreate([
    { id: randint(), awesome: false },
    { id: randint(), awesome: true },
    { id: randint(), awesome: true },
    { id: randint(), awesome: false },
    { id: randint(), awesome: true },
    { id: randint(), awesome: false },
    { id: randint(), awesome: true },
    { id: randint(), awesome: true },
    { id: randint(), awesome: true },
    { id: randint(), awesome: false },
    { id: randint(), awesome: true }
  ], {returning: true});

  await this.project1.setMembers(this.users.slice(0, 4));
  await this.project2.setMembers(this.users.slice(3, 7));
  await this.project3.setMembers(this.users.slice(6, 9));
  await this.project5.setMembers(this.users.slice(9, 11));

  await this.User.update({ deletedAt: new Date() }, {
    where: {
      id: [this.users[9].get('id')]
    }
  });
}

describe('belongsToMany', function () {
  beforeEach(async function () {
    this.sandbox = sinon.sandbox.create();
  });

  before(createConnection);

  setups.forEach(([description, setup]) => {
    describe(description, function () {
      describe('simple association', function () {
        before(async function () {
          this.User = this.connection.define('user', {
            name: Sequelize.STRING,
            awesome: Sequelize.BOOLEAN,
            deletedAt: Sequelize.DATE,
          }, {
            paranoid: true,
          });
          this.Project = this.connection.define('project');

          setup(this);

          await this.connection.sync({ force: true });
          await createData.call(this);

          this.context = createContext(this.connection);
        });

        beforeEach(function () {
          this.sandbox = sinon.sandbox.create();

          this.sandbox.spy(this.User, 'findAll');
        });

        afterEach(function () {
          this.sandbox.restore();
        });

        it('batches/caches to a single findAll call when getting (createContext)', async function () {
          let members1 = this.project1.getMembers({[EXPECTED_OPTIONS_KEY]: this.context})
            , members2 = this.project2.getMembers({[EXPECTED_OPTIONS_KEY]: this.context});

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

          members1 = this.project1.getMembers({[EXPECTED_OPTIONS_KEY]: this.context});
          members2 = this.project2.getMembers({[EXPECTED_OPTIONS_KEY]: this.context});

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
              where: { project_id: [ this.project1.get('id'), this.project2.get('id') ] }
            }]
          }]);
        });

        it('supports rejectOnEmpty', async function () {
          let members1 = this.project1.getMembers({ [EXPECTED_OPTIONS_KEY]: this.context, rejectOnEmpty: true })
            , members2 = this.project4.getMembers({ [EXPECTED_OPTIONS_KEY]: this.context, rejectOnEmpty: true })
            , members3 = this.project4.getMembers({ [EXPECTED_OPTIONS_KEY]: this.context });

          await expect(members1, 'to be fulfilled with', Array);
          await expect(members2, 'to be rejected');
          await expect(members3, 'to be fulfilled with', []);
        });

        it('batches to a single findAll call when counting', async function () {
          let project4 = await this.Project.create();

          let members1 = this.project1.countMembers({[EXPECTED_OPTIONS_KEY]: this.context})
            , members2 = this.project2.countMembers({[EXPECTED_OPTIONS_KEY]: this.context})
            , members3 = project4.countMembers({[EXPECTED_OPTIONS_KEY]: this.context});

          await expect(members1, 'to be fulfilled with', 4);
          await expect(members2, 'to be fulfilled with', 4);
          await expect(members3, 'to be fulfilled with', 0);

          expect(this.User.findAll, 'was called once');
          expect(this.User.findAll, 'to have a call satisfying', [{
            attributes: [
              [this.connection.fn('COUNT', this.connection.col(['user', 'id'].join('.'))), 'count']
            ],
            include: [{
              attributes: [
                'projectId'
              ],
              association: this.Project.Users.manyFromTarget,
              where: { project_id: [ this.project1.get('id'), this.project2.get('id'), project4.get('id') ] }
            }],
            raw: true,
            group: [`${this.ProjectMembers ? 'project_members' : 'members'}.project_id`],
            multiple: false
          }]);
        });

        it('batches to multiple findAll call when different limits are applied', async function () {
          const [members1, members2, members3] = await Promise.all([
            this.project1.getMembers({ limit: 4, [EXPECTED_OPTIONS_KEY]: this.context }),
            this.project2.getMembers({ limit: 2, [EXPECTED_OPTIONS_KEY]: this.context }),
            this.project3.getMembers({ limit: 2, [EXPECTED_OPTIONS_KEY]: this.context }),
          ]);

          // there is no guaranteed order and this test returns different
          // values depending on the sequelize version.
          const allMembers1 = this.users.slice(0, 4).map(user => user.get('id'));
          const allMembers2 = this.users.slice(3, 7).map(user => user.get('id'));
          const allMembers3 = this.users.slice(6, 9).map(user => user.get('id'));

          const intersection1 = intersection(members1.map(user => user.get('id')), allMembers1);
          expect(intersection1.length, 'to equal', 4);

          const intersection2 = intersection(members2.map(user => user.get('id')), allMembers2);
          expect(intersection2.length, 'to equal', 2);

          const intersection3 = intersection(members3.map(user => user.get('id')), allMembers3);
          expect(intersection3.length, 'to equal', 2);

          expect(this.User.findAll, 'was called twice');
        });

        it('find call with through model has all attributes', async function () {

          await this.project2.getMembers({ through: {attributes: ['projectId', 'userId']}, [EXPECTED_OPTIONS_KEY]: this.context });

          expect(this.User.findAll, 'to have a call satisfying', [{
            through: {attributes: ['projectId', 'userId']}
          }]);
        });

        it('batches to multiple findAll call with where', async function () {
          let members1 = this.project1.getMembers({ where: { awesome: true }, [EXPECTED_OPTIONS_KEY]: this.context })
            , members2 = this.project2.getMembers({ where: { awesome: false }, [EXPECTED_OPTIONS_KEY]: this.context });

          await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
            this.users[1],
            this.users[2],
          ]);
          await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
            this.users[3],
            this.users[5]
          ]);

          expect(this.User.findAll, 'was called twice');
          expect(this.User.findAll, 'to have a call satisfying', [{
            where: {
              awesome: true
            },
          }]);
          expect(this.User.findAll, 'to have a call satisfying', [{
            where: {
              awesome: true
            },
          }]);
        });

        it('batches to multiple findAll call with where + limit', async function () {
          const [members1, members2, members3, members4, members5] = await Promise.all([
            this.project1.getMembers({ where: { awesome: true }, limit: 1, [EXPECTED_OPTIONS_KEY]: this.context }),
            this.project2.getMembers({ where: { awesome: true }, limit: 1, [EXPECTED_OPTIONS_KEY]: this.context }),
            this.project2.getMembers({ where: { awesome: false }, limit: 2, [EXPECTED_OPTIONS_KEY]: this.context }),
            this.project3.getMembers({ where: { awesome: true }, limit: 2, [EXPECTED_OPTIONS_KEY]: this.context }),
            this.project3.getMembers({ where: { awesome: true }, limit: 2, [EXPECTED_OPTIONS_KEY]: this.context }),
          ]);

          // there is no guaranteed order and this test returns different
          // values depending on the sequelize version.
          const allMembers1 = this.users.slice(0, 4).map(user => user.get('id'));
          const allMembers2 = this.users.slice(3, 7).map(user => user.get('id'));
          const allMembers3 = this.users.slice(3, 7).map(user => user.get('id'));
          const allMembers4 = this.users.slice(6, 9).map(user => user.get('id'));
          const allMembers5 = this.users.slice(6, 9).map(user => user.get('id'));

          const intersection1 = intersection(members1.map(user => user.get('id')), allMembers1);
          expect(intersection1.length, 'to equal', 1);

          const intersection2 = intersection(members2.map(user => user.get('id')), allMembers2);
          expect(intersection2.length, 'to equal', 1);

          const intersection3 = intersection(members3.map(user => user.get('id')), allMembers3);
          expect(intersection3.length, 'to equal', 2);

          const intersection4 = intersection(members4.map(user => user.get('id')), allMembers4);
          expect(intersection4.length, 'to equal', 2);

          const intersection5 = intersection(members5.map(user => user.get('id')), allMembers5);
          expect(intersection5.length, 'to equal', 2);

          expect(this.User.findAll, 'was called thrice');
          expect(this.User.findAll, 'to have a call satisfying', [{
            where: {
              awesome: true
            },
            groupedLimit: {
              on: this.Project.Users.paired,
              limit: 1,
              values: [this.project1.get('id'), this.project2.get('id')]
            }
          }]);
          expect(this.User.findAll, 'to have a call satisfying', [{
            where: {
              awesome: true
            },
            groupedLimit: {
              on: this.Project.Users.paired,
              limit: 2,
              values: [this.project3.get('id')]
            }
          }]);
          expect(this.User.findAll, 'to have a call satisfying', [{
            where: {
              awesome: false
            },
            groupedLimit: {
              on: this.Project.Users.paired,
              limit: 2,
              values: [this.project2.get('id')]
            }
          }]);
        });
      });
    });
  });

  setups.forEach(([description, setup]) => {
    describe(description, function () {
      describe('paranoid', function () {
        before(async function () {
          this.User = this.connection.define('user', {
            name: Sequelize.STRING,
            awesome: Sequelize.BOOLEAN,
            deletedAt: Sequelize.DATE,
          }, {
            paranoid: true,
          });
          this.Project = this.connection.define('project');

          setup(this);

          await this.connection.sync({ force: true });
          await createData.call(this);

          this.context = createContext(this.connection);
        });

        beforeEach(function () {
          this.sandbox = sinon.sandbox.create();

          this.sandbox.spy(this.User, 'findAll');
        });

        afterEach(function () {
          this.sandbox.restore();
        });

        it('batches and caches to a single findAll call (paranoid)', async function () {
          let members1 = this.project1.getMembers({[EXPECTED_OPTIONS_KEY]: this.context})
            , members5 = this.project5.getMembers({[EXPECTED_OPTIONS_KEY]: this.context});

          await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
            this.users[0],
            this.users[1],
            this.users[2],
            this.users[3],
          ]);
          await expect(members5, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
            this.users[10],
          ]);

          members1 = this.project1.getMembers({[EXPECTED_OPTIONS_KEY]: this.context});
          members5 = this.project5.getMembers({[EXPECTED_OPTIONS_KEY]: this.context});

          await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
            this.users[0],
            this.users[1],
            this.users[2],
            this.users[3],
          ]);
          await expect(members5, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
            this.users[10],
          ]);

          expect(this.User.findAll, 'was called once');
          expect(this.User.findAll, 'to have a call satisfying', [{
            include: [{
              association: this.Project.Users.manyFromTarget,
              where: { project_id: [this.project1.get('id'), this.project5.get('id')] }
            }]
          }]);
        });

        it('batches and caches to a single findAll call (not paranoid)', async function () {
          let members1 = this.project1.getMembers({[EXPECTED_OPTIONS_KEY]: this.context, paranoid: false})
            , members5 = this.project5.getMembers({[EXPECTED_OPTIONS_KEY]: this.context, paranoid: false});

          await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
            this.users[0],
            this.users[1],
            this.users[2],
            this.users[3],
          ]);
          await expect(members5, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
            this.users[9],
            this.users[10],
          ]);

          members1 = this.project1.getMembers({[EXPECTED_OPTIONS_KEY]: this.context, paranoid: false});
          members5 = this.project5.getMembers({[EXPECTED_OPTIONS_KEY]: this.context, paranoid: false});

          await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
            this.users[0],
            this.users[1],
            this.users[2],
            this.users[3],
          ]);
          await expect(members5, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
            this.users[9],
            this.users[10],
          ]);

          expect(this.User.findAll, 'was called once');
          expect(this.User.findAll, 'to have a call satisfying', [{
            include: [{
              association: this.Project.Users.manyFromTarget,
              where: { project_id: [this.project1.get('id'), this.project5.get('id')] }
            }]
          }]);
        });
      });
    });
  });

  describe('scopes', function () {
    describe('scope on target', function () {
      before(async function () {
        this.User = this.connection.define('user', {
          name: Sequelize.STRING,
          awesome: Sequelize.BOOLEAN
        });
        this.Project = this.connection.define('project');

        this.Project.AwesomeMembers = this.Project.belongsToMany(this.User, {
          as: 'awesomeMembers',
          through: 'project_members',
          foreignKey: 'projectId',
          targetKey: 'id',
          scope: {
            awesome: true
          }
        });

        this.Project.Members = this.Project.belongsToMany(this.User, {
          as: 'members',
          through: 'project_members',
          foreignKey: 'projectId',
          targetKey: 'id'
        });

        this.User.belongsToMany(this.Project, {
          through: 'project_members',
          foreignKey: 'userId',
          targetKey: 'id'
        });

        await this.connection.sync({ force: true });
        await createData.call(this);
      });

      beforeEach(function () {
        this.context = createContext(this.connection);
        this.sandbox.spy(this.User, 'findAll');
      });

      afterEach(function () {
        this.sandbox.restore();
      });

      it('batches to multiple findAll call when different limits are applied', async function () {
        let members1 = this.project1.getAwesomeMembers({ limit: 10, [EXPECTED_OPTIONS_KEY]: this.context })
          , members2 = this.project2.getAwesomeMembers({ limit: 10, [EXPECTED_OPTIONS_KEY]: this.context })
          , members3 = this.project3.getAwesomeMembers({ limit: 2, [EXPECTED_OPTIONS_KEY]: this.context });

        await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
          this.users[1],
          this.users[2]
        ]);
        await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
          this.users[4],
          this.users[6]
        ]);
        await expect(members3, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
          this.users[6],
          this.users[7]
        ]);

        expect(this.User.findAll, 'was called twice');
      });

      it('batches to a single findAll call', async function () {
        let members1 = this.project1.getAwesomeMembers({[EXPECTED_OPTIONS_KEY]: this.context})
          , members2 = this.project2.getAwesomeMembers({[EXPECTED_OPTIONS_KEY]: this.context})
          , members3 = this.project3.getAwesomeMembers({[EXPECTED_OPTIONS_KEY]: this.context});

        await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
          this.users[1],
          this.users[2]
        ]);
        await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
          this.users[4],
          this.users[6]
        ]);
        await expect(members3, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
          this.users[6],
          this.users[7],
          this.users[8]
        ]);

        expect(this.User.findAll, 'was called once');
      });

      it('works for raw queries', async function () {
        let members1 = this.project1.getAwesomeMembers({ [EXPECTED_OPTIONS_KEY]: this.context })
          , members2 = this.project2.getAwesomeMembers({ raw: true, [EXPECTED_OPTIONS_KEY]: this.context })
          , members3 = this.project3.getAwesomeMembers({ raw: true, [EXPECTED_OPTIONS_KEY]: this.context });

        await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
          this.users[1],
          this.users[2]
        ]);
        expect((await members2).map(m => m.id), 'with set semantics to exhaustively satisfy', [
          this.users[4].id,
          this.users[6].id
        ]);
        expect((await members3).map(m => m.id), 'with set semantics to exhaustively satisfy', [
          this.users[6].id,
          this.users[7].id,
          this.users[8].id
        ]);

        expect(this.User.findAll, 'was called twice');
      });

      it('batches to multiple findAll call when different scopes are applied', async function () {
        let members1 = this.project1.getAwesomeMembers({ limit: 10, [EXPECTED_OPTIONS_KEY]: this.context })
          , members2 = this.project1.getMembers({ limit: 10, [EXPECTED_OPTIONS_KEY]: this.context });

        await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
          this.users[1],
          this.users[2]
        ]);
        await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
          this.users[0],
          this.users[1],
          this.users[2],
          this.users[3]
        ]);

        expect(this.User.findAll, 'was called twice');
      });
    });

    describe('scope on through', function () {
      before(async function () {
        this.User = this.connection.define('user', {
          name: Sequelize.STRING,
          awesome: Sequelize.BOOLEAN
        });
        this.Project = this.connection.define('project');
        this.ProjectMembers = this.connection.define('project_members', {
          secret: Sequelize.BOOLEAN
        });

        this.Project.SecretMembers = this.Project.belongsToMany(this.User, {
          as: 'secretMembers',
          through: {
            model: this.ProjectMembers,
            scope: {
              secret: true
            }
          },
          foreignKey: 'projectId',
          targetKey: 'id'
        });

        this.Project.Members = this.Project.belongsToMany(this.User, {
          as: 'members',
          through: this.ProjectMembers,
          foreignKey: 'projectId',
          targetKey: 'id'
        });

        this.User.belongsToMany(this.Project, {
          through: this.ProjectMembers,
          foreignKey: 'userId',
          targetKey: 'id'
        });

        await this.connection.sync({ force: true });
        await createData.call(this);

        await this.ProjectMembers.update({
          secret: true
        }, {
          where: {
            [Sequelize.Op ? Sequelize.Op.or : '$or']: [
              { projectId: this.project1.get('id'), userId: [this.users[0].get('id'), this.users[1].get('id')]},
              { projectId: this.project2.get('id'), userId: [this.users[4].get('id')]},
              { projectId: this.project3.get('id'), userId: [this.users[6].get('id'), this.users[7].get('id'), this.users[8].get('id')]}
            ]
          }
        });
      });

      beforeEach(function () {
        this.context = createContext(this.connection);
        this.sandbox.spy(this.User, 'findAll');
      });

      afterEach(function () {
        this.sandbox.restore();
      });

      it('batches to multiple findAll call when different limits are applied', async function () {
        let members1 = this.project1.getSecretMembers({ limit: 10, [EXPECTED_OPTIONS_KEY]: this.context })
          , members2 = this.project2.getSecretMembers({ limit: 10, [EXPECTED_OPTIONS_KEY]: this.context })
          , members3 = this.project3.getSecretMembers({ limit: 2, [EXPECTED_OPTIONS_KEY]: this.context });

        await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
          this.users[0],
          this.users[1]
        ]);
        await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
          this.users[4]
        ]);
        await expect(members3, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
          this.users[6],
          this.users[7]
        ]);

        expect(this.User.findAll, 'was called twice');
      });

      it('batches to one findAll call without limits', async function () {
        let members1 = this.project1.getSecretMembers({[EXPECTED_OPTIONS_KEY]: this.context})
          , members2 = this.project2.getSecretMembers({[EXPECTED_OPTIONS_KEY]: this.context})
          , members3 = this.project3.getSecretMembers({[EXPECTED_OPTIONS_KEY]: this.context});

        await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
          this.users[0],
          this.users[1]
        ]);
        await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
          this.users[4]
        ]);
        await expect(members3, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
          this.users[6],
          this.users[7],
          this.users[8]
        ]);

        expect(this.User.findAll, 'was called once');
      });

      it('batches to multiple findAll call when different scopes are applied', async function () {
        let members1 = this.project1.getSecretMembers({ limit: 10, [EXPECTED_OPTIONS_KEY]: this.context })
          , members2 = this.project1.getMembers({ limit: 10, [EXPECTED_OPTIONS_KEY]: this.context });

        await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
          this.users[0],
          this.users[1]
        ]);
        await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
          this.users[0],
          this.users[1],
          this.users[2],
          this.users[3]
        ]);

        expect(this.User.findAll, 'was called twice');
      });
    });
  });
});

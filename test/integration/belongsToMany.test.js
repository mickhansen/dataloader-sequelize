import {connection, randint} from '../helper';
import sinon from 'sinon';
import dataloaderSequelize from '../../src';
import expect from 'unexpected';
import Sequelize from 'sequelize';

async function createData() {
  [this.project1, this.project2, this.project3, this.project4] = await this.Project.bulkCreate([
    { id: randint() },
    { id: randint() },
    { id: randint() },
    { id: randint() }
  ], {returning: true});
  this.users = await this.User.bulkCreate([
    { id: randint(), awesome: false},
    { id: randint(), awesome: true },
    { id: randint(), awesome: true },
    { id: randint(), awesome: false },
    { id: randint(), awesome: true },
    { id: randint(), awesome: false },
    { id: randint(), awesome: true },
    { id: randint(), awesome: true },
    { id: randint(), awesome: true }
  ], {returning: true});

  await this.project1.setMembers(this.users.slice(0, 4));
  await this.project2.setMembers(this.users.slice(3, 7));
  await this.project3.setMembers(this.users.slice(6));
}

describe('belongsToMany', function () {
  beforeEach(async function () {
    this.sandbox = sinon.sandbox.create();
  });

  [
    ['string through', context => {
      context.Project.Users = context.Project.belongsToMany(context.User, {
        as: 'members',
        through: 'project_members',
        foreignKey: {
          name: 'projectId',
          field: 'project_id'
        },
        targetKey: {
          name: 'userId',
          field: 'user_id'
        }
      });
      context.User.belongsToMany(context.Project, {
        through: 'project_members',
        foreignKey: {
          name: 'userId',
          field: 'user_id'
        },
        targetKey: {
          name: 'projectId',
          field: 'project_id'
        }
      });
    }],
    ['model through', context => {
      context.ProjectMembers = connection.define('project_members', {
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
        targetKey: 'userId'
      });
      context.User.belongsToMany(context.Project, {
        through: context.ProjectMembers,
        foreignKey: 'userId',
        targetKey: 'projectId'
      });
    }]
  ].forEach(([description, setup]) => {
    describe(description, function () {
      describe('simple association', function () {
        before(async function () {
          this.User = connection.define('user', {
            name: Sequelize.STRING,
            awesome: Sequelize.BOOLEAN
          });
          this.Project = connection.define('project');

          setup(this);

          await connection.sync({ force: true });
          await createData.call(this);

          dataloaderSequelize(this.Project);
        });

        beforeEach(function () {
          this.sandbox = sinon.sandbox.create();

          this.sandbox.spy(this.User, 'findAll');
        });

        afterEach(function () {
          this.sandbox.restore();
        });

        it('batches to a single findAll call when getting', async function () {
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
              where: { project_id: [ this.project1.get('id'), this.project2.get('id') ] }
            }]
          }]);
        });

        it('supports rejectOnEmpty', async function () {
          let members1 = this.project1.getMembers({ rejectOnEmpty: true })
            , members2 = this.project4.getMembers({ rejectOnEmpty: true })
            , members3 = this.project4.getMembers();

          await expect(members1, 'to be fulfilled with', Array);
          await expect(members2, 'to be rejected');
          await expect(members3, 'to be fulfilled with', []);
        });

        it('batches to a single findAll call when counting', async function () {
          let project4 = await this.Project.create();

          let members1 = this.project1.countMembers()
            , members2 = this.project2.countMembers()
            , members3 = project4.countMembers();

          await expect(members1, 'to be fulfilled with', 4);
          await expect(members2, 'to be fulfilled with', 4);
          await expect(members3, 'to be fulfilled with', 0);

          expect(this.User.findAll, 'was called once');
          expect(this.User.findAll, 'to have a call satisfying', [{
            attributes: [
              [connection.fn('COUNT', connection.col(['user', 'id'].join('.'))), 'count']
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

        it('batches to multiple findAll call with where', async function () {
          let members1 = this.project1.getMembers({ where: { awesome: true } })
            , members2 = this.project2.getMembers({ where: { awesome: false } });

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
          let members1 = this.project1.getMembers({ where: { awesome: true }, limit: 1 })
            , members2 = this.project2.getMembers({ where: { awesome: true }, limit: 1 })
            , members3 = this.project2.getMembers({ where: { awesome: false }, limit: 2 })
            , members4 = this.project3.getMembers({ where: { awesome: true }, limit: 2 });

          await expect(members1, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
            this.users[1]
          ]);
          await expect(members2, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
            this.users[4]
          ]);
          await expect(members3, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
            this.users[3],
            this.users[5]
          ]);
          await expect(members4, 'when fulfilled', 'with set semantics to exhaustively satisfy', [
            this.users[6],
            this.users[7]
          ]);

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

  describe('scopes', function () {
    describe('scope on target', function () {
      before(async function () {
        this.User = connection.define('user', {
          name: Sequelize.STRING,
          awesome: Sequelize.BOOLEAN
        });
        this.Project = connection.define('project');

        this.Project.AwesomeMembers = this.Project.belongsToMany(this.User, {
          as: 'awesomeMembers',
          through: 'project_members',
          foreignKey: 'projectId',
          targetKey: 'userId',
          scope: {
            awesome: true
          }
        });

        this.Project.Members = this.Project.belongsToMany(this.User, {
          as: 'members',
          through: 'project_members',
          foreignKey: 'projectId',
          targetKey: 'userId'
        });

        this.User.belongsToMany(this.Project, {
          through: 'project_members',
          foreignKey: 'userId',
          targetKey: 'projectId'
        });

        await connection.sync({ force: true });
        await createData.call(this);

        dataloaderSequelize(this.Project);
      });

      beforeEach(function () {
        this.sandbox.spy(this.User, 'findAll');
      });

      afterEach(function () {
        this.sandbox.restore();
      });

      it('batches to multiple findAll call when different limits are applied', async function () {
        let members1 = this.project1.getAwesomeMembers({ limit: 10 })
          , members2 = this.project2.getAwesomeMembers({ limit: 10 })
          , members3 = this.project3.getAwesomeMembers({ limit: 2 });

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
        let members1 = this.project1.getAwesomeMembers()
          , members2 = this.project2.getAwesomeMembers()
          , members3 = this.project3.getAwesomeMembers();

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
        let members1 = this.project1.getAwesomeMembers()
          , members2 = this.project2.getAwesomeMembers({ raw: true })
          , members3 = this.project3.getAwesomeMembers({ raw: true });

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
        let members1 = this.project1.getAwesomeMembers({ limit: 10 })
          , members2 = this.project1.getMembers({ limit: 10 });

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
        this.User = connection.define('user', {
          name: Sequelize.STRING,
          awesome: Sequelize.BOOLEAN
        });
        this.Project = connection.define('project');
        this.ProjectMembers = connection.define('project_members', {
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
          targetKey: 'userId'
        });

        this.Project.Members = this.Project.belongsToMany(this.User, {
          as: 'members',
          through: this.ProjectMembers,
          foreignKey: 'projectId',
          targetKey: 'userId'
        });

        this.User.belongsToMany(this.Project, {
          through: this.ProjectMembers,
          foreignKey: 'userId',
          targetKey: 'projectId'
        });

        await connection.sync({ force: true });
        await createData.call(this);

        await this.ProjectMembers.update({
          secret: true
        }, {
          where: {
            $or: [
              { projectId: this.project1.get('id'), userId: [this.users[0].get('id'), this.users[1].get('id')]},
              { projectId: this.project2.get('id'), userId: [this.users[4].get('id')]},
              { projectId: this.project3.get('id'), userId: [this.users[6].get('id'), this.users[7].get('id'), this.users[8].get('id')]}
            ]
          }
        });

        dataloaderSequelize(this.Project);
      });

      beforeEach(function () {
        this.sandbox.spy(this.User, 'findAll');
      });

      afterEach(function () {
        this.sandbox.restore();
      });

      it('batches to multiple findAll call when different limits are applied', async function () {
        let members1 = this.project1.getSecretMembers({ limit: 10 })
          , members2 = this.project2.getSecretMembers({ limit: 10 })
          , members3 = this.project3.getSecretMembers({ limit: 2 });

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
        let members1 = this.project1.getSecretMembers()
          , members2 = this.project2.getSecretMembers()
          , members3 = this.project3.getSecretMembers();

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
        let members1 = this.project1.getSecretMembers({ limit: 10 })
          , members2 = this.project1.getMembers({ limit: 10 });

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

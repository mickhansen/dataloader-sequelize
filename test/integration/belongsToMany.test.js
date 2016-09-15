import {connection, randint} from '../helper';
import sinon from 'sinon';
import dataloaderSequelize from '../../src';
import expect from 'unexpected';
import Sequelize from 'sequelize';

describe('belongsToMany', function () {
  beforeEach(async function () {
    this.sandbox = sinon.sandbox.create();
  });
  afterEach(function () {
    this.sandbox.restore();
  });

  [
    ['string through', context => {
      context.Project.Users = context.Project.belongsToMany(context.User, { as: 'members', through: 'project_members' });
      context.User.belongsToMany(context.Project, { through: 'project_members' });
    }],
    ['model through', context => {
      context.ProjectMembers = connection.define('project_members');
      context.Project.Users = context.Project.belongsToMany(context.User, { as: 'members', through: context.ProjectMembers });
      context.User.belongsToMany(context.Project, { through: context.ProjectMembers });
    }]
  ].forEach(([description, setup]) => {
    describe(description, function () {
      describe('simple association', function () {
        beforeEach(async function () {
          this.sandbox = sinon.sandbox.create();

          this.User = connection.define('user', {
            name: Sequelize.STRING,
            awesome: Sequelize.BOOLEAN
          });
          this.Project = connection.define('project');

          setup(this);

          await connection.sync({
            force: true
          });

          [this.project1, this.project2, this.project3] = await this.Project.bulkCreate([
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

          dataloaderSequelize(this.Project);
          this.sandbox.spy(this.User, 'findAll');
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
              where: { projectId: [ this.project1.get('id'), this.project2.get('id') ] }
            }]
          }]);
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
              where: { projectId: [ this.project1.get('id'), this.project2.get('id'), project4.get('id') ] }
            }],
            raw: true,
            group: ['projectId'],
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
});

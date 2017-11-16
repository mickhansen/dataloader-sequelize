import Sequelize from 'sequelize';
import {connection, randint} from '../helper';
import sinon from 'sinon';
import dataloaderSequelize from '../../src';
import expect from 'unexpected';

async function createData() {
  [this.project1, this.project2, this.project3, this.project4] = await this.Project.bulkCreate([
    { id: randint() },
    { id: randint() },
    { id: randint() },
    { id: randint() }
  ], {returning: true});
  this.users = await this.User.bulkCreate([
    { id: randint(), awesome: false, deletedAt: new Date() },
    { id: randint(), awesome: true },
    { id: randint(), awesome: true },
    { id: randint(), awesome: false },
    { id: randint(), awesome: true },
    { id: randint(), awesome: false },
    { id: randint(), awesome: true },
    { id: randint(), awesome: true },
    { id: randint(), awesome: true, deletedAt: new Date() }
  ], {returning: true});

  await this.project1.setMembers(this.users.slice(0, 3));
  await this.project2.setMembers(this.users.slice(3, 7));
  await this.project3.setMembers(this.users.slice(7));
}

describe('issue#44', function () {
  beforeEach(async function () {
    this.sandbox = sinon.sandbox.create();
  });

  describe('issue#44', function () {
    before(async function () {
      this.User = connection.define('user', {
        awesome: Sequelize.BOOLEAN
      });
      this.Project = connection.define('project');
      this.Project.Members = this.Project.hasMany(this.User, { as: 'members' });

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

    it('issue#44', async function () {
      const project = await this.Project.findById(this.project1.get('id'));

      const [result1, result2 ] = await Promise.all([
        project.getMembers({
          limit: 1
        }),
        project.getMembers({
          limit: 1
        })
      ]);

      expect(result1, 'to have length', 1);
      expect(result1[0].id, 'to be', this.users[0].get('id'));

      expect(result2, 'to have length', 1);
      expect(result2[0].id, 'to be', this.users[0].get('id'));


    });
  });
});

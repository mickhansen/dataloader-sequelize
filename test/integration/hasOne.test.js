import {connection, randint} from '../helper';
import sinon from 'sinon';
import dataloaderSequelize from '../../src';
import expect from 'unexpected';
import Promise from 'bluebird';

describe('hasOne', function () {
  beforeEach(async function () {
    this.sandbox = sinon.sandbox.create();

    this.User = connection.define('user');
    this.Project = connection.define('project');

    this.User.hasOne(this.Project, {
      as: 'mainProject',
      foreignKey: {
        name: 'ownerId',
        field: 'owner_id'
      }
    });

    await connection.sync({
      force: true
    });

    [this.user1, this.user2, this.user3] = await this.User.bulkCreate([
      { id: randint() },
      { id: randint() },
      { id: randint() }
    ], { returning: true });
    [this.project1, this.project2] = await this.Project.bulkCreate([
      { id: randint() },
      { id: randint() }
    ], { returning: true });
    await Promise.join(
      this.user1.setMainProject(this.project1),
      this.user2.setMainProject(this.project2)
    );

    dataloaderSequelize(this.User);
    this.sandbox.spy(this.Project, 'findAll');
  });
  afterEach(function () {
    this.sandbox.restore();
  });

  it('batches to a single findAll call', async function () {
    let project1 = this.user1.getMainProject()
      , project2 = this.user2.getMainProject();

    await expect(project1, 'to be fulfilled with', this.project1);
    await expect(project2, 'to be fulfilled with', this.project2);

    expect(this.Project.findAll, 'was called once');
    expect(this.Project.findAll, 'to have a call satisfying', [{
      where: {
        owner_id: [this.user1.get('id'), this.user2.get('id')]
      }
    }]);
  });

  it('supports rejectOnEmpty', async function () {
    let project1 = this.user1.getMainProject({ rejectOnEmpty: true })
      , project2 = this.user3.getMainProject({ rejectOnEmpty: true })
      , project3 = this.user3.getMainProject();

    await expect(project1, 'to be fulfilled with', this.project1);
    await expect(project2, 'to be rejected with', new connection.EmptyResultError());
    await expect(project3, 'to be fulfilled with', null);
  });
});

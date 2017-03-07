import {connection} from '../helper';
import Sequelize from 'sequelize';
import dataloaderSequelize from '../../src';
import expect from 'unexpected';
import sinon from 'sinon';
import Promise from 'bluebird';
import shimmer from 'shimmer';

describe('shimming', function () {
  beforeEach(function () {
    this.sandbox = sinon.sandbox.create();
    this.User = connection.define('user');
    this.Task = connection.define('task', {
      external_id: Sequelize.INTEGER
    });
    this.Action = connection.define('action', {
      task_id: Sequelize.INTEGER
    });

    this.User.Tasks = this.User.hasMany(this.Task);
    this.User.PrimaryTask = this.User.hasOne(this.Task);
    this.Task.User = this.Task.belongsTo(this.User);
    this.Task.Actions = this.Task.hasMany(this.Action, {
      foreignKey: 'task_id',
      sourceKey: 'external_id'
    });
    this.Action.Task = this.Action.belongsTo(this.Task, {
      foreignKey: 'task_id',
      targetKey: 'external_id'
    });
  });

  afterEach(function () {
    [
      connection.Model.prototype.findByPrimary,
      connection.Model.prototype.findById,
      connection.Association.BelongsTo.prototype.get,
      connection.Association.HasOne.prototype.get,
      connection.Association.HasMany.prototype.get,
      connection.Association.BelongsToMany.prototype.get
    ].forEach(i => i.__unwrap && i.__unwrap());

    this.sandbox.restore();
    connection.modelManager.forEachModel(connection.modelManager.removeModel.bind(connection.modelManager));
  });

  describe('sequelize constructor', function () {
    beforeEach(function () {
      dataloaderSequelize(connection);
    });

    it('shims all models', function () {
      expect(this.User.findById, 'to be shimmed');
      expect(this.Task.findById, 'to be shimmed');
      expect(this.Action.findById, 'to be shimmed');
    });

    it('shims all associations', function () {
      expect(this.User.Tasks.get, 'to be shimmed');
      expect(this.User.PrimaryTask.get, 'to be shimmed');
      expect(this.Task.User.get, 'to be shimmed');
      expect(this.Task.Actions.get, 'to be shimmed');
      expect(this.Action.Task.get, 'to be shimmed');
    });

    it('shims only once', function () {
      this.sandbox.stub(shimmer, 'wrap');
      dataloaderSequelize(connection);

      expect(shimmer.wrap, 'was not called');
    });
  });

  describe('single model', function () {
    beforeEach(function () {
      dataloaderSequelize(this.User);
    });

    afterEach(function () {
      [
        this.User.findByPrimary,
        this.User.findById,
        this.User.associations.tasks.get
      ].forEach(i => i.__unwrap());
    });

    it('shims only targeted model', function () {
      expect(this.User.findById, 'to be shimmed');
      expect(this.Task.findById, 'not to be shimmed');
    });

    it('shims only targeted models associations', function () {
      expect(this.User.Tasks.get, 'to be shimmed');
      expect(this.User.PrimaryTask.get, 'to be shimmed');
      expect(this.Task.User.get, 'not to be shimmed');
    });
  });

  describe('single association', function () {
    beforeEach(function () {
      dataloaderSequelize(this.User.Tasks);
    });

    afterEach(function () {
      this.User.Tasks.get.__unwrap();
    });

    it('does not shim models', function () {
      expect(this.User.findById, 'not to be shimmed');
      expect(this.Task.findById, 'not to be shimmed');
    });

    it('does not shim other associations', function () {
      expect(this.User.Tasks.get, 'to be shimmed');
      expect(this.User.PrimaryTask.get, 'not to be shimmed');
      expect(this.Task.User.get, 'not to be shimmed');
    });
  });

  describe('paired BTM', function () {
    it('does not throw an error when attached to the prototype', async function () {
      this.sandbox.stub(this.Task, 'findAll').resolves();
      dataloaderSequelize(connection);

      let UserTasks = this.User.belongsToMany(this.Task, { through: 'foobar' });
      this.Task.belongsToMany(this.User, { through: 'foobar' });

      expect(() => UserTasks.get(this.User.build({ id: 42 })), 'not to throw');
      await Promise.delay(1);
      expect(this.Task.findAll, 'was called once');
    });

    it('throws error for non-paired BTM', function () {
      let UserTasks = this.User.belongsToMany(this.Task, { through: 'foobar' });
      dataloaderSequelize(UserTasks);

      expect(() => UserTasks.get(this.User.build({ id: 42 })), 'to throw');
    });
  });
});


import {connection} from '../helper';
import dataloaderSequelize from '../../src';
import expect from 'unexpected';

describe('shimming', function () {
  beforeEach(function () {
    this.User = connection.define('user');
    this.Task = connection.define('task');

    this.User.Tasks = this.User.hasMany(this.Task);
    this.User.PrimaryTask = this.User.hasOne(this.Task);
    this.Task.User = this.Task.belongsTo(this.User);
  });

  describe('sequelize constructor', function () {
    beforeEach(function () {
      dataloaderSequelize(connection);
    });

    afterEach(function () {
      [
        connection.Model.prototype.findByPrimary,
        connection.Model.prototype.findById,
        connection.Association.BelongsTo.prototype.get,
        connection.Association.HasOne.prototype.get,
        connection.Association.HasMany.prototype.get
      ].forEach(i => i.__unwrap());
    });

    it('shims all models', function () {
      expect(this.User.findById, 'to be shimmed');
      expect(this.Task.findById, 'to be shimmed');
    });

    it('shims all associations', function () {
      expect(this.User.Tasks.get, 'to be shimmed');
      expect(this.User.PrimaryTask.get, 'to be shimmed');
      expect(this.Task.User.get, 'to be shimmed');
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
      [
        this.User.Tasks.get
      ].forEach(i => i.__unwrap());
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
});


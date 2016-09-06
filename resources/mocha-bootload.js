require("babel-register");

var unexpected = require('unexpected');
unexpected.use(require('unexpected-sinon'));
unexpected.use(require('unexpected-set'));

var Bluebird = require('bluebird');
require('sinon-as-promised')(Bluebird);

var Sequelize = require('sequelize');
unexpected.addType({
  name: 'SequelizeInstance',
  identify: function (value) {
    return value && value instanceof Sequelize.Instance;
  },
  inspect: function (value, depth, output, inspect) {
    output.append(inspect(value.get(), depth));
  },
  equal: function (a, b) {
    const pk = a.Model.primaryKeyAttribute;
    return a.Model.name === b.Model.name && a.get(pk) === b.get(pk);
  }
});

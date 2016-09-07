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
    output
      .text(value.Model.name).text('(')
      .append(inspect(value.get(), depth))
      .text(')');
  },
  equal: function (a, b) {
    const pk = a.Model.primaryKeyAttribute;
    return a.Model.name === b.Model.name && a.get(pk) === b.get(pk);
  }
});

unexpected.addAssertion('<function> [not] to be shimmed', function (expect, subject) {
  return expect(subject, '[not] to have property', '__wrapped');
});

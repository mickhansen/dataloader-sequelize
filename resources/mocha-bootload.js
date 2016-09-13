require("babel-register");

var unexpected = require('unexpected');
unexpected.use(require('unexpected-sinon'));
unexpected.use(require('unexpected-set'));

var Bluebird = require('bluebird');
require('sinon-as-promised')(Bluebird);

var Sequelize = require('sequelize');
unexpected.addType({
  name: 'Sequelize.Instance',
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

unexpected.addType({
  name: 'Sequelize.Association',
  identify: function (value) {
    return value && value instanceof Sequelize.Association;
  },
  inspect: function (value, depth, output) {
    output
      .text(value.associationType).text(': ')
      .text(value.source.name).text(' -> ').text(value.target.name)
      .text('(').text(value.as).text(')');
  },
  equal: function (a, b, equal) {
    return a.associationType === b.associationType && equal(a.source, b.source) && equal(a.target, b.target) && a.as === b.as;
  }
});

unexpected.addAssertion('<function> [not] to be shimmed', function (expect, subject) {
  return expect(subject, '[not] to have property', '__wrapped');
});

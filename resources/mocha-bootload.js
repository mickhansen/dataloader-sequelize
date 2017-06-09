require("babel-register");

var unexpected = require('unexpected');
unexpected.use(require('unexpected-sinon'));
unexpected.use(require('unexpected-set'));

var Bluebird = require('bluebird');
require('sinon-as-promised')(Bluebird);

var Sequelize = require('sequelize');
unexpected.addType({
  name: 'Sequelize.Instance',
  identify: /^4/.test(Sequelize.version) ?
    function (value) {
      return value && value instanceof Sequelize.Model && 'isNewRecord' in value;
    } :
    function (value) {
      return value && value instanceof Sequelize.Instance;
    },
  inspect: function (value, depth, output, inspect) {
    const name = value.name || value._modelOptions.name; // v3 vs v4
    output
      .text(name.singular).text('(')
      .append(inspect(value.get(), depth))
      .text(')');
  },
  equal: function (a, b) {
    const aModel = a.Model || a.constructor; // v3 vs v4
    const bModel = b.Model || b.constructor;
    const pk = aModel.primaryKeyAttribute;
    return aModel.name === bModel.name && a.get(pk) === b.get(pk);
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

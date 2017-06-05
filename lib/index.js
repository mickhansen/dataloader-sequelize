'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

exports.getCacheKey = getCacheKey;
exports.resetCache = resetCache;

exports.default = function (target) {
  let options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

  options = _extends({}, options, {
    max: 500
  });

  if (!cache) {
    cache = (0, _lruCache2.default)(options);
  }

  if (target.associationType) {
    shimAssociation(target);
  } else if (/SequelizeModel|class extends Model/.test(target.toString())) {
    shimModel(target);
    (0, _lodash.values)(target.associations).forEach(shimAssociation);
  } else {
    // Assume target is the sequelize constructor
    shimModel(/^4/.test(_sequelize2.default.version) ? // v3 vs v4
    target.Model : target.Model.prototype);
    shimBelongsTo(target.Association.BelongsTo.prototype);
    shimHasOne(target.Association.HasOne.prototype);
    shimHasMany(target.Association.HasMany.prototype);
    shimBelongsToMany(target.Association.BelongsToMany.prototype);
  }
};

var _sequelize = require('sequelize');

var _sequelize2 = _interopRequireDefault(_sequelize);

var _shimmer = require('shimmer');

var _shimmer2 = _interopRequireDefault(_shimmer);

var _dataloader = require('dataloader');

var _dataloader2 = _interopRequireDefault(_dataloader);

var _bluebird = require('bluebird');

var _bluebird2 = _interopRequireDefault(_bluebird);

var _lodash = require('lodash');

var _lruCache = require('lru-cache');

var _lruCache2 = _interopRequireDefault(_lruCache);

var _assert = require('assert');

var _assert2 = _interopRequireDefault(_assert);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function mapResult(attribute, keys, options, result) {
  // Convert an array of results to an object of attribute (primary / foreign / target key) -> array of matching rows
  if (Array.isArray(attribute) && options.multiple && !options.raw) {
    // Regular belongs to many
    var _attribute = attribute,
        _attribute2 = _slicedToArray(_attribute, 2);

    let throughAttribute = _attribute2[0],
        foreignKey = _attribute2[1];

    result = result.reduce((carry, row) => {
      for (const throughRow of row.get(throughAttribute)) {
        let key = throughRow[foreignKey];
        if (!(key in carry)) {
          carry[key] = [];
        }

        carry[key].push(row);
      }

      return carry;
    }, {});
  } else {
    if (Array.isArray(attribute)) {
      // Belongs to many count is a raw query, so we have to get the attribute directly
      attribute = attribute.join('.');
    }
    result = (0, _lodash.groupBy)(result, (0, _lodash.property)(attribute));
  }

  return keys.map(key => {
    if (key in result) {
      let value = result[key];

      return options.multiple ? value : value[0];
    }
    return options.multiple ? [] : null;
  });
}

function stringifyValue(value, key) {
  if (value && value.associationType) {
    return `${value.associationType},${value.target.name},${value.as}`;
  } else if (Array.isArray(value)) {
    if (key !== 'order') {
      // attribute order doesn't matter - order order definitely does
      value = (0, _lodash.clone)(value).sort();
    }
    return value.map(stringifyValue).join(',');
  } else if (typeof value === 'object' && value !== null) {
    return stringifyObject(value);
  }
  return value;
}

// This is basically a home-grown JSON.stringifier. However, JSON.stringify on objects
// depends on the order in which the properties were defined - which we don't like!
// Additionally, JSON.stringify escapes strings, which we don't need here
function stringifyObject(object) {
  let keys = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : Object.keys(object);

  return keys.sort().map(key => `${key}:${stringifyValue(object[key], key)}`).join('|');
}

function getCacheKey(model, attribute, options) {
  options = stringifyObject(options, ['association', 'attributes', 'groupedLimit', 'limit', 'offset', 'order', 'where', 'through', 'raw']);

  return `${model.name}|${attribute}|${options}`;
}

function mergeWhere(where, optionsWhere) {
  if (optionsWhere) {
    return {
      $and: [where, optionsWhere]
    };
  }
  return where;
}

function rejectOnEmpty(options, result) {
  if ((0, _lodash.isEmpty)(result) && options.rejectOnEmpty) {
    if (typeof options.rejectOnEmpty === 'function') {
      throw new options.rejectOnEmpty();
    } else if (typeof options.rejectOnEmpty === 'object') {
      throw options.rejectOnEmpty;
    } else {
      throw new _sequelize2.default.EmptyResultError();
    }
  }

  return result;
}

function loaderForBTM(model, joinTableName, foreignKey, foreignKeyField) {
  let options = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : {};

  (0, _assert2.default)(options.include === undefined, 'options.include is not supported by model loader');
  (0, _assert2.default)(options.association !== undefined, 'options.association should be set for BTM loader');

  let attributes = [joinTableName, foreignKey],
      cacheKey = getCacheKey(model, attributes, options),
      association = options.association;
  delete options.association;

  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, new _dataloader2.default(keys => {
      let findOptions = Object.assign({}, options);
      delete findOptions.rejectOnEmpty;
      if (findOptions.limit) {
        findOptions.groupedLimit = {
          through: options.through,
          on: association,
          limit: findOptions.limit,
          values: keys
        };
      } else {
        findOptions.include = [{
          attributes: [foreignKey],
          association: association.manyFromSource,
          where: _extends({
            [foreignKeyField]: keys
          }, options.through.where)
        }];
      }

      return model.findAll(findOptions).then(mapResult.bind(null, attributes, keys, findOptions));
    }, {
      cache: false
    }));
  }

  return cache.get(cacheKey);
}

function loaderForModel(model, attribute, attributeField) {
  let options = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : {};

  (0, _assert2.default)(options.include === undefined, 'options.include is not supported by model loader');

  let cacheKey = getCacheKey(model, attribute, options);

  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, new _dataloader2.default(keys => {
      const findOptions = Object.assign({}, options);
      delete findOptions.rejectOnEmpty;

      if (findOptions.limit && keys.length > 1) {
        findOptions.groupedLimit = {
          limit: findOptions.limit,
          on: attributeField,
          values: keys
        };
        delete findOptions.limit;
      } else {
        findOptions.where = mergeWhere({
          [attributeField]: keys
        }, findOptions.where);
      }

      return model.findAll(findOptions).then(mapResult.bind(null, attribute, keys, findOptions));
    }, {
      cache: false
    }));
  }

  return cache.get(cacheKey);
}

function shimModel(target) {
  if (target.findById.__wrapped) return;

  _shimmer2.default.massWrap(target, ['findById', 'findByPrimary'], original => {
    return function batchedFindById(id) {
      let options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      if ([null, undefined].indexOf(id) !== -1) {
        return _bluebird2.default.resolve(null);
      }
      if (options.transaction || options.include) {
        return original.apply(this, arguments);
      }
      return loaderForModel(this, this.primaryKeyAttribute, this.primaryKeyField).load(id).then(rejectOnEmpty.bind(null, options));
    };
  });
}

function shimBelongsTo(target) {
  if (target.get.__wrapped) return;

  _shimmer2.default.wrap(target, 'get', original => {
    return function batchedGetBelongsTo(instance) {
      let options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      if (Array.isArray(instance) || options.include || options.transaction) {
        return original.apply(this, arguments);
      }

      let foreignKeyValue = instance.get(this.foreignKey);
      return _bluebird2.default.resolve().then(() => {
        if (foreignKeyValue === undefined || foreignKeyValue === null) {
          return _bluebird2.default.resolve(null);
        }
        let loader = loaderForModel(this.target, this.targetKey, this.targetKeyField, options);
        return loader.load(foreignKeyValue);
      }).then(rejectOnEmpty.bind(null, options));
    };
  });
}

function shimHasOne(target) {
  if (target.get.__wrapped) return;

  _shimmer2.default.wrap(target, 'get', original => {
    return function batchedGetHasOne(instance) {
      let options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      if (Array.isArray(instance) || options.include || options.transaction) {
        return original.apply(this, arguments);
      }

      let loader = loaderForModel(this.target, this.foreignKey, this.identifierField, options);
      return loader.load(instance.get(this.sourceKey)).then(rejectOnEmpty.bind(null, options));
    };
  });
}

function shimHasMany(target) {
  if (target.get.__wrapped) return;

  _shimmer2.default.wrap(target, 'get', original => {
    return function bathedGetHasMany(instances) {
      let options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      let isCount = false;
      if (options.include || options.transaction) {
        return original.apply(this, arguments);
      }

      const attributes = options.attributes;
      if (attributes && attributes.length === 1 && attributes[0][0].fn && attributes[0][0].fn === 'COUNT' && !options.group) {
        // Phew, what an if statement - It avoids duplicating the count code from sequelize,
        // at the expense of slightly tighter coupling to the sequelize implementation
        options.attributes.push(this.foreignKey);
        options.multiple = false;
        options.group = [this.foreignKey];
        delete options.plain;
        isCount = true;
      }

      if (this.scope) {
        options.where = {
          $and: [options.where, this.scope]
        };
      }

      let loader = loaderForModel(this.target, this.foreignKey, this.foreignKeyField, _extends({
        multiple: true
      }, options));

      let key = this.sourceKey || this.source.primaryKeyAttribute;

      if (Array.isArray(instances)) {
        return _bluebird2.default.map(instances, instance => loader.load(instance.get(key)));
      } else {
        return loader.load(instances.get(key)).then(result => {
          if (isCount && !result) {
            result = { count: 0 };
          }
          return result;
        }).then(rejectOnEmpty.bind(null, options));
      }
    };
  });
}

function shimBelongsToMany(target) {
  if (target.get.__wrapped) return;

  _shimmer2.default.wrap(target, 'get', original => {
    return function bathedGetHasMany(instances) {
      let options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      let isCount = false;
      (0, _assert2.default)(this.paired, '.paired missing on belongsToMany association. You need to set up both sides of the association');

      if (options.include || options.transaction) {
        return original.apply(this, arguments);
      }

      const attributes = options.attributes;
      if (attributes && attributes.length === 1 && attributes[0][0].fn && attributes[0][0].fn === 'COUNT' && !options.group) {
        // Phew, what an if statement - It avoids duplicating the count code from sequelize,
        // at the expense of slightly tighter coupling to the sequelize implementation
        options.multiple = false;
        options.group = [`${this.paired.manyFromSource.as}.${this.identifierField}`];
        delete options.plain;
        isCount = true;
      }

      if (this.scope) {
        options.where = {
          $and: [options.where, this.scope]
        };
      }

      options.through = options.through || {};
      if (this.through.scope) {
        options.through.where = {
          $and: [options.through.where, this.through.scope]
        };
      }

      let loader = loaderForBTM(this.target, this.paired.manyFromSource.as, this.foreignKey, this.identifierField, _extends({
        association: this.paired,
        multiple: true
      }, options));

      if (Array.isArray(instances)) {
        return _bluebird2.default.map(instances, instance => loader.load(instance.get(this.source.primaryKeyAttribute)));
      } else {
        return loader.load(instances.get(this.source.primaryKeyAttribute)).then(result => {
          if (isCount && !result) {
            result = { count: 0 };
          }
          return result;
        }).then(rejectOnEmpty.bind(null, options));
      }
    };
  });
}

function shimAssociation(association) {
  switch (association.associationType) {
    case 'BelongsTo':
      return shimBelongsTo(association);
    case 'HasOne':
      return shimHasOne(association);
    case 'HasMany':
      return shimHasMany(association);
    case 'BelongsToMany':
      return shimBelongsToMany(association);
  }
}

let cache;
function resetCache() {
  if (cache) cache.reset();
}
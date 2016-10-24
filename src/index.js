import Sequelize from 'sequelize';
import shimmer from 'shimmer';
import DataLoader from 'dataloader';
import Promise from 'bluebird';
import {groupBy, property, values, clone, isEmpty} from 'lodash';
import LRU from 'lru-cache';
import assert from 'assert';

function mapResult(attribute, keys, options, result) {
  // Convert an array of results to an object of attribute (primary / foreign / target key) -> array of matching rows
  if (Array.isArray(attribute) && options.multiple) {
    // Regular belongs to many
    let [throughAttribute, foreignKey] = attribute;
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
    result = groupBy(result, property(attribute));
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
  if (value instanceof Sequelize.Association) {
    return `${value.associationType},${value.target.name},${value.as}`;
  } else if (Array.isArray(value)) {
    if (key !== 'order') {
      // attribute order doesn't matter - order order definitely does
      value = clone(value).sort();
    }
    return value.map(stringifyValue).join(',');
  } else if (typeof value === 'object') {
    return stringifyObject(value);
  }
  return value;
}

// This is basically a home-grown JSON.stringifier. However, JSON.stringify on objects
// depends on the order in which the properties were defined - which we don't like!
// Additionally, JSON.stringify escapes strings, which we don't need here
function stringifyObject(object, keys = Object.keys(object)) {
  return keys.sort().map(key => `${key}:${stringifyValue(object[key], key)}`).join('|');
}

export function getCacheKey(model, attribute, options) {
  options = stringifyObject(options, ['association', 'attributes', 'groupedLimit', 'limit', 'offset', 'order', 'where']);

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
  if (isEmpty(result) && options.rejectOnEmpty) {
    if (typeof options.rejectOnEmpty === 'function') {
      throw new options.rejectOnEmpty();
    } else if (typeof options.rejectOnEmpty === 'object') {
      throw options.rejectOnEmpty;
    } else {
      throw new Sequelize.EmptyResultError();
    }
  }

  return result;
}

function loaderForBTM(model, joinTableName, foreignKey, foreignKeyField, options = {}) {
  assert(options.include === undefined, 'options.include is not supported by model loader');
  assert(options.association !== undefined, 'options.association should be set for BTM loader');

  let attributes = [joinTableName, foreignKey]
    , cacheKey = getCacheKey(model, attributes, options)
    , association = options.association;
  delete options.association;

  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, new DataLoader(keys => {
      let findOptions = Object.assign({}, options);
      delete findOptions.rejectOnEmpty;
      if (findOptions.limit) {
        findOptions.groupedLimit = {
          on: association,
          limit: findOptions.limit,
          values: keys
        };
      } else {
        findOptions.include = [{
          attributes: [foreignKey],
          association: association.manyFromSource,
          where: {
            [foreignKeyField]: keys
          }
        }];
      }

      return model.findAll(findOptions).then(mapResult.bind(null, attributes, keys, findOptions));
    }, {
      cache: false
    }));
  }

  return cache.get(cacheKey);
}

function loaderForModel(model, attribute, attributeField, options = {}) {
  assert(options.include === undefined, 'options.include is not supported by model loader');

  let cacheKey = getCacheKey(model, attribute, options);

  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, new DataLoader(keys => {
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

  shimmer.massWrap(target, ['findById', 'findByPrimary'], original => {
    return function batchedFindById(id, options = {}) {
      if ([null, undefined].indexOf(id) !== -1) {
        return Promise.resolve(null);
      }
      if (options.transaction) {
        return original.apply(this, arguments);
      }
      return loaderForModel(this, this.primaryKeyAttribute, this.primaryKeyField).load(id).then(rejectOnEmpty.bind(null, options));
    };
  });
}

function shimBelongsTo(target) {
  if (target.get.__wrapped) return;

  shimmer.wrap(target, 'get', original => {
    return function batchedGetBelongsTo(instance, options = {}) {
      if (Array.isArray(instance) || options.include || options.transaction) {
        return original.apply(this, arguments);
      }

      let foreignKeyValue = instance.get(this.foreignKey);
      return Promise.resolve().then(() => {
        if (!foreignKeyValue) {
          return Promise.resolve(null);
        }
        let loader = loaderForModel(this.target, this.targetKey, this.targetKeyField, options);
        return loader.load(foreignKeyValue);
      }).then(rejectOnEmpty.bind(null, options));
    };
  });
}

function shimHasOne(target) {
  if (target.get.__wrapped) return;

  shimmer.wrap(target, 'get', original => {
    return function batchedGetHasOne(instance, options = {}) {
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

  shimmer.wrap(target, 'get', original => {
    return function bathedGetHasMany(instances, options = {}) {
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

      let loader = loaderForModel(this.target, this.foreignKey, this.foreignKeyField, {
        multiple: true,
        ...options
      });

      if (Array.isArray(instances)) {
        return Promise.map(instances, instance => loader.load(instance.get(this.source.primaryKeyAttribute)));
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

function shimBelongsToMany(target) {
  if (target.get.__wrapped) return;

  shimmer.wrap(target, 'get', original => {
    return function bathedGetHasMany(instances, options = {}) {
      let isCount = false;
      assert(this.paired, '.paired missing on belongsToMany association. You need to set up both sides of the association');

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

      let loader = loaderForBTM(this.target, this.paired.manyFromSource.as, this.foreignKey, this.identifierField, {
        association: this.paired,
        multiple: true,
        ...options
      });

      if (Array.isArray(instances)) {
        return Promise.map(instances, instance => loader.load(instance.get(this.source.primaryKeyAttribute)));
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
  if (association instanceof Sequelize.Association.BelongsTo) shimBelongsTo(association);
  else if (association instanceof Sequelize.Association.HasOne) shimHasOne(association);
  else if (association instanceof Sequelize.Association.HasMany) shimHasMany(association);
  else if (association instanceof Sequelize.Association.BelongsToMany) shimBelongsToMany(association);
}

let cache;
export function resetCache() {
  if (cache) cache.reset();
}
export default function (target, options = {}) {
  options = {
    ...options,
    max: 500
  };

  cache = LRU(options);

  if (target instanceof Sequelize.Association) {
    shimAssociation(target);
  } else if (target instanceof Sequelize.Model) {
    shimModel(target);
    values(target.associations).forEach(shimAssociation);
  } else if (target instanceof Sequelize) {
    shimModel(target.Model.prototype);
    shimBelongsTo(target.Association.BelongsTo.prototype);
    shimHasOne(target.Association.HasOne.prototype);
    shimHasMany(target.Association.HasMany.prototype);
    shimBelongsToMany(target.Association.BelongsToMany.prototype);
  }
}

import Sequelize from 'sequelize';
import shimmer from 'shimmer';
import DataLoader from 'dataloader';
import Promise from 'bluebird';
import {groupBy, property, values} from 'lodash';
import LRU from 'lru-cache';
import assert from 'assert';

function mapResult(attribute, keys, options, result) {
  // Convert an array of results to an object of attribute (primary / foreign / target key) -> array of matching rows
  if (Array.isArray(attribute)) {
    // Belongs to many
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

function stringifyValue(value) {
  if (value instanceof Sequelize.Association) {
    return `${value.associationType},${value.target.name},${value.as}`;
  } else if (Array.isArray(value)) {
    return value.sort().map(stringifyValue).join(',');
  } else if (typeof value === 'object') {
    return stringifyObject(value);
  }
  return value;
}

// This is basically a home-grown JSON.stringifier. However, JSON.stringify on objects
// depends on the order in which the properties were defined - which we don't like!
// Additionally, JSON.stringify escapes strings, which we don't need here
function stringifyObject(object, keys = Object.keys(object)) {
  return keys.sort().map(key => `${key}:${stringifyValue(object[key])}`).join('|');
}

export function getCacheKey(model, attribute, options) {
  options = stringifyObject(options, ['association', 'attributes', 'groupedLimit', 'limit', 'order', 'where']);

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

function loaderForBTM(model, attributes, options = {}) {
  assert(options.include === undefined, 'options.include is not supported by model loader');
  assert(options.association !== undefined, 'options.association should be set for BTM loader');
  assert(Array.isArray(attributes), 'Attributes for BTM loader should be an array');
  assert(attributes.length === 2, 'Attributes for BTM loader should have length two');

  let cacheKey = getCacheKey(model, attributes, options)
    , association = options.association;
  delete options.association;

  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, new DataLoader(keys => {
      if (options.limit) {
        options.groupedLimit = {
          on: association,
          limit: options.limit,
          values: keys
        };
      } else {
        options.include = [{
          association: association.manyFromSource,
          where: mergeWhere({
            [attributes[1]]: keys
          }, options.where)
        }];
      }

      return model.findAll(options).then(mapResult.bind(null, attributes, keys, options));
    }));
  }

  return cache.get(cacheKey);
}

function loaderForModel(model, attribute, options = {}) {
  assert(options.include === undefined, 'options.include is not supported by model loader');

  let cacheKey = getCacheKey(model, attribute, options);

  if (!cache.has(cacheKey)) {
    if (options.limit) {
      cache.set(cacheKey, new DataLoader(keys => {
        if (keys.length === 1) {
          return model.findAll({
            where: mergeWhere({
              [attribute]: keys[0]
            }, options.where),
            limit: options.limit
          }).then(mapResult.bind(null, attribute, keys, options));
        }

        return model.findAll({
          groupedLimit: {
            limit: options.limit,
            on: attribute,
            values: keys
          },
          where: options.where
        }).then(mapResult.bind(null, attribute, keys, options));
      }, {
        cache: false
      }));
    } else {
      cache.set(cacheKey, new DataLoader(keys => {
        return model.findAll({
          where: mergeWhere({
            [attribute]: keys
          }, options.where),
        }).then(mapResult.bind(null, attribute, keys, options));
      }, {
        cache: false
      }));
    }
  }

  return cache.get(cacheKey);
}

function shimModel(target) {
  shimmer.massWrap(target, ['findById', 'findByPrimary'], original => {
    return function batchedFindById(id, options = {}) {
      if (options.transaction) {
        return original.apply(this, arguments);
      }
      return loaderForModel(this, this.primaryKeyAttribute).load(id);
    };
  });
}

function shimBelongsTo(target) {
  shimmer.wrap(target, 'get', original => {
    return function batchedGetBelongsTo(instance, options = {}) {
      // targetKeyIsPrimary already handled by sequelize (maps to findById)
      if (this.targetKeyIsPrimary || Array.isArray(instance) || options.include || options.transaction) {
        return original.apply(this, arguments);
      }

      let loader = loaderForModel(this.target, this.targetKey);
      return loader.load(instance.get(this.foreignKey));
    };
  });
}

function shimHasOne(target) {
  shimmer.wrap(target, 'get', original => {
    return function batchedGetHasOne(instance, options = {}) {
      if (Array.isArray(instance) || options.include || options.transaction) {
        return original.apply(this, arguments);
      }

      let loader = loaderForModel(this.target, this.foreignKey);
      return loader.load(instance.get(this.sourceKey));
    };
  });
}

function shimHasMany(target) {
  shimmer.wrap(target, 'get', original => {
    return function bathedGetHasMany(instances, options = {}) {
      if (options.include || options.transaction) {
        return original.apply(this, arguments);
      }

      let loader = loaderForModel(this.target, options.limit ? this.foreignKeyField : this.foreignKey, {
        ...options,
        multiple: true
      });

      if (Array.isArray(instances)) {
        return Promise.map(instances, instance => loader.load(instance.get(this.source.primaryKeyAttribute)));
      } else {
        return loader.load(instances.get(this.source.primaryKeyAttribute));
      }
    };
  });
}

function shimBelongsToMany(target) {
  shimmer.wrap(target, 'get', original => {
    return function bathedGetHasMany(instances, options = {}) {
      assert(this.paired, '.paired missing on belongsToMany association. You need to set up both sides of the association');

      if (options.include || options.transaction) {
        return original.apply(this, arguments);
      }

      let loader = loaderForBTM(this.target, [this.paired.manyFromSource.as, this.foreignKey], {
        ...options,
        association: this.paired,
        multiple: true
      });

      if (Array.isArray(instances)) {
        return Promise.map(instances, instance => loader.load(instance.get(this.source.primaryKeyAttribute)));
      } else {
        return loader.load(instances.get(this.source.primaryKeyAttribute));
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

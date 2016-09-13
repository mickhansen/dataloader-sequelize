import Sequelize from 'sequelize';
import shimmer from 'shimmer';
import DataLoader from 'dataloader';
import Promise from 'bluebird';
import {isEmpty, groupBy, property, values} from 'lodash';
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

export function getCacheKey(model, attribute, options) {
  return model.name + attribute + JSON.stringify(options, function replacer(key, value) {
    if (!key) {
      // We were called with the whole object
      return value;
    }

    if (key === 'association') {
      return value.associationType + value.target.name + value.as;
    }

    if (['attributes', 'limit', 'groupedLimit', 'order'].indexOf(key) !== -1) {
      return value;
    }

    return undefined; // skip
  });
}

function loaderForBTM(model, attributes, options = {}) {
  assert(options.include === undefined, 'options.include is not supported by model loader');
  assert(options.association !== undefined, 'options.association should be set for BTM loader');
  assert(Array.isArray(attributes), 'Attributes for BTM loader should be an array');
  assert(attributes.length === 2, 'Attributes for BTM loader should have length two');

  let cacheKey = getCacheKey(model, attributes, options);

  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, new DataLoader(keys => {
      if (options.limit) {
        options.groupedLimit = {
          on: options.association,
          limit: options.limit,
          values: keys
        };
      } else {
        options.include = [{
          association: options.association.manyFromSource,
          where: {
            [attributes[1]]: keys
          }
        }];
      }
      delete options.association;

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
            where: {
              [attribute]: keys[0]
            },
            limit: options.limit
          }).then(mapResult.bind(null, attribute, keys, options));
        }

        return model.findAll({
          groupedLimit: {
            limit: options.limit,
            on: attribute,
            values: keys
          }
        }).then(mapResult.bind(null, attribute, keys, options));
      }, {
        cache: false
      }));
    } else {
      cache.set(cacheKey, new DataLoader(keys => {
        return model.findAll({
          where: {
            [attribute]: keys
          }
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
      if (this.targetKeyIsPrimary || Array.isArray(instance) || !isEmpty(options.where) || options.include || options.transaction) {
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
      if (Array.isArray(instance) || !isEmpty(options.where) || options.include || options.transaction) {
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
      if (!isEmpty(options.where) || options.include || options.transaction) {
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
      if (!isEmpty(options.where) || options.include || options.transaction) {
        return original.apply(this, arguments);
      }

      let loader = loaderForBTM(this.target, [this.as, this.foreignKey], {
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

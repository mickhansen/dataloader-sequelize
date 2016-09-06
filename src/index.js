import Sequelize from 'sequelize';
import shimmer from 'shimmer';
import DataLoader from 'dataloader';
import Promise from 'bluebird';
import {isEmpty} from 'lodash';
import LRU from 'lru-cache';

function mapResult(attribute, keys, options, result) {
  result = result.reduce((carry, row) => {
    let key = row.get(attribute);

    if (options.multiple) {
      if (!(key in carry)) {
        carry[key] = [];
      }
      carry[key].push(row);
    } else {
      carry[key] = row;
    }

    return carry;
  }, {});

  return keys.map(key => {
    if (key in result) {
      return result[key];
    }
    return options.multiple ? [] : null;
  });
}

function loaderForModel(model, attribute, options = {}) {
  let cacheKey = model.name + attribute + JSON.stringify(options);

  if (!cache.has(cacheKey)) {
    if (options.limit) {
      cache.set(cacheKey, new DataLoader(keys => {
        if (keys.length > 1) {
          return model.findAll({
            groupedLimit: {
              limit: options.limit,
              on: attribute,
              values: keys
            }
          }).then(mapResult.bind(null, attribute, keys, options));
        }

        return model.findAll({
          where: {
            [attribute]: keys[0]
          },
          limit: options.limit
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

function shimModel(model) {
  shimmer.massWrap(model, ['findById', 'findByPrimary'], original => {
    return function batchedFindById(id, options) {
      if (options && options.transaction) {
        return original.apply(this, arguments);
      }
      return loaderForModel(this, this.primaryKeyAttribute).load(id);
    };
  });
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

  if (target instanceof Sequelize.Model) {
    shimModel(target);
  } else if (target instanceof Sequelize) {
    target.modelManager.forEachModel(model => {
      shimModel(model);
    });

    shimmer.wrap(target.Association.BelongsTo.prototype, 'get', original => {
      return function batchedGetBelongsTo(instance, options = {}) {
        if (Array.isArray(instance) || !isEmpty(options.where) || options.transaction) {
          return original.apply(this, arguments);
        }

        let loader = loaderForModel(this.target, this.targetKey);
        return loader.load(instance.get(this.foreignKey));
      };
    });

    shimmer.wrap(target.Association.HasOne.prototype, 'get', original => {
      return function batchedGetHasOne(instance, options = {}) {
        if (Array.isArray(instance) || !isEmpty(options.where) || options.transaction) {
          return original.apply(this, arguments);
        }

        let loader = loaderForModel(this.target, this.foreignKey);
        return loader.load(instance.get(this.sourceKey));
      };
    });

    shimmer.wrap(target.Association.HasMany.prototype, 'get', original => {
      return function bathedGetHasMany(instances, options = {}) {
        if (!isEmpty(options.where) || options.transaction) {
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
}

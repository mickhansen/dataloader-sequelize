import Sequelize from 'sequelize';
import shimmer from 'shimmer';
import DataLoader from 'dataloader';
import Promise from 'bluebird';
import {groupBy, property, values, clone, isEmpty, uniq} from 'lodash';
import LRU from 'lru-cache';
import assert from 'assert';

function mapResult(attribute, keys, options, result) {
  // Convert an array of results to an object of attribute (primary / foreign / target key) -> array of matching rows
  if (Array.isArray(attribute) && options && options.multiple && !options.raw) {
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

      return options && options.multiple ? value : value[0];
    }
    return options && options.multiple ? [] : null;
  });
}

function stringifyValue(value, key) {
  if (value && value.associationType) {
    return `${value.associationType},${value.target.name},${value.as}`;
  } else if (Array.isArray(value)) {
    if (key !== 'order') {
      // attribute order doesn't matter - order order definitely does
      value = clone(value).sort();
    }
    return value.map(stringifyValue).join(',');
  } else if (typeof value === 'object' && value !== null) {
    if (value instanceof Date) return value.toJSON();
    return stringifyObject(value);
  }
  return value;
}

// This is basically a home-grown JSON.stringifier. However, JSON.stringify on objects
// depends on the order in which the properties were defined - which we don't like!
// Additionally, JSON.stringify escapes strings, which we don't need here
function stringifyObject(object, keys = [...Object.keys(object), ...Object.getOwnPropertySymbols(object)]) {
  return keys.sort((lhs, rhs) => {
    const l = lhs.toString();
    const r = rhs.toString();
    if (l > r) return 1;
    if (l < r) return -1;
    return 0;
  }).map(key => `${key.toString()}:${stringifyValue(object[key], key)}`).join('|');
}

export function getCacheKey(model, attribute, options) {
  options = stringifyObject(options, ['association', 'attributes', 'groupedLimit', 'limit', 'offset', 'order', 'where', 'through', 'raw', 'searchPath', 'paranoid']);

  let name = `${model.name}|${attribute}|${options}`;
  const schema = model.options && model.options.schema;
  if (schema) {
    name = `${schema}|${name}`;
  }
  return name;
}

function mergeWhere(where, optionsWhere) {
  if (optionsWhere) {
    return {
      [Sequelize.Op ? Sequelize.Op.and : '$and']: [where, optionsWhere]
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

function cachedLoaderForBTM(model, joinTableName, foreignKey, foreignKeyField, options = {}) {
  assert(options.include === undefined, 'options.include is not supported by model loader');
  assert(options.association !== undefined, 'options.association should be set for BTM loader');

  let attributes = [joinTableName, foreignKey]
    , cacheKey = getCacheKey(model, attributes, options);

  if (!GLOBAL_CACHE.has(cacheKey)) {
    GLOBAL_CACHE.set(cacheKey, loaderForBTM(model, joinTableName, foreignKey, foreignKeyField, {
      ...options,
      cache: false
    }));
  }

  return GLOBAL_CACHE.get(cacheKey);
}

function loaderForBTM(model, joinTableName, foreignKey, foreignKeyField, options = {}) {
  assert(options.include === undefined, 'options.include is not supported by model loader');
  assert(options.association !== undefined, 'options.association should be set for BTM loader');

  let attributes = [joinTableName, foreignKey];
  const association = options.association;
  delete options.association;

  return new DataLoader(keys => {
    let findOptions = Object.assign({}, options);
    delete findOptions.rejectOnEmpty;
    if (findOptions.limit) {
      findOptions.groupedLimit = {
        through: options.through,
        on: association,
        limit: findOptions.limit,
        values: uniq(keys)
      };
    } else {
      findOptions.include = [{
        attributes: [foreignKey],
        association: association.manyFromSource,
        where: {
          [foreignKeyField]: keys,
          ...options.through.where
        }
      }];
    }

    return model.findAll(findOptions).then(mapResult.bind(null, attributes, keys, findOptions));
  }, {
    cache: options.cache
  });
}

function cachedLoaderForModel(model, attribute, attributeField, options = {}) {
  assert(options.include === undefined, 'options.include is not supported by model loader');

  let cacheKey = getCacheKey(model, attribute, options);

  if (!GLOBAL_CACHE.has(cacheKey)) {
    GLOBAL_CACHE.set(cacheKey, loaderForModel(model, attribute, attributeField, {
      ...options,
      cache: false
    }));
  }

  return GLOBAL_CACHE.get(cacheKey);
}

function loaderForModel(model, attribute, attributeField, options = {}) {
  assert(options.include === undefined, 'options.include is not supported by model loader');

  return new DataLoader(keys => {
    const findOptions = Object.assign({}, options);
    delete findOptions.rejectOnEmpty;

    if (findOptions.limit && keys.length > 1) {
      findOptions.groupedLimit = {
        limit: findOptions.limit,
        on: attributeField,
        values: uniq(keys)
      };
      delete findOptions.limit;
    } else {
      findOptions.where = mergeWhere({
        [attributeField]: keys
      }, findOptions.where);
    }

    return model.findAll(findOptions).then(mapResult.bind(null, attribute, keys, options));
  }, {
    cache: options.cache
  });
}

function shimModel(target) {
  if (target.findById.__wrapped) return;

  const methods = /^[45]/.test(Sequelize.version) ?
    ['findById'] :
    ['findById', 'findByPrimary'];

  shimmer.massWrap(target, methods, original => {
    return function batchedFindById(id, options = {}) {
      if ([null, undefined].indexOf(id) !== -1) {
        return Promise.resolve(null);
      }
      if (options.transaction || options.include || activeClsTransaction()) {
        return original.apply(this, arguments);
      }

      let loader = null;
      if (options[EXPECTED_OPTIONS_KEY]) {
        loader = options[EXPECTED_OPTIONS_KEY].loaders[this.name].byPrimaryKey;
      } else {
        loader = cachedLoaderForModel(this, this.primaryKeyAttribute, this.primaryKeyField, options);
      }
      return loader.load(id).then(rejectOnEmpty.bind(null, options));
    };
  });
}

function shimBelongsTo(target) {
  if (target.get.__wrapped) return;

  shimmer.wrap(target, 'get', original => {
    return function batchedGetBelongsTo(instance, options = {}) {
      if (Array.isArray(instance) || options.include || options.transaction || activeClsTransaction()) {
        return original.apply(this, arguments);
      }

      let foreignKeyValue = instance.get(this.foreignKey);
      return Promise.resolve().then(() => {
        if (foreignKeyValue === undefined || foreignKeyValue === null) {
          return Promise.resolve(null);
        }

        let loader = null;
        if (options[EXPECTED_OPTIONS_KEY] && !options.where) {
          loader = options[EXPECTED_OPTIONS_KEY].loaders[this.target.name].bySingleAttribute[this.targetKey];
        } else {
          loader = cachedLoaderForModel(this.target, this.targetKey, this.targetKeyField, options);
        }
        return loader.load(foreignKeyValue);
      }).then(rejectOnEmpty.bind(null, options));
    };
  });
}

function shimHasOne(target) {
  if (target.get.__wrapped) return;

  shimmer.wrap(target, 'get', original => {
    return function batchedGetHasOne(instance, options = {}) {
      if (Array.isArray(instance) || options.include || options.transaction || activeClsTransaction()) {
        return original.apply(this, arguments);
      }

      let loader = null;
      if (options[EXPECTED_OPTIONS_KEY] && !options.where) {
        loader = options[EXPECTED_OPTIONS_KEY].loaders[this.target.name].bySingleAttribute[this.foreignKey];
      } else {
        loader = cachedLoaderForModel(this.target, this.foreignKey, this.identifierField, options);
      }
      return loader.load(instance.get(this.sourceKey)).then(rejectOnEmpty.bind(null, options));
    };
  });
}

function shimHasMany(target) {
  if (target.get.__wrapped) return;

  shimmer.wrap(target, 'get', original => {
    return function bathedGetHasMany(instances, options = {}) {
      let isCount = false;
      if (options.include || options.transaction || activeClsTransaction()) {
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
          [Sequelize.Op ? Sequelize.Op.and : '$and']: [
            options.where,
            this.scope
          ]
        };
      }

      let loader = null
        , loaderOptions = {
          multiple: true,
          ...options
        };

      if (options[EXPECTED_OPTIONS_KEY]) {
        const cacheKey = getCacheKey(this.target, this.foreignKey, loaderOptions);
        loader = options[EXPECTED_OPTIONS_KEY].loaders.autogenerated.get(cacheKey);
        if (!loader) {
          loader = loaderForModel(this.target, this.foreignKey, this.foreignKeyField, {
            ...loaderOptions,
            cache: true
          });
          options[EXPECTED_OPTIONS_KEY].loaders.autogenerated.set(cacheKey, loader);
        }
      } else {
        loader = cachedLoaderForModel(this.target, this.foreignKey, this.foreignKeyField, loaderOptions);
      }

      let key = this.sourceKey || this.source.primaryKeyAttribute;

      if (Array.isArray(instances)) {
        return Promise.map(instances, instance => loader.load(instance.get(key)));
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

  shimmer.wrap(target, 'get', original => {
    return function bathedGetHasMany(instances, options = {}) {
      let isCount = false;
      assert(this.paired, '.paired missing on belongsToMany association. You need to set up both sides of the association');

      if (options.include || options.transaction || activeClsTransaction()) {
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
          [Sequelize.Op ? Sequelize.Op.and : '$and']: [
            options.where,
            this.scope
          ]
        };
      }

      options.through = options.through || {};
      if (this.through.scope) {
        options.through.where = {
          [Sequelize.Op ? Sequelize.Op.and : '$and']: [
            options.through.where,
            this.through.scope
          ]
        };
      }

      let loader
        , loaderOptions = {
          association: this.paired,
          multiple: true,
          ...options
        };

      if (options[EXPECTED_OPTIONS_KEY]) {
        const cacheKey = getCacheKey(this.target, [this.paired.manyFromSource.as, this.foreignKey], loaderOptions);
        loader = options[EXPECTED_OPTIONS_KEY].loaders.autogenerated.get(cacheKey);
        if (!loader) {
          loader = loaderForBTM(this.target, this.paired.manyFromSource.as, this.foreignKey, this.identifierField, {
            ...loaderOptions,
            cache: true
          });
          options[EXPECTED_OPTIONS_KEY].loaders.autogenerated.set(cacheKey, loader);
        }
      } else {
        loader = cachedLoaderForBTM(this.target, this.paired.manyFromSource.as, this.foreignKey, this.identifierField, loaderOptions);
      }

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
  switch (association.associationType) {
    case 'BelongsTo': return shimBelongsTo(association);
    case 'HasOne': return shimHasOne(association);
    case 'HasMany': return shimHasMany(association);
    case 'BelongsToMany': return shimBelongsToMany(association);
  }
}

let GLOBAL_CACHE;
export function resetCache() {
  if (GLOBAL_CACHE) GLOBAL_CACHE.reset();
}

function activeClsTransaction() {
  if (/^[45]/.test(Sequelize.version)) {
    if (Sequelize._cls && Sequelize._cls.get('transaction')) {
      return true;
    }
  } else if (Sequelize.cls && Sequelize.cls.get('transaction')) {
    return true;
  }
  return false;
}

export default function (target, options = {}) {
  options = {
    ...options,
    max: 500
  };

  if (!GLOBAL_CACHE) {
    GLOBAL_CACHE = LRU(options);
  }

  if (target.associationType) {
    shimAssociation(target);
  } else if (/(SequelizeModel|class extends Model)/.test(target.toString()) || Sequelize.Model.isPrototypeOf(target)) {
    shimModel(target);
    values(target.associations).forEach(shimAssociation);
  } else {
    // Assume target is the sequelize constructor
    shimModel(/^[45]/.test(Sequelize.version) ? // v3 vs v4
      target.Model : target.Model.prototype);
    shimBelongsTo(target.Association.BelongsTo.prototype);
    shimHasOne(target.Association.HasOne.prototype);
    shimHasMany(target.Association.HasMany.prototype);
    shimBelongsToMany(target.Association.BelongsToMany.prototype);
  }
}

export const EXPECTED_OPTIONS_KEY = 'dataloader_sequelize_context';
export function createContext(sequelize, options = {}) {
  const loaders = {};

  shimModel(/^[45]/.test(sequelize.constructor.version) ? // v3 vs v4
    sequelize.Model : sequelize.Model.prototype);
  shimBelongsTo(sequelize.Association.BelongsTo.prototype);
  shimHasOne(sequelize.Association.HasOne.prototype);
  shimHasMany(sequelize.Association.HasMany.prototype);
  shimBelongsToMany(sequelize.Association.BelongsToMany.prototype);

  loaders.autogenerated = LRU({max: options.max || 500});
  if (!GLOBAL_CACHE) {
    GLOBAL_CACHE = LRU(options);
  }

  sequelize.modelManager.forEachModel(Model => {
    loaders[Model.name] = {
      bySingleAttribute: {}
    };
    loaders[Model.name].bySingleAttribute[Model.primaryKeyAttribute] = createModelAttributeLoader(Model, Model.primaryKeyAttribute, options);
    loaders[Model.name].byId = loaders[Model.name].byPrimaryKey = loaders[Model.name].bySingleAttribute[Model.primaryKeyAttribute];
  });

  sequelize.modelManager.forEachModel(Model => {
    values(Model.associations).forEach(association => {
      if (association.associationType === 'BelongsTo') {
        const Target = association.target;
        if (association.targetKey !== Target.primaryKeyAttribute) {
          loaders[Target.name].bySingleAttribute[association.targetKey] = createModelAttributeLoader(Target, association.targetKey, options);
        }
      } else if (association.associationType === 'HasOne') {
        const Target = association.target;
        loaders[Target.name].bySingleAttribute[association.foreignKey] = createModelAttributeLoader(Target, association.foreignKey, options);
      }
    });
  });

  function prime(results) {
    if (!Array.isArray(results)) {
      results = [results];
    }

    results.forEach(result => {
      const modelName = result.Model ? result.Model.name : result.constructor.name;
      Object.keys(loaders[modelName].bySingleAttribute).forEach(attribute => {
        loaders[modelName].bySingleAttribute[attribute].prime(result.get(attribute), result);
      });
    });
  }

  return {loaders, prime};
}

function createModelAttributeLoader(Model, attribute, options = {}) {
  return new DataLoader(keys => {
    return Model.findAll({
      where: {
        [attribute]: keys
      },
      logging: options.logging
    }).then(mapResult.bind(null, attribute, keys, {}));
  }, {
    cache: true
  });
}

import Sequelize from 'sequelize';
import shimmer from 'shimmer';
import DataLoader from 'dataloader';
import Promise from 'bluebird';
import {groupBy, property, values, clone, isEmpty, uniq} from 'lodash';
import LRU from 'lru-cache';
import assert from 'assert';
import {methods} from './helper';

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
      const limit = findOptions.offset && findOptions.offset > 0 ? [findOptions.limit, findOptions.offset] : findOptions.limit;
      findOptions.groupedLimit = {
        through: options.through,
        on: association,
        limit,
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

function loaderForModel(model, attribute, attributeField, options = {}) {
  assert(options.include === undefined, 'options.include is not supported by model loader');

  return new DataLoader(keys => {
    const findOptions = Object.assign({}, options);
    delete findOptions.rejectOnEmpty;

    if (findOptions.limit && keys.length > 1) {
      const limit = findOptions.offset && findOptions.offset > 0 ? [findOptions.limit, findOptions.offset] : findOptions.limit;
      findOptions.groupedLimit = {
        limit,
        on: attributeField,
        values: uniq(keys)
      };
      delete findOptions.limit;
      delete findOptions.offset;
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
  if (target.findByPk ? target.findByPk.__wrapped : target.findById.__wrapped) return;

  shimmer.massWrap(target, methods(Sequelize.version).findByPk, original => {
    return function batchedFindById(id, options = {}) {
      if ([null, undefined].indexOf(id) !== -1) {
        return Promise.resolve(null);
      }
      if (options.transaction || options.include || activeClsTransaction() || !options[EXPECTED_OPTIONS_KEY]) {
        return original.apply(this, arguments);
      }

      const loaders = options[EXPECTED_OPTIONS_KEY].loaders;
      let loader = loaders[this.name].byPrimaryKey;
      if (options.raw) {
        const cacheKey = getCacheKey(this, this.primaryKeyAttribute, {raw: options.raw});
        loader = loaders.autogenerated.get(cacheKey);
        if (!loader) {
          loader = createModelAttributeLoader(this, this.primaryKeyAttribute, {raw: options.raw, logging: options.logging});
          loaders.autogenerated.set(cacheKey, loader);
        }
      }
      return Promise.resolve(loader.load(id)).then(rejectOnEmpty.bind(null, options));
    };
  });
}

function shimBelongsTo(target) {
  if (target.get.__wrapped) return;

  shimmer.wrap(target, 'get', original => {
    return function batchedGetBelongsTo(instance, options = {}) {
      if (Array.isArray(instance) || options.include || options.transaction || activeClsTransaction() || !options[EXPECTED_OPTIONS_KEY] || options.where) {
        return original.apply(this, arguments);
      }

      let foreignKeyValue = instance.get(this.foreignKey);
      return Promise.resolve().then(() => {
        if (foreignKeyValue === undefined || foreignKeyValue === null) {
          return Promise.resolve(null);
        }

        const loader = options[EXPECTED_OPTIONS_KEY].loaders[this.target.name].bySingleAttribute[this.targetKey];
        return Promise.resolve(loader.load(foreignKeyValue));
      }).then(rejectOnEmpty.bind(null, options));
    };
  });
}

function shimHasOne(target) {
  if (target.get.__wrapped) return;

  shimmer.wrap(target, 'get', original => {
    return function batchedGetHasOne(instance, options = {}) {
      if (Array.isArray(instance) || options.include || options.transaction || activeClsTransaction() || !options[EXPECTED_OPTIONS_KEY]) {
        return original.apply(this, arguments);
      }

      const loader = options[EXPECTED_OPTIONS_KEY].loaders[this.target.name].bySingleAttribute[this.foreignKey];
      return Promise.resolve(loader.load(instance.get(this.sourceKey)).then(rejectOnEmpty.bind(null, options)));
    };
  });
}

function shimHasMany(target) {
  if (target.get.__wrapped) return;

  shimmer.wrap(target, 'get', original => {
    return function bathedGetHasMany(instances, options = {}) {
      let isCount = false;
      if (options.include || options.transaction || options.separate || activeClsTransaction() || !options[EXPECTED_OPTIONS_KEY]) {
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

      const cacheKey = getCacheKey(this.target, this.foreignKey, loaderOptions);
      loader = options[EXPECTED_OPTIONS_KEY].loaders.autogenerated.get(cacheKey);
      if (!loader) {
        loader = loaderForModel(this.target, this.foreignKey, this.foreignKeyField, {
          ...loaderOptions,
          cache: true
        });
        options[EXPECTED_OPTIONS_KEY].loaders.autogenerated.set(cacheKey, loader);
      }

      let key = this.sourceKey || this.source.primaryKeyAttribute;

      if (Array.isArray(instances)) {
        return Promise.map(instances, instance => {
          let sourceKeyValue = instance.get(key);

          if (sourceKeyValue === undefined || sourceKeyValue === null) {
            return Promise.resolve(null);
          }

          return loader.load(sourceKeyValue);
        });
      } else {
        let sourceKeyValue = instances.get(key);

        if (sourceKeyValue === undefined || sourceKeyValue === null) {
          return Promise.resolve(null);
        }

        return Promise.resolve(loader.load(sourceKeyValue)).then(result => {
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

      if (options.include || options.transaction || activeClsTransaction() || !options[EXPECTED_OPTIONS_KEY]) {
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

      const cacheKey = getCacheKey(this.target, [this.paired.manyFromSource.as, this.foreignKey], loaderOptions);
      loader = options[EXPECTED_OPTIONS_KEY].loaders.autogenerated.get(cacheKey);
      if (!loader) {
        loader = loaderForBTM(this.target, this.paired.manyFromSource.as, this.foreignKey, this.identifierField, {
          ...loaderOptions,
          cache: true
        });
        options[EXPECTED_OPTIONS_KEY].loaders.autogenerated.set(cacheKey, loader);
      }

      if (Array.isArray(instances)) {
        return Promise.map(instances, instance => loader.load(instance.get(this.source.primaryKeyAttribute)));
      } else {
        return Promise.resolve(loader.load(instances.get(this.source.primaryKeyAttribute))).then(result => {
          if (isCount && !result) {
            result = { count: 0 };
          }
          return result;
        }).then(rejectOnEmpty.bind(null, options));
      }
    };
  });
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

export const EXPECTED_OPTIONS_KEY = 'dataloader_sequelize_context';
export function createContext(sequelize, options = {}) {
  const loaders = {};

  shimModel(/^[45]/.test(sequelize.constructor.version) ? // v3 vs v4
    sequelize.constructor.Model : sequelize.constructor.Model.prototype);
  shimBelongsTo(sequelize.constructor.Association.BelongsTo.prototype);
  shimHasOne(sequelize.constructor.Association.HasOne.prototype);
  shimHasMany(sequelize.constructor.Association.HasMany.prototype);
  shimBelongsToMany(sequelize.constructor.Association.BelongsToMany.prototype);

  loaders.autogenerated = LRU({max: options.max || 500});

  sequelize.modelManager.forEachModel(Model => {
    shimModel(Model);
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

export function removeContext(sequelize) {
  const Model = /^[45]/.test(sequelize.constructor.version) ? // v3 vs v4
    sequelize.constructor.Model : sequelize.constructor.Model.prototype;

  shimmer.massUnwrap(Model, methods(Sequelize.version).findByPk);
  shimmer.unwrap(sequelize.constructor.Association.BelongsTo.prototype, 'get');
  shimmer.unwrap(sequelize.constructor.Association.HasOne.prototype, 'get');
  shimmer.unwrap(sequelize.constructor.Association.HasMany.prototype, 'get');
  shimmer.unwrap(sequelize.constructor.Association.BelongsToMany.prototype, 'get');
}

function createModelAttributeLoader(Model, attribute, options = {}) {
  return new DataLoader(keys => {
    return Model.findAll({
      ...options,
      where: {
        [attribute]: keys
      }
    }).then(mapResult.bind(null, attribute, keys, {}));
  }, {
    cache: true
  });
}

# dataloader-sequelize

Batching, caching and simplification of Sequelize with facebook/dataloader

# How it works

dataloader-sequelize is designed to provide per-request caching/batching for sequelize lookups, most likely in a graphql environment

# API

## `createContext(sequelize, object options)`
* Should be called after all models and associations are defined
* `sequelize` a sequelize instance
* `options.max=500` the maximum number of simultaneous dataloaders to store in memory. The loaders are stored in an LRU cache

# Usage
```js
import {createContext, EXPECTED_OPTIONS_KEY} from 'dataloader-sequelize';

/* Per request */
const context = createContext(sequelize); // must not be called before all models and associations are defined
await User.findById(2, {[EXPECTED_OPTIONS_KEY]: context});
await User.findById(2, {[EXPECTED_OPTIONS_KEY]: context}); // Cached or batched, depending on timing
```

## Priming

Commonly you might have some sort of custom findAll requests that isn't going through the dataloader. To reuse the results from a call such as this in later findById calls you need to prime the cache:

```js
import {createContext, EXPECTED_OPTIONS_KEY} from 'dataloader-sequelize';
const context = createContext(sequelize);

const results = await User.findAll({where: {/* super complicated */}});
context.prime(results);

await User.findById(2, {[EXPECTED_OPTIONS_KEY]: context}); // Cached, if was in results
```

## `findOne` batching

`findOne` calls are automatically batched when a primary key is present in `where`. Multiple calls in the same tick are rewritten to a single `WHERE pk IN (...)` query:

```js
import {createContext, EXPECTED_OPTIONS_KEY} from 'dataloader-sequelize';
const context = createContext(sequelize);

// These execute in the same tick — batched into one query:
User.findOne({ where: { id: 1 }, [EXPECTED_OPTIONS_KEY]: context });
User.findOne({ where: { id: 2 }, [EXPECTED_OPTIONS_KEY]: context });
// → SELECT * FROM users WHERE id IN (1, 2)
```

Extra conditions alongside the primary key are supported. Calls with identical extra conditions are batched together; different extra conditions use separate loaders:

```js
User.findOne({ where: { id: 1, status: 'active' }, [EXPECTED_OPTIONS_KEY]: context });
User.findOne({ where: { id: 3, status: 'active' }, [EXPECTED_OPTIONS_KEY]: context });
// → SELECT * FROM users WHERE id IN (1, 3) AND status = 'active'

User.findOne({ where: { id: 2, status: 'inactive' }, [EXPECTED_OPTIONS_KEY]: context });
// → SELECT * FROM users WHERE id IN (2) AND status = 'inactive'  (separate query)
```

Sequelize `Op` symbols are also supported:

```js
User.findOne({ where: { id: 1, [Op.and]: [{ deletedAt: null }] }, [EXPECTED_OPTIONS_KEY]: context });
User.findOne({ where: { id: 2, [Op.and]: [{ deletedAt: null }] }, [EXPECTED_OPTIONS_KEY]: context });
// → SELECT * FROM users WHERE id IN (1, 2) AND deletedAt IS NULL
```

## `BATCH_BY_ATTRIBUTE` — batching by any field

For cases where you're not querying by primary key, use `BATCH_BY_ATTRIBUTE` to declare which field to batch by:

```js
import {createContext, EXPECTED_OPTIONS_KEY, BATCH_BY_ATTRIBUTE} from 'dataloader-sequelize';
const context = createContext(sequelize);

// Batch by a foreign key with a shared extra condition:
Box.findOne({ where: { ancestorBoxId: 1, enabled: true }, [BATCH_BY_ATTRIBUTE]: 'ancestorBoxId', [EXPECTED_OPTIONS_KEY]: context });
Box.findOne({ where: { ancestorBoxId: 2, enabled: true }, [BATCH_BY_ATTRIBUTE]: 'ancestorBoxId', [EXPECTED_OPTIONS_KEY]: context });
Box.findOne({ where: { ancestorBoxId: 3, enabled: true }, [BATCH_BY_ATTRIBUTE]: 'ancestorBoxId', [EXPECTED_OPTIONS_KEY]: context });
// → SELECT * FROM boxes WHERE ancestorBoxId IN (1, 2, 3) AND enabled = true
```

`order`, `raw`, `paranoid`, and `rejectOnEmpty` are all respected. Calls with different extra conditions or different `order` values use separate loaders and are not mixed:

```js
Box.findOne({
  [EXPECTED_OPTIONS_KEY]: context,
  [BATCH_BY_ATTRIBUTE]: 'ancestorBoxId',
  order: [['id', 'DESC']],
  rejectOnEmpty: true,
  where: { ancestorBoxId: achievementReward.ancestorBoxId, enabled: true },
});
```


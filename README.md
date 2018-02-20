# dataloader-sequelize

Batching, caching and simplification of Sequelize with facebook/dataloader

[![Build Status](https://circleci.com/gh/mickhansen/dataloader-sequelize.svg)](https://circleci.com/gh/mickhansen/dataloader-sequelize)
[![Coverage](https://codecov.io/gh/mickhansen/dataloader-sequelize/branch/master/graph/badge.svg)](https://codecov.io/gh/mickhansen/dataloader-sequelize)

# How it works

dataloader-sequelize is designed to provide per-request catching/batching for sequelize lookups, most likely in a graphql environment

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

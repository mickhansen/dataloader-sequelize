# dataloader-sequelize
Batching and simplification of Sequelize with facebook/dataloader

[![Build Status](https://circleci.com/gh/mickhansen/dataloader-sequelize.svg)](https://circleci.com/gh/mickhansen/dataloader-sequelize)
[![Coverage](https://codecov.io/gh/mickhansen/dataloader-sequelize/branch/master/graph/badge.svg)](https://codecov.io/gh/mickhansen/dataloader-sequelize)

## What it does
```js
const User = sequelize.define('user');
```

Suppose you search for two users simultaneously (technically, within the same tick):

```js
User.findById(42);
User.findById(5678);
```

Normally, this would result in two different queries:

```sql
SELECT ... FROM "user" WHERE "id" = 42;
SELECT ... FROM "user" WHERE "id" = 5678;
```

However, by using `dataloader-sequelize`, the two requests will be batched into a single query:

```sql
SELECT ... FROM "user" WHERE "id" IN (42, 5678);
```

## Why is that a good idea?

If the two `findById` calls are right next to each other, this module is semi-pointless - you
can just change your own code into a single `findAll` call. However, if the two calls originate
from different parts of your application, it's nice to invoke what looks like a request for a
single row somewhere, and have it batched with other similar requests under the hood for increased
performance.

One case where this shines especially bright is in connection with graphql, specifically [graphql-sequelize](https://github.com/mickhansen/graphql-sequelize).
Suppose we have the following schema:

```js
Task.User = Task.belongsTo(User);

let taskType = new GraphQLObjectType({
  name: 'Task',
  description: 'A task',
  fields: {
    id: {
      type: new GraphQLNonNull(GraphQLInt),
      description: 'The id of the task.',
    }
    user: {
      type: userType,
      resolve: resolver(Task.User, {
        include: false
      })
    }
  }
});

let userType = new GraphQLObjectType({
  name: 'User',
  description: 'A user',
  fields: {
    id: {
      type: new GraphQLNonNull(GraphQLInt),
      description: 'The id of the user.',
    },
    name: {
      type: GraphQLString,
      description: 'The name of the user.',
    }
  }
});
```

A query for `task { user {name } }` will first load all tasks, and then make a call to `task.getUser()` for each task.
With the help of `dataloader-sequelize`, these calls will be merged into a single call to `User.findAll`.

## How it works

`dataloader-sequelize` can wrap the following methods:

* `Model.findById`
* `Model.findByPrimary`
* `BelongsTo.get`
* `HasOne.get`
* `HasMany.get`
* `BelongsToMany.get`

Batching is then handled by [facebook/dataloader](https://github.com/facebook/dataloader), which batches all request
on the same tick into a single request.

## Limitations

Only plain requests are batched, meaning requests with includes and transactions are skipped. The
batching does handle limit, and where; but different limits and wheres are placed in different batches. Currently this module only leverages
the batching functionality from dataloader, caching is disabled.

# API
## `dataloaderSequelize(target, object options)`
* `target` can be a sequelize instance, a sequelize model, or a sequelize assocations
* `options.max=500` the maximum number of simultaneous dataloaders to store in memory. The loaders are stored in an LRU cache

```js
import dataloaderSequelize from 'dataloader-sequelize';

//Note: if using require use the following syntax
//const dataloaderSequelize = require('dataloader-sequelize').default;

// Sequelize instance - wrap all current and future models and associations
dataloaderSequelize(sequelize)

// Sequelize Model - wrap findById, findByPrimary, and all existing associations
dataloaderSequelize(User)

// Sequelize Association - wrap only this association
dataloaderSequelize(User.associations.tasks)
```

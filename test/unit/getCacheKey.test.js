import {getCacheKey} from '../../src';
import expect from 'unexpected';
import {connection} from '../helper';

describe('getCacheKey', function () {
  const User = connection.define('user')
    , Task = connection.define('task')
    , association = User.hasMany(Task);

  it('handles circular structures', function () {
    let foo = {}
      , bar = {}
      , options = {
        foo,
        bar
      };

    foo.bar = bar;
    bar.foo = foo;

    expect(getCacheKey({
      name: 'user'
    }, 'id', options), 'to equal',
      'user|id|association:undefined|attributes:undefined|groupedLimit:undefined|limit:undefined|offset:undefined|order:undefined|raw:undefined|searchPath:undefined|through:undefined|where:undefined');
  });

  it('handles nulls', function () {
    expect(getCacheKey(User, 'id', {
      order: null
    }), 'to equal', 'user|id|association:undefined|attributes:undefined|groupedLimit:undefined|limit:undefined|offset:undefined|order:null|raw:undefined|searchPath:undefined|through:undefined|where:undefined');
  });

  it('does not modify arrays', function () {
    let options = {
      order: ['foo', 'bar']
    };

    expect(getCacheKey(User, 'id', options), 'to equal',
      'user|id|association:undefined|attributes:undefined|groupedLimit:undefined|limit:undefined|offset:undefined|order:foo,bar|raw:undefined|searchPath:undefined|through:undefined|where:undefined');
    expect(options.order, 'to equal', ['foo', 'bar']);
  });

  it('handles associations', function () {
    expect(getCacheKey(User, 'id', {
      association,
      limit: 42
    }), 'to equal', 'user|id|association:HasMany,task,tasks|attributes:undefined|groupedLimit:undefined|limit:42|offset:undefined|order:undefined|raw:undefined|searchPath:undefined|through:undefined|where:undefined');
  });

  it('handles attributes', function () {
    expect(getCacheKey(User, 'id', {
      attributes: ['foo', 'bar', 'baz']
    }), 'to equal', 'user|id|association:undefined|attributes:bar,baz,foo|groupedLimit:undefined|limit:undefined|offset:undefined|order:undefined|raw:undefined|searchPath:undefined|through:undefined|where:undefined');
  });

  it('handles schemas', function () {
    expect(getCacheKey({
      name: 'user',
      options: {
        schema: 'app'
      }
    }, 'id', {
      attributes: ['foo', 'bar', 'baz']
    }), 'to equal', 'app|user|id|association:undefined|attributes:bar,baz,foo|groupedLimit:undefined|limit:undefined|offset:undefined|order:undefined|raw:undefined|searchPath:undefined|through:undefined|where:undefined');
  });

  describe('where statements', function () {
    it('POJO', function () {
      expect(getCacheKey(User, 'id', {
        where: {
          completed: true
        }
      }), 'to equal',
        'user|id|association:undefined|attributes:undefined|groupedLimit:undefined|limit:undefined|offset:undefined|order:undefined|raw:undefined|searchPath:undefined|through:undefined|where:completed:true');
    });

    it('symbols', function () {
      expect(getCacheKey(User, 'id', {
        where: {
          [Symbol('or')]: {
            name: { [Symbol('iLike')]: '%test%' }
          },
          [Symbol('or')]: {
            name: { [Symbol('iLike')]: '%test%' }
          }
        }
      }), 'to equal',
        'user|id|association:undefined|attributes:undefined|groupedLimit:undefined|limit:undefined|offset:undefined|order:undefined|raw:undefined|searchPath:undefined|through:undefined|where:Symbol(or):name:Symbol(iLike):%test%|Symbol(or):name:Symbol(iLike):%test%');
    });

    it('date', function () {
      const from = new Date(Date.UTC(2016, 1, 1));
      const to = new Date(Date.UTC(2016, 2, 1));

      expect(getCacheKey(User, 'id', {
        where: {
          completed: {
            $between: [
              from,
              to
            ]
          }
        }
      }), 'to equal',
        'user|id|association:undefined|attributes:undefined|groupedLimit:undefined|limit:undefined|offset:undefined|order:undefined|raw:undefined|searchPath:undefined|through:undefined|where:completed:$between:2016-02-01T00:00:00.000Z,2016-03-01T00:00:00.000Z');
    });

    it('literal', function () {
      expect(getCacheKey(User, 'id', {
        where: {
          foo: connection.literal('SELECT foo FROM bar')
        }
      }), 'to equal',
        'user|id|association:undefined|attributes:undefined|groupedLimit:undefined|limit:undefined|offset:undefined|order:undefined|raw:undefined|searchPath:undefined|through:undefined|where:foo:val:SELECT foo FROM bar');
    });

    it('fn + col', function () {
      expect(getCacheKey(User, 'id', {
        where: {
          foo: {
            $gt: connection.fn('FOO', connection.col('bar'))
          }
        }
      }), 'to equal',
        'user|id|association:undefined|attributes:undefined|groupedLimit:undefined|limit:undefined|offset:undefined|order:undefined|raw:undefined|searchPath:undefined|through:undefined|where:foo:$gt:args:col:bar|fn:FOO');
    });
  });

  it('searchPath', function () {
    expect(getCacheKey(User, 'id', {
      searchPath: 'test'
    }), 'to equal',
        'user|id|association:undefined|attributes:undefined|groupedLimit:undefined|limit:undefined|offset:undefined|order:undefined|raw:undefined|searchPath:test|through:undefined|where:undefined');
  });

});

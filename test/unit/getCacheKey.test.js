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
      'user|id|association:undefined|attributes:undefined|groupedLimit:undefined|limit:undefined|offset:undefined|order:undefined|through:undefined|where:undefined|raw:undefined');
  });

  it('handles nulls', function () {
    expect(getCacheKey(User, 'id', {
      order: null
    }), 'to equal', 'user|id|association:undefined|attributes:undefined|groupedLimit:undefined|limit:undefined|offset:undefined|order:null|through:undefined|where:undefined|raw:undefined');
  });

  it('does not modify arrays', function () {
    let options = {
      order: ['foo', 'bar']
    };

    expect(getCacheKey(User, 'id', options), 'to equal',
      'user|id|association:undefined|attributes:undefined|groupedLimit:undefined|limit:undefined|offset:undefined|order:foo,bar|through:undefined|where:undefined|raw:undefined');
    expect(options.order, 'to equal', ['foo', 'bar']);
  });

  it('handles associations', function () {
    expect(getCacheKey(User, 'id', {
      association,
      limit: 42
    }), 'to equal', 'user|id|association:HasMany,task,tasks|attributes:undefined|groupedLimit:undefined|limit:42|offset:undefined|order:undefined|through:undefined|where:undefined|raw:undefined');
  });

  it('handles attributes', function () {
    expect(getCacheKey(User, 'id', {
      attributes: ['foo', 'bar', 'baz']
    }), 'to equal', 'user|id|association:undefined|attributes:bar,baz,foo|groupedLimit:undefined|limit:undefined|offset:undefined|order:undefined|through:undefined|where:undefined|raw:undefined');
  });

  describe('where statements', function () {
    it('POJO', function () {
      expect(getCacheKey(User, 'id', {
        where: {
          completed: true
        }
      }), 'to equal',
        'user|id|association:undefined|attributes:undefined|groupedLimit:undefined|limit:undefined|offset:undefined|order:undefined|through:undefined|where:completed:true|raw:undefined');
    });

    it('literal', function () {
      expect(getCacheKey(User, 'id', {
        where: {
          foo: connection.literal('SELECT foo FROM bar')
        }
      }), 'to equal',
        'user|id|association:undefined|attributes:undefined|groupedLimit:undefined|limit:undefined|offset:undefined|order:undefined|through:undefined|where:foo:val:SELECT foo FROM bar|raw:undefined');
    });

    it('fn + col', function () {
      expect(getCacheKey(User, 'id', {
        where: {
          foo: {
            $gt: connection.fn('FOO', connection.col('bar'))
          }
        }
      }), 'to equal',
        'user|id|association:undefined|attributes:undefined|groupedLimit:undefined|limit:undefined|offset:undefined|order:undefined|through:undefined|where:foo:$gt:args:col:bar|fn:FOO|raw:undefined');
    });
  });
});


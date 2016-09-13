import {getCacheKey} from '../../src';
import expect from 'unexpected';
import {connection} from '../helper';

describe('getCacheKey', function () {
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
    }, 'id', options), 'to equal', 'userid{}');
  });

  it('handles associations', function () {
    let User = connection.define('user')
      , Task = connection.define('task')
      , association = User.hasMany(Task)
      , options = {
        association,
        limit: 42
      };

    expect(getCacheKey(User, 'id', options), 'to equal', 'userid{"association":"HasManytasktasks","limit":42}');
  });
});


var CacheRedis = require('..');
var redisManager = require('redis-manager');
var mutate = require('../lib/mutate');
var test = require('tape');

var redisClient = redisManager.getClient();

test('clear', function(assert) {
    redisClient.flushall(function() {
        assert.end();
    });
});

function createCache() {
    return new CacheRedis({
        namespace: 'cacheTest'
    });
}

test('initialize', function(assert) {
    assert.plan(5);
    var cache = createCache();
    assert.equal(cache.host, 'localhost', 'got default host');
    assert.equal(cache.port, 6379, 'got default port');
    assert.equal(cache.namespace, 'cacheTest', 'got passed in cache');
    assert.equal(cache.lazy, false, 'greedy by default');
    assert.ok(cache.redisClient.flushall instanceof Function, 'correctly constructed a redis object');
    cache.close();
    assert.end();
});

test('emits error if error during initialization', mutate(redisManager, 'getClient', function() {
    return {
        on: function() { },
        hgetall: function(namespace, callback) {
            callback(new Error('initialization error'));
        }
    };
}, function(assert) {
    assert.plan(1);
    // Not possible to listen for events emitted during construction
    assert.throws(createCache, /initialization error/, 'got the mocked error');
    assert.end();
}));

test('drops key eager loading of corrupt value', mutate(redisManager, 'getClient', function() {
    return {
        on: function() {},
        hgetall: function(namespace, callback) {
            callback(null, { key: 'lol{json}' });
        },
        hdel: function(namespace, key, callback) {
            callback();
        }
    };
}, function(assert) {
    assert.plan(1);
    assert.doesNotThrow(function() {
        createCache();
    });
    assert.end();
}));

test('emits error if error deleting corrupt value from redis', mutate(redisManager, 'getClient', function() {
    return {
        on: function() {},
        hgetall: function(namespace, callback) {
            callback(null, { key: 'lol{json}' });
        },
        hdel: function(namespace, key, callback) {
            callback(new Error('cannot delete'));
        }
    };
}, function(assert) {
    assert.plan(1);
    assert.throws(function() {
        createCache();
    }, /cannot delete/, 'got a redis hdel error');
    assert.end();
}));

test('set', function(assert) {
    assert.plan(3);
    var cache = createCache();
    assert.doesNotThrow(function() {
        cache.set('foo', 'bar');
    }, 'can set fire and forget');
    cache.set('foo2', 'bar2', function() {
        redisClient.hget('cacheTest', 'foo2', function(err, val) {
            assert.ifError(err, 'does not fail to get from redis');
            assert.equal(JSON.parse(val), cache.cache.foo2, 'key written to redis and matches memory');
            cache.close();
            assert.end();
        });
    });
});

test('getLocal', function(assert) {
    assert.plan(1);
    var cache = createCache();
    setTimeout(function() {
        var val = cache.getLocal('foo');
        assert.equal(val, 'bar', 'got the expected value even from a separate constructor obj');
        cache.close();
        assert.end();
    }, 50);
});

test('getLocal non existent', function(assert) {
    assert.plan(1);
    var cache = createCache();
    var val = cache.getLocal('nonexistent');
    assert.equal(val, undefined, 'got the expected undefined value for a nonexistent key');
    cache.close();
    assert.end();
});

test('get', function(assert) {
    assert.plan(2);
    var cache = createCache();
    cache.get('foo2', function(err, val) {
        assert.ifError(err, 'should not get an error back');
        assert.equal(val, 'bar2', 'got the expected value from a separate constructor obj');
        cache.close();
        assert.end();
    });
});

test('get already cached value', function(assert) {
    assert.plan(2);
    var cache = createCache();
    setTimeout(function() {
        cache.get('foo2', function(err, val) {
            assert.ifError(err, 'should not get an error back');
            assert.equal(val, 'bar2', 'got the expected value from a separate constructor obj');
            cache.close();
            assert.end();
        });
    }, 50);
});

test('getLazy', function(assert) {
    assert.plan(3);
    var cache = new CacheRedis({
        namespace: 'cacheTest',
        lazy: true
    });
    assert.ok(!cache.cache.foo2, 'key not yet in memory');
    cache.get('foo2', function(err, val) {
        assert.ifError(err, 'should not get an error back');
        assert.equal(val, 'bar2', 'got the expected value even though not originally in memory');
        cache.close();
        assert.end();
    });
});

test('get non existent', function(assert) {
    assert.plan(2);
    var cache = createCache();
    cache.get('nonexistent', function(err, result) {
        assert.ifError(err, 'got no error');
        assert.equal(result, undefined, 'got no result');
        cache.close();
        assert.end();
    });
});

test('get redis failure', mutate(redisClient, 'hget', function(namespace, key, callback) {
    callback(new Error('fake error'));
}, function(assert) {
    assert.plan(2);
    var cache = new CacheRedis({
        namespace: 'cacheTest',
        lazy: true
    });
    redisManager.freeClient(cache.redisClient);
    cache.redisClient = redisClient;
    cache.get('foo2', function(err) {
        assert.ok(err instanceof Error, 'got an error back');
        assert.equal(err.message, 'fake error', 'got the fake redisClient error back');
        assert.end();
    });
}));

test('get corrupt key returns undefined', mutate(redisClient, 'hget', function(namespace, key, callback) {
    callback(null, 'lol{json}');
}, function(assert) {
    assert.plan(2);
    var cache = new CacheRedis({
        namespace: 'cacheTest',
        lazy: true
    });
    redisManager.freeClient(cache.redisClient);
    cache.redisClient = redisClient;
    cache.get('corrupted', function(err, result) {
        assert.ifError(err, 'should not get an error back');
        assert.equal(result, undefined, 'got back an undefined value');
        assert.end();
    });
}));

test('get corrupt key returns error if cannot delete from redis', function(assert) {
    assert.plan(2);
    var cache = new CacheRedis({
        namespace: 'cacheTest',
        lazy: true
    });
    redisManager.freeClient(cache.redisClient);
    cache.redisClient = {
        hget: function(namespace, key, callback) {
            callback(null, 'lol{json}');
        },
        hdel: function(namespace, key, callback) {
            callback(new Error('will not delete'));
        }
    };
    cache.get('corrupted', function(err) {
        assert.ok(err instanceof Error, 'got an error back');
        assert.equal(err.message, 'will not delete', 'got the hdel error back');
        assert.end();
    });
});

test('keysLocal', function(assert) {
    assert.plan(1);
    var cache = createCache();
    setTimeout(function() {
        assert.deepEqual(cache.keysLocal().sort(), ['foo', 'foo2'], 'got both keys');
        cache.close();
        assert.end();
    }, 50);
});

test('keys', function(assert) {
    assert.plan(1);
    var cache = createCache();
    cache.keys(function(err, keys) {
        assert.deepEqual(keys.sort(), ['foo', 'foo2'], 'got both keys');
        cache.close();
        assert.end();
    });
});

test('valuesLocal', function(assert) {
    assert.plan(1);
    var cache = createCache();
    setTimeout(function() {
        assert.deepEqual(cache.valuesLocal().sort(), ['bar', 'bar2'], 'got both values');
        cache.close();
        assert.end();
    }, 50);
});

test('values', function(assert) {
    assert.plan(1);
    var cache = createCache();
    cache.values(function(err, values) {
        assert.deepEqual(values.sort(), ['bar', 'bar2'], 'got both values');
        cache.close();
        assert.end();
    });
});

test('values error', mutate(redisClient, 'hvals', function(namespace, callback) {
    callback(new Error('fake error'));
}, function(assert) {
    assert.plan(2);
    var cache = createCache();
    redisManager.freeClient(cache.redisClient);
    cache.redisClient = redisClient;
    cache.values(function(err) {
        assert.ok(err instanceof Error, 'got an error back');
        assert.equal(err.message, 'fake error', 'got back the expected error');
        assert.end();
    });
}));

test('values drops corrupt values', mutate(redisClient, 'hvals', function(namespace, callback) {
    callback(null, ['"a"', '"b"', 'lol{json}']);
}, function(assert) {
    assert.plan(2);
    var cache = createCache();
    redisManager.freeClient(cache.redisClient);
    cache.redisClient = redisClient;
    cache.values(function(err, results) {
        assert.ifError(err, 'should not get an error');
        assert.equal(results.sort().toString(), ['a', 'b'].sort().toString(), 'got back the expected array of values');
        assert.end();
    });
}));

test('has', function(assert) {
    assert.plan(2);
    var cache = createCache();
    cache.has('foo', function(has) {
        assert.equal(has, true, 'has that key');
        cache.has('lolno', function(has) {
            assert.equal(has, false, 'does not have that key');
            cache.close();
            assert.end();
        });
    });
});

test('has already cached', function(assert) {
    assert.plan(1);
    var cache = createCache();
    setTimeout(function() {
        cache.has('foo', function(has) {
            assert.equal(has, true, 'has that key');
            cache.close();
            assert.end();
        });
    }, 50);
});

test('has returns false on error', mutate(redisClient, 'hexists', function(namespace, key, callback) {
    callback(new Error('Rar! This is an error of some sort!'));
}, function(assert) {
    assert.plan(1);
    var cache = createCache();
    redisManager.freeClient(cache.redisClient);
    cache.redisClient = redisClient;
    cache.has('foo', function(has) {
        assert.equal(has, false, 'returns false if having issues with redis');
        assert.end();
    });
}));

test('hasLocal', function(assert) {
    assert.plan(2);
    var cache = createCache();
    setTimeout(function() {
        assert.equal(cache.hasLocal('foo'), true, 'has that key');
        assert.equal(cache.hasLocal('lolno'), false, 'does not have that key');
        cache.close();
        assert.end();
    }, 50);
});

test('setObj', function(assert) {
    assert.plan(3);
    var cache = createCache();
    cache.set('obj', { foo: 'bar', abc: 123 }, function(err) {
        assert.ifError(err, 'should not get an error');
        cache.get('obj', function(err, obj) {
            assert.ifError(err, 'should not get an error');
            assert.deepEqual({ foo: 'bar', abc: 123 }, obj, 'got back the same object');
            cache.close();
            assert.end();
        });
    });
});

test('clearAgain', function (assert) {
    redisClient.flushall(function() {
        redisManager.freeClient(redisClient);
        assert.end();
    });
});

var test = require('tape');

var cacheRedis = require('../index.js');

test('cacheRedis is a function', function (assert) {
    assert.strictEqual(typeof cacheRedis, 'function');
    assert.end();
});

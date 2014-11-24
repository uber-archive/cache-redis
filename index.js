var redisManager = require('redis-manager');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

function CacheRedis(config) {
    EventEmitter.call(this);
    this.host = config.host || 'localhost';
    this.port = config.port || 6379;
    this.redisConfig = config.redisConfig || {};
    this.namespace = config.namespace;
    this.lazy = config.lazy || false;
    this.redisManager = config.redisManager || redisManager;
    this.redisClient = this.redisManager.getClient(this.port, this.host, this.redisConfig);
    this.redisClient.on('error', this.emit.bind(this, 'error'));
    this.cache = {};

    if (!this.lazy) {
        this.redisClient.hgetall(this.namespace, function(err, cache) {
            if (err) this.emit('error', err);
            if (cache) {
                Object.keys(cache).forEach(function(key) {
                    try {
                        this.cache[key] = JSON.parse(cache[key]);
                    } catch (e) {
                        delete this.cache[key];
                        this.redisClient.hdel(this.namespace, key, function(err) {
                            if (err) this.emit('error', err);
                        }.bind(this));
                    }
                }.bind(this));
            }
        }.bind(this));
    }
}

util.inherits(CacheRedis, EventEmitter);

CacheRedis.prototype.close = function() {
    this.redisManager.freeClient(this.redisClient);
};

CacheRedis.prototype.set = function(key, val, callback) {
    this.cache[key] = val;
    this.redisClient.hset(this.namespace, key, JSON.stringify(val), callback);
};

CacheRedis.prototype.getLocal = function(key) {
    return this.cache[key];
};

CacheRedis.prototype.get = function(key, callback) {
    if (this.cache.hasOwnProperty(key)) return process.nextTick(callback.bind(this, undefined, this.cache[key]));
    this.redisClient.hget(this.namespace, key, function(err, val) {
        if (err) return callback(err);
        if (val) {
            try {
                this.cache[key] = JSON.parse(val);
            } catch (e) {
                delete this.cache[key];
                return this.redisClient.hdel(this.namespace, key, function(err) {
                    if (err) return callback(err);
                    callback(undefined, undefined);
                });
            }
        }
        callback(undefined, this.cache[key]);
    }.bind(this));
};

CacheRedis.prototype.keysLocal = function() {
    return Object.keys(this.cache);
};

CacheRedis.prototype.keys = function(callback) {
    this.redisClient.hkeys(this.namespace, callback);
};

CacheRedis.prototype.valuesLocal = function() {
    return Object.keys(this.cache).map(function(key) { return this.cache[key]; }, this);
};

CacheRedis.prototype.values = function(callback) {
    this.redisClient.hvals(this.namespace, function(err, values) {
        if (err) return callback(err);
        callback(undefined, values.map(function(value) {
            try {
                return JSON.parse(value);
            } catch (e) {
                return undefined;
            }
        }).filter(function(value) {
            return value !== undefined;
        }));
    });
};

CacheRedis.prototype.has = function(key, callback) {
    if (this.cache.hasOwnProperty(key)) {
        process.nextTick(callback.bind(this, true));
    } else {
        this.redisClient.hexists(this.namespace, key, function(err, result) {
            if (err) return callback(false);
            callback(!!result); // Cast to boolean
        });
    }
};

CacheRedis.prototype.hasLocal = function(key) {
    return this.cache.hasOwnProperty(key);
};

// TODO: Add other ES6 Map methods: items, forEach, iterator, delete, clear, toString, and the property size

module.exports = CacheRedis;

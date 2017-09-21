'use strict';

const fs   = require('fs');
const path = require('path');

const cb = function () { return false; };
const opts = { booleans: ['arg1'] };

function clearRequireCache () {
    // node_unit runs all the tests in the same process, so the process.env
    // changes affect other tests. Icky. Work around by invalidating
    // the require cache, so config and configfile re-initialize
    delete require.cache[
        path.resolve(__dirname, '..','config') + '.js'
    ];
    delete require.cache[
        path.resolve(__dirname, '..','configfile') + '.js'
    ];
}

function setUp (done) {
    process.env.NODE_ENV = 'test'
    process.env.HARAKA = '';
    clearRequireCache();
    this.config = require('../config');
    done();
}

exports.config = {
    'setUp' : setUp,
    'new' : function (test) {
        test.expect(1);
        test.equal(path.resolve('test','config'), this.config.root_path);
        test.done();
    },
    'module_config' : function (test) {
        test.expect(2);
        const c = this.config.module_config('foo', 'bar');
        test.equal(c.root_path, path.join('foo','config'));
        test.equal(c.overrides_path, path.join('bar','config'));
        test.done();
    },
};

exports.config_path = {
    'config_path process.env.HARAKA': function (test) {
        test.expect(1);
        process.env.HARAKA = '/tmp';
        clearRequireCache();
        const config = require('../config');
        // console.log(config);
        test.equal(config.root_path, path.join('/tmp','config'));
        test.done();
    },
    'config_path process.env.NODE_ENV': function (test) {
        test.expect(1);
        process.env.HARAKA = '';
        process.env.NODE_ENV = 'not-test';
        clearRequireCache();
        const config = require('../config');
        // ./config doesn't exist so path will be resolved ./
        test.ok(/haraka-config$/.test(config.root_path));
        process.env.NODE_ENV = 'test';
        test.done();
    },
};

exports.arrange_args = {
    'setUp' : setUp,
    // config.get('name');
    'name' : function (test) {
        test.expect(1);
        test.deepEqual(
            this.config.arrange_args(['test.ini']),
            ['test.ini', 'ini', undefined, undefined]);
        test.done();
    },
    // config.get('name', type);
    'name, type' : function (test) {
        test.expect(1);
        test.deepEqual(
            this.config.arrange_args(['test.ini','ini']),
            ['test.ini', 'ini', undefined, undefined]);
        test.done();
    },
    // config.get('name', cb);
    'name, callback' : function (test) {
        test.expect(1);
        test.deepEqual(
            this.config.arrange_args(['test.ini',cb]),
            ['test.ini', 'ini', cb, undefined]);
        test.done();
    },
    // config.get('name', cb, options);
    'name, callback, options' : function (test) {
        test.expect(1);
        test.deepEqual(
            this.config.arrange_args(['test.ini',cb,opts]),
            ['test.ini', 'ini', cb, opts]);
        test.done();
    },
    // config.get('name', options);
    'name, options' : function (test) {
        test.expect(1);
        test.deepEqual(
            this.config.arrange_args(['test.ini',opts]),
            ['test.ini', 'ini', undefined, opts]);
        test.done();
    },
    // config.get('name', type, cb);
    'name, type, callback' : function (test) {
        test.expect(1);
        test.deepEqual(
            this.config.arrange_args(['test.ini','ini',cb]),
            ['test.ini', 'ini', cb, undefined]);
        test.done();
    },
    // config.get('name', type, options);
    'name, type, options' : function (test) {
        test.expect(1);
        test.deepEqual(
            this.config.arrange_args(['test.ini','ini',opts]),
            ['test.ini', 'ini', undefined, opts]);
        test.done();
    },
    // config.get('name', type, cb, options);
    'name, type, callback, options' : function (test) {
        test.expect(1);
        test.deepEqual(
            this.config.arrange_args(['test.ini','ini',cb, opts]),
            ['test.ini', 'ini', cb, opts]);
        test.done();
    },
    // config.get('name', list, cb, options);
    'name, list type, callback, options' : function (test) {
        test.expect(1);
        test.deepEqual(
            this.config.arrange_args(['test.ini','list',cb, opts]),
            ['test.ini', 'list', cb, opts]);
        test.done();
    },
    // config.get('name', binary, cb, options);
    'name, binary type, callback, options' : function (test) {
        test.expect(1);
        test.deepEqual(
            this.config.arrange_args(['test.ini','binary',cb, opts]),
            ['test.ini', 'binary', cb, opts]);
        test.done();
    },
    // config.get('name', type, cb, options);
    'name, value type, callback, options' : function (test) {
        test.expect(1);
        test.deepEqual(
            this.config.arrange_args(['test.ini','value',cb, opts]),
            ['test.ini', 'value', cb, opts]);
        test.done();
    },
    // config.get('name', type, cb, options);
    'name, json type, callback, options' : function (test) {
        test.expect(1);
        test.deepEqual(
            this.config.arrange_args(['test.ini','json',cb, opts]),
            ['test.ini', 'json', cb, opts]);
        test.done();
    },
    // config.get('name', type, cb, options);
    'name, data type, callback, options' : function (test) {
        test.expect(1);
        test.deepEqual(
            this.config.arrange_args(['test.ini','data',cb, opts]),
            ['test.ini', 'data', cb, opts]);
        test.done();
    },
};

const jsonRes = {
    matt: 'waz here',
    array: [ 'has an element' ],
    objecty: { 'has a property': 'with a value' }
};

const yamlRes = {
    main: {
        bool_true: true,
        bool_false: false,
        str_true: true,
        str_false: false
    },
    sect1: {
        bool_true: true,
        bool_false: false,
        str_true: true,
        str_false: false
    },
    whitespace: {
        str_no_trail: true,
        str_trail: true
    },
    matt: 'waz here',
    array: ['has an element'],
    objecty: {
        'has a property': 'with a value'
    }
};

function _test_get (test, name, type, callback, options, expected) {
    test.expect(1);
    const config = require('../config');
    const cfg = config.get(name, type, callback, options);
    test.deepEqual(cfg, expected);
    test.done();
}

exports.get = {
    'setUp' : setUp,
    // config.get('name');
    'test (non-existing)' : function (test) {
        _test_get(test, 'test', null, null, null, null);
    },
    'test (non-existing, cached)' : function (test) {
        test.expect(1);
        const cfg = this.config.get('test', null, null);
        test.deepEqual(cfg, null);
        test.done();
    },

    // config.get('test.ini');
    'test.ini, no opts' : function (test) {
        _test_get(test, 'test.ini', null, null, null, {
            main: { bool_true: 'true', bool_false: 'false', str_true: 'true', str_false: 'false' },
            sect1: { bool_true: 'true', bool_false: 'false', str_true: 'true', str_false: 'false' },
            whitespace: { str_no_trail: 'true', str_trail: 'true' },
            funnychars: { 'results.auth/auth_base.fail': 'fun' },
            empty_values: { first: undefined, second: undefined },
            has_ipv6: { '2605:ae00:329::2': undefined },
            array_test: {
                hostlist: [ 'first_host', 'second_host', 'third_host' ],
                intlist: [ '123', '456', '789' ],
            },
            'foo.com': { is_bool: 'true' },
            'bar.com': { is_bool: 'false' }
        });
    },

    // config.get('test.txt');
    'test.txt' : function (test) {
        _test_get(test, 'test.txt', null, null, null, null);
    },

    // config.get('test.flat');
    'test.flat, type=' : function (test) {
        _test_get(test, 'test.flat', null, null, null, 'line1');
    },

    // NOTE: the test.flat file had to be duplicated for these tests, to avoid
    // the config cache from returning invalid results.

    // config.get('test.flat', 'value');
    'test.flat, type=value' : function (test) {
        _test_get(test, 'test.value', 'value', null, null, 'line1');
    },
    // config.get('test.flat', 'list');
    'test.flat, type=list' : function (test) {
        _test_get(test, 'test.list', 'list', null, null,
            ['line1', 'line2','line3', 'line5'] );
    },
    // config.get('test.flat', 'data');
    'test.flat, type=data' : function (test) {
        _test_get(test, 'test.data', 'data', null, null,
            ['line1', 'line2','line3', '', 'line5'] );
    },

    // config.get('test.json');
    'test.json, type=' : function (test) {
        _test_get(test, 'test.json', null, null, null, jsonRes);
    },
    // config.get('test.json', 'json');
    'test.json, type=json' : function (test) {
        _test_get(test, 'test.json', 'json', null, null, jsonRes);
    },

    // config.get('test.yaml');
    'test.yaml, type=' : function (test) {
        _test_get(test, 'test.yaml', null, null, null, yamlRes);
    },
    // config.get('test.yaml', 'yaml');
    'test.yaml, type=yaml' : function (test) {
        _test_get(test, 'test.yaml', 'yaml', null, null, yamlRes);
    },
    // config.get('missing.json');
    'missing.yaml, asked for json' : function (test) {
        _test_get(test, 'missing.json', 'json', null, null, {"matt": "waz here"});
    },

    // config.get('test.bin', 'binary');
    'test.bin, type=binary' : function (test) {
        test.expect(2);
        const res = this.config.get('test.binary', 'binary');
        test.equal(res.length, 120);
        test.ok(Buffer.isBuffer(res));
        test.done();
    },
};

exports.merged = {
    'setUp' : setUp,
    'before_merge' : function (test) {
        test.expect(1);
        const lc = this.config.module_config(
            path.join('test','default')
        );
        test.deepEqual(lc.get('test.ini'),
            { main: {}, defaults: { one: 'one', two: 'two' } }
        );
        test.done();
    },
    'after_merge': function (test) {
        test.expect(1);
        const lc = this.config.module_config(
            path.join('test','default'),
            path.join('test','override')
        );
        test.deepEqual(lc.get('test.ini'),
            { main: {}, defaults: { one: 'three', two: 'four' } }
        );
        test.done();
    },
    'flat overridden' : function (test) {
        test.expect(1);
        const lc = this.config.module_config(
            path.join('test','default'),
            path.join('test','override')
        );
        test.equal(lc.get('test.flat'), 'flatoverrode');
        test.done();
    },
}

const tmpFile = path.resolve('test', 'config', 'dir', '4.ext');

function cleanup (done) {
    fs.unlink(tmpFile, () => {
        done();
    })
}

exports.getDir = {
    'setUp' : function (done) {
        process.env.HARAKA = '';
        clearRequireCache();
        this.config = require('../config');
        cleanup(done);
    },
    'tearDown' : function (done) {
        cleanup(done);
    },
    'loads all files in dir' : function (test) {
        test.expect(4);
        this.config.getDir('dir', { type: 'binary' }, function (err, files) {
            // console.log(files);
            test.equal(err, null);
            test.equal(files.length, 3);
            test.equal(files[0].data, 'contents1\n');
            test.equal(files[2].data, 'contents3\n');
            test.done();
        })
    },
    'errs on invalid dir' : function (test) {
        test.expect(1);
        this.config.getDir('dirInvalid', { type: 'binary' }, function (err, files) {
            // console.log(arguments);
            test.equal(err.code, 'ENOENT');
            test.done();
        })
    },
    'reloads when file in dir is touched' : function (test) {
        if (/darwin/.test(process.platform)) {
            // due to differences in fs.watch, this test is not reliable on
            // Mac OS X
            test.done();
            return;
        }
        test.expect(6);
        const self = this;
        let callCount = 0;
        function getDirDone (err, files) {
            // console.log('Loading: test/config/dir');
            if (err) console.error(err);
            callCount++;
            if (callCount === 1) {
                // console.log(files);
                test.equal(err, null);
                test.equal(files.length, 3);
                test.equal(files[0].data, 'contents1\n');
                test.equal(files[2].data, 'contents3\n');
                fs.writeFile(tmpFile, 'contents4\n', (err2, res) => {
                    test.equal(err2, null);
                    // console.log('file touched, waiting for callback');
                    // console.log(res);
                });
            }
            if (callCount === 2) {
                test.equal(files[3].data, 'contents4\n');
                test.done();
            }
        }
        function getDir () {
            const opts2 = { type: 'binary', watchCb: getDir };
            self.config.getDir('dir', opts2, getDirDone);
        }
        getDir();
    }
}

exports.jsonOverrides = {
    'setUp' : setUp,
    'no override for smtpgreeting': function (test) {
        test.expect(1);
        // console.log(this.config);
        test.deepEqual(
            this.config.get('smtpgreeting', 'list'),
            []
        );
        test.done();
    },
    'with smtpgreeting override': function (test) {
        test.expect(1);
        const main = this.config.get('main.json');
        console.log(main);
        test.deepEqual(
            this.config.get('smtpgreeting', 'list'),
            [ 'this is line one', 'this is line two' ]
        );
        test.done();
    }
}
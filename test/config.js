
const assert = require('assert')
const fs     = require('fs')
const os     = require('os')
const path   = require('path')

function cb () { return false; }
const opts = { booleans: ['arg1'] };

function clearRequireCache () {
    // node_unit runs all the tests in the same process, so the process.env
    // changes affect other tests. Icky. Work around by invalidating
    // the require cache, so config and configfile re-initialize
    delete require.cache[
        `${path.resolve(__dirname, '..','config')}.js`
    ];
    delete require.cache[
        `${path.resolve(__dirname, '..','configfile')}.js`
    ];
}

function testSetup (done) {
    process.env.NODE_ENV = 'test'
    process.env.HARAKA = '';
    process.env.WITHOUT_CONFIG_CACHE = '1';
    clearRequireCache();
    this.config = require('../config');
    done();
}

describe('config', function () {

    beforeEach(testSetup)

    it('new', function (done) {
        assert.equal(path.resolve('test','config'), this.config.root_path);
        done();
    })

    it('module_config', function (done) {
        const c = this.config.module_config('foo', 'bar');
        assert.equal(c.root_path, path.join('foo','config'));
        assert.equal(c.overrides_path, path.join('bar','config'));
        done();
    })

    describe('config_path', function () {
        it('config_path process.env.HARAKA', function (done) {
            process.env.HARAKA = '/tmp';
            clearRequireCache();
            const config = require('../config');
            // console.log(config);
            assert.equal(config.root_path, path.join('/tmp','config'));
            done();
        })

        it('config_path process.env.NODE_ENV', function (done) {
            process.env.HARAKA = '';
            process.env.NODE_ENV = 'not-test';
            clearRequireCache();
            const config = require('../config');
            // ./config doesn't exist so path will be resolved ./
            assert.ok(/haraka-config$/.test(config.root_path));
            process.env.NODE_ENV = 'test';
            done();
        })
    })

    describe('arrange_args', function () {
        beforeEach(testSetup)

        // config.get('name');
        it('name', function (done) {
            assert.deepEqual(
                this.config.arrange_args(['test.ini']),
                ['test.ini', 'ini', undefined, undefined]);
            done();
        })
        // config.get('name', type);
        it('name, type', function (done) {
            assert.deepEqual(
                this.config.arrange_args(['test.ini','ini']),
                ['test.ini', 'ini', undefined, undefined]);
            done();
        })

        // config.get('name', cb);
        it('name, callback', function (done) {
            assert.deepEqual(
                this.config.arrange_args(['test.ini',cb]),
                ['test.ini', 'ini', cb, undefined]);
            done();
        })

        // config.get('name', cb, options);
        it('name, callback, options', function (done) {
            assert.deepEqual(
                this.config.arrange_args(['test.ini',cb,opts]),
                ['test.ini', 'ini', cb, opts]);
            done();
        })

        // config.get('name', options);
        it('name, options', function (done) {
            assert.deepEqual(
                this.config.arrange_args(['test.ini',opts]),
                ['test.ini', 'ini', undefined, opts]);
            done();
        })

        // config.get('name', type, cb);
        it('name, type, callback', function (done) {
            assert.deepEqual(
                this.config.arrange_args(['test.ini','ini',cb]),
                ['test.ini', 'ini', cb, undefined]);
            done();
        })

        // config.get('name', type, options);
        it('name, type, options', function (done) {
            assert.deepEqual(
                this.config.arrange_args(['test.ini','ini',opts]),
                ['test.ini', 'ini', undefined, opts]);
            done();
        })

        // config.get('name', type, cb, options);
        it('name, type, callback, options', function (done) {
            assert.deepEqual(
                this.config.arrange_args(['test.ini','ini',cb, opts]),
                ['test.ini', 'ini', cb, opts]);
            done();
        })

        // config.get('name', list, cb, options);
        it('name, list type, callback, options', function (done) {
            assert.deepEqual(
                this.config.arrange_args(['test.ini','list',cb, opts]),
                ['test.ini', 'list', cb, opts]);
            done();
        })

        // config.get('name', binary, cb, options);
        it('name, binary type, callback, options', function (done) {
            assert.deepEqual(
                this.config.arrange_args(['test.ini','binary',cb, opts]),
                ['test.ini', 'binary', cb, opts]);
            done();
        })

        // config.get('name', type, cb, options);
        it('name, value type, callback, options', function (done) {
            assert.deepEqual(
                this.config.arrange_args(['test.ini','value',cb, opts]),
                ['test.ini', 'value', cb, opts]);
            done();
        })

        // config.get('name', type, cb, options);
        it('name, hjson type, callback, options', function (done) {
            assert.deepEqual(
                this.config.arrange_args(['test.ini','hjson',cb, opts]),
                ['test.ini', 'hjson', cb, opts]);
            done();
        })

        // config.get('name', type, cb, options);
        it('name, json type, callback, options', function (done) {
            assert.deepEqual(
                this.config.arrange_args(['test.ini','json',cb, opts]),
                ['test.ini', 'json', cb, opts]);
            done();
        })

        // config.get('name', type, cb, options);
        it('name, data type, callback, options', function (done) {
            assert.deepEqual(
                this.config.arrange_args(['test.ini','data',cb, opts]),
                ['test.ini', 'data', cb, opts]);
            done();
        })
    })
})

const hjsonRes = {
    matt: 'waz here and also made comments',
    differentArray: [ 'has element #1', 'has element #2' ],
    object: {
        'has a property one': 'with a value A',
        'has a property two': 'with a value B'
    }
}

const jsonRes = {
    matt: 'waz here',
    array: [ 'has an element' ],
    objecty: { 'has a property': 'with a value' }
}

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
}

function _test_get (done, name, type, callback, options, expected) {
    const config = require('../config');
    const cfg = config.get(name, type, callback, options);
    assert.deepEqual(cfg, expected);
    done();
}

function _test_int (done, name, default_value, expected) {
    const config = require('../config');
    const result = config.getInt(name, default_value);
    if (result) {
        assert.equal(typeof result, 'number');
    }
    assert.deepEqual(result, expected);
    done();
}

describe('get', function () {
    beforeEach(testSetup)

    // config.get('name');
    it('test (non-existing)', function (done) {
        _test_get(done, 'test', null, null, null, null);
    })

    it('test (non-existing, cached)', function (done) {
        process.env.WITHOUT_CONFIG_CACHE= '';
        const cfg = this.config.get('test', null, null);
        assert.deepEqual(cfg, null);
        done();
    })

    // config.get('test.ini');
    it('test.ini, no opts', function (done) {
        _test_get(done, 'test.ini', null, null, null, {
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
            'bar.com': { is_bool: 'false' },
            has_nums: { integer: 454, float: 10.5 },
        })
    })

    it('test.ini, opts', function (done) {
        _test_get(done, 'test.ini', 'ini', null, {
            booleans: [
                '*.bool_true',
                '*.bool_false',
            ]
        }, {
            main: { bool_true: true, bool_false: false, str_true: 'true', str_false: 'false' },
            sect1: { bool_true: true, bool_false: false, str_true: 'true', str_false: 'false' },
            whitespace: { str_no_trail: 'true', str_trail: 'true' },
            funnychars: { 'results.auth/auth_base.fail': 'fun' },
            empty_values: { first: undefined, second: undefined },
            has_ipv6: { '2605:ae00:329::2': undefined },
            array_test: {
                hostlist: [ 'first_host', 'second_host', 'third_host' ],
                intlist: [ '123', '456', '789' ],
            },
            'foo.com': { is_bool: 'true' },
            'bar.com': { is_bool: 'false' },
            has_nums: { integer: 454, float: 10.5 },
        })
    })

    // config.get('test.txt');
    it('test.txt', function (done) {
        _test_get(done, 'test.txt', null, null, null, null);
    })

    // config.get('test.flat');
    it('test.flat, type=', function (done) {
        _test_get(done, 'test.flat', null, null, null, 'line1');
    })

    // NOTE: the test.flat file had to be duplicated for these tests, to avoid
    // the config cache from returning invalid results.

    // config.get('test.flat', 'value');
    it('test.flat, type=value', function (done) {
        _test_get(done, 'test.value', 'value', null, null, 'line1');
    })

    // config.get('test.flat', 'list');
    it('test.flat, type=list', function (done) {
        _test_get(done, 'test.list', 'list', null, null,
            ['line1', 'line2','line3', 'line5'] );
    })

    // config.get('test.flat', 'data');
    it('test.flat, type=data', function (done) {
        _test_get(done, 'test.data', 'data', null, null,
            ['line1', 'line2','line3', '', 'line5'] );
    })

    // config.get('test.hjson');
    it('test.hjson, type=', function (done) {
        _test_get(done, 'test.hjson', null, null, null, hjsonRes);
    })

    // config.get('test.hjson', 'hjson');
    it('test.hjson, type=hjson', function (done) {
        _test_get(done, 'test.hjson', 'hjson', null, null, hjsonRes);
    })

    // config.get('test.json');
    it('test.json, type=', function (done) {
        _test_get(done, 'test.json', null, null, null, jsonRes);
    })

    // config.get('test.json', 'json');
    it('test.json, type=json', function (done) {
        _test_get(done, 'test.json', 'json', null, null, jsonRes);
    })

    // config.get('test.yaml');
    it('test.yaml, type=', function (done) {
        _test_get(done, 'test.yaml', null, null, null, yamlRes);
    })
    // config.get('test.yaml', 'yaml');
    it('test.yaml, type=yaml', function (done) {
        _test_get(done, 'test.yaml', 'yaml', null, null, yamlRes);
    })
    // config.get('missing2.hjson');
    it('missing2.yaml, asked for hjson', function (done) {
        _test_get(done, 'missing2.hjson', 'hjson', null, null, {"matt": "waz here - hjson type"});
    })
    // config.get('missing.json');
    it('missing.yaml, asked for json', function (done) {
        _test_get(done, 'missing.json', 'json', null, null, {"matt": "waz here"});
    })

    it('test.bin, type=binary', function (done) {
        const res = this.config.get('test.binary', 'binary');
        assert.equal(res.length, 120);
        assert.ok(Buffer.isBuffer(res));
        done();
    })

    it('fully qualified path: /etc/services', function (done) {
        let res;
        if (/^win/.test(process.platform)) {
            res = this.config.get('c:\\windows\\win.ini', 'list');
        }
        else {
            res = this.config.get('/etc/services', 'list');
        }
        assert.ok(res.length);
        done();
    })
})

describe('merged', function () {
    beforeEach(testSetup)

    it('before_merge', function (done) {
        const lc = this.config.module_config(
            path.join('test','default')
        );
        assert.deepEqual(lc.get('test.ini'),
            { main: {}, defaults: { one: 'one', two: 'two' } }
        );
        done();
    })

    it('after_merge', function (done) {
        const lc = this.config.module_config(
            path.join('test','default'),
            path.join('test','override')
        );
        assert.deepEqual(lc.get('test.ini'),
            { main: {}, defaults: { one: 'three', two: 'four' } }
        );
        done();
    })

    it('flat overridden', function (done) {
        const lc = this.config.module_config(
            path.join('test','default'),
            path.join('test','override')
        );
        assert.equal(lc.get('test.flat'), 'flatoverrode');
        done();
    })
})

describe('getInt', function () {
    beforeEach(testSetup)

    // config.get('name');
    it('empty filename is NaN', function (done) {
        const result = this.config.getInt();
        assert.equal(typeof result, 'number');
        assert.ok(isNaN(result));
        done();
    })

    it('empty/missing file contents is NaN', function (done) {
        const result = this.config.getInt('test-non-exist');
        assert.equal(typeof result, 'number');
        assert.ok(isNaN(result));
        done();
    })

    it('non-existing file returns default', function (done) {
        _test_int(done, 'test-non-exist', 5, 5);
    })

    it('test.int equals 6', function (done) {
        _test_int(done, 'test.int', undefined, 6);
    })

    it('test.int equals 6 (with default 7)', function (done) {
        _test_int(done, 'test.int', 7, 6);
    })
})

const tmpFile = path.resolve('test', 'config', 'dir', '4.ext');

function cleanup (done) {
    fs.unlink(tmpFile, () => {
        done();
    })
}

describe('getDir', function () {
    beforeEach(function (done) {
        process.env.HARAKA = '';
        clearRequireCache();
        this.config = require('../config');
        cleanup(done);
    })

    it('loads all files in dir', function (done) {
        this.config.getDir('dir', { type: 'binary' }, (err, files) => {
            assert.ifError(err);
            // console.log(files);
            assert.equal(err, null);
            assert.equal(files.length, 3);
            assert.equal(files[0].data, `contents1${os.EOL}`);
            assert.equal(files[2].data, `contents3${os.EOL}`);
            done();
        })
    })

    it('errs on invalid dir', function (done) {
        this.config.getDir('dirInvalid', { type: 'binary' }, (err, files) => {
            // console.log(arguments);
            assert.equal(err.code, 'ENOENT');
            done();
        })
    })

    it('reloads when file in dir is touched', function (done) {
        this.timeout(3500);
        if (/darwin/.test(process.platform)) {
            // due to differences in fs.watch, this test is not reliable on Mac OS X
            done();
            return;
        }
        const self = this;
        let callCount = 0;
        function getDirDone (err, files) {
            // console.log('Loading: test/config/dir');
            if (err) console.error(err);
            callCount++;
            if (callCount === 1) {
                // console.log(files);
                assert.equal(err, null);
                assert.equal(files.length, 3);
                assert.equal(files[0].data, `contents1${os.EOL}`);
                assert.equal(files[2].data, `contents3${os.EOL}`);
                fs.writeFile(tmpFile, 'contents4\n', (err2, res) => {
                    assert.equal(err2, null);
                    // console.log('file touched, waiting for callback');
                    // console.log(res);
                });
            }
            if (callCount === 2) {
                assert.equal(files[3].data, 'contents4\n');
                done();
            }
        }
        function getDir () {
            const opts2 = { type: 'binary', watchCb: getDir };
            self.config.getDir('dir', opts2, getDirDone);
        }
        getDir();
    })
})

describe('hjsonOverrides', function () {
    beforeEach(testSetup)

    it('no override for smtpgreeting', function (done) {
        // console.log(this.config);
        assert.deepEqual(
            this.config.get('smtpgreeting', 'list'),
            []
        );
        done();
    })

    it('with smtpgreeting override', function (done) {
        process.env.WITHOUT_CONFIG_CACHE='';
        const main = this.config.get('main.hjson');
        console.log(main);
        assert.deepEqual(
            this.config.get('smtpgreeting', 'list'),
            [ 'this is line one for hjson', 'this is line two for hjson' ]
        );
        done();
    })
})

describe('jsonOverrides', function () {
    beforeEach(testSetup)

    it('no override for smtpgreeting', function (done) {
        // console.log(this.config);
        assert.deepEqual(
            this.config.get('smtpgreeting', 'list'),
            []
        );
        done();
    })

    it('with smtpgreeting override', function (done) {
        process.env.WITHOUT_CONFIG_CACHE='';
        const main = this.config.get('main.json');
        console.log(main);
        assert.deepEqual(
            this.config.get('smtpgreeting', 'list'),
            [ 'this is line one', 'this is line two' ]
        );
        done();
    })
})

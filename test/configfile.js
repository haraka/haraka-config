'use strict';

const assert = require('assert')
// const path = require('path');

function _setUp (done) {
    process.env.NODE_ENV === 'test';
    this.cfreader = require('../configfile');
    this.opts = { booleans: ['main.bool_true','main.bool_false'] };
    done();
}

describe('configfile', function () {
    beforeEach(_setUp)

    describe('load_config', function () {

        describe('non-exist.ini', function () {

            it('empty', function (done) {
                assert.deepEqual(
                    this.cfreader.load_config('non-exist.ini','ini'),
                    { main: { } }
                );
                done()
            })

            it('boolean', function (done) {
                assert.deepEqual(
                    this.cfreader.load_config('non-exist.ini', 'ini',
                        { booleans: ['reject']}),
                    { main: { reject: false } }
                );
                done()
            })

            it('boolean true default', function (done) {
                assert.deepEqual(
                    this.cfreader.load_config('non-exist.ini', 'ini',
                        { booleans: ['+reject']}),
                    { main: { reject: true } }
                );
                assert.deepEqual(
                    this.cfreader.load_config('non-exist.ini', 'ini',
                        { booleans: ['+main.reject']}),
                    { main: { reject: true } }
                );
                assert.deepEqual(
                    this.cfreader.load_config('non-exist.ini', 'ini',
                        { booleans: ['main.+reject']}),
                    { main: { reject: true } }
                );
                done()
            })

            it('boolean false default', function (done) {
                assert.deepEqual(
                    this.cfreader.load_config('non-exist.ini', 'ini',
                        { booleans: ['-reject']}),
                    { main: { reject: false } }
                );
                assert.deepEqual(
                    this.cfreader.load_config('non-exist.ini', 'ini',
                        { booleans: ['-main.reject']}),
                    { main: { reject: false } }
                );
                assert.deepEqual(
                    this.cfreader.load_config('non-exist.ini', 'ini',
                        { booleans: ['main.-reject']}),
                    { main: { reject: false } }
                );
                done()
            })

            it('boolean false default, section', function (done) {
                assert.deepEqual(
                    this.cfreader.load_config('non-exist.ini', 'ini',
                        { booleans: ['-reject.boolf']}),
                    { main: { }, reject: {boolf: false} }
                );
                assert.deepEqual(
                    this.cfreader.load_config('non-exist.ini', 'ini',
                        { booleans: ['+reject.boolt']}),
                    { main: { }, reject: {boolt: true} }
                );
                done()
            })
        })

        describe('test.ini', function () {

            it('no opts', function (done) {
                const r = this.cfreader.load_config('test/config/test.ini','ini');
                assert.strictEqual(r.main.bool_true, 'true');
                assert.strictEqual(r.main.bool_false, 'false');
                assert.strictEqual(r.main.str_true, 'true');
                assert.strictEqual(r.main.str_false, 'false');
                done()
            })

            it('opts', function (done) {
                const r = this.cfreader.load_config('test/config/test.ini', 'ini', this.opts);
                assert.strictEqual(r.main.bool_true, true);
                assert.strictEqual(r.main.bool_false, false);
                assert.strictEqual(r.main.str_true, 'true');
                assert.strictEqual(r.main.str_false, 'false');
                done()
            })

            it('sect1, opts', function (done) {
                const r = this.cfreader.load_config('test/config/test.ini', 'ini', {
                    booleans: ['sect1.bool_true','sect1.bool_false']
                });
                assert.strictEqual(r.sect1.bool_true, true);
                assert.strictEqual(r.sect1.bool_false, false);
                assert.strictEqual(r.sect1.str_true, 'true');
                assert.strictEqual(r.sect1.str_false, 'false');
                done()
            })

            it('sect1, opts, w/defaults', function (done) {
                const r = this.cfreader.load_config('test/config/test.ini', 'ini', {
                    booleans: [
                        '+sect1.bool_true','-sect1.bool_false',
                        '+sect1.bool_true_default', 'sect1.-bool_false_default'
                    ]
                });
                assert.strictEqual(r.sect1.bool_true, true);
                assert.strictEqual(r.sect1.bool_false, false);
                assert.strictEqual(r.sect1.str_true, 'true');
                assert.strictEqual(r.sect1.str_false, 'false');
                assert.strictEqual(r.sect1.bool_true_default, true);
                assert.strictEqual(r.sect1.bool_false_default, false);
                done()
            })

            it('funnychars, /', function (done) {
                const r = this.cfreader.load_config('test/config/test.ini');
                assert.strictEqual(r.funnychars['results.auth/auth_base.fail'], 'fun');
                done()
            })

            it('funnychars, _', function (done) {
                const r = this.cfreader.load_config('test/config/test.ini');
                assert.strictEqual(r.funnychars['results.auth/auth_base.fail'], 'fun');
                done()
            })

            it('ipv6 addr, :', function (done) {
                const r = this.cfreader.load_config('test/config/test.ini');
                assert.ok( '2605:ae00:329::2' in r.has_ipv6 );
                done()
            })

            it('empty value', function (done) {
                const r = this.cfreader.load_config('test/config/test.ini');
                assert.deepEqual({ first: undefined, second: undefined}, r.empty_values);
                done()
            })

            it('array', function (done) {
                const r = this.cfreader.load_config('test/config/test.ini');
                assert.deepEqual(['first_host', 'second_host', 'third_host'], r.array_test.hostlist);
                assert.deepEqual([123, 456, 789], r.array_test.intlist);
                done()
            })
        })
    })

    describe('get_filetype_reader', function () {

        it('binary', function (done) {
            const reader = this.cfreader.get_filetype_reader('binary');
            assert.equal(typeof reader.load, 'function');
            assert.equal(typeof reader.empty, 'function');
            done()
        })

        it('flat', function (done) {
            const reader = this.cfreader.get_filetype_reader('flat');
            assert.equal(typeof reader.load, 'function');
            assert.equal(typeof reader.empty, 'function');
            done()
        })

        it('hjson', function (done) {
            const reader = this.cfreader.get_filetype_reader('hjson');
            assert.equal(typeof reader.load, 'function');
            assert.equal(typeof reader.empty, 'function');
            done()
        })

        it('json', function (done) {
            const reader = this.cfreader.get_filetype_reader('json');
            assert.equal(typeof reader.load, 'function');
            assert.equal(typeof reader.empty, 'function');
            done()
        })

        it('ini', function (done) {
            const reader = this.cfreader.get_filetype_reader('ini');
            assert.equal(typeof reader.load, 'function');
            assert.equal(typeof reader.empty, 'function');
            done()
        })

        it('yaml', function (done) {
            const reader = this.cfreader.get_filetype_reader('yaml');
            assert.equal(typeof reader.load, 'function');
            assert.equal(typeof reader.empty, 'function');
            done()
        })

        it('value', function (done) {
            const reader = this.cfreader.get_filetype_reader('value');
            assert.equal(typeof reader.load, 'function');
            assert.equal(typeof reader.empty, 'function');
            done()
        })

        it('list', function (done) {
            const reader = this.cfreader.get_filetype_reader('list');
            assert.equal(typeof reader.load, 'function');
            assert.equal(typeof reader.empty, 'function');
            done()
        })

        it('data', function (done) {
            const reader = this.cfreader.get_filetype_reader('data');
            assert.equal(typeof reader.load, 'function');
            assert.equal(typeof reader.empty, 'function');
            done()
        })
    })

    describe('empty', function () {
        it('empty object for HJSON files', function (done) {
            const result = this.cfreader.load_config(
                'test/config/non-existent.hjson'
            );
            assert.deepEqual(result, {});
            done()
        })

        it('empty object for JSON files', function (done) {
            const result = this.cfreader.load_config(
                'test/config/non-existent.json'
            );
            assert.deepEqual(result, {});
            done()
        })

        it('empty object for YAML files', function (done) {
            const result = this.cfreader.load_config(
                'test/config/non-existent.yaml'
            );
            assert.deepEqual(result, {});
            done()
        })

        it('null for binary file', function (done) {
            const result = this.cfreader.load_config(
                'test/config/non-existent.bin',
                'binary'
            );
            assert.equal(result, null);
            done()
        })

        it('null for flat file', function (done) {
            const result = this.cfreader.load_config(
                'test/config/non-existent.flat'
            );
            assert.deepEqual(result, null);
            done()
        })

        it('null for value file', function (done) {
            const result = this.cfreader.load_config(
                'test/config/non-existent.value'
            );
            assert.deepEqual(result, null);
            done()
        })

        it('empty array for list file', function (done) {
            const result = this.cfreader.load_config(
                'test/config/non-existent.list'
            );
            assert.deepEqual(result, []);
            done()
        })

        it('template ini for INI file', function (done) {
            const result = this.cfreader.load_config(
                'test/config/non-existent.ini'
            );
            assert.deepEqual(result, { main: {} });
            done()
        })
    })

    describe('get_cache_key', function () {
        it('no options is the name', function (done) {
            assert.equal(this.cfreader.get_cache_key('test'),
                'test');
            done()
        })

        it('one option is name + serialized opts', function (done) {
            assert.equal(this.cfreader.get_cache_key('test', {foo: 'bar'}),
                'test{"foo":"bar"}');
            done()
        })

        it('two options are returned predictably', function (done) {
            assert.equal(
                this.cfreader.get_cache_key('test', {opt1: 'foo', opt2: 'bar'}),
                'test{"opt1":"foo","opt2":"bar"}');
            done()
        })
    })

    describe('regex', function () {
        it('section', function (done) {
            assert.equal(this.cfreader.regex.section.test('[foo]'), true);
            assert.equal(this.cfreader.regex.section.test('bar'), false);
            assert.equal(this.cfreader.regex.section.test('[bar'), false);
            assert.equal(this.cfreader.regex.section.test('bar]'), false);
            done()
        })

        it('param', function (done) {
            assert.equal(this.cfreader.regex.param.exec('foo=true')[1], 'foo');
            assert.equal(this.cfreader.regex.param.exec(';foo=true'), undefined);
            done()
        })

        it('comment', function (done) {
            assert.equal(this.cfreader.regex.comment.test('; true'), true);
            assert.equal(this.cfreader.regex.comment.test('false'), false);
            done()
        })

        it('line', function (done) {
            assert.equal(this.cfreader.regex.line.test(' boo '), true);
            assert.equal(this.cfreader.regex.line.test('foo'), true);
            done()
        })

        it('blank', function (done) {
            assert.equal(this.cfreader.regex.blank.test('foo'), false);
            assert.equal(this.cfreader.regex.blank.test(' '), true);
            done()
        })

        // 'continuation', function (done) {
        // done()
        // })

        it('is_integer', function (done) {
            assert.equal(this.cfreader.regex.is_integer.test(1), true);
            assert.equal(this.cfreader.regex.is_integer.test(''), false);
            assert.equal(this.cfreader.regex.is_integer.test('a'), false);
            done()
        })

        it('is_float', function (done) {
            assert.equal(this.cfreader.regex.is_float.test('1.0'), true);
            assert.equal(this.cfreader.regex.is_float.test(''), false);
            assert.equal(this.cfreader.regex.is_float.test('45'), false);
            done()
        })

        it('is_truth', function (done) {
            assert.equal(this.cfreader.regex.is_truth.test('no'), false);
            assert.equal(this.cfreader.regex.is_truth.test('nope'), false);
            assert.equal(this.cfreader.regex.is_truth.test('nuh uh'), false);
            assert.equal(this.cfreader.regex.is_truth.test('yes'), true);
            assert.equal(this.cfreader.regex.is_truth.test('true'), true);
            assert.equal(this.cfreader.regex.is_truth.test(true), true);
            done()
        })

        it('is_array', function (done) {
            assert.equal(this.cfreader.regex.is_array.test('foo=bar'), false);
            assert.equal(this.cfreader.regex.is_array.test('foo'), false);
            assert.equal(this.cfreader.regex.is_array.test('foo[]'), true);
            done()
        })
    })

    describe('bad_config', function () {
        it('bad.yaml returns empty', function (done) {
            assert.deepEqual(
                this.cfreader.load_config('test/config/bad.yaml'),
                {}
            );
            done()
        })
    })

    describe('overrides', function () {

        it('missing hjson loads yaml instead', function (done) {
            assert.deepEqual(
                this.cfreader.load_config('test/config/override2.hjson'),
                { hasDifferent: { value: false } });
            done()
        })

        it('missing json loads yaml instead', function (done) {
            assert.deepEqual(
                this.cfreader.load_config('test/config/override.json'),
                { has: { value: true } });
            done()
        })
    })

    describe('get_path_to_config_dir', function () {
        it('Haraka runtime (env.HARAKA=*)', function (done) {
            process.env.HARAKA = '/etc/';
            this.cfreader.get_path_to_config_dir();
            assert.ok(/etc.config$/.test(this.cfreader.config_path), this.cfreader.config_path);
            delete process.env.HARAKA;
            done()
        })

        it('NODE_ENV=test', function (done) {
            process.env.NODE_ENV = 'test';
            this.cfreader.get_path_to_config_dir();
            assert.ok(/haraka-config.test.config$/.test(this.cfreader.config_path), this.cfreader.config_path);
            delete process.env.NODE_ENV;
            done()
        })

        it('no $ENV defaults to ./config (if present) or ./', function (done) {
            delete process.env.HARAKA;
            delete process.env.NODE_ENV;
            this.cfreader.get_path_to_config_dir();
            assert.ok(/haraka-config$/.test(this.cfreader.config_path), this.cfreader.config_path);
            done()
        })
    })
})

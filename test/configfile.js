'use strict';

// const path = require('path');

function _setUp (done) {
    process.env.NODE_ENV === 'test';
    this.cfreader = require('../configfile');
    this.opts = { booleans: ['main.bool_true','main.bool_false'] };
    done();
}

exports.load_config = {
    setUp: _setUp,
    'non-exist.ini empty' : function (test) {
        test.expect(1);
        test.deepEqual(
            this.cfreader.load_config('non-exist.ini','ini'),
            { main: { } }
        );
        test.done();
    },
    'non-exist.ini boolean' : function (test) {
        test.expect(1);
        test.deepEqual(
            this.cfreader.load_config('non-exist.ini', 'ini',
                { booleans: ['reject']}),
            { main: { reject: false } }
        );
        test.done();
    },
    'non-exist.ini boolean true default' : function (test) {
        test.expect(3);
        test.deepEqual(
            this.cfreader.load_config('non-exist.ini', 'ini',
                { booleans: ['+reject']}),
            { main: { reject: true } }
        );
        test.deepEqual(
            this.cfreader.load_config('non-exist.ini', 'ini',
                { booleans: ['+main.reject']}),
            { main: { reject: true } }
        );
        test.deepEqual(
            this.cfreader.load_config('non-exist.ini', 'ini',
                { booleans: ['main.+reject']}),
            { main: { reject: true } }
        );
        test.done();
    },
    'non-exist.ini boolean false default' : function (test) {
        test.expect(3);
        test.deepEqual(
            this.cfreader.load_config('non-exist.ini', 'ini',
                { booleans: ['-reject']}),
            { main: { reject: false } }
        );
        test.deepEqual(
            this.cfreader.load_config('non-exist.ini', 'ini',
                { booleans: ['-main.reject']}),
            { main: { reject: false } }
        );
        test.deepEqual(
            this.cfreader.load_config('non-exist.ini', 'ini',
                { booleans: ['main.-reject']}),
            { main: { reject: false } }
        );
        test.done();
    },
    'non-exist.ini boolean false default, section' : function (test) {
        test.expect(2);
        test.deepEqual(
            this.cfreader.load_config('non-exist.ini', 'ini',
                { booleans: ['-reject.boolf']}),
            { main: { }, reject: {boolf: false} }
        );
        test.deepEqual(
            this.cfreader.load_config('non-exist.ini', 'ini',
                { booleans: ['+reject.boolt']}),
            { main: { }, reject: {boolt: true} }
        );
        test.done();
    },
    'test.ini, no opts' : function (test) {
        test.expect(4);
        const r = this.cfreader.load_config('test/config/test.ini','ini');
        test.strictEqual(r.main.bool_true, 'true');
        test.strictEqual(r.main.bool_false, 'false');
        test.strictEqual(r.main.str_true, 'true');
        test.strictEqual(r.main.str_false, 'false');
        test.done();
    },
    'test.ini, opts' : function (test) {
        test.expect(4);
        const r = this.cfreader.load_config('test/config/test.ini', 'ini', this.opts);
        test.strictEqual(r.main.bool_true, true);
        test.strictEqual(r.main.bool_false, false);
        test.strictEqual(r.main.str_true, 'true');
        test.strictEqual(r.main.str_false, 'false');
        test.done();
    },
    'test.ini, sect1, opts' : function (test) {
        test.expect(4);
        const r = this.cfreader.load_config('test/config/test.ini', 'ini', {
            booleans: ['sect1.bool_true','sect1.bool_false']
        });
        test.strictEqual(r.sect1.bool_true, true);
        test.strictEqual(r.sect1.bool_false, false);
        test.strictEqual(r.sect1.str_true, 'true');
        test.strictEqual(r.sect1.str_false, 'false');
        test.done();
    },
    'test.ini, sect1, opts, w/defaults' : function (test) {
        test.expect(6);
        const r = this.cfreader.load_config('test/config/test.ini', 'ini', {
            booleans: [
                '+sect1.bool_true','-sect1.bool_false',
                '+sect1.bool_true_default', 'sect1.-bool_false_default'
            ]
        });
        test.strictEqual(r.sect1.bool_true, true);
        test.strictEqual(r.sect1.bool_false, false);
        test.strictEqual(r.sect1.str_true, 'true');
        test.strictEqual(r.sect1.str_false, 'false');
        test.strictEqual(r.sect1.bool_true_default, true);
        test.strictEqual(r.sect1.bool_false_default, false);
        test.done();
    },
    'test.ini, funnychars, /' : function (test) {
        test.expect(1);
        const r = this.cfreader.load_config('test/config/test.ini');
        test.strictEqual(r.funnychars['results.auth/auth_base.fail'], 'fun');
        test.done();
    },
    'test.ini, funnychars, _' : function (test) {
        test.expect(1);
        const r = this.cfreader.load_config('test/config/test.ini');
        test.strictEqual(r.funnychars['results.auth/auth_base.fail'], 'fun');
        test.done();
    },
    'test.ini, ipv6 addr, :' : function (test) {
        test.expect(1);
        const r = this.cfreader.load_config('test/config/test.ini');
        test.ok( '2605:ae00:329::2' in r.has_ipv6 );
        test.done();
    },
    'test.ini, empty value' : function (test) {
        test.expect(1);
        const r = this.cfreader.load_config('test/config/test.ini');
        test.deepEqual({ first: undefined, second: undefined}, r.empty_values);
        test.done();
    },
    'test.ini, array' : function (test){
        test.expect(2);
        const r = this.cfreader.load_config('test/config/test.ini');
        test.deepEqual(['first_host', 'second_host', 'third_host'], r.array_test.hostlist);
        test.deepEqual([123, 456, 789], r.array_test.intlist);
        test.done();
    },
};

exports.get_filetype_reader  = {
    setUp: _setUp,
    'binary': function (test) {
        test.expect(2);
        const reader = this.cfreader.get_filetype_reader('binary');
        test.equal(typeof reader.load, 'function');
        test.equal(typeof reader.empty, 'function');
        test.done();
    },
    'flat': function (test) {
        test.expect(2);
        const reader = this.cfreader.get_filetype_reader('flat');
        test.equal(typeof reader.load, 'function');
        test.equal(typeof reader.empty, 'function');
        test.done();
    },
    'json': function (test) {
        test.expect(2);
        const reader = this.cfreader.get_filetype_reader('json');
        test.equal(typeof reader.load, 'function');
        test.equal(typeof reader.empty, 'function');
        test.done();
    },
    'ini': function (test) {
        test.expect(2);
        const reader = this.cfreader.get_filetype_reader('ini');
        test.equal(typeof reader.load, 'function');
        test.equal(typeof reader.empty, 'function');
        test.done();
    },
    'yaml': function (test) {
        test.expect(2);
        const reader = this.cfreader.get_filetype_reader('yaml');
        test.equal(typeof reader.load, 'function');
        test.equal(typeof reader.empty, 'function');
        test.done();
    },
    'value': function (test) {
        test.expect(2);
        const reader = this.cfreader.get_filetype_reader('value');
        test.equal(typeof reader.load, 'function');
        test.equal(typeof reader.empty, 'function');
        test.done();
    },
    'list': function (test) {
        test.expect(2);
        const reader = this.cfreader.get_filetype_reader('list');
        test.equal(typeof reader.load, 'function');
        test.equal(typeof reader.empty, 'function');
        test.done();
    },
    'data': function (test) {
        test.expect(2);
        const reader = this.cfreader.get_filetype_reader('data');
        test.equal(typeof reader.load, 'function');
        test.equal(typeof reader.empty, 'function');
        test.done();
    },
};

exports.non_existing = {
    setUp: _setUp,

    'empty object for JSON files': function (test) {
        test.expect(1);
        const result = this.cfreader.load_config(
            'test/config/non-existent.json'
        );
        test.deepEqual(result, {});
        test.done();
    },
    'empty object for YAML files': function (test) {
        test.expect(1);
        const result = this.cfreader.load_config(
            'test/config/non-existent.yaml'
        );
        test.deepEqual(result, {});
        test.done();
    },
    'null for binary file': function (test) {
        test.expect(1);
        const result = this.cfreader.load_config(
            'test/config/non-existent.bin',
            'binary'
        );
        test.equal(result, null);
        test.done();
    },
    'null for flat file': function (test) {
        test.expect(1);
        const result = this.cfreader.load_config(
            'test/config/non-existent.flat'
        );
        test.deepEqual(result, null);
        test.done();
    },
    'null for value file': function (test) {
        test.expect(1);
        const result = this.cfreader.load_config(
            'test/config/non-existent.value'
        );
        test.deepEqual(result, null);
        test.done();
    },
    'empty array for list file': function (test) {
        test.expect(1);
        const result = this.cfreader.load_config(
            'test/config/non-existent.list'
        );
        test.deepEqual(result, []);
        test.done();
    },
    'template ini for INI file': function (test) {
        test.expect(1);
        const result = this.cfreader.load_config(
            'test/config/non-existent.ini'
        );
        test.deepEqual(result, { main: {} });
        test.done();
    },
};

exports.get_cache_key = {
    setUp: _setUp,
    'no options is the name': function (test) {
        test.expect(1);
        test.equal(this.cfreader.get_cache_key('test'),
            'test');
        test.done();
    },
    'one option is name + serialized opts': function (test) {
        test.expect(1);
        test.equal(this.cfreader.get_cache_key('test', {foo: 'bar'}),
            'test{"foo":"bar"}');
        test.done();
    },
    'two options are returned predictably': function (test) {
        test.expect(1);
        test.equal(
            this.cfreader.get_cache_key('test', {opt1: 'foo', opt2: 'bar'}),
            'test{"opt1":"foo","opt2":"bar"}');
        test.done();
    }
};

exports.regex = {
    setUp: _setUp,
    'section': function (test) {
        test.expect(4);
        test.equal(this.cfreader.regex.section.test('[foo]'), true);
        test.equal(this.cfreader.regex.section.test('bar'), false);
        test.equal(this.cfreader.regex.section.test('[bar'), false);
        test.equal(this.cfreader.regex.section.test('bar]'), false);
        test.done();
    },
    'param': function (test) {
        test.expect(2);
        test.equal(this.cfreader.regex.param.exec('foo=true')[1], 'foo');
        test.equal(this.cfreader.regex.param.exec(';foo=true'), undefined);
        test.done();
    },
    'comment': function (test) {
        test.expect(2);
        test.equal(this.cfreader.regex.comment.test('; true'), true);
        test.equal(this.cfreader.regex.comment.test('false'), false);
        test.done();
    },
    'line': function (test) {
        test.expect(2);
        test.equal(this.cfreader.regex.line.test(' boo '), true);
        test.equal(this.cfreader.regex.line.test('foo'), true);
        test.done();
    },
    'blank': function (test) {
        test.expect(2);
        test.equal(this.cfreader.regex.blank.test('foo'), false);
        test.equal(this.cfreader.regex.blank.test(' '), true);
        test.done();
    },
    // 'continuation': function (test) {
    //     test.expect(1);
    //     test.done();
    // },
    'is_integer': function (test) {
        test.expect(3);
        test.equal(this.cfreader.regex.is_integer.test(1), true);
        test.equal(this.cfreader.regex.is_integer.test(''), false);
        test.equal(this.cfreader.regex.is_integer.test('a'), false);
        test.done();
    },
    'is_float': function (test) {
        test.expect(3);
        test.equal(this.cfreader.regex.is_float.test('1.0'), true);
        test.equal(this.cfreader.regex.is_float.test(''), false);
        test.equal(this.cfreader.regex.is_float.test('45'), false);
        test.done();
    },
    'is_truth': function (test) {
        test.expect(6);
        test.equal(this.cfreader.regex.is_truth.test('no'), false);
        test.equal(this.cfreader.regex.is_truth.test('nope'), false);
        test.equal(this.cfreader.regex.is_truth.test('nuh uh'), false);
        test.equal(this.cfreader.regex.is_truth.test('yes'), true);
        test.equal(this.cfreader.regex.is_truth.test('true'), true);
        test.equal(this.cfreader.regex.is_truth.test(true), true);
        test.done();
    },
    'is_array': function (test) {
        test.expect(3);
        test.equal(this.cfreader.regex.is_array.test('foo=bar'), false);
        test.equal(this.cfreader.regex.is_array.test('foo'), false);
        test.equal(this.cfreader.regex.is_array.test('foo[]'), true);
        test.done();
    },
}

exports.bad_config = {
    setUp: _setUp,
    'bad.yaml returns empty' : function (test) {
        test.expect(1);
        test.deepEqual(
            this.cfreader.load_config('test/config/bad.yaml'),
            {}
        );
        test.done();
    },
}

exports.overrides = {
    setUp: _setUp,
    'missing json loads yaml instead' : function (test) {
        test.expect(1);
        test.deepEqual(
            this.cfreader.load_config('test/config/override.json'),
            { has: { value: true } });
        test.done();
    },
}

exports.get_path_to_config_dir = {
    setUp: _setUp,
    'Haraka runtime (env.HARAKA=*)' : function (test) {
        test.expect(1);
        process.env.HARAKA = '/etc/';
        this.cfreader.get_path_to_config_dir();
        test.ok(/etc.config$/.test(this.cfreader.config_path), this.cfreader.config_path);
        delete process.env.HARAKA;
        test.done();
    },
    'NODE_ENV=test' : function (test) {
        test.expect(1);
        process.env.NODE_ENV === 'test';
        this.cfreader.get_path_to_config_dir();
        test.ok(/haraka-config.test.config$/.test(this.cfreader.config_path), this.cfreader.config_path);
        delete process.env.NODE_ENV;
        test.done();
    },
    'no $ENV defaults to ./config (if present) or ./' : function (test) {
        test.expect(1);
        delete process.env.HARAKA;
        delete process.env.NODE_ENV;
        this.cfreader.get_path_to_config_dir();
        test.ok(/haraka-config$/.test(this.cfreader.config_path), this.cfreader.config_path);
        test.done();
    },
}
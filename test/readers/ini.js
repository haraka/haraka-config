
const assert = require('assert')

const regex  = require('../../configfile').regex

beforeEach(function (done) {
    this.ini = require('../../readers/ini');
    this.opts = {
        booleans: [ 'main.bool_true', 'main.bool_false' ]
    };
    done();
})

describe('ini', function () {

    it('requires', function (done) {
        assert.ok(this.ini);
        done()
    })

    it('has a load function', function (done) {
        assert.ok(typeof this.ini.load === 'function');
        done()
    })

    it('loads the test ini file', function (done) {
        const result = this.ini.load('test/config/test.ini',  {}, regex);
        // console.log(result);
        assert.deepEqual(result.main, {
            bool_true: 'true', bool_false: 'false',
            str_true: 'true', str_false: 'false'
        });
        done()
    })

    describe('test.ini', function () {
        it('no opts', function (done) {
            const r = this.ini.load('test/config/test.ini', {}, regex);
            assert.strictEqual(r.main.bool_true, 'true');
            assert.strictEqual(r.main.bool_false, 'false');
            assert.strictEqual(r.main.str_true, 'true');
            assert.strictEqual(r.main.str_false, 'false');
            done()
        })

        it('opts', function (done) {
            const r = this.ini.load('test/config/test.ini', this.opts, regex).main;
            assert.strictEqual(r.bool_true, true);
            assert.strictEqual(r.bool_false, false);
            assert.strictEqual(r.str_true, 'true');
            assert.strictEqual(r.str_false, 'false');
            done()
        })

        it('sect1, opts', function (done) {
            const r = this.ini.load('test/config/test.ini', {
                booleans: ['sect1.bool_true','sect1.bool_false']
            }, regex);
            assert.strictEqual(r.sect1.bool_true, true);
            assert.strictEqual(r.sect1.bool_false, false);
            assert.strictEqual(r.sect1.str_true, 'true');
            assert.strictEqual(r.sect1.str_false, 'false');
            done()
        })

        it('sect1, opts, w/defaults', function (done) {
            const r = this.ini.load('test/config/test.ini', {
                booleans: [
                    '+sect1.bool_true',
                    '-sect1.bool_false',
                    '+sect1.bool_true_default',
                    'sect1.-bool_false_default'
                ]
            }, regex);
            assert.strictEqual(r.sect1.bool_true, true);
            assert.strictEqual(r.sect1.bool_false, false);
            assert.strictEqual(r.sect1.str_true, 'true');
            assert.strictEqual(r.sect1.str_false, 'false');
            assert.strictEqual(r.sect1.bool_true_default, true);
            assert.strictEqual(r.sect1.bool_false_default, false);
            done()
        })

        it('wildcard boolean', function (done) {
            const r = this.ini.load('test/config/test.ini', {
                booleans: [ '+main.bool_true', '*.is_bool' ]
            }, regex);
            assert.strictEqual(r['*'], undefined);
            assert.strictEqual(r.main.bool_true, true);
            assert.strictEqual(r.main.is_bool, undefined);
            assert.strictEqual(r['foo.com'].is_bool, true);
            assert.strictEqual(r['bar.com'].is_bool, false);
            done()
        })
    })

    describe('non-exist.ini (empty)', function () {

        it('is template', function (done) {
            assert.deepEqual(this.ini.empty(), { main: { } } );
            done()
        })

        it('boolean', function (done) {
            assert.deepEqual(
                this.ini.empty({ booleans: ['reject']}),
                { main: { reject: false } }
            );
            done()
        })

        it('boolean true default', function (done) {
            assert.deepEqual(
                this.ini.empty({ booleans: ['+reject']}),
                { main: { reject: true } }
            );
            assert.deepEqual(
                this.ini.empty({ booleans: ['+main.reject']}),
                { main: { reject: true } }
            );
            assert.deepEqual(
                this.ini.empty({ booleans: ['main.+reject']}),
                { main: { reject: true } }
            );
            done()
        })

        it('boolean false default', function (done) {
            assert.deepEqual(
                this.ini.empty({ booleans: ['-reject']}),
                { main: { reject: false } }
            );
            assert.deepEqual(
                this.ini.empty({ booleans: ['-main.reject']}),
                { main: { reject: false } }
            );
            assert.deepEqual(
                this.ini.empty({ booleans: ['main.-reject']}),
                { main: { reject: false } }
            );
            done()
        })

        it('boolean false default, section', function (done) {
            assert.deepEqual(
                this.ini.empty({ booleans: ['-reject.boolf']}),
                { main: { }, reject: {boolf: false} }
            );
            assert.deepEqual(
                this.ini.empty({ booleans: ['+reject.boolt']}),
                { main: { }, reject: {boolt: true} }
            );
            done()
        })
    })

    describe('goobers.ini', function () {
        it('goobers.ini has invalid entry', function (done) {
            const result = this.ini.load('test/config/goobers.ini',  {}, regex);
            assert.deepEqual(result, { main: { } } );
            done()
        })
    })
})

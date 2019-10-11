
const assert = require('assert')

const regex = require('../../configfile').regex

beforeEach(function (done) {
    this.flat = require('../../readers/flat')
    done()
})

describe('flat', function () {

    it('module is required', function (done) {
        assert.ok(this.flat);
        done();
    })

    it('has a load function', function (done) {
        assert.ok(typeof this.flat.load === 'function');
        done();
    })

    it('loads the test flat file, as list', function (done) {
        const result = this.flat.load('test/config/test.flat', 'list', null, regex);
        assert.deepEqual(result, [ 'line1', 'line2', 'line3', 'line5' ]);
        done();
    })

    it('loads the test flat file, unspecified type', function (done) {
        const result = this.flat.load('test/config/test.flat', null, null, regex);
        assert.deepEqual(result, 'line1');
        done();
    })

    it('returns hostname for empty "me"', function (done) {
        const result = this.flat.load( 'test/config/me', null, null, regex);
        console.log(result);
        assert.ok(result);
        done();
    })
})

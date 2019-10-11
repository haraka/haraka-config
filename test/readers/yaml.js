
const assert = require('assert')

beforeEach(function (done) {
    this.yaml = require('../../readers/yaml');
    done();
})

describe('yaml', function () {

    it('module is required', function (done) {
        assert.ok(this.yaml);
        done();
    })

    it('has a load function', function (done) {
        assert.ok(typeof this.yaml.load === 'function');
        done();
    })

    it('loads the test yaml file', function (done) {
        const result = this.yaml.load('test/config/test.yaml');
        assert.strictEqual(result.main.bool_true, true);
        assert.equal(result.matt, 'waz here');
        assert.ok(result.array.length);
        assert.ok(result.objecty['has a property']);
        done();
    })
})

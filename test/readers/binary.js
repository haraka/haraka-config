
const assert = require('assert')
const fs     = require('fs')
const path   = require('path')

beforeEach(function (done) {
    this.bin = require('../../readers/binary')
    done()
})

describe('binary', function () {
    it('module is required', function (done) {
        assert.ok(this.bin)
        done()
    })

    it('has a load function', function (done) {
        assert.ok(typeof this.bin.load === 'function')
        done()
    })

    it('loads the test binary file', function (done) {
        const testBin = path.join('test','config','test.binary')
        const result = this.bin.load(testBin)
        assert.ok(Buffer.isBuffer(result))
        assert.equal(result.length, 120)
        assert.deepEqual(result, fs.readFileSync(testBin))
        done()
    })
})
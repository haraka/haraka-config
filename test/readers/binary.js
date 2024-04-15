const assert = require('assert')
const fs = require('fs')
const path = require('path')

beforeEach(function (done) {
  this.bin = require('../../lib/readers/binary')
  done()
})

describe('binary', function () {
  it('module is required', function () {
    assert.ok(this.bin)
  })

  it('has a load function', function () {
    assert.ok(typeof this.bin.load === 'function')
  })

  it('loads the test binary file', function () {
    const testBin = path.join('test', 'config', 'test.binary')
    const result = this.bin.load(testBin)
    assert.ok(Buffer.isBuffer(result))
    assert.equal(result.length, 120)
    assert.deepEqual(result, fs.readFileSync(testBin))
  })
})

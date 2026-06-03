const assert = require('node:assert/strict')
const { beforeEach, describe, it } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

beforeEach(function () {
  this.bin = require('../../lib/readers/binary')
})

describe('binary', function () {
  it('module is required', function () {
    assert.ok(this.bin)
  })

  it('has a load function', function () {
    assert.ok(typeof this.bin.load === 'function')
  })

  it('has a loadPromise function', function () {
    assert.ok(typeof this.bin.loadPromise === 'function')
  })

  it('loads the test binary file', function () {
    const testBin = path.join('test', 'config', 'test.binary')
    const result = this.bin.load(testBin)
    assert.ok(Buffer.isBuffer(result))
    assert.equal(result.length, 120)
    assert.deepEqual(result, fs.readFileSync(testBin))
  })

  it('loads the test binary file with a promise', async function () {
    const testBin = path.join('test', 'config', 'test.binary')
    const result = await this.bin.loadPromise(testBin)
    assert.equal(result.path, testBin)
    assert.ok(Buffer.isBuffer(result.data))
    assert.equal(result.data.length, 120)
    assert.deepEqual(result.data, fs.readFileSync(testBin))
  })
})

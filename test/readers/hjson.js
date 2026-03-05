const assert = require('node:assert')
const { beforeEach, describe, it } = require('node:test')
const path = require('node:path')

beforeEach(function () {
  this.hjson = require('../../lib/readers/hjson')
})

describe('hjson', function () {
  it('module is required', function () {
    assert.ok(this.hjson)
  })

  it('has a load function', function () {
    assert.ok(typeof this.hjson.load === 'function')
  })

  it('loads the test HJSON file', function () {
    const result = this.hjson.load(path.join('test', 'config', 'test.hjson'))
    // console.log(result)
    assert.equal(result.matt, 'waz here and also made comments')
    assert.ok(result.differentArray.length)
    assert.ok(result.object['has a property one'])
    assert.ok(result.object['has a property two'])
  })
})

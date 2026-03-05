const assert = require('node:assert')
const { beforeEach, describe, it } = require('node:test')

beforeEach(function () {
  this.yaml = require('../../lib/readers/yaml')
})

describe('yaml', function () {
  it('module is required', function () {
    assert.ok(this.yaml)
  })

  it('has a load function', function () {
    assert.ok(typeof this.yaml.load === 'function')
  })

  it('loads the test yaml file', function () {
    const result = this.yaml.load('test/config/test.yaml')
    assert.strictEqual(result.main.bool_true, true)
    assert.equal(result.matt, 'waz here')
    assert.ok(result.array.length)
    assert.ok(result.objecty['has a property'])
  })
})

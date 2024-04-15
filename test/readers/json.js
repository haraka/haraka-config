const assert = require('assert')

beforeEach(function (done) {
  this.json = require('../../lib/readers/json')
  done()
})

describe('json', function () {
  it('module is required', function () {
    assert.ok(this.json)
  })

  it('has a load function', function () {
    assert.ok(typeof this.json.load === 'function')
  })

  it('loads the test JSON file', function () {
    const result = this.json.load('test/config/test.json')
    // console.log(result);
    assert.equal(result.matt, 'waz here')
    assert.ok(result.array.length)
    assert.ok(result.objecty['has a property'])
  })
})

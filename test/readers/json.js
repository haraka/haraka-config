const assert = require('assert')

beforeEach(function (done) {
  this.json = require('../../readers/json')
  done()
})

describe('json', function () {
  it('module is required', function (done) {
    assert.ok(this.json)
    done()
  })

  it('has a load function', function (done) {
    assert.ok(typeof this.json.load === 'function')
    done()
  })

  it('loads the test JSON file', function (done) {
    const result = this.json.load('test/config/test.json')
    // console.log(result);
    assert.equal(result.matt, 'waz here')
    assert.ok(result.array.length)
    assert.ok(result.objecty['has a property'])
    done()
  })
})

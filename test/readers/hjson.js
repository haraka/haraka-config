const assert = require('assert')
const path = require('path')

beforeEach(function (done) {
  this.hjson = require('../../readers/hjson')
  done()
})

describe('hjson', function () {
  it('module is required', function (done) {
    assert.ok(this.hjson)
    done()
  })

  it('has a load function', function (done) {
    assert.ok(typeof this.hjson.load === 'function')
    done()
  })

  it('loads the test HJSON file', function (done) {
    const result = this.hjson.load(path.join('test', 'config', 'test.hjson'))
    // console.log(result)
    assert.equal(result.matt, 'waz here and also made comments')
    assert.ok(result.differentArray.length)
    assert.ok(result.object['has a property one'])
    assert.ok(result.object['has a property two'])
    done()
  })
})

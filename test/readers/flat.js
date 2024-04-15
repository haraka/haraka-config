const assert = require('assert')

beforeEach(function (done) {
  this.flat = require('../../lib/readers/flat')
  done()
})

describe('flat', function () {
  it('module is required', function () {
    assert.ok(this.flat)
  })

  it('has a load function', function () {
    assert.ok(typeof this.flat.load === 'function')
  })

  it('loads the test flat file, as list', function () {
    const result = this.flat.load('test/config/test.flat', 'list', null)
    assert.deepEqual(result, ['line1', 'line2', 'line3', 'line5'])
  })

  it('loads the test flat file, unspecified type', function () {
    const result = this.flat.load('test/config/test.flat', null, null)
    assert.deepEqual(result, 'line1')
  })

  it('returns hostname for empty "me"', function () {
    const result = this.flat.load('test/config/me', null, null)
    assert.ok(result)
  })
})

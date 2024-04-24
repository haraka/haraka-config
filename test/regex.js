const assert = require('node:assert')

const regex = require('../lib/regex')

describe('regex', function () {
  it('section', function () {
    assert.equal(regex.section.test('[foo]'), true)
    assert.equal(regex.section.test('bar'), false)
    assert.equal(regex.section.test('[bar'), false)
    assert.equal(regex.section.test('bar]'), false)
  })

  it('param', function () {
    assert.equal(regex.param.exec('foo=true')[1], 'foo')
    assert.equal(regex.param.exec(';foo=true'), undefined)
  })

  it('comment', function () {
    assert.equal(regex.comment.test('; true'), true)
    assert.equal(regex.comment.test('false'), false)
  })

  it('line', function () {
    assert.equal(regex.line.test(' boo '), true)
    assert.equal(regex.line.test('foo'), true)
  })

  it('blank', function () {
    assert.equal(regex.blank.test('foo'), false)
    assert.equal(regex.blank.test(' '), true)
  })

  it('is_integer', function () {
    assert.equal(regex.is_integer.test(1), true)
    assert.equal(regex.is_integer.test(''), false)
    assert.equal(regex.is_integer.test('a'), false)
  })

  it('is_float', function () {
    assert.equal(regex.is_float.test('1.0'), true)
    assert.equal(regex.is_float.test(''), false)
    assert.equal(regex.is_float.test('45'), false)
  })

  it('is_truth', function () {
    assert.equal(regex.is_truth.test('no'), false)
    assert.equal(regex.is_truth.test('nope'), false)
    assert.equal(regex.is_truth.test('nuh uh'), false)
    assert.equal(regex.is_truth.test('yes'), true)
    assert.equal(regex.is_truth.test('true'), true)
    assert.equal(regex.is_truth.test(true), true)
  })

  it('is_array', function () {
    assert.equal(regex.is_array.test('foo=bar'), false)
    assert.equal(regex.is_array.test('foo'), false)
    assert.equal(regex.is_array.test('foo[]'), true)
  })
})

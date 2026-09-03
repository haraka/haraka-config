const assert = require('node:assert/strict')
const { beforeEach, describe, it } = require('node:test')
const os = require('node:os')
const path = require('node:path')

beforeEach(function () {
  this.flat = require('../../lib/readers/flat')
})

describe('flat', function () {
  describe('load', function () {
    it('as list', function () {
      assert.deepEqual(this.flat.load('test/config/test.flat', 'list', null), ['line1', 'line2', 'line3', 'line5'])
    })

    it('as data', function () {
      assert.deepEqual(this.flat.load('test/config/test.data', 'data', null), ['line1', 'line2', 'line3', '', 'line5'])
    })

    it('unspecified type reads the first value', function () {
      assert.equal(this.flat.load('test/config/test.flat', null, null), 'line1')
    })

    it('returns the hostname for an empty "me"', function () {
      assert.deepEqual(this.flat.load('test/config/me', null, null), [os.hostname()])
    })
  })

  describe('parseValue', function () {
    const parse = (flat, type, data, options = null, name = '/etc/haraka/config/x') =>
      flat.parseValue(name, type, options, data)

    describe('data', function () {
      const cases = [
        ['a\nb', ['a', 'b']],
        ['a\nb\n', ['a', 'b']],
        ['a\n\nb\n\n', ['a', '', 'b', '']],
        ['a\r\nb\r\n', ['a', 'b']],
        ['a\rb', ['a', 'b']],
        ['', []],
        ['\n', ['']],
        ['# kept\n ; kept \n', ['# kept', ' ; kept ']],
      ]
      for (const [data, expected] of cases) {
        it(`${JSON.stringify(data)} -> ${JSON.stringify(expected)}`, function () {
          assert.deepEqual(parse(this.flat, 'data', data), expected)
        })
      }
    })

    describe('list', function () {
      it('trims, and skips blanks and comments', function () {
        assert.deepEqual(parse(this.flat, 'list', '  a \n\n# c\n ; d\nb\n'), ['a', 'b'])
      })

      it('accepts any line break', function () {
        assert.deepEqual(parse(this.flat, 'list', 'a\r\nb\rc\nd'), ['a', 'b', 'c', 'd'])
      })

      it('is empty for an empty file', function () {
        assert.deepEqual(parse(this.flat, 'list', ''), [])
        assert.deepEqual(parse(this.flat, 'list', '# comments only\n'), [])
      })

      it('an empty "me" is this host, detected by basename', function () {
        assert.deepEqual(parse(this.flat, 'list', '\n', null, '/etc/haraka/config/me'), [os.hostname()])
        assert.deepEqual(parse(this.flat, 'list', '', null, path.join('C:', 'haraka', 'config', 'me')), [os.hostname()])
        assert.deepEqual(parse(this.flat, 'list', '', null, 'me'), [os.hostname()])
        assert.deepEqual(parse(this.flat, 'list', '', null, '/etc/haraka/config/theme'), [])
      })

      it('a populated "me" is read as written', function () {
        assert.deepEqual(parse(this.flat, 'list', 'mx.example.com\n', null, '/etc/haraka/config/me'), [
          'mx.example.com',
        ])
      })
    })

    describe('value', function () {
      it('is the first non-comment line', function () {
        assert.equal(parse(this.flat, 'value', '# c\n\n a \nb'), 'a')
      })

      it('is coerced to a number when it looks like one', function () {
        assert.equal(parse(this.flat, 'value', '25\n'), 25)
        assert.equal(parse(this.flat, 'value', '-3'), -3)
        assert.equal(parse(this.flat, 'value', '2.5'), 2.5)
        assert.equal(parse(this.flat, 'value', '2.5.1'), '2.5.1')
      })

      it('is coerced to a boolean only when declared', function () {
        assert.equal(parse(this.flat, 'value', 'true'), 'true')
        assert.equal(parse(this.flat, 'value', 'true', { booleans: ['true'] }), true)
        assert.equal(parse(this.flat, 'value', 'no', { booleans: ['no'] }), false)
        assert.equal(parse(this.flat, 'value', 'true', { booleans: 'true' }), 'true')
      })

      it('is null for an empty file', function () {
        assert.equal(parse(this.flat, 'value', ''), null)
        assert.equal(parse(this.flat, 'value', '; nothing\n'), null)
      })

      it('an empty "me" is this host', function () {
        assert.deepEqual(parse(this.flat, 'value', '', null, '/etc/haraka/config/me'), [os.hostname()])
      })

      it('an unknown type is read as a value', function () {
        assert.equal(parse(this.flat, undefined, 'a\nb'), 'a')
        assert.equal(parse(this.flat, '', 'a\nb'), 'a')
      })
    })
  })

  describe('empty', function () {
    it('is null for a value and [] otherwise', function () {
      assert.equal(this.flat.empty(null, 'value'), null)
      assert.deepEqual(this.flat.empty(null, 'list'), [])
      assert.deepEqual(this.flat.empty(null, 'data'), [])
      assert.deepEqual(this.flat.empty(), [])
    })
  })
})

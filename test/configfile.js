'use strict'

const assert = require('assert')

function _setUp(done) {
  process.env.NODE_ENV === 'test'
  this.cfreader = require('../configfile')
  this.opts = { booleans: ['main.bool_true', 'main.bool_false'] }
  done()
}

describe('configfile', function () {
  beforeEach(_setUp)

  describe('load_config', function () {
    describe('non-exist.ini', function () {
      it('empty', function () {
        assert.deepEqual(this.cfreader.load_config('non-exist.ini', 'ini'), {
          main: {},
        })
      })

      it('boolean', function () {
        assert.deepEqual(
          this.cfreader.load_config('non-exist.ini', 'ini', {
            booleans: ['reject'],
          }),
          { main: { reject: false } },
        )
      })

      it('boolean true default', function () {
        assert.deepEqual(
          this.cfreader.load_config('non-exist.ini', 'ini', {
            booleans: ['+reject'],
          }),
          { main: { reject: true } },
        )
        assert.deepEqual(
          this.cfreader.load_config('non-exist.ini', 'ini', {
            booleans: ['+main.reject'],
          }),
          { main: { reject: true } },
        )
        assert.deepEqual(
          this.cfreader.load_config('non-exist.ini', 'ini', {
            booleans: ['main.+reject'],
          }),
          { main: { reject: true } },
        )
      })

      it('boolean false default', function () {
        assert.deepEqual(
          this.cfreader.load_config('non-exist.ini', 'ini', {
            booleans: ['-reject'],
          }),
          { main: { reject: false } },
        )
        assert.deepEqual(
          this.cfreader.load_config('non-exist.ini', 'ini', {
            booleans: ['-main.reject'],
          }),
          { main: { reject: false } },
        )
        assert.deepEqual(
          this.cfreader.load_config('non-exist.ini', 'ini', {
            booleans: ['main.-reject'],
          }),
          { main: { reject: false } },
        )
      })

      it('boolean false default, section', function () {
        assert.deepEqual(
          this.cfreader.load_config('non-exist.ini', 'ini', {
            booleans: ['-reject.boolf'],
          }),
          { main: {}, reject: { boolf: false } },
        )
        assert.deepEqual(
          this.cfreader.load_config('non-exist.ini', 'ini', {
            booleans: ['+reject.boolt'],
          }),
          { main: {}, reject: { boolt: true } },
        )
      })
    })

    describe('test.ini', function () {
      it('no opts', function () {
        const r = this.cfreader.load_config('test/config/test.ini', 'ini')
        assert.strictEqual(r.main.bool_true, 'true')
        assert.strictEqual(r.main.bool_false, 'false')
        assert.strictEqual(r.main.str_true, 'true')
        assert.strictEqual(r.main.str_false, 'false')
      })

      it('opts', function () {
        const r = this.cfreader.load_config(
          'test/config/test.ini',
          'ini',
          this.opts,
        )
        assert.strictEqual(r.main.bool_true, true)
        assert.strictEqual(r.main.bool_false, false)
        assert.strictEqual(r.main.str_true, 'true')
        assert.strictEqual(r.main.str_false, 'false')
      })

      it('sect1, opts', function () {
        const r = this.cfreader.load_config('test/config/test.ini', 'ini', {
          booleans: ['sect1.bool_true', 'sect1.bool_false'],
        })
        assert.strictEqual(r.sect1.bool_true, true)
        assert.strictEqual(r.sect1.bool_false, false)
        assert.strictEqual(r.sect1.str_true, 'true')
        assert.strictEqual(r.sect1.str_false, 'false')
      })

      it('sect1, opts, w/defaults', function () {
        const r = this.cfreader.load_config('test/config/test.ini', 'ini', {
          booleans: [
            '+sect1.bool_true',
            '-sect1.bool_false',
            '+sect1.bool_true_default',
            'sect1.-bool_false_default',
          ],
        })
        assert.strictEqual(r.sect1.bool_true, true)
        assert.strictEqual(r.sect1.bool_false, false)
        assert.strictEqual(r.sect1.str_true, 'true')
        assert.strictEqual(r.sect1.str_false, 'false')
        assert.strictEqual(r.sect1.bool_true_default, true)
        assert.strictEqual(r.sect1.bool_false_default, false)
      })

      it('funnychars, /', function () {
        const r = this.cfreader.load_config('test/config/test.ini')
        assert.strictEqual(r.funnychars['results.auth/auth_base.fail'], 'fun')
      })

      it('funnychars, _', function () {
        const r = this.cfreader.load_config('test/config/test.ini')
        assert.strictEqual(r.funnychars['results.auth/auth_base.fail'], 'fun')
      })

      it('ipv6 addr, :', function () {
        const r = this.cfreader.load_config('test/config/test.ini')
        assert.ok('2605:ae00:329::2' in r.has_ipv6)
      })

      it('empty value', function () {
        const r = this.cfreader.load_config('test/config/test.ini')
        assert.deepEqual(
          { first: undefined, second: undefined },
          r.empty_values,
        )
      })

      it('array', function () {
        const r = this.cfreader.load_config('test/config/test.ini')
        assert.deepEqual(
          ['first_host', 'second_host', 'third_host'],
          r.array_test.hostlist,
        )
        assert.deepEqual([123, 456, 789], r.array_test.intlist)
      })
    })
  })

  describe('get_filetype_reader', function () {
    it('binary', function () {
      const reader = this.cfreader.get_filetype_reader('binary')
      assert.equal(typeof reader.load, 'function')
      assert.equal(typeof reader.empty, 'function')
    })

    it('flat', function () {
      const reader = this.cfreader.get_filetype_reader('flat')
      assert.equal(typeof reader.load, 'function')
      assert.equal(typeof reader.empty, 'function')
    })

    it('hjson', function () {
      const reader = this.cfreader.get_filetype_reader('hjson')
      assert.equal(typeof reader.load, 'function')
      assert.equal(typeof reader.empty, 'function')
    })

    it('json', function () {
      const reader = this.cfreader.get_filetype_reader('json')
      assert.equal(typeof reader.load, 'function')
      assert.equal(typeof reader.empty, 'function')
    })

    it('ini', function () {
      const reader = this.cfreader.get_filetype_reader('ini')
      assert.equal(typeof reader.load, 'function')
      assert.equal(typeof reader.empty, 'function')
    })

    it('yaml', function () {
      const reader = this.cfreader.get_filetype_reader('yaml')
      assert.equal(typeof reader.load, 'function')
      assert.equal(typeof reader.empty, 'function')
    })

    it('value', function () {
      const reader = this.cfreader.get_filetype_reader('value')
      assert.equal(typeof reader.load, 'function')
      assert.equal(typeof reader.empty, 'function')
    })

    it('list', function () {
      const reader = this.cfreader.get_filetype_reader('list')
      assert.equal(typeof reader.load, 'function')
      assert.equal(typeof reader.empty, 'function')
    })

    it('data', function () {
      const reader = this.cfreader.get_filetype_reader('data')
      assert.equal(typeof reader.load, 'function')
      assert.equal(typeof reader.empty, 'function')
    })
  })

  describe('empty', function () {
    it('empty object for HJSON files', function () {
      const result = this.cfreader.load_config('test/config/non-existent.hjson')
      assert.deepEqual(result, {})
    })

    it('empty object for JSON files', function () {
      const result = this.cfreader.load_config('test/config/non-existent.json')
      assert.deepEqual(result, {})
    })

    it('empty object for YAML files', function () {
      const result = this.cfreader.load_config('test/config/non-existent.yaml')
      assert.deepEqual(result, {})
    })

    it('null for binary file', function () {
      const result = this.cfreader.load_config(
        'test/config/non-existent.bin',
        'binary',
      )
      assert.equal(result, null)
    })

    it('null for flat file', function () {
      const result = this.cfreader.load_config('test/config/non-existent.flat')
      assert.deepEqual(result, null)
    })

    it('null for value file', function () {
      const result = this.cfreader.load_config('test/config/non-existent.value')
      assert.deepEqual(result, null)
    })

    it('empty array for list file', function () {
      const result = this.cfreader.load_config('test/config/non-existent.list')
      assert.deepEqual(result, [])
    })

    it('template ini for INI file', function () {
      const result = this.cfreader.load_config('test/config/non-existent.ini')
      assert.deepEqual(result, { main: {} })
    })
  })

  describe('get_cache_key', function () {
    it('no options is the name', function () {
      assert.equal(this.cfreader.get_cache_key('test'), 'test')
    })

    it('one option is name + serialized opts', function () {
      assert.equal(
        this.cfreader.get_cache_key('test', { foo: 'bar' }),
        'test{"foo":"bar"}',
      )
    })

    it('two options are returned predictably', function () {
      assert.equal(
        this.cfreader.get_cache_key('test', { opt1: 'foo', opt2: 'bar' }),
        'test{"opt1":"foo","opt2":"bar"}',
      )
    })
  })

  describe('regex', function () {
    it('section', function () {
      assert.equal(this.cfreader.regex.section.test('[foo]'), true)
      assert.equal(this.cfreader.regex.section.test('bar'), false)
      assert.equal(this.cfreader.regex.section.test('[bar'), false)
      assert.equal(this.cfreader.regex.section.test('bar]'), false)
    })

    it('param', function () {
      assert.equal(this.cfreader.regex.param.exec('foo=true')[1], 'foo')
      assert.equal(this.cfreader.regex.param.exec(';foo=true'), undefined)
    })

    it('comment', function () {
      assert.equal(this.cfreader.regex.comment.test('; true'), true)
      assert.equal(this.cfreader.regex.comment.test('false'), false)
    })

    it('line', function () {
      assert.equal(this.cfreader.regex.line.test(' boo '), true)
      assert.equal(this.cfreader.regex.line.test('foo'), true)
    })

    it('blank', function () {
      assert.equal(this.cfreader.regex.blank.test('foo'), false)
      assert.equal(this.cfreader.regex.blank.test(' '), true)
    })

    // 'continuation', function () {
    // done()
    // })

    it('is_integer', function () {
      assert.equal(this.cfreader.regex.is_integer.test(1), true)
      assert.equal(this.cfreader.regex.is_integer.test(''), false)
      assert.equal(this.cfreader.regex.is_integer.test('a'), false)
    })

    it('is_float', function () {
      assert.equal(this.cfreader.regex.is_float.test('1.0'), true)
      assert.equal(this.cfreader.regex.is_float.test(''), false)
      assert.equal(this.cfreader.regex.is_float.test('45'), false)
    })

    it('is_truth', function () {
      assert.equal(this.cfreader.regex.is_truth.test('no'), false)
      assert.equal(this.cfreader.regex.is_truth.test('nope'), false)
      assert.equal(this.cfreader.regex.is_truth.test('nuh uh'), false)
      assert.equal(this.cfreader.regex.is_truth.test('yes'), true)
      assert.equal(this.cfreader.regex.is_truth.test('true'), true)
      assert.equal(this.cfreader.regex.is_truth.test(true), true)
    })

    it('is_array', function () {
      assert.equal(this.cfreader.regex.is_array.test('foo=bar'), false)
      assert.equal(this.cfreader.regex.is_array.test('foo'), false)
      assert.equal(this.cfreader.regex.is_array.test('foo[]'), true)
    })
  })

  describe('bad_config', function () {
    it('bad.yaml returns empty', function () {
      assert.deepEqual(this.cfreader.load_config('test/config/bad.yaml'), {})
    })
  })

  describe('overrides', function () {
    it('missing hjson loads yaml instead', function () {
      assert.deepEqual(
        this.cfreader.load_config('test/config/override2.hjson'),
        { hasDifferent: { value: false } },
      )
    })

    it('missing json loads yaml instead', function () {
      assert.deepEqual(this.cfreader.load_config('test/config/override.json'), {
        has: { value: true },
      })
    })
  })

  describe('get_path_to_config_dir', function () {
    it('Haraka runtime (env.HARAKA=*)', function () {
      process.env.HARAKA = '/etc/'
      this.cfreader.get_path_to_config_dir()
      assert.ok(
        /etc.config$/.test(this.cfreader.config_path),
        this.cfreader.config_path,
      )
      delete process.env.HARAKA
    })

    it('NODE_ENV=test', function () {
      process.env.NODE_ENV = 'test'
      this.cfreader.get_path_to_config_dir()
      assert.ok(
        /haraka-config.test.config$/.test(this.cfreader.config_path),
        this.cfreader.config_path,
      )
      delete process.env.NODE_ENV
    })

    it('no $ENV defaults to ./config (if present) or ./', function () {
      delete process.env.HARAKA
      delete process.env.NODE_ENV
      this.cfreader.get_path_to_config_dir()
      assert.ok(
        /haraka-config$/.test(this.cfreader.config_path),
        this.cfreader.config_path,
      )
    })
  })
})

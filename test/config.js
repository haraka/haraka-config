const assert = require('node:assert')
const { after, afterEach, beforeEach, describe, it } = require('node:test')
const fs = require('node:fs/promises')
const { realpathSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Windows: workers don't exit on .unref() alone.
after(() => {
  require('../lib/watch').closeAll()
})

function cb() {
  return false
}
const opts = { booleans: ['arg1'] }

function clearRequireCache() {
  // the tests are run in the same process, so process.env changes affect
  // other tests. Invalidate the require cache between tests
  delete require.cache[`${path.resolve(__dirname, '..', 'config')}.js`]
  delete require.cache[`${path.resolve(__dirname, '..', 'lib', 'reader')}.js`]
}

function testSetup() {
  process.env.NODE_ENV = 'test'
  process.env.HARAKA = ''
  process.env.WITHOUT_CONFIG_CACHE = '1'
  clearRequireCache()
  this.config = require('../config')
}

describe('config', function () {
  beforeEach(testSetup)

  it('new', function () {
    assert.equal(path.resolve('test', 'config'), this.config.root_path)
  })

  it('rejects an unknown type instead of guessing from the extension', function () {
    assert.throws(() => this.config.get('test.ini', 'bogus'), /unknown config type: bogus/)
  })

  it('module_config', function () {
    const c = this.config.module_config('foo', 'bar')
    assert.equal(c.root_path, path.join('foo', 'config'))
    assert.equal(c.overrides_path, path.join('bar', 'config'))
  })

  describe('config_path', function () {
    it('config_path process.env.HARAKA', function () {
      process.env.HARAKA = '/tmp'
      clearRequireCache()
      const config = require('../config')
      assert.equal(config.root_path, path.join('/tmp', 'config'))
    })

    it('config_path process.env.NODE_ENV', function () {
      process.env.HARAKA = ''
      process.env.NODE_ENV = 'not-test'
      clearRequireCache()
      const config = require('../config')
      assert.ok(/haraka-config$/.test(config.root_path))
    })
  })

  describe('arrange_args', function () {
    beforeEach(testSetup)

    it('name', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini']), ['test.ini', 'ini', undefined, undefined])
    })

    it('name, type', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', 'ini']), ['test.ini', 'ini', undefined, undefined])
    })

    it('name, callback', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', cb]), ['test.ini', 'ini', cb, undefined])
    })

    it('name, callback, options', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', cb, opts]), ['test.ini', 'ini', cb, opts])
    })

    it('name, options', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', opts]), ['test.ini', 'ini', undefined, opts])
    })

    it('name, type, callback', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', 'ini', cb]), ['test.ini', 'ini', cb, undefined])
    })

    it('name, type, options', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', 'ini', opts]), ['test.ini', 'ini', undefined, opts])
    })

    it('name, type, callback, options', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', 'ini', cb, opts]), ['test.ini', 'ini', cb, opts])
    })

    it('name, list type, callback, options', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', 'list', cb, opts]), ['test.ini', 'list', cb, opts])
    })

    it('name, binary type, callback, options', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', 'binary', cb, opts]), ['test.ini', 'binary', cb, opts])
    })

    it('name, value type, callback, options', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', 'value', cb, opts]), ['test.ini', 'value', cb, opts])
    })

    it('name, hjson type, callback, options', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', 'hjson', cb, opts]), ['test.ini', 'hjson', cb, opts])
    })

    // config.get('name', type, cb, options);
    it('name, json type, callback, options', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', 'json', cb, opts]), ['test.ini', 'json', cb, opts])
    })

    // config.get('name', type, cb, options);
    it('name, data type, callback, options', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', 'data', cb, opts]), ['test.ini', 'data', cb, opts])
    })
  })
})

const hjsonRes = {
  matt: 'waz here and also made comments',
  differentArray: ['has element #1', 'has element #2'],
  object: {
    'has a property one': 'with a value A',
    'has a property two': 'with a value B',
  },
}

const jsonRes = {
  matt: 'waz here',
  array: ['has an element'],
  objecty: { 'has a property': 'with a value' },
}

const yamlRes = {
  main: {
    bool_true: true,
    bool_false: false,
    str_true: true,
    str_false: false,
  },
  sect1: {
    bool_true: true,
    bool_false: false,
    str_true: true,
    str_false: false,
  },
  whitespace: {
    str_no_trail: true,
    str_trail: true,
  },
  matt: 'waz here',
  array: ['has an element'],
  objecty: {
    'has a property': 'with a value',
  },
}

function _test_get(name, type, callback, options, expected) {
  const config = require('../config')
  const cfg = config.get(name, type, callback, options)
  assert.deepEqual(cfg, expected)
}

function _test_int(name, default_value, expected) {
  const config = require('../config')
  const result = config.getInt(name, default_value)
  if (result) assert.equal(typeof result, 'number')
  assert.deepEqual(result, expected)
}

describe('get', function () {
  beforeEach(testSetup)

  // config.get('name');
  // Use a name with no backing fixture *and* no `<name>.js` shadow: a
  // missing file now falls back to <name>.js (issue #39), so 'test' would
  // resolve to test/config/test.js.
  it('non-existing returns null', function () {
    _test_get('nonexist', null, null, null, null)
  })

  it('non-existing returns null (cached)', function () {
    process.env.WITHOUT_CONFIG_CACHE = ''
    const cfg = this.config.get('nonexist', null, null)
    assert.deepEqual(cfg, null)
  })

  it('test.ini, no opts', function () {
    _test_get('test.ini', null, null, null, {
      main: {
        bool_true: 'true',
        bool_false: 'false',
        str_true: 'true',
        str_false: 'false',
      },
      sect1: {
        bool_true: 'true',
        bool_false: 'false',
        str_true: 'true',
        str_false: 'false',
      },
      whitespace: { str_no_trail: 'true', str_trail: 'true' },
      funnychars: { 'results.auth/auth_base.fail': 'fun' },
      empty_values: { first: undefined, second: undefined },
      has_ipv6: { '2605:ae00:329::2': undefined },
      array_test: {
        hostlist: ['first_host', 'second_host', 'third_host'],
        intlist: ['123', '456', '789'],
      },
      'foo.com': { is_bool: 'true' },
      'bar.com': { is_bool: 'false' },
      has_nums: { integer: 454, float: 10.5 },
    })
  })

  it('test.ini, opts', function () {
    _test_get(
      'test.ini',
      'ini',
      null,
      {
        booleans: ['*.bool_true', '*.bool_false'],
      },
      {
        main: {
          bool_true: true,
          bool_false: false,
          str_true: 'true',
          str_false: 'false',
        },
        sect1: {
          bool_true: true,
          bool_false: false,
          str_true: 'true',
          str_false: 'false',
        },
        whitespace: { str_no_trail: 'true', str_trail: 'true' },
        funnychars: { 'results.auth/auth_base.fail': 'fun' },
        empty_values: { first: undefined, second: undefined },
        has_ipv6: { '2605:ae00:329::2': undefined },
        array_test: {
          hostlist: ['first_host', 'second_host', 'third_host'],
          intlist: ['123', '456', '789'],
        },
        'foo.com': { is_bool: 'true' },
        'bar.com': { is_bool: 'false' },
        has_nums: { integer: 454, float: 10.5 },
      },
    )
  })

  it('test.txt', function () {
    _test_get('test.txt', null, null, null, null)
  })

  it('test.int', function () {
    _test_get('test.int', null, null, null, 6)
  })

  it('test.flat, type=', function () {
    _test_get('test.flat', null, null, null, 'line1')
  })

  it('test.flat, type=value', function () {
    _test_get('test.value', 'value', null, null, 'line1')
  })

  it('test.flat, type=list', function () {
    _test_get('test.list', 'list', null, null, ['line1', 'line2', 'line3', 'line5'])
  })

  it('test.flat, type=data', function () {
    _test_get('test.data', 'data', null, null, ['line1', 'line2', 'line3', '', 'line5'])
  })

  it('test.hjson, type=', function () {
    _test_get('test.hjson', null, null, null, hjsonRes)
  })

  it('test.hjson, type=hjson', function () {
    _test_get('test.hjson', 'hjson', null, null, hjsonRes)
  })

  it('test.json, type=', function () {
    _test_get('test.json', null, null, null, jsonRes)
  })

  it('test.json, type=json', function () {
    _test_get('test.json', 'json', null, null, jsonRes)
  })

  it('test.yaml, type=', function () {
    _test_get('test.yaml', null, null, null, yamlRes)
  })

  it('test.yaml, type=yaml', function () {
    _test_get('test.yaml', 'yaml', null, null, yamlRes)
  })

  it('missing2.yaml, asked for hjson', function () {
    _test_get('missing2.hjson', 'hjson', null, null, {
      matt: 'waz here - hjson type',
    })
  })

  it('missing.yaml, asked for json', function () {
    _test_get('missing.json', 'json', null, null, { matt: 'waz here' })
  })

  it('test.bin, type=binary', function () {
    const res = this.config.get('test.binary', 'binary')
    assert.equal(res.length, 120)
    assert.ok(Buffer.isBuffer(res))
  })

  it('fully qualified path: /etc/services', function () {
    let res
    if (/^win/.test(process.platform)) {
      res = this.config.get('c:\\windows\\win.ini', 'list')
    } else {
      res = this.config.get('/etc/services', 'list')
    }
    assert.ok(res.length)
  })
})

describe('merged', function () {
  beforeEach(testSetup)

  it('before_merge', function () {
    const lc = this.config.module_config(path.join('test', 'default'))
    assert.deepEqual(lc.get('test.ini'), {
      main: {},
      defaults: { one: 'one', two: 'two' },
    })
  })

  it('after_merge', function () {
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    assert.deepEqual(lc.get('test.ini'), {
      main: {},
      defaults: { one: 'three', two: 'four' },
    })
  })

  it('flat overridden', function () {
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    assert.equal(lc.get('test.flat'), 'flatoverrode')
  })

  it('flat list default preserved when the override file is missing', function () {
    // a missing list override reads as [] and must not wipe the default list
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    assert.deepEqual(lc.get('test.list', 'list'), ['alpha', 'beta', 'gamma'])
  })

  it('null default value overridden with object does not throw', function () {
    // regression: typeof null === 'object' caused merge_struct to recurse into null,
    // then `key in null` threw TypeError (GitHub #85)
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    assert.doesNotThrow(() => lc.get('plugins.yaml'))
  })

  it('null default value replaced by override object', function () {
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    assert.deepEqual(lc.get('plugins.yaml'), { plugins: { rspamd: { enabled: true } } })
  })

  it('getInt honors the overrides layer, like get()', function () {
    // getInt() used to read root_path directly, so it silently disagreed
    // with get() on the very same file whenever an override existed
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    assert.equal(lc.get('test.int', 'value'), 587)
    assert.equal(lc.getInt('test.int'), 587)
  })

  it('getInt falls back to the default layer when no override exists', function () {
    const lc = this.config.module_config(path.join('test', 'default'))
    assert.equal(lc.getInt('test.int'), 25)
  })

  it('an override file that is not a mapping leaves the defaults alone', function () {
    // an empty or comment-only yaml file parses to null
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    assert.deepEqual(lc.get('nullover.yaml'), { a: 1 })
  })

  it('a default file that is not a mapping is replaced by its override', function () {
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    assert.deepEqual(lc.get('nulldef.yaml'), { b: 2 })
  })

  it('a yaml alias reused under two override keys merges into each', function () {
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    const r = lc.get('alias-over.yaml')
    assert.deepEqual(r, { a: { v: 1, w: 1 }, b: { z: 2, v: 1 } })
    assert.notEqual(r.a, r.b)
  })

  it('an override reaches only the key it names, not every alias of that default', function () {
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    assert.deepEqual(lc.get('alias-def.yaml'), { a: { x: 1, z: 3 }, b: { x: 1 } })
  })

  it('a .js default that exports a function is replaced, not merged into', function () {
    const both = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    assert.deepEqual(both.get('fn.js'), { b: 2 })
    const only = this.config.module_config(path.join('test', 'default'))
    const fn = only.get('fn.js')
    assert.equal(typeof fn, 'function')
    assert.equal(fn.a, 1)
    assert.equal(fn.b, undefined, 'the cached default was not written to')
  })

  it('a sequence on either side replaces rather than merges', function () {
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    assert.deepEqual(lc.get('seq-both.yaml'), ['c'])
    assert.deepEqual(lc.get('seq-over.yaml'), ['c'])
    assert.deepEqual(lc.get('seq-def.yaml'), { x: 1 })
  })

  it('nested values of different shapes replace rather than merge', function () {
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    assert.deepEqual(lc.get('shapes.yaml'), { list: ['c'], obj: [1], arr: { k: 1 }, keep: { a: 1, b: 2 } })
  })

  it('a root-level yaml alias still points at the returned object after a merge', function () {
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    const r = lc.get('root-alias.yaml')
    assert.equal(r.self, r)
    assert.equal(r.name, 'a')
    assert.equal(r.z, 1)
  })

  it('a cycle that exists only in the defaults survives a partial override', function () {
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    const r = lc.get('cycle-partial.yaml')
    assert.equal(r.loop.name, 'override')
    assert.equal(r.loop.self, r.loop)
  })

  it("a missing override ini does not impose declared boolean defaults on the default's values", function () {
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    assert.equal(lc.get('bool-default.ini', { booleans: ['+main.reject'] }).main.reject, false)
    assert.equal(
      lc.get('bool-default.ini', { booleans: ['+main.other'] }).main.other,
      true,
      'an undefined key still gets its default',
    )
  })

  it('cyclic default and override merge without overflowing', function () {
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    const r = lc.get('cyclic.yaml')
    assert.equal(r.loop.name, 'override')
    assert.equal(r.loop.keep, 1)
    assert.equal(r.loop.self, r.loop)
  })

  it('merged ini keeps its null prototypes', function () {
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    const r = lc.get('test.ini')
    assert.strictEqual(Object.getPrototypeOf(r), null)
    assert.strictEqual(Object.getPrototypeOf(r.main), null)
    assert.strictEqual(Object.getPrototypeOf(r.defaults), null)
    assert.strictEqual(r.main.constructor, undefined)
  })

  it('an absolute name is read once, not merged with itself', function () {
    const reader = require('../lib/reader')
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    const abs = path.resolve('test', 'default', 'config', 'test.list')
    const orig = reader.read_config
    const seen = []
    reader.read_config = (...args) => {
      seen.push(args[0])
      return orig.apply(reader, args)
    }
    try {
      assert.deepEqual(lc.get(abs, 'list'), ['alpha', 'beta', 'gamma'])
    } finally {
      reader.read_config = orig
    }
    assert.deepEqual(seen, [abs])
  })

  it('null override value preserves default object', function () {
    // a bare YAML key (null) should not wipe out a default object — deep key-by-key semantics
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    assert.deepEqual(lc.get('tls.yaml'), { tls: { key: '/etc/ssl/key.pem', cert: '/etc/ssl/cert.pem' } })
  })
})

describe('copies', function () {
  beforeEach(function () {
    testSetup.call(this)
    // the cache must be live, or every get() would re-read the file anyway
    process.env.WITHOUT_CONFIG_CACHE = ''
  })

  it('an ini object: mutations do not reach the next get()', function () {
    const a = this.config.get('test.ini')
    a.main.injected = true
    assert.equal(this.config.get('test.ini').main.injected, undefined)
  })

  it('keeps the null prototype of ini sections', function () {
    const r = this.config.get('test.ini')
    assert.strictEqual(Object.getPrototypeOf(r), null)
    assert.strictEqual(Object.getPrototypeOf(r.main), null)
  })

  it('a binary Buffer', function () {
    const a = this.config.get('test.binary', 'binary')
    assert.notStrictEqual(a, this.config.get('test.binary', 'binary'))
    a[0] ^= 0xff
    assert.notEqual(this.config.get('test.binary', 'binary')[0], a[0])
  })

  it('a list', function () {
    const lc = this.config.module_config(path.join('test', 'default'))
    lc.get('test.list', 'list').push('delta')
    assert.deepEqual(lc.get('test.list', 'list'), ['alpha', 'beta', 'gamma'])
  })

  it('an override-only object inside a merged result', function () {
    // merge_struct used to graft override sub-objects in by reference
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    lc.get('plugins.yaml').plugins.rspamd.enabled = false
    assert.equal(lc.get('plugins.yaml').plugins.rspamd.enabled, true)
  })

  it('a yaml alias cycle copies without overflowing, and stays a cycle', function () {
    const r = this.config.get('cyclic.yaml')
    assert.equal(r.loop.self, r.loop)
    assert.equal(r.a, r.a2, 'a shared alias stays one object in the copy')
    r.loop.name = 'mutated'
    assert.equal(this.config.get('cyclic.yaml').loop.name, 'loop')
  })

  it('a file read under a second type is re-read, not served as the first', function () {
    // the cache slot ignored type, so getInt() on an ini got the ini object and threw
    assert.equal(typeof this.config.get('test.ini'), 'object')
    assert.ok(Number.isNaN(this.config.getInt('test.ini')))
    assert.deepEqual(this.config.get('test.list', 'list'), ['line1', 'line2', 'line3', 'line5'])
    assert.equal(this.config.get('test.list', 'value'), 'line1')
    assert.deepEqual(this.config.get('test.list', 'list'), ['line1', 'line2', 'line3', 'line5'])
  })

  it('a parse failure under a second type does not fall back to the first shape', function () {
    assert.equal(typeof this.config.get('test.ini').main, 'object')
    assert.deepEqual(this.config.get('test.ini', 'json'), {}, 'an ini file is not json; the json empty value')
    assert.deepEqual(this.config.get('test.ini', 'json'), {}, 'and stays that way on the next read')
    assert.equal(typeof this.config.get('test.ini').main, 'object', 'reading as ini again recovers')
  })

  it('re-reading a source under another type drops the !file overrides it injected', function () {
    this.config.get('ovr-source.json')
    assert.deepEqual(this.config.get('ovr-target.ini'), { main: { x: 1 } })
    this.config.get('ovr-source.json', 'value')
    assert.deepEqual(this.config.get('ovr-target.ini'), { main: {} })
  })

  it('drops !file overrides when the source is re-typed under different options', function () {
    this.config.get('ovr-source.json', { booleans: ['main.a'] })
    assert.deepEqual(this.config.get('ovr-target.ini'), { main: { x: 1 } })
    this.config.get('ovr-source.json', 'value', { booleans: ['b'] })
    assert.deepEqual(this.config.get('ovr-target.ini'), { main: {} })
  })

  it('drops !file overrides on re-type even without the cache', function () {
    process.env.WITHOUT_CONFIG_CACHE = '1'
    const reader = require('../lib/reader')
    const target = path.resolve('test', 'config', 'ovr-target.ini')
    this.config.get('ovr-source.json')
    assert.equal(reader._overrides[target], true)
    this.config.get('ovr-source.json', 'value')
    assert.equal(reader._overrides[target], undefined)
    assert.equal(reader._config_cache[target], undefined)
  })

  it('passes through what a .js config exports that is not plain data', function () {
    const r = this.config.get('exotic.js')
    assert.equal(r.when.getTime(), 0)
    assert.equal(r.m.get(1), 2)
    assert.ok(r.re.test('x'))
    r.plain.n = 2
    assert.equal(this.config.get('exotic.js').plain.n, 1, 'plain parts are still copies')
  })

  it("drops an own '__proto__' key while copying", function () {
    const r = this.config.get('proto.js')
    assert.equal(r.a.polluted, undefined)
    assert.equal(r.polluted, undefined)
    assert.equal(Object.getPrototypeOf(r.a), Object.prototype)
  })

  it('coincident default and override dirs read each file once', function () {
    // the production singleton has root_path === overrides_path
    const reader = require('../lib/reader')
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'default'))
    const orig = reader.read_config
    const seen = []
    reader.read_config = (...args) => {
      seen.push(args[0])
      return orig.apply(reader, args)
    }
    try {
      assert.deepEqual(lc.get('test.ini'), { main: {}, defaults: { one: 'one', two: 'two' } })
    } finally {
      reader.read_config = orig
    }
    assert.equal(seen.length, 1)
  })
})

describe('getInt', function () {
  beforeEach(testSetup)

  // config.get('name');
  it('empty filename is NaN', function () {
    const result = this.config.getInt()
    assert.equal(typeof result, 'number')
    assert.ok(isNaN(result))
  })

  it('empty/missing file contents is NaN', function () {
    const result = this.config.getInt('test-non-exist')
    assert.equal(typeof result, 'number')
    assert.ok(isNaN(result))
  })

  it('non-existing file returns default', function () {
    _test_int('test-non-exist', 5, 5)
  })

  it('test.int equals 6', function () {
    _test_int('test.int', undefined, 6)
  })

  it('test.int equals 6 (with default 7)', function () {
    _test_int('test.int', 7, 6)
  })
})

describe('getDir', function () {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    process.env.HARAKA = ''
    process.env.WITHOUT_CONFIG_CACHE = '1'
    clearRequireCache()
    this.config = require('../config')
  })

  it('loads all files in dir', async () => {
    const files = await this.config.getDir('dir', { type: 'binary' })
    assert.equal(files.length, 4)
    assert.equal(files[0].data, `contents1${os.EOL}`)
    assert.equal(files[2].data, `contents3${os.EOL}`)
  })

  it('errs on invalid dir', async () => {
    try {
      await this.config.getDir('dirInvalid', { type: 'binary' })
      assert.fail('expected error')
    } catch (err) {
      assert.equal(err.code, 'ENOENT')
    }
  })

  it('reloads when file in dir is touched', { timeout: 15000 }, async (t) => {
    // due to differences in fs.watch, this test is unreliable on macOS with Node < 24
    const nodeMajorVersion = parseInt(process.versions.node.split('.')[0])
    if (/darwin/.test(process.platform) && nodeMajorVersion < 24) return

    // a private copy of the fixture dir: test/reader.js lists the shared one concurrently.
    // realpath.native expands Windows 8.3 names (RUNNER~1), which libuv's fs.watch asserts on
    const tmpRoot = await fs.mkdtemp(path.join(realpathSync.native(os.tmpdir()), 'hc-getdir-'))
    await fs.cp(path.resolve('test', 'config', 'dir'), path.join(tmpRoot, 'config', 'dir'), { recursive: true })
    const cfg = this.config.module_config(tmpRoot)
    const tmpFile = path.join(tmpRoot, 'config', 'dir', '4.ext')

    try {
      await t.test('waits for watch event', async () => {
        return new Promise((resolve) => {
          let callCount = 0

          const getDir = async () => {
            try {
              const opts2 = { type: 'binary', watchCb: getDir }
              const files = await cfg.getDir('dir', opts2)
              callCount++
              if (callCount === 1) {
                assert.equal(files.length, 4)
                assert.equal(files[0].data, `contents1${os.EOL}`)
                assert.equal(files[2].data, `contents3${os.EOL}`)
                // a write that lands before the new FSEvents stream is live is never reported
                await new Promise((resolve) => setTimeout(resolve, 250))
                await fs.writeFile(tmpFile, 'contents4\n')
              } else if (callCount === 2) {
                assert.equal(files[3].data, 'contents4\n')
                await fs.unlink(tmpFile)
                resolve()
              } else {
                console.log('unexpected call count: ', callCount)
              }
            } catch (err) {
              console.error(err)
            }
          }
          getDir()
        })
      })
    } finally {
      // unlink fires fs.watch post-resolve; close the watcher so Windows can exit
      cfg.stop_watching('dir')
      await fs.rm(tmpRoot, { recursive: true, force: true })
    }
  })
})

describe('hjsonOverrides', function () {
  beforeEach(testSetup)

  it('no override for smtpgreeting', function () {
    assert.deepEqual(this.config.get('smtpgreeting', 'list'), [])
  })

  it('with smtpgreeting override', function () {
    process.env.WITHOUT_CONFIG_CACHE = ''
    this.config.get('main.hjson')
    assert.deepEqual(this.config.get('smtpgreeting', 'list'), [
      'this is line one for hjson',
      'this is line two for hjson',
    ])
  })
})

describe('jsonOverrides', function () {
  beforeEach(testSetup)

  it('no override for smtpgreeting', function () {
    assert.deepEqual(this.config.get('smtpgreeting', 'list'), [])
  })

  it('with smtpgreeting override', function () {
    process.env.WITHOUT_CONFIG_CACHE = ''
    this.config.get('main.json')
    assert.deepEqual(this.config.get('smtpgreeting', 'list'), ['this is line one', 'this is line two'])
  })
})

describe('path containment', function () {
  beforeEach(testSetup)

  it('rejects a relative name that escapes the config root', function () {
    assert.throws(() => this.config.get('../../../../../../etc/passwd', 'list'), /escapes the config directory/)
  })

  it('rejects a .. escape in getInt', function () {
    assert.throws(() => this.config.getInt('../../../../etc/passwd'), /escapes the config directory/)
  })

  it('rejects a .. escape in getDir', function () {
    assert.throws(() => this.config.getDir('../../../../etc'), /escapes the config directory/)
  })

  it('still allows an explicit absolute path', function () {
    let res
    if (/^win/.test(process.platform)) {
      res = this.config.get('c:\\windows\\win.ini', 'list')
    } else {
      res = this.config.get('/etc/services', 'list')
    }
    assert.ok(res.length)
  })

  it('still allows normal root-relative names', function () {
    assert.strictEqual(this.config.get('test.ini').main.str_true, 'true')
  })

  it('allows subdir-relative names within the root', function () {
    // test/config/test/plugin.ini exists in fixtures
    assert.ok(this.config.get(path.join('test', 'plugin.ini')))
  })
})

describe('stop_watching', function () {
  beforeEach(testSetup)

  it('stops both layers of a module config', function () {
    const cfg = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    cfg.get('test.int')
    const reader = require('../lib/reader')
    const layers = [path.resolve('test/default/config/test.int'), path.resolve('test/override/config/test.int')]
    assert.deepEqual(
      layers.map((p) => p in reader._read_args),
      [true, true],
    )

    cfg.stop_watching('test.int')

    assert.deepEqual(
      layers.map((p) => p in reader._read_args),
      [false, false],
    )
  })
})

describe('reload failure', function () {
  let tmpDir
  let reader
  let Watch
  let file
  let calls

  beforeEach(async function () {
    process.env.NODE_ENV = 'test'
    process.env.WITHOUT_CONFIG_CACHE = ''
    clearRequireCache()
    delete require.cache[`${path.resolve(__dirname, '..', 'lib', 'watch')}.js`]
    reader = require('../lib/reader')
    Watch = require('../lib/watch')
    tmpDir = await fs.mkdtemp(path.join(realpathSync.native(os.tmpdir()), 'hc-c1-'))
    file = path.join(tmpDir, 'a.json')
    await fs.writeFile(file, '{"k":"good"}')
    calls = []
  })

  afterEach(async function () {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('keeps prior config and signals the error, watcher survives', async function () {
    const args = { type: 'json', options: null, cb: (err) => calls.push(err) }
    // initial good load
    const first = reader.load_config(file, 'json', null)
    assert.strictEqual(first.k, 'good')
    assert.strictEqual(reader.last_load_error(file, 'json', null), undefined)

    // corrupt the file, then run the same path the watcher uses
    await fs.writeFile(file, '{ this is not json')
    Watch.reload(reader, file, args)
    const err = reader.last_load_error(file, 'json', null)
    assert.ok(err instanceof Error) // failure surfaced
    assert.strictEqual(reader.load_config(file, 'json', null).k, 'good') // prior retained
    assert.ok(calls[0] instanceof Error) // cb told about failure

    // operator fixes the file; the same (still-active) path reloads it
    await fs.writeFile(file, '{"k":"fixed"}')
    Watch.reload(reader, file, args)
    assert.strictEqual(reader.last_load_error(file, 'json', null), undefined)
    assert.strictEqual(reader.load_config(file, 'json', null).k, 'fixed')
    assert.strictEqual(calls[1], undefined) // success: cb called w/o error
  })
})

describe('.js fallback (issue #39)', function () {
  beforeEach(function () {
    testSetup.call(this)
    process.env.HARAKA_JS_CONFIG = '1' // opt-in
  })
  afterEach(function () {
    delete process.env.HARAKA_JS_CONFIG
  })

  it('is opt-in: disabled without HARAKA_JS_CONFIG', function () {
    delete process.env.HARAKA_JS_CONFIG
    assert.strictEqual(this.config.get('env-hostname'), null)
  })

  it('no-extension name falls back to <name>.js (core-file case)', function () {
    // e.g. the `me` hostname file — env-driven without forking Haraka
    assert.strictEqual(this.config.get('env-hostname'), 'env-hostname-default')
  })

  it('reads process.env via the .js fallback', function () {
    process.env.TEST_HOSTNAME = 'mail.example.com'
    try {
      assert.strictEqual(this.config.get('env-hostname'), 'mail.example.com')
    } finally {
      delete process.env.TEST_HOSTNAME
    }
  })

  it('list caller gets the array its .js fallback returns', function () {
    // js-list.js exports an array; documents the shape contract
    assert.deepEqual(this.config.get('js-list', 'list'), ['a', 'b'])
  })

  it('second get() is served from cache', function () {
    process.env.WITHOUT_CONFIG_CACHE = ''
    const a = this.config.get('env-hostname')
    process.env.TEST_HOSTNAME = 'changed'
    try {
      // cached: same value despite env change (no reload triggered)
      assert.strictEqual(this.config.get('env-hostname'), a)
    } finally {
      delete process.env.TEST_HOSTNAME
    }
  })

  it('the .js fallback cannot reintroduce a path escape', function () {
    // safe_resolve runs before the fallback; an escaping, extension-less
    // name must still be rejected (not turned into ../evil.js)
    assert.throws(() => this.config.get('../../../../../tmp/evil'), /escapes the config directory/)
  })

  describe('override layer', function () {
    let defRoot
    let ovrRoot

    beforeEach(async function () {
      defRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-def-'))
      ovrRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-ovr-'))
      await fs.mkdir(path.join(defRoot, 'config'))
      await fs.mkdir(path.join(ovrRoot, 'config'))
      await fs.writeFile(path.join(defRoot, 'config', 'svc.js'), 'module.exports = { a: 1, b: 1 }\n')
      await fs.writeFile(path.join(ovrRoot, 'config', 'svc.js'), 'module.exports = { b: 2, c: 3 }\n')
    })

    afterEach(async function () {
      await fs.rm(defRoot, { recursive: true, force: true })
      await fs.rm(ovrRoot, { recursive: true, force: true })
    })

    it('deep-merges a .js default with a .js override', function () {
      const cfg = this.config.module_config(defRoot, ovrRoot)
      assert.deepEqual(cfg.get('svc', 'js'), { a: 1, b: 2, c: 3 })
    })
  })
})

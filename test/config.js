const assert = require('node:assert')
const { after, afterEach, beforeEach, describe, it } = require('node:test')
const fs = require('node:fs/promises')
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

  it('null override value preserves default object', function () {
    // a bare YAML key (null) should not wipe out a default object — deep key-by-key semantics
    const lc = this.config.module_config(path.join('test', 'default'), path.join('test', 'override'))
    assert.deepEqual(lc.get('tls.yaml'), { tls: { key: '/etc/ssl/key.pem', cert: '/etc/ssl/cert.pem' } })
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

const tmpFile = path.resolve('test', 'config', 'dir', '4.ext')

describe('getDir', function () {
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.HARAKA = ''
    process.env.WITHOUT_CONFIG_CACHE = '1'
    clearRequireCache()
    this.config = require('../config')
    await fs.unlink(tmpFile).catch(() => {})
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

  it('reloads when file in dir is touched', { timeout: 5000 }, async (t) => {
    // due to differences in fs.watch, this test is unreliable on macOS with Node < 24
    const nodeMajorVersion = parseInt(process.versions.node.split('.')[0])
    if (/darwin/.test(process.platform) && nodeMajorVersion < 24) return

    try {
      await t.test('waits for watch event', async () => {
        return new Promise((resolve) => {
          let callCount = 0

          const getDir = async () => {
            try {
              const opts2 = { type: 'binary', watchCb: getDir }
              const files = await this.config.getDir('dir', opts2)
              callCount++
              if (callCount === 1) {
                assert.equal(files.length, 4)
                assert.equal(files[0].data, `contents1${os.EOL}`)
                assert.equal(files[2].data, `contents3${os.EOL}`)
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
      this.config.stop_watching('dir')
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
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-c1-'))
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

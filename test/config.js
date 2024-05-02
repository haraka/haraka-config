const assert = require('node:assert')
// const { beforeEach, describe, it } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

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

function testSetup(done) {
  process.env.NODE_ENV = 'test'
  process.env.HARAKA = ''
  process.env.WITHOUT_CONFIG_CACHE = '1'
  clearRequireCache()
  this.config = require('../config')
  done()
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
      assert.deepEqual(this.config.arrange_args(['test.ini']), [
        'test.ini',
        'ini',
        undefined,
        undefined,
      ])
    })

    it('name, type', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', 'ini']), [
        'test.ini',
        'ini',
        undefined,
        undefined,
      ])
    })

    it('name, callback', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', cb]), [
        'test.ini',
        'ini',
        cb,
        undefined,
      ])
    })

    it('name, callback, options', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', cb, opts]), [
        'test.ini',
        'ini',
        cb,
        opts,
      ])
    })

    it('name, options', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', opts]), [
        'test.ini',
        'ini',
        undefined,
        opts,
      ])
    })

    it('name, type, callback', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', 'ini', cb]), [
        'test.ini',
        'ini',
        cb,
        undefined,
      ])
    })

    it('name, type, options', function () {
      assert.deepEqual(this.config.arrange_args(['test.ini', 'ini', opts]), [
        'test.ini',
        'ini',
        undefined,
        opts,
      ])
    })

    it('name, type, callback, options', function () {
      assert.deepEqual(
        this.config.arrange_args(['test.ini', 'ini', cb, opts]),
        ['test.ini', 'ini', cb, opts],
      )
    })

    it('name, list type, callback, options', function () {
      assert.deepEqual(
        this.config.arrange_args(['test.ini', 'list', cb, opts]),
        ['test.ini', 'list', cb, opts],
      )
    })

    it('name, binary type, callback, options', function () {
      assert.deepEqual(
        this.config.arrange_args(['test.ini', 'binary', cb, opts]),
        ['test.ini', 'binary', cb, opts],
      )
    })

    it('name, value type, callback, options', function () {
      assert.deepEqual(
        this.config.arrange_args(['test.ini', 'value', cb, opts]),
        ['test.ini', 'value', cb, opts],
      )
    })

    it('name, hjson type, callback, options', function () {
      assert.deepEqual(
        this.config.arrange_args(['test.ini', 'hjson', cb, opts]),
        ['test.ini', 'hjson', cb, opts],
      )
    })

    // config.get('name', type, cb, options);
    it('name, json type, callback, options', function () {
      assert.deepEqual(
        this.config.arrange_args(['test.ini', 'json', cb, opts]),
        ['test.ini', 'json', cb, opts],
      )
    })

    // config.get('name', type, cb, options);
    it('name, data type, callback, options', function () {
      assert.deepEqual(
        this.config.arrange_args(['test.ini', 'data', cb, opts]),
        ['test.ini', 'data', cb, opts],
      )
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
  it('test (non-existing)', function () {
    _test_get('test', null, null, null, null)
  })

  it('test (non-existing, cached)', function () {
    process.env.WITHOUT_CONFIG_CACHE = ''
    const cfg = this.config.get('test', null, null)
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
    _test_get('test.list', 'list', null, null, [
      'line1',
      'line2',
      'line3',
      'line5',
    ])
  })

  it('test.flat, type=data', function () {
    _test_get('test.data', 'data', null, null, [
      'line1',
      'line2',
      'line3',
      '',
      'line5',
    ])
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
    const lc = this.config.module_config(
      path.join('test', 'default'),
      path.join('test', 'override'),
    )
    assert.deepEqual(lc.get('test.ini'), {
      main: {},
      defaults: { one: 'three', two: 'four' },
    })
  })

  it('flat overridden', function () {
    const lc = this.config.module_config(
      path.join('test', 'default'),
      path.join('test', 'override'),
    )
    assert.equal(lc.get('test.flat'), 'flatoverrode')
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
  beforeEach(function (done) {
    process.env.NODE_ENV = 'test'
    process.env.HARAKA = ''
    process.env.WITHOUT_CONFIG_CACHE = '1'
    clearRequireCache()
    this.config = require('../config')
    fs.unlink(tmpFile, () => done())
  })

  it('loads all files in dir', function (done) {
    this.config.getDir('dir', { type: 'binary' }, (err, files) => {
      if (err) console.error(err)
      assert.ifError(err)
      assert.equal(err, null)
      assert.equal(files.length, 4)
      assert.equal(files[0].data, `contents1${os.EOL}`)
      assert.equal(files[2].data, `contents3${os.EOL}`)
      done()
    })
  })

  it('errs on invalid dir', function (done) {
    this.config.getDir('dirInvalid', { type: 'binary' }, (err) => {
      assert.equal(err.code, 'ENOENT')
      done()
    })
  })

  it('reloads when file in dir is touched', function (done) {
    this.timeout(3500)

    // due to differences in fs.watch, this test is unreliable on Mac OS X
    // if (/darwin/.test(process.platform)) return done()

    let callCount = 0

    const getDir = () => {
      const opts2 = { type: 'binary', watchCb: getDir }
      this.config.getDir('dir', opts2, (err, files) => {
        // console.log('Loading: test/config/dir');
        if (err) console.error(err)
        callCount++
        if (callCount === 1) {
          assert.equal(err, null)
          assert.equal(files.length, 4)
          assert.equal(files[0].data, `contents1${os.EOL}`)
          assert.equal(files[2].data, `contents3${os.EOL}`)
          fs.writeFile(tmpFile, 'contents4\n', (err2) => {
            assert.equal(err2, null)
            // console.log('file touched, waiting for callback');
          })
        } else if (callCount === 2) {
          assert.equal(files[3].data, 'contents4\n')
          fs.unlink(tmpFile, () => {})
          done()
        }
      })
    }
    getDir()
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
    assert.deepEqual(this.config.get('smtpgreeting', 'list'), [
      'this is line one',
      'this is line two',
    ])
  })
})

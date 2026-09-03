'use strict'

const assert = require('node:assert')
const { after, afterEach, beforeEach, describe, it } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Windows: workers don't exit on .unref() alone.
after(() => {
  require('../lib/watch').closeAll()
})

describe('reader', function () {
  beforeEach(function () {
    process.env.NODE_ENV === 'test'
    this.cfreader = require('../lib/reader')
    this.opts = { booleans: ['main.bool_true', 'main.bool_false'] }
  })

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
        const r = this.cfreader.load_config('test/config/test.ini', 'ini', this.opts)
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
          booleans: ['+sect1.bool_true', '-sect1.bool_false', '+sect1.bool_true_default', 'sect1.-bool_false_default'],
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
        assert.deepEqual({ first: undefined, second: undefined }, r.empty_values)
      })

      it('array', function () {
        const r = this.cfreader.load_config('test/config/test.ini')
        assert.deepEqual(['first_host', 'second_host', 'third_host'], r.array_test.hostlist)
        assert.deepEqual([123, 456, 789], r.array_test.intlist)
      })
    })
  })

  describe('read_dir', function () {
    it('returns dir contents', async function () {
      const dir = path.resolve('test/config/dir')
      assert.deepEqual(await this.cfreader.read_dir(dir), [
        { data: 'contents1', path: path.join(dir, '1.ext') },
        { data: 'contents2', path: path.join(dir, '2.ext') },
        { data: 'contents3', path: path.join(dir, '3.ext') },
        { data: 'contents4', path: path.join(dir, 'subdir', '4.flat') },
      ])
    })

    it('returns dir with mixed types', async function () {
      const dir = path.join('test', 'config', 'mixed')
      assert.deepEqual(await this.cfreader.read_dir(dir), [
        {
          data: { main: {}, sect: { one: 'true' } },
          path: path.join(dir, '1.ini'),
        },
        { data: { main: { two: false } }, path: path.join(dir, '2.yml') },
      ])
    })

    describe('js entries', function () {
      beforeEach(function () {
        this.jsEnv = process.env.HARAKA_JS_CONFIG
        delete process.env.HARAKA_JS_CONFIG
        this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haraka-config-js-'))
        fs.writeFileSync(path.join(this.dir, 'ran.js'), 'module.exports = { ran: true }\n')
        fs.writeFileSync(path.join(this.dir, 'plain.list'), 'a\nb\n')
      })

      afterEach(function () {
        if (this.jsEnv === undefined) {
          delete process.env.HARAKA_JS_CONFIG
        } else {
          process.env.HARAKA_JS_CONFIG = this.jsEnv
        }
        fs.rmSync(this.dir, { recursive: true, force: true })
      })

      it('does not execute .js without HARAKA_JS_CONFIG', async function () {
        const contents = await this.cfreader.read_dir(this.dir)
        assert.deepEqual(
          contents.map((c) => path.basename(c.path)),
          ['plain.list'],
        )
      })

      it('executes .js when HARAKA_JS_CONFIG is set', async function () {
        process.env.HARAKA_JS_CONFIG = '1'
        const contents = await this.cfreader.read_dir(this.dir)
        const ran = contents.find((c) => path.basename(c.path) === 'ran.js')
        assert.deepEqual(ran.data, { ran: true })
      })

      it('executes .js when the caller asks for type js explicitly', async function () {
        fs.unlinkSync(path.join(this.dir, 'plain.list')) // type: 'js' would execute it too
        const contents = await this.cfreader.read_dir(this.dir, { type: 'js' })
        const ran = contents.find((c) => path.basename(c.path) === 'ran.js')
        assert.deepEqual(ran.data, { ran: true })
      })
    })

    describe('symlinks', function () {
      beforeEach(function () {
        this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'haraka-config-link-'))
        this.outside = fs.mkdtempSync(path.join(os.tmpdir(), 'haraka-config-out-'))
        fs.writeFileSync(path.join(this.outside, 'secret.list'), 'secret\n')
        fs.writeFileSync(path.join(this.root, 'own.list'), 'own\n')
      })

      afterEach(function () {
        fs.rmSync(this.root, { recursive: true, force: true })
        fs.rmSync(this.outside, { recursive: true, force: true })
      })

      it('follows a symlink to a directory outside', async function () {
        fs.symlinkSync(this.outside, path.join(this.root, 'escape'))
        const contents = await this.cfreader.read_dir(this.root)
        assert.deepEqual(contents.map((c) => path.basename(c.path)).sort(), ['own.list', 'secret.list'])
        assert.equal(
          contents.find((c) => c.path.endsWith('secret.list')).path,
          path.join(this.root, 'escape', 'secret.list'),
        )
      })

      it('follows a symlink to a file outside (certs in /etc/letsencrypt)', async function () {
        fs.symlinkSync(path.join(this.outside, 'secret.list'), path.join(this.root, 'linked.list'))
        const contents = await this.cfreader.read_dir(this.root)
        assert.deepEqual(contents.map((c) => path.basename(c.path)).sort(), ['linked.list', 'own.list'])
        assert.deepEqual(contents.find((c) => c.path.endsWith('linked.list')).data, ['secret'])
      })

      it('skips a symlink that points at itself', async function () {
        fs.symlinkSync('self.list', path.join(this.root, 'self.list'))
        const contents = await this.cfreader.read_dir(this.root)
        assert.deepEqual(
          contents.map((c) => path.basename(c.path)),
          ['own.list'],
        )
      })

      it('a directory that vanishes between stat and realpath is skipped', async function () {
        const sub = path.join(this.root, 'sub')
        fs.mkdirSync(sub)
        const fsp = require('node:fs/promises')
        const realpath = fsp.realpath
        fsp.realpath = async (p) => {
          if (p === sub) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
          return realpath(p)
        }
        try {
          const contents = await this.cfreader.read_dir(this.root)
          assert.deepEqual(
            contents.map((c) => path.basename(c.path)),
            ['own.list'],
          )
        } finally {
          fsp.realpath = realpath
        }
      })

      it('a missing directory rejects and leaves no slot behind', async function () {
        const missing = path.join(this.root, 'nope')
        await assert.rejects(() => this.cfreader.read_dir(missing, { watchCb() {} }), { code: 'ENOENT' })
        assert.equal(this.cfreader._read_args[missing], undefined)
      })

      it('breaks a symlink cycle instead of recursing until ELOOP', async function () {
        const sub = path.join(this.root, 'sub')
        fs.mkdirSync(sub)
        fs.writeFileSync(path.join(sub, 'deep.list'), 'deep\n')
        fs.symlinkSync(this.root, path.join(sub, 'loop'))
        const contents = await this.cfreader.read_dir(this.root)
        assert.deepEqual(contents.map((c) => path.basename(c.path)).sort(), ['deep.list', 'own.list'])
      })

      it('skips a dangling symlink', async function () {
        fs.symlinkSync(path.join(this.root, 'gone.list'), path.join(this.root, 'dangling.list'))
        const contents = await this.cfreader.read_dir(this.root)
        assert.deepEqual(
          contents.map((c) => path.basename(c.path)),
          ['own.list'],
        )
      })
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
      const result = this.cfreader.load_config('test/config/non-existent.bin', 'binary')
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
      assert.equal(this.cfreader.get_cache_key('test', { foo: 'bar' }), 'test{"foo":"bar"}')
    })

    it('two options are returned predictably', function () {
      assert.equal(this.cfreader.get_cache_key('test', { opt1: 'foo', opt2: 'bar' }), 'test{"opt1":"foo","opt2":"bar"}')
    })
  })

  describe('bad_config', function () {
    it('bad.yaml returns empty', function () {
      assert.deepEqual(this.cfreader.load_config('test/config/bad.yaml'), {})
    })
  })

  describe('overrides', function () {
    it('missing hjson loads yaml instead', function () {
      assert.deepEqual(this.cfreader.load_config('test/config/override2.hjson'), { hasDifferent: { value: false } })
    })

    it('missing json loads yaml instead', function () {
      assert.deepEqual(this.cfreader.load_config('test/config/override.json'), {
        has: { value: true },
      })
    })
  })

  describe('js fallback', function () {
    // the <name>.js fallback is opt-in via HARAKA_JS_CONFIG
    beforeEach(function () {
      process.env.HARAKA_JS_CONFIG = '1'
    })
    afterEach(function () {
      delete process.env.HARAKA_JS_CONFIG
    })

    it('is disabled unless HARAKA_JS_CONFIG is set', function () {
      delete process.env.HARAKA_JS_CONFIG
      // value-type empty is null; the point is it did NOT load the .js
      assert.strictEqual(this.cfreader.load_config('test/config/js-fallback', 'value'), null)
    })

    it('missing value file falls back to .js', function () {
      const result = this.cfreader.load_config('test/config/js-fallback', 'value')
      assert.equal(result, 'js-fallback-default')
    })

    it('re-reads process.env on reload (no manual cache clear)', function () {
      // Intentionally does NOT delete require.cache: this verifies the
      // js reader busts the cache itself, so .js configs hot-reload.
      assert.equal(this.cfreader.load_config('test/config/js-fallback', 'value'), 'js-fallback-default')
      process.env.TEST_JS_FALLBACK = 'from-env'
      try {
        assert.equal(this.cfreader.load_config('test/config/js-fallback', 'value'), 'from-env')
      } finally {
        delete process.env.TEST_JS_FALLBACK
      }
    })

    it('missing ini file falls back to .ini.js', function () {
      const result = this.cfreader.load_config('test/config/js-fallback.ini', 'ini')
      assert.deepEqual(result, { main: { host: 'js-ini-fallback-host' } })
    })

    it('.ini.js fallback re-reads env on reload', function () {
      assert.deepEqual(this.cfreader.load_config('test/config/js-fallback.ini', 'ini'), {
        main: { host: 'js-ini-fallback-host' },
      })
      process.env.TEST_JS_HOST = 'env-host'
      try {
        assert.deepEqual(this.cfreader.load_config('test/config/js-fallback.ini', 'ini'), {
          main: { host: 'env-host' },
        })
      } finally {
        delete process.env.TEST_JS_HOST
      }
    })

    it('existing config file is not replaced by .js fallback', function () {
      // test.value exists; test.value.js does not — should load the plain file
      const result = this.cfreader.load_config('test/config/test.value', 'value')
      assert.ok(result !== null)
    })

    it('missing .js file returns empty (no infinite loop)', function () {
      const result = this.cfreader.load_config('test/config/non-existent.js', 'js')
      assert.deepEqual(result, {})
    })

    it('last_load_error is found for a broken fallback .js', function () {
      // create the throwing fixture outside test/ so the node:test runner
      // does not try to execute it as a test file
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-broken-'))
      const base = path.join(dir, 'broken')
      fs.writeFileSync(`${base}.js`, "throw new Error('intentional broken')\n")
      try {
        const result = this.cfreader.load_config(base, 'value')
        // failed require -> empty, but the error must be discoverable
        // under the *original* (pre-fallback) name + type
        assert.deepEqual(result, {})
        const err = this.cfreader.last_load_error(base, 'value')
        assert.ok(err instanceof Error)
        assert.match(err.message, /intentional broken/)
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })

    it('successful fallback clears a prior load error', function () {
      this.cfreader.load_config('test/config/js-fallback', 'value')
      assert.equal(this.cfreader.last_load_error('test/config/js-fallback', 'value'), undefined)
    })
  })

  describe('get_path_to_config_dir', function () {
    it('Haraka runtime (env.HARAKA=*)', function () {
      process.env.HARAKA = '/etc/'
      this.cfreader.get_path_to_config_dir()
      assert.ok(/etc.config$/.test(this.cfreader.config_path), this.cfreader.config_path)
      delete process.env.HARAKA
    })

    it('NODE_ENV=test', function () {
      delete process.env.HARAKA
      process.env.NODE_ENV = 'test'
      this.cfreader.get_path_to_config_dir()
      assert.ok(/haraka-config.test.config$/.test(this.cfreader.config_path), this.cfreader.config_path)
      delete process.env.NODE_ENV
    })

    it('no $ENV defaults to ./config (if present) or ./', function () {
      delete process.env.HARAKA
      delete process.env.NODE_ENV
      this.cfreader.get_path_to_config_dir()
      assert.ok(/haraka-config$/.test(this.cfreader.config_path), this.cfreader.config_path)
    })
  })
})

const assert = require('node:assert')
const { afterEach, beforeEach, describe, it } = require('node:test')

beforeEach(function () {
  this.ini = require('../../lib/readers/ini')
  this.opts = {
    booleans: ['main.bool_true', 'main.bool_false'],
  }
})

describe('ini', function () {
  it('requires', function () {
    assert.ok(this.ini)
  })

  it('has a load function', function () {
    assert.ok(typeof this.ini.load === 'function')
  })

  it('loads the test ini file', function () {
    const result = this.ini.load('test/config/test.ini', {})
    // console.log(result);
    assert.deepEqual(result.main, {
      bool_true: 'true',
      bool_false: 'false',
      str_true: 'true',
      str_false: 'false',
    })
  })

  describe('test.ini', function () {
    it('no opts', function () {
      const r = this.ini.load('test/config/test.ini', {})
      assert.strictEqual(r.main.bool_true, 'true')
      assert.strictEqual(r.main.bool_false, 'false')
      assert.strictEqual(r.main.str_true, 'true')
      assert.strictEqual(r.main.str_false, 'false')
    })

    it('opts', function () {
      const r = this.ini.load('test/config/test.ini', this.opts).main
      assert.strictEqual(r.bool_true, true)
      assert.strictEqual(r.bool_false, false)
      assert.strictEqual(r.str_true, 'true')
      assert.strictEqual(r.str_false, 'false')
    })

    it('sect1, opts', function () {
      const r = this.ini.load('test/config/test.ini', {
        booleans: ['sect1.bool_true', 'sect1.bool_false'],
      })
      assert.strictEqual(r.sect1.bool_true, true)
      assert.strictEqual(r.sect1.bool_false, false)
      assert.strictEqual(r.sect1.str_true, 'true')
      assert.strictEqual(r.sect1.str_false, 'false')
    })

    it('sect1, opts, w/defaults', function () {
      const r = this.ini.load('test/config/test.ini', {
        booleans: ['+sect1.bool_true', '-sect1.bool_false', '+sect1.bool_true_default', 'sect1.-bool_false_default'],
      })
      assert.strictEqual(r.sect1.bool_true, true)
      assert.strictEqual(r.sect1.bool_false, false)
      assert.strictEqual(r.sect1.str_true, 'true')
      assert.strictEqual(r.sect1.str_false, 'false')
      assert.strictEqual(r.sect1.bool_true_default, true)
      assert.strictEqual(r.sect1.bool_false_default, false)
    })

    it('wildcard boolean', function () {
      const r = this.ini.load('test/config/test.ini', {
        booleans: ['+main.bool_true', '*.is_bool'],
      })
      assert.strictEqual(r['*'], undefined)
      assert.strictEqual(r.main.bool_true, true)
      assert.strictEqual(r.main.is_bool, undefined)
      assert.strictEqual(r['foo.com'].is_bool, true)
      assert.strictEqual(r['bar.com'].is_bool, false)
    })

    it('a header padded with 20k spaces parses in linear time', { timeout: 2000 }, function () {
      // the section regex had three overlapping \s* and was cubic in line length
      const r = this.ini.parseIni('x', {}, `[${' '.repeat(20000)}ok${' '.repeat(20000)}]\nk=v\n[${' '.repeat(20000)}\n`)
      assert.equal(r.ok.k, 'v')
    })

    it('wildcard boolean with a default prefix', function () {
      // '+*.key' parsed as section '+*' and was dropped before detection,
      // so its values stayed strings while bare '*.key' worked
      const r = this.ini.load('test/config/test.ini', {
        booleans: ['+*.is_bool'],
      })
      assert.strictEqual(r['*'], undefined)
      assert.strictEqual(r['foo.com'].is_bool, true)
      assert.strictEqual(r['bar.com'].is_bool, false)
    })
  })

  describe('non-exist.ini (empty)', function () {
    it('is template', function () {
      assert.deepEqual(this.ini.empty(), { main: {} })
    })

    it('boolean', function () {
      assert.deepEqual(this.ini.empty({ booleans: ['reject'] }), {
        main: { reject: false },
      })
    })

    it('boolean true default', function () {
      assert.deepEqual(this.ini.empty({ booleans: ['+reject'] }), {
        main: { reject: true },
      })
      assert.deepEqual(this.ini.empty({ booleans: ['+main.reject'] }), {
        main: { reject: true },
      })
      assert.deepEqual(this.ini.empty({ booleans: ['main.+reject'] }), {
        main: { reject: true },
      })
    })

    it('boolean false default', function () {
      assert.deepEqual(this.ini.empty({ booleans: ['-reject'] }), {
        main: { reject: false },
      })
      assert.deepEqual(this.ini.empty({ booleans: ['-main.reject'] }), {
        main: { reject: false },
      })
      assert.deepEqual(this.ini.empty({ booleans: ['main.-reject'] }), {
        main: { reject: false },
      })
    })

    it('boolean false default, section', function () {
      assert.deepEqual(this.ini.empty({ booleans: ['-reject.boolf'] }), {
        main: {},
        reject: { boolf: false },
      })
      assert.deepEqual(this.ini.empty({ booleans: ['+reject.boolt'] }), {
        main: {},
        reject: { boolt: true },
      })
    })
  })

  describe('goobers.ini', function () {
    it('goobers.ini has invalid entry', function () {
      const result = this.ini.load('test/config/goobers.ini', {})
      assert.deepEqual(result, { main: {} })
    })
  })

  describe('prototype pollution', function () {
    beforeEach(function () {
      this.warnings = []
      this.origLogger = this.ini.logger
      this.ini.logger = (m) => this.warnings.push(m)
    })
    afterEach(function () {
      this.ini.logger = this.origLogger
      delete Object.prototype.polluted
      delete Array.prototype.polluted
    })

    it('ignores a [__proto__] section', function () {
      const r = this.ini.parseIni('x', {}, '[__proto__]\npolluted=yes\n')
      assert.strictEqual({}.polluted, undefined)
      assert.deepEqual(Object.keys(r), ['main'])
      assert.equal(this.warnings.length, 1)
    })

    it('ignores [constructor] and [prototype] sections', function () {
      this.ini.parseIni('x', {}, '[constructor]\nx=1\n[prototype]\ny=2\n')
      assert.strictEqual({}.x, undefined)
      assert.strictEqual({}.y, undefined)
      assert.equal(this.warnings.length, 2)
    })

    it('ignores a __proto__ key', function () {
      const r = this.ini.parseIni('x', {}, 'foo=bar\n__proto__=evil\n')
      assert.strictEqual({}.toString.name, 'toString') // sanity
      assert.strictEqual(r.main.foo, 'bar')
      assert.strictEqual(Object.prototype.polluted, undefined)
      assert.equal(this.warnings.length, 1)
    })

    it('ignores a __proto__[] array key', function () {
      this.ini.parseIni('x', {}, '__proto__[]=evil\n')
      assert.strictEqual([].polluted, undefined)
      assert.strictEqual(Array.prototype.polluted, undefined)
      assert.equal(this.warnings.length, 1)
    })

    it('does not alias a section to an inherited member', function () {
      // [toString] previously aliased Object.prototype.toString
      const r = this.ini.parseIni('x', {}, '[toString]\nx=1\n')
      assert.deepEqual(r.toString, { x: 1 })
      assert.strictEqual(typeof {}.toString, 'function')
    })
  })

  describe('prototype chain reads', function () {
    const INHERITED = [
      '__proto__',
      'constructor',
      'valueOf',
      'toString',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      'toLocaleString',
    ]

    it('result object has a null prototype', function () {
      const r = this.ini.parseIni('x', {}, 'foo=bar\n')
      assert.strictEqual(Object.getPrototypeOf(r), null)
    })

    it('sections have a null prototype', function () {
      const r = this.ini.parseIni('x', {}, '[users]\nmatt=test\n')
      assert.strictEqual(Object.getPrototypeOf(r.main), null)
      assert.strictEqual(Object.getPrototypeOf(r.users), null)
    })

    it('empty() has a null prototype', function () {
      const r = this.ini.empty({})
      assert.strictEqual(Object.getPrototypeOf(r), null)
      assert.strictEqual(Object.getPrototypeOf(r.main), null)
    })

    it('boolean-declared sections have a null prototype', function () {
      const r = this.ini.parseIni('x', { booleans: ['+core.constrain_sender'] }, '')
      assert.strictEqual(Object.getPrototypeOf(r.core), null)
      assert.strictEqual(r.core.constrain_sender, true)
    })

    for (const name of INHERITED) {
      it(`an unconfigured key named '${name}' reads as undefined`, function () {
        const r = this.ini.parseIni('x', {}, '[users]\nmatt=test\n')
        assert.strictEqual(r.users[name], undefined)
      })

      it(`an unconfigured section named '${name}' reads as undefined`, function () {
        const r = this.ini.parseIni('x', {}, 'foo=bar\n')
        assert.strictEqual(r[name], undefined)
      })
    }

    it('an empty section resolves no inherited members', function () {
      const r = this.ini.parseIni('x', {}, '[users]\n')
      for (const name of INHERITED) assert.strictEqual(r.users[name], undefined)
    })

    it('still supports the usual object operations', function () {
      const r = this.ini.parseIni('x', {}, '[users]\nmatt=test\nbob=hunter2\n')

      assert.ok(Object.prototype.hasOwnProperty.call(r.users, 'matt'))
      assert.deepEqual(Object.keys(r.users), ['matt', 'bob'])
      assert.ok('matt' in r.users)
      assert.deepEqual({ ...r.users }, { matt: 'test', bob: 'hunter2' })
      assert.strictEqual(JSON.stringify(r.users), '{"matt":"test","bob":"hunter2"}')

      const seen = []
      for (const k in r.users) seen.push(k)
      assert.deepEqual(seen, ['matt', 'bob'])
    })
  })
})

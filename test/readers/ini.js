const assert = require('assert')

const regex = require('../../configfile').regex

beforeEach(function (done) {
  this.ini = require('../../readers/ini')
  this.opts = {
    booleans: ['main.bool_true', 'main.bool_false'],
  }
  done()
})

describe('ini', function () {
  it('requires', function () {
    assert.ok(this.ini)
  })

  it('has a load function', function () {
    assert.ok(typeof this.ini.load === 'function')
  })

  it('loads the test ini file', function () {
    const result = this.ini.load('test/config/test.ini', {}, regex)
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
      const r = this.ini.load('test/config/test.ini', {}, regex)
      assert.strictEqual(r.main.bool_true, 'true')
      assert.strictEqual(r.main.bool_false, 'false')
      assert.strictEqual(r.main.str_true, 'true')
      assert.strictEqual(r.main.str_false, 'false')
    })

    it('opts', function () {
      const r = this.ini.load('test/config/test.ini', this.opts, regex).main
      assert.strictEqual(r.bool_true, true)
      assert.strictEqual(r.bool_false, false)
      assert.strictEqual(r.str_true, 'true')
      assert.strictEqual(r.str_false, 'false')
    })

    it('sect1, opts', function () {
      const r = this.ini.load(
        'test/config/test.ini',
        {
          booleans: ['sect1.bool_true', 'sect1.bool_false'],
        },
        regex,
      )
      assert.strictEqual(r.sect1.bool_true, true)
      assert.strictEqual(r.sect1.bool_false, false)
      assert.strictEqual(r.sect1.str_true, 'true')
      assert.strictEqual(r.sect1.str_false, 'false')
    })

    it('sect1, opts, w/defaults', function () {
      const r = this.ini.load(
        'test/config/test.ini',
        {
          booleans: [
            '+sect1.bool_true',
            '-sect1.bool_false',
            '+sect1.bool_true_default',
            'sect1.-bool_false_default',
          ],
        },
        regex,
      )
      assert.strictEqual(r.sect1.bool_true, true)
      assert.strictEqual(r.sect1.bool_false, false)
      assert.strictEqual(r.sect1.str_true, 'true')
      assert.strictEqual(r.sect1.str_false, 'false')
      assert.strictEqual(r.sect1.bool_true_default, true)
      assert.strictEqual(r.sect1.bool_false_default, false)
    })

    it('wildcard boolean', function () {
      const r = this.ini.load(
        'test/config/test.ini',
        {
          booleans: ['+main.bool_true', '*.is_bool'],
        },
        regex,
      )
      assert.strictEqual(r['*'], undefined)
      assert.strictEqual(r.main.bool_true, true)
      assert.strictEqual(r.main.is_bool, undefined)
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
      const result = this.ini.load('test/config/goobers.ini', {}, regex)
      assert.deepEqual(result, { main: {} })
    })
  })
})

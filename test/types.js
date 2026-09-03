'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const types = require('../lib/types')

const TYPES = ['value', 'list', 'data', 'ini', 'json', 'hjson', 'yaml', 'js', 'binary']

describe('types', function () {
  describe('is_type', function () {
    for (const t of TYPES) it(t, () => assert.ok(types.is_type(t)))

    for (const s of ['flat', 'yml', 'pem', 'INI', '', 'constructor', '__proto__']) {
      it(`rejects '${s}'`, () => assert.equal(types.is_type(s), false))
    }
  })

  describe('reader_for', function () {
    for (const t of TYPES) {
      it(t, function () {
        const reader = types.reader_for(t)
        assert.equal(typeof reader.load, 'function')
        assert.equal(typeof reader.empty, 'function')
      })
    }

    it('shares one reader across the flat types', function () {
      assert.equal(types.reader_for('value'), types.reader_for('list'))
      assert.equal(types.reader_for('list'), types.reader_for('data'))
    })

    it('shares one reader across the structured types', function () {
      assert.equal(types.reader_for('json'), types.reader_for('hjson'))
      assert.equal(types.reader_for('hjson'), types.reader_for('yaml'))
    })

    it('throws for an unknown type instead of loading a module by that name', function () {
      // the old lookup fell through to require(`readers/${type}`)
      for (const t of ['flat', '../reader', 'constructor', '', undefined]) {
        assert.throws(() => types.reader_for(t), /unknown config type/)
      }
    })
  })

  describe('type_of', function () {
    const cases = {
      'smtp.ini': 'ini',
      'a.json': 'json',
      'a.hjson': 'hjson',
      'a.yaml': 'yaml',
      'a.yml': 'yaml',
      'a.js': 'js',
      'a.list': 'list',
      'a.data': 'data',
      'a.binary': 'binary',
      'a.bin': 'binary',
      'tls_cert.pem': 'binary',
      'A.INI': 'ini',
      '/abs/path/to/a.yml': 'yaml',
      me: 'value',
      'a.txt': 'value',
      'a.flat': 'value',
      'a.constructor': 'value',
      'a.__proto__': 'value',
    }
    for (const [name, type] of Object.entries(cases)) {
      it(`${name} -> ${type}`, () => assert.equal(types.type_of(name), type))
    }
  })

  describe('is_mergeable', function () {
    for (const t of ['ini', 'json', 'hjson', 'yaml', 'js']) it(t, () => assert.ok(types.is_mergeable(t)))
    for (const t of ['value', 'list', 'data', 'binary'])
      it(`not ${t}`, () => assert.equal(types.is_mergeable(t), false))
  })
})

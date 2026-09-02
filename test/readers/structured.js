'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const os = require('node:os')
const path = require('node:path')
const { after, describe, it } = require('node:test')

const readerPath = path.resolve(__dirname, '../../lib/readers/structured')
const testJson = path.join('test', 'config', 'test.json')
const testHjson = path.join('test', 'config', 'test.hjson')

const loadReader = () => require(readerPath)
const clearReaderCache = () => delete require.cache[readerPath]

const withMissingHjson = (run) => {
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'hjson') {
      const err = new Error("Cannot find module 'hjson'")
      err.code = 'MODULE_NOT_FOUND'
      throw err
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  return Promise.resolve()
    .then(run)
    .finally(() => {
      Module._load = originalLoad
    })
}

describe('structured', () => {
  describe('prototype-polluting keys', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'haraka-config-proto-'))

    after(() => fs.rmSync(tmp, { recursive: true, force: true }))

    const write = (file, body) => {
      const full = path.join(tmp, file)
      fs.writeFileSync(full, body)
      return full
    }

    // capture reader.logger for the duration of `run`, returning what it logged
    const quietly = async (run) => {
      const reader = loadReader()
      const logged = []
      const logger = reader.logger
      reader.logger = (msg) => logged.push(msg)
      try {
        return { result: await run(reader), logged }
      } finally {
        reader.logger = logger
      }
    }

    const cases = [
      ['json', 'p.json', '{"__proto__":{"polluted":true},"keep":1}'],
      ['yaml', 'p.yaml', '__proto__:\n  polluted: true\nkeep: 1\n'],
      // hjson assigns as it parses, so the prototype is swapped, not keyed
      ['hjson', 'p.hjson', '{__proto__:{polluted:true},keep:1}'],
    ]

    for (const [type, file, body] of cases) {
      it(`strips __proto__ from ${type}`, async () => {
        const { result, logged } = await quietly((reader) => reader.load(write(file, body), type))
        assert.equal(Object.prototype.hasOwnProperty.call(result, '__proto__'), false)
        assert.equal(Object.getPrototypeOf(result), Object.prototype)
        assert.equal(result.polluted, undefined)
        assert.equal(result.keep, 1)
        assert.match(logged[0], /Ignoring unsafe key '__proto__'/)
      })
    }

    it('strips unsafe keys nested in objects and arrays', async () => {
      const body = '{"a":{"__proto__":{"x":1},"b":[{"constructor":{"y":2},"ok":3}]},"prototype":{"z":4}}'
      const { result } = await quietly((reader) => reader.load(write('nested.json', body), 'json'))
      assert.deepEqual(result, { a: { b: [{ ok: 3 }] } })
    })

    it('leaves an Object.assign target prototype intact', async () => {
      const body = '{"__proto__":{"isAdmin":true}}'
      const { result } = await quietly((reader) => reader.load(write('assign.json', body), 'json'))
      const target = {}
      Object.assign(target, result)
      assert.equal(Object.getPrototypeOf(target), Object.prototype)
      assert.equal(target.isAdmin, undefined)
    })

    it('strips unsafe keys via loadPromise too', async () => {
      const body = '{"__proto__":{"x":1},"keep":2}'
      const { result } = await quietly((reader) => reader.loadPromise(write('async.json', body), 'json'))
      assert.deepEqual(result, { keep: 2 })
    })

    it('terminates on a cyclic yaml graph', async () => {
      const body = 'a: &anchor\n  self: *anchor\n  __proto__:\n    x: 1\n'
      const { result } = await quietly((reader) => reader.load(write('cycle.yaml', body), 'yaml'))
      assert.equal(result.a.self, result.a)
      assert.equal(Object.prototype.hasOwnProperty.call(result.a, '__proto__'), false)
    })

    it('logs through console.log by default', async () => {
      const reader = loadReader()
      const logged = []
      const log = console.log
      console.log = (msg) => logged.push(msg)
      try {
        reader.load(write('default-logger.json', '{"__proto__":{"x":1}}'), 'json')
      } finally {
        console.log = log
      }
      assert.match(logged[0], /Ignoring unsafe key '__proto__'/)
    })

    it('leaves an ordinary config untouched', async () => {
      const { result, logged } = await quietly((reader) => reader.load(testJson, 'json'))
      assert.equal(result.matt, 'waz here')
      assert.deepEqual(logged, [])
    })
  })

  it('does not eagerly require hjson on module load', async () => {
    clearReaderCache()

    await withMissingHjson(async () => {
      const reader = loadReader()
      const result = reader.load(testJson, 'json')
      assert.equal(result.matt, 'waz here')
    })
  })

  it('throws a clear error for unsupported sync type', () => {
    const reader = loadReader()
    assert.throws(() => reader.load(testJson, 'toml'), /Unsupported structured config type: toml/)
  })

  it('throws a clear error for unsupported async type', async () => {
    const reader = loadReader()
    await assert.rejects(() => reader.loadPromise(testJson, 'toml'), /Unsupported structured config type: toml/)
  })

  it('throws a clear error when hjson optional dependency is missing (sync)', async () => {
    clearReaderCache()

    await withMissingHjson(async () => {
      const reader = loadReader()
      assert.throws(() => reader.load(testHjson, 'hjson'), /HJSON support requires the optional dependency "hjson"/)
    })
  })

  it('throws a clear error when hjson optional dependency is missing (async)', async () => {
    clearReaderCache()

    await withMissingHjson(async () => {
      const reader = loadReader()
      await assert.rejects(
        () => reader.loadPromise(testHjson, 'hjson'),
        /HJSON support requires the optional dependency "hjson"/,
      )
    })
  })
})

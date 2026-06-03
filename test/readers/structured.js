'use strict'

const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const { describe, it } = require('node:test')

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

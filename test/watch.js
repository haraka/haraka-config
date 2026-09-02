'use strict'

const assert = require('node:assert/strict')
const { afterEach, beforeEach, describe, it } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

function loadWatch() {
  delete require.cache[require.resolve('../lib/watch')]
  return require('../lib/watch')
}

const enoent = () => Object.assign(new Error('missing'), { code: 'ENOENT' })

function mockReader(read_args = {}) {
  return {
    _read_args: read_args,
    load_config_calls: 0,
    load_config() {
      this.load_config_calls++
    },
    last_load_error() {
      return undefined
    },
  }
}

function fileSlot() {
  return {
    type: 'ini',
    options: {},
    cb_calls: 0,
    cb() {
      this.cb_calls++
    },
  }
}

function dirSlot() {
  return {
    opts: {
      watchCb_calls: 0,
      watchCb() {
        this.watchCb_calls++
      },
    },
  }
}

describe('watch', function () {
  const saved = {}
  const watchCalls = []
  const watchers = []

  beforeEach(function () {
    Object.assign(saved, {
      watch: fs.watch,
      stat: fs.stat,
      setTimeout: global.setTimeout,
      clearTimeout: global.clearTimeout,
      setInterval: global.setInterval,
      clearInterval: global.clearInterval,
      error: console.error,
      log: console.log,
    })
    watchCalls.length = 0
    watchers.length = 0
    fs.watch = (target, opts, listener) => {
      watchCalls.push({ target, opts, listener })
      const w = {
        close_calls: 0,
        close() {
          this.close_calls++
        },
      }
      watchers.push(w)
      return w
    }
    // sedation timers fire immediately
    global.setTimeout = (fn) => {
      fn()
      return 1
    }
    global.clearTimeout = () => {}
    console.log = () => {}
  })

  afterEach(function () {
    fs.watch = saved.watch
    fs.stat = saved.stat
    global.setTimeout = saved.setTimeout
    global.clearTimeout = saved.clearTimeout
    global.setInterval = saved.setInterval
    global.clearInterval = saved.clearInterval
    console.error = saved.error
    console.log = saved.log
    delete require.cache[require.resolve('../lib/watch')]
  })

  const cfgPath = path.resolve('test/config')
  const subDir = path.join(cfgPath, 'dir')

  it('dir attaches one non-persistent watcher per directory', function () {
    const Watch = loadWatch()
    const reader = mockReader()

    Watch.dir(reader, cfgPath)
    Watch.dir(reader, cfgPath)

    assert.equal(watchCalls.length, 1)
    assert.equal(watchCalls[0].target, cfgPath)
    assert.equal(watchCalls[0].opts.persistent, false)
    assert.equal(watchCalls[0].opts.recursive, false)
  })

  it('dir reloads a tracked file and invokes its callback', function () {
    const Watch = loadWatch()
    const file = path.join(subDir, 'test.ini')
    const reader = mockReader({ [file]: fileSlot() })

    Watch.dir(reader, subDir)
    watchCalls[0].listener('change')
    watchCalls[0].listener('change', 'untracked.ini')
    watchCalls[0].listener('change', 'test.ini')

    assert.equal(reader.load_config_calls, 1)
    assert.equal(reader._read_args[file].cb_calls, 1)
  })

  it('dir skips no_watch slots', function () {
    const Watch = loadWatch()
    const file = path.join(cfgPath, 'quiet.ini')
    const reader = mockReader({ [file]: { type: 'ini', options: { no_watch: true } } })

    Watch.dir(reader, cfgPath)
    watchCalls[0].listener('change', 'quiet.ini')

    assert.equal(reader.load_config_calls, 0)
  })

  it('dir skips getDir slots so it cannot load_config a directory (EISDIR)', function () {
    const Watch = loadWatch()
    const reader = mockReader({ [subDir]: { opts: {} } })

    Watch.dir(reader, cfgPath)
    watchCalls[0].listener('change', 'dir')

    assert.equal(reader.load_config_calls, 0)
  })

  it('one watcher serves file reloads and a getDir watchCb on the same directory', function () {
    // get() and getDir() used to have separate watcher kinds keyed by the
    // same dir; whichever attached first silently starved the other
    const Watch = loadWatch()
    const file = path.join(subDir, 'a.pem')
    const reader = mockReader({ [subDir]: dirSlot(), [file]: fileSlot() })

    Watch.dir(reader, subDir)
    Watch.dir(reader, subDir, { recursive: true })
    watchCalls[1].listener('change', 'a.pem')

    assert.equal(reader.load_config_calls, 1)
    assert.equal(reader._read_args[file].cb_calls, 1)
    assert.equal(reader._read_args[subDir].opts.watchCb_calls, 1)
  })

  it('a recursive request upgrades an existing watcher, once', function () {
    const Watch = loadWatch()
    const reader = mockReader()

    Watch.dir(reader, subDir)
    Watch.dir(reader, subDir, { recursive: true })
    Watch.dir(reader, subDir, { recursive: true })
    Watch.dir(reader, subDir)

    assert.equal(watchCalls.length, 2)
    assert.equal(watchers[0].close_calls, 1, 'the plain watcher is closed on upgrade')
    assert.equal(watchCalls[1].opts.recursive, true)
  })

  it('falls back to a plain watcher where recursive is unavailable', function () {
    const Watch = loadWatch()
    const plainWatch = fs.watch
    fs.watch = (target, opts, listener) => {
      if (opts.recursive) throw Object.assign(new Error('nope'), { code: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' })
      return plainWatch(target, opts, listener)
    }

    Watch.dir(mockReader(), subDir, { recursive: true })

    assert.equal(watchCalls.length, 1)
    assert.equal(watchCalls[0].opts.recursive, undefined)
  })

  it('watchCb tolerates a slot torn down before the sedation timer fires', function () {
    const Watch = loadWatch()
    const reader = mockReader({ [subDir]: dirSlot() })
    let pending
    global.setTimeout = (fn) => {
      pending = fn
      return 1
    }

    Watch.dir(reader, subDir, { recursive: true })
    watchCalls[0].listener('change', 'host.pem')
    delete reader._read_args[subDir]

    assert.doesNotThrow(pending)
  })

  it('onEvent is inert after close()', function () {
    const Watch = loadWatch()
    const file = path.join(subDir, 'test.ini')
    const reader = mockReader({ [file]: fileSlot() })

    Watch.dir(reader, subDir)
    Watch.close(reader, file)

    // an fs event queued before close() still lands in the handler
    assert.doesNotThrow(() => watchCalls[0].listener('change', 'test.ini'))
    assert.equal(reader.load_config_calls, 0)
    assert.equal(watchCalls.length, 1, 'a closed watcher must not be re-attached')
  })

  it('dir logs non-ENOENT watch errors', function () {
    const Watch = loadWatch()
    const errors = []
    fs.watch = () => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' })
    }
    console.error = (msg) => errors.push(msg)

    Watch.dir(mockReader(), '/no/such/dir')

    assert.equal(errors.length, 1)
    assert.match(errors[0], /Error watching directory/)
  })

  describe('enoent poller', function () {
    let timerFn
    let statCalls
    let clearedIntervals
    let intervalUnrefCalls

    beforeEach(function () {
      timerFn = undefined
      statCalls = 0
      clearedIntervals = 0
      intervalUnrefCalls = 0
      fs.stat = (target, cb) => {
        statCalls++
        cb(null, {})
      }
      global.setInterval = (fn) => {
        timerFn = fn
        return {
          unref() {
            intervalUnrefCalls++
          },
        }
      }
      global.clearInterval = () => clearedIntervals++
    })

    // the first fs.watch on `dir` fails with ENOENT; later ones succeed
    function missingOnce() {
      let calls = 0
      const plainWatch = fs.watch
      fs.watch = (...args) => {
        if (++calls === 1) throw enoent()
        return plainWatch(...args)
      }
    }

    it('dir queues a missing directory quietly and attaches once it appears', function () {
      const Watch = loadWatch()
      const errors = []
      console.error = (msg) => errors.push(msg)
      missingOnce()
      // a tracked file that exists by the time the dir is noticed
      const file = path.join(cfgPath, 'test.ini')
      const reader = mockReader({ [file]: fileSlot(), [cfgPath]: dirSlot() })

      Watch.dir(reader, cfgPath, { recursive: true })

      assert.deepEqual(errors, [])
      assert.equal(typeof timerFn, 'function', 'a stat retry timer must be armed')
      assert.equal(intervalUnrefCalls, 1)

      timerFn()

      assert.equal(watchCalls.length, 1)
      assert.equal(watchCalls[0].target, cfgPath)
      assert.equal(watchCalls[0].opts.recursive, true, 'the recursive request survives the wait')
      assert.equal(reader.load_config_calls, 1, 'tracked files already in the new dir are loaded')
      assert.equal(reader._read_args[file].cb_calls, 1)
    })

    it('tolerates a directory that vanishes between stat and watch', function () {
      const Watch = loadWatch()
      fs.watch = () => {
        throw enoent()
      }
      const reader = mockReader()

      Watch.dir(reader, subDir)
      assert.doesNotThrow(timerFn)

      timerFn()
      assert.equal(statCalls, 2, 'the dir is re-queued for the next poll')
    })

    it('close() unqueues a pending directory so it is not resurrected', function () {
      const Watch = loadWatch()
      fs.watch = () => {
        throw enoent()
      }
      const file = path.join(subDir, 'never.ini')
      const reader = mockReader({ [file]: fileSlot() })

      Watch.dir(reader, subDir)
      Watch.close(reader, file)
      timerFn()

      assert.equal(statCalls, 0, 'a closed dir must not be polled')
      assert.equal(reader.load_config_calls, 0)
      assert.equal(clearedIntervals, 1, 'the poller must stop once nothing is pending')
    })

    it('closeAll() clears pending directories and stops the poller', function () {
      const Watch = loadWatch()
      fs.watch = () => {
        throw enoent()
      }

      Watch.dir(mockReader(), subDir)
      Watch.dir(mockReader(), cfgPath)
      Watch.closeAll()
      assert.equal(clearedIntervals, 1)

      timerFn()
      assert.equal(statCalls, 0)
    })
  })

  describe('close', function () {
    it('clears pending sedation timers under the target and removes its slot', function () {
      const Watch = loadWatch()
      let pendingTimer = false
      let clearedTimers = 0
      global.setTimeout = () => {
        pendingTimer = true
        return 1
      }
      global.clearTimeout = () => {
        if (!pendingTimer) return
        clearedTimers++
        pendingTimer = false
      }
      const reader = mockReader({ [subDir]: dirSlot() })

      Watch.dir(reader, subDir, { recursive: true })
      watchCalls[0].listener('change', 'a.ini')
      assert.ok(pendingTimer)

      Watch.close(reader, subDir)

      assert.equal(clearedTimers, 1)
      assert.equal(reader._read_args[subDir], undefined)
      assert.equal(watchers[0].close_calls, 1)

      Watch.close(reader, subDir)
      assert.equal(watchers[0].close_calls, 1, 'close() is idempotent')
    })

    it('a file keeps the shared directory watcher while a sibling is tracked', function () {
      // stop_watching() on one file used to close the whole directory's
      // watcher, silently ending live reload for every other file in it
      const Watch = loadWatch()
      const a = path.join(cfgPath, 'a.ini')
      const b = path.join(cfgPath, 'b.ini')
      const reader = mockReader({ [a]: fileSlot(), [b]: fileSlot() })

      Watch.dir(reader, cfgPath)
      Watch.close(reader, a)

      assert.equal(watchers[0].close_calls, 0)
      watchCalls[0].listener('change', 'a.ini')
      watchCalls[0].listener('change', 'b.ini')
      assert.equal(reader.load_config_calls, 1, 'only the still-tracked sibling reloads')

      Watch.close(reader, b)
      assert.equal(watchers[0].close_calls, 1, 'released once nothing in the dir is tracked')
    })

    it('a getDir directory keeps its watcher while a file inside it is tracked', function () {
      const Watch = loadWatch()
      const file = path.join(subDir, 'a.pem')
      const reader = mockReader({ [subDir]: dirSlot(), [file]: fileSlot() })
      const dirArgs = reader._read_args[subDir]

      Watch.dir(reader, subDir, { recursive: true })
      Watch.close(reader, subDir)

      assert.equal(watchers[0].close_calls, 0)
      watchCalls[0].listener('change', 'a.pem')
      assert.equal(reader.load_config_calls, 1)
      assert.equal(dirArgs.opts.watchCb_calls, 0, 'the stopped watchCb is not invoked')

      Watch.close(reader, file)
      assert.equal(watchers[0].close_calls, 1)
    })
  })
})

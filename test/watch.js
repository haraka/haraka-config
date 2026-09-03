'use strict'

const assert = require('node:assert/strict')
const { afterEach, beforeEach, describe, it } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
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

  it('asks for recursion only where fs.watch supports it natively', function () {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    try {
      for (const [os, expected] of [
        ['linux', false],
        ['darwin', true],
        ['win32', true],
        ['freebsd', false],
      ]) {
        Object.defineProperty(process, 'platform', { value: os, configurable: true })
        const Watch = loadWatch()
        Watch.dir(mockReader(), subDir, { recursive: true })
        assert.equal(watchCalls.at(-1).opts.recursive, expected, os)
        Watch.closeAll()
      }
    } finally {
      Object.defineProperty(process, 'platform', platform)
    }
  })

  it("logs a watcher's 'error' event instead of letting it throw", function () {
    const Watch = loadWatch()
    const handlers = {}
    fs.watch = () => ({ close() {}, on: (ev, fn) => (handlers[ev] = fn) })
    const errors = []
    console.error = (msg) => errors.push(msg)

    Watch.dir(mockReader(), subDir)
    assert.equal(typeof handlers.error, 'function')
    assert.doesNotThrow(() => handlers.error(new Error('EACCES')))
    assert.match(errors[0], /Error watching directory/)
  })

  it('keeps the existing watcher when the recursive upgrade fails to open', function () {
    const Watch = loadWatch()
    const reader = mockReader()
    Watch.dir(reader, subDir)
    const plainWatch = fs.watch
    fs.watch = (target, opts, listener) => {
      if (opts.recursive) throw Object.assign(new Error('too many open files'), { code: 'EMFILE' })
      return plainWatch(target, opts, listener)
    }
    console.error = () => {}

    Watch.dir(reader, subDir, { recursive: true })

    assert.equal(watchers[0].close_calls, 0, 'the plain watcher survives')
    Watch.dir(reader, subDir)
    assert.equal(watchCalls.length, 1, 'and is still registered')
  })

  it('ignores a watchCb that is not a function', function () {
    const Watch = loadWatch()
    const reader = mockReader({ [subDir]: { opts: { watchCb: true } } })
    Watch.dir(reader, subDir, { recursive: true })
    assert.doesNotThrow(() => watchCalls[0].listener('change', 'a.pem'))
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

  describe('a symlinked config', function () {
    let tmp
    beforeEach(function () {
      tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hc-link-')))
      fs.mkdirSync(path.join(tmp, 'config'))
      fs.mkdirSync(path.join(tmp, 'real'))
      fs.writeFileSync(path.join(tmp, 'real', 'cert.pem'), 'v1')
      fs.symlinkSync(path.join(tmp, 'real', 'cert.pem'), path.join(tmp, 'config', 'cert.pem'))
    })
    afterEach(function () {
      fs.rmSync(tmp, { recursive: true, force: true })
    })

    it('reloads when the link target changes', function () {
      const Watch = loadWatch()
      const link = path.join(tmp, 'config', 'cert.pem')
      const reader = mockReader({ [link]: fileSlot() })

      Watch.file(reader, link)
      assert.deepEqual(watchCalls.map((c) => c.target).sort(), [path.join(tmp, 'config'), path.join(tmp, 'real')])

      watchCalls.find((c) => c.target === path.join(tmp, 'real')).listener('change', 'cert.pem')
      assert.equal(reader.load_config_calls, 1)
      assert.equal(reader._read_args[link].cb_calls, 1)
    })

    it('close() releases the target directory watcher too', function () {
      const Watch = loadWatch()
      const link = path.join(tmp, 'config', 'cert.pem')
      const reader = mockReader({ [link]: fileSlot() })

      Watch.file(reader, link)
      Watch.close(reader, link)
      assert.deepEqual(
        watchers.map((w) => w.close_calls),
        [1, 1],
      )
    })
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
      assert.equal(clearedIntervals, 1, 'the poller stops as soon as nothing is pending')

      timerFn()
      assert.equal(statCalls, 0, 'a closed dir must not be polled')
      assert.equal(reader.load_config_calls, 0)
    })

    it('a pending recursive request survives a later plain request for the same dir', function () {
      const Watch = loadWatch()
      let calls = 0
      const plainWatch = fs.watch
      fs.watch = (...args) => {
        if (++calls <= 2) throw enoent()
        return plainWatch(...args)
      }
      const reader = mockReader()

      Watch.dir(reader, subDir, { recursive: true })
      Watch.dir(reader, subDir)
      timerFn()

      assert.equal(watchCalls.length, 1)
      assert.equal(watchCalls[0].opts.recursive, true)
    })

    it('a later recursive request upgrades a pending plain one', function () {
      const Watch = loadWatch()
      let calls = 0
      const plainWatch = fs.watch
      fs.watch = (...args) => {
        if (++calls <= 2) throw enoent()
        return plainWatch(...args)
      }
      const reader = mockReader()

      Watch.dir(reader, subDir)
      Watch.dir(reader, subDir, { recursive: true })
      timerFn()

      assert.equal(watchCalls.length, 1)
      assert.equal(watchCalls[0].opts.recursive, true)
    })

    it('a request that succeeds before the poll unqueues the dir and stops the poller', function () {
      const Watch = loadWatch()
      missingOnce()
      const file = path.join(cfgPath, 'test.ini')
      const reader = mockReader({ [file]: fileSlot() })

      Watch.dir(reader, cfgPath)
      Watch.dir(reader, cfgPath)
      assert.equal(watchCalls.length, 1, 'the retry attached a watcher')
      assert.equal(clearedIntervals, 1, 'nothing is pending, so the poller stopped')

      timerFn()
      assert.equal(statCalls, 0, 'an attached dir is not polled')
      assert.equal(reader.load_config_calls, 0, 'and its files are not spuriously reloaded')
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
    it("clears the target's pending debounce, removes its slot, and is idempotent", function () {
      const Watch = loadWatch()
      const pending = new Set()
      let next = 0
      global.setTimeout = () => {
        pending.add(++next)
        return next
      }
      global.clearTimeout = (id) => pending.delete(id)
      const reader = mockReader({ [subDir]: dirSlot() })

      Watch.dir(reader, subDir, { recursive: true })
      watchCalls[0].listener('change', 'a.ini')
      assert.equal(pending.size, 1)

      Watch.close(reader, subDir)

      assert.equal(pending.size, 0)
      assert.equal(reader._read_args[subDir], undefined)
      assert.equal(watchers[0].close_calls, 1)

      Watch.close(reader, subDir)
      assert.equal(watchers[0].close_calls, 1, 'close() is idempotent')
    })

    it("stopping a getDir() slot keeps a tracked child's pending reload", function () {
      const Watch = loadWatch()
      const timers = new Map()
      let next = 0
      global.setTimeout = (fn) => {
        timers.set(++next, fn)
        return next
      }
      global.clearTimeout = (id) => timers.delete(id)
      const file = path.join(subDir, 'a.pem')
      const reader = mockReader({ [subDir]: dirSlot(), [file]: fileSlot() })

      Watch.dir(reader, subDir, { recursive: true })
      watchCalls[0].listener('change', 'a.pem')
      assert.equal(timers.size, 2, 'a reload and a watchCb are pending')

      Watch.close(reader, subDir)
      assert.equal(timers.size, 1, "only the dir's own debounce is cleared")

      for (const fn of timers.values()) fn()
      assert.equal(reader.load_config_calls, 1, 'the child reload still fires')
    })

    it('slots that need no watcher do not keep it open', function () {
      const Watch = loadWatch()
      const watched = path.join(cfgPath, 'watched.ini')
      const reader = mockReader({
        [path.join(cfgPath, 'quiet.ini')]: { type: 'ini', options: { no_watch: true } },
        [cfgPath]: { opts: {} }, // getDir() without a watchCb
        [subDir]: { opts: {} }, // a getDir() child dir has its own watcher
        [watched]: fileSlot(),
      })

      Watch.dir(reader, cfgPath)
      Watch.close(reader, watched)

      assert.equal(watchers[0].close_calls, 1, 'nothing left relies on the watcher')
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

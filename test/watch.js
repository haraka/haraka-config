'use strict'

const assert = require('node:assert')
const { afterEach, beforeEach, describe, it } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

function loadWatch() {
  delete require.cache[require.resolve('../lib/watch')]
  return require('../lib/watch')
}

describe('watch', function () {
  let fsWatch
  let fsStat
  let setTimeoutFn
  let clearTimeoutFn
  let setIntervalFn
  let clearIntervalFn
  let consoleError
  let consoleLog

  beforeEach(function () {
    fsWatch = fs.watch
    fsStat = fs.stat
    setTimeoutFn = global.setTimeout
    clearTimeoutFn = global.clearTimeout
    setIntervalFn = global.setInterval
    clearIntervalFn = global.clearInterval
    consoleError = console.error
    consoleLog = console.log
  })

  afterEach(function () {
    fs.watch = fsWatch
    fs.stat = fsStat
    global.setTimeout = setTimeoutFn
    global.clearTimeout = clearTimeoutFn
    global.setInterval = setIntervalFn
    global.clearInterval = clearIntervalFn
    console.error = consoleError
    console.log = consoleLog
    delete require.cache[require.resolve('../lib/watch')]
  })

  it('file skips no_watch and avoids duplicate watchers', function () {
    const Watch = loadWatch()
    let watchCalls = 0

    fs.watch = () => {
      watchCalls++
      return { close() {}, unref() {} }
    }

    Watch.file({}, 'test/config/test.ini', 'ini', null, { no_watch: true })
    Watch.file({}, 'test/config/test.ini', 'ini')
    Watch.file({}, 'test/config/test.ini', 'ini')

    assert.equal(watchCalls, 1)
  })

  it('file handles ENOENT and recovers via stat timer', function () {
    const Watch = loadWatch()
    const name = path.join('test', 'config', 'missing-watch.ini')
    const reader = {
      _read_args: {
        [name]: { type: 'ini', options: { booleans: ['main.test'] }, cb() {} },
      },
      load_config_calls: 0,
      load_config() {
        this.load_config_calls++
      },
      last_load_error() {
        return undefined
      },
    }

    let watchCalls = 0
    let timerFn
    let intervalUnrefCalls = 0

    fs.watch = () => {
      watchCalls++
      if (watchCalls === 1) {
        const err = new Error('missing')
        err.code = 'ENOENT'
        throw err
      }
      return { close() {}, unref() {} }
    }

    fs.stat = (file, cb) => {
      assert.equal(file, name)
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

    Watch.file(reader, name, 'ini', reader._read_args[name].cb, {
      booleans: ['main.test'],
    })
    Watch.file(reader, `${name}.again`, 'ini', null, null)

    assert.equal(typeof timerFn, 'function')
    assert.equal(intervalUnrefCalls, 1)

    timerFn()

    assert.equal(reader.load_config_calls, 1)
    assert.equal(watchCalls, 3)
  })

  it('file logs non-ENOENT watch errors', function () {
    const Watch = loadWatch()
    const errors = []

    fs.watch = () => {
      const err = new Error('denied')
      err.code = 'EACCES'
      throw err
    }
    console.error = (msg) => errors.push(msg)

    Watch.file({}, 'test/config/test.ini', 'ini')

    assert.equal(errors.length, 1)
    assert.match(errors[0], /Error watching config file:/)
  })

  it('onEvent reloads and re-watches on rename', function () {
    const Watch = loadWatch()
    const name = path.join('test', 'config', 'test.ini')
    const reader = {
      load_config_calls: 0,
      load_config() {
        this.load_config_calls++
      },
      last_load_error() {
        return undefined
      },
    }
    const args = {
      type: 'ini',
      options: {},
      cb_calls: 0,
      cb() {
        this.cb_calls++
      },
    }

    const watcher = {
      closed: 0,
      close() {
        this.closed++
      },
      unref() {},
    }
    let watchCalls = 0
    let watchListener

    fs.watch = (file, opts, listener) => {
      watchCalls++
      watchListener = listener
      return watcher
    }

    global.setTimeout = (fn) => {
      fn()
      return 1
    }
    global.clearTimeout = () => {}
    console.log = () => {}

    Watch.file(reader, name, 'ini', args.cb.bind(args), args.options)
    watchListener('rename')

    assert.equal(reader.load_config_calls, 1)
    assert.equal(args.cb_calls, 1)
    assert.equal(watcher.closed, 1)
    assert.equal(watchCalls, 2)
  })

  it('onEvent reloads with the latest read args, not those captured at attach', function () {
    const Watch = loadWatch()
    const name = path.join('test', 'config', 'test.ini')
    const loads = []
    const reader = {
      _read_args: { [name]: { type: 'ini', options: {} } },
      load_config(file, type) {
        loads.push(type)
      },
      last_load_error() {
        return undefined
      },
    }
    let listener
    fs.watch = (file, opts, l) => {
      listener = l
      return { close() {}, unref() {} }
    }
    global.setTimeout = (fn) => {
      fn()
      return 1
    }
    global.clearTimeout = () => {}
    console.log = () => {}

    let pending
    global.setTimeout = (fn) => {
      pending = fn
      return 1
    }

    Watch.file(reader, name, 'ini', null, {})
    listener('change')
    reader._read_args[name] = { type: 'value', options: {} } // read again during the debounce
    pending()

    assert.deepEqual(loads, ['value'])
  })

  it('onEvent is inert after the watcher is closed', function () {
    const Watch = loadWatch()
    const name = path.join('test', 'config', 'test.ini')
    const reader = {
      load_config_calls: 0,
      load_config() {
        this.load_config_calls++
      },
      last_load_error() {
        return undefined
      },
    }

    let watchCalls = 0
    let watchListener
    fs.watch = (file, opts, listener) => {
      watchCalls++
      watchListener = listener
      return { close() {}, unref() {} }
    }
    global.setTimeout = (fn) => {
      fn()
      return 1
    }
    global.clearTimeout = () => {}
    console.log = () => {}

    Watch.file(reader, name, 'ini', null, {})
    Watch.close(reader, name)

    // An fs event queued before close() still lands in the handler. It must
    // neither throw nor resurrect a watcher the caller asked us to drop.
    assert.doesNotThrow(() => watchListener('rename'))
    assert.equal(reader.load_config_calls, 0, 'a closed watcher must not reload')
    assert.equal(watchCalls, 1, 'a closed watcher must not be re-attached')
  })

  it('enoent timer tolerates a file that vanishes before it can be watched', function () {
    const Watch = loadWatch()
    const name = path.join('test', 'config', 'flaky-watch.ini')
    const reader = {
      _read_args: { [name]: { type: 'ini', options: {}, cb() {} } },
      load_config() {},
      last_load_error() {
        return undefined
      },
    }

    const errors = []
    console.error = (msg) => errors.push(msg)
    console.log = () => {}

    fs.watch = () => {
      const err = new Error('missing')
      err.code = 'ENOENT'
      throw err
    }
    fs.stat = (file, cb) => cb(null, {})

    let timerFn
    global.setInterval = (fn) => {
      timerFn = fn
      return { unref() {} }
    }

    Watch.file(reader, name, 'ini', reader._read_args[name].cb, {})
    // The file appeared for the stat, then vanished again before fs.watch().
    assert.doesNotThrow(() => timerFn())
  })

  it('close() unqueues an enoent-pending file so it is not resurrected', function () {
    const Watch = loadWatch()
    const name = path.join('test', 'config', 'never-appears.ini')
    const reader = {
      _read_args: { [name]: { type: 'ini', options: {}, cb() {} } },
      load_config_calls: 0,
      load_config() {
        this.load_config_calls++
      },
      last_load_error() {
        return undefined
      },
    }

    let watchCalls = 0
    fs.watch = () => {
      watchCalls++
      const err = new Error('missing')
      err.code = 'ENOENT'
      throw err
    }
    let statCalls = 0
    fs.stat = (file, cb) => {
      statCalls++
      cb(null, {})
    }

    let timerFn
    let clearedIntervals = 0
    global.setInterval = (fn) => {
      timerFn = fn
      return { unref() {} }
    }
    global.clearInterval = () => clearedIntervals++
    console.log = () => {}

    Watch.file(reader, name, 'ini', reader._read_args[name].cb, {})
    assert.equal(watchCalls, 1)

    Watch.close(reader, name)
    timerFn()

    assert.equal(statCalls, 0, 'a closed file must not be polled')
    assert.equal(reader.load_config_calls, 0, 'a closed file must not be reloaded')
    assert.equal(clearedIntervals, 1, 'the poller must stop once nothing is pending')
  })

  it('a stat that resolves after closeAll() neither reloads nor re-watches', function () {
    const Watch = loadWatch()
    const name = path.join('test', 'config', 'late.ini')
    const reader = {
      _read_args: { [name]: { type: 'ini', options: {}, cb() {} } },
      load_config_calls: 0,
      load_config() {
        this.load_config_calls++
      },
      last_load_error() {
        return undefined
      },
    }

    let watchCalls = 0
    fs.watch = () => {
      watchCalls++
      const err = new Error('missing')
      err.code = 'ENOENT'
      throw err
    }
    let statCb
    fs.stat = (file, cb) => {
      statCb = cb
    }
    let timerFn
    global.setInterval = (fn) => {
      timerFn = fn
      return { unref() {} }
    }
    console.log = () => {}

    Watch.file(reader, name, 'ini', null, {})
    timerFn() // dispatches the stat
    Watch.closeAll()
    fs.watch = () => {
      watchCalls++
      return { close() {}, unref() {} }
    }
    statCb(null, {}) // the in-flight stat completes after shutdown

    assert.equal(reader.load_config_calls, 0, 'must not reload after closeAll')
    assert.equal(watchCalls, 1, 'must not re-attach after closeAll')
  })

  it('closeAll() clears enoent registrations and stops the poller', function () {
    const Watch = loadWatch()
    const file = path.join('test', 'config', 'gone.ini')
    const dir = path.resolve('test/config/gone-dir')
    const reader = { _read_args: {}, load_config() {}, last_load_error: () => undefined }

    fs.watch = () => {
      const err = new Error('missing')
      err.code = 'ENOENT'
      throw err
    }
    let statCalls = 0
    fs.stat = (target, cb) => {
      statCalls++
      cb(null, {})
    }

    let timerFn
    let clearedIntervals = 0
    global.setInterval = (fn) => {
      timerFn = fn
      return { unref() {} }
    }
    global.clearInterval = () => clearedIntervals++

    Watch.file(reader, file, 'ini', null, {})
    Watch.dir(reader, dir)

    Watch.closeAll()
    assert.equal(clearedIntervals, 1, 'closeAll must stop the enoent poller')

    timerFn()
    assert.equal(statCalls, 0, 'closeAll must clear both enoent queues')
  })

  it('dir watches a caller-supplied path (not just reader.config_path)', function () {
    const Watch = loadWatch()
    const cfgPath = path.resolve('test/config')
    const otherDir = path.resolve('test/config/dir')
    const filename = 'test.ini'
    const fullPathInOther = path.join(otherDir, filename)

    const reader = {
      config_path: cfgPath,
      _read_args: {
        [fullPathInOther]: {
          type: 'ini',
          options: {},
          cb_calls: 0,
          cb() {
            this.cb_calls++
          },
        },
      },
      load_config_calls: 0,
      load_config() {
        this.load_config_calls++
      },
      last_load_error() {
        return undefined
      },
    }

    let watchTarget
    let watchListener
    fs.watch = (target, opts, listener) => {
      watchTarget = target
      watchListener = listener
      return { close() {}, unref() {} }
    }

    global.setTimeout = (fn) => {
      fn()
      return 1
    }
    global.clearTimeout = () => {}
    console.log = () => {}

    Watch.dir(reader, otherDir)
    assert.equal(watchTarget, otherDir, 'fs.watch must be called on the caller-supplied dir')

    watchListener('change', filename)
    assert.equal(reader.load_config_calls, 1, 'change in other dir triggers reload')
    assert.equal(reader._read_args[fullPathInOther].cb_calls, 1)
  })

  it('dir reloads with the latest read args, not those captured at the event', function () {
    const Watch = loadWatch()
    const cfgPath = path.resolve('test/config')
    const fullPath = path.join(cfgPath, 'test.ini')
    const loads = []
    const reader = {
      config_path: cfgPath,
      _read_args: { [fullPath]: { type: 'ini', options: {} } },
      load_config(file, type) {
        loads.push(type)
      },
      last_load_error() {
        return undefined
      },
    }
    let listener
    fs.watch = (target, opts, l) => {
      listener = l
      return { close() {}, unref() {} }
    }
    let pending
    global.setTimeout = (fn) => {
      pending = fn
      return 1
    }
    global.clearTimeout = () => {}
    console.log = () => {}

    Watch.dir(reader, cfgPath)
    listener('change', 'test.ini')
    reader._read_args[fullPath] = { type: 'value', options: {} } // read again during the debounce
    pending()
    assert.deepEqual(loads, ['value'])

    listener('change', 'test.ini')
    delete reader._read_args[fullPath] // stopped during the debounce
    pending()
    assert.deepEqual(loads, ['value'], 'a stopped file is not reloaded')
  })

  it('dir skips getDir slots so it cannot load_config a directory (EISDIR)', function () {
    const Watch = loadWatch()
    const cfgPath = path.resolve('test/config')
    const subDir = 'tls'
    const subDirPath = path.join(cfgPath, subDir)

    const reader = {
      config_path: cfgPath,
      _read_args: {
        // getDir() registers the directory path itself as { opts }
        [subDirPath]: { opts: {} },
      },
      load_config_calls: 0,
      load_config() {
        this.load_config_calls++
      },
      last_load_error() {
        return undefined
      },
    }

    let watchListener
    fs.watch = (target, opts, listener) => {
      watchListener = listener
      return { close() {}, unref() {} }
    }

    global.setTimeout = (fn) => {
      fn()
      return 1
    }
    global.clearTimeout = () => {}
    console.log = () => {}

    Watch.dir(reader, cfgPath)
    watchListener('change', subDir)

    assert.equal(reader.load_config_calls, 0, 'getDir directory slot must not be reloaded as a file')
  })

  it('dir handles ENOENT and recovers via stat timer', function () {
    const Watch = loadWatch()
    const dirPath = path.resolve('test/config/missing-watch-dir')
    const reader = {
      config_path: path.resolve('test/config'),
      _read_args: {},
    }

    let watchCalls = 0
    const watchTargets = []
    let timerFn
    let intervalUnrefCalls = 0
    const errors = []

    fs.watch = (target) => {
      watchCalls++
      watchTargets.push(target)
      if (watchCalls === 1) {
        const err = new Error('missing')
        err.code = 'ENOENT'
        throw err
      }
      return { close() {}, unref() {} }
    }

    fs.stat = (target, cb) => {
      assert.equal(target, dirPath)
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

    console.error = (msg) => errors.push(msg)

    Watch.dir(reader, dirPath)

    assert.deepEqual(errors, [], 'ENOENT during dir watch must not log')
    assert.equal(typeof timerFn, 'function', 'a stat retry timer must be armed')
    assert.equal(intervalUnrefCalls, 1, 'timer must be unref()d')

    // simulate the directory appearing later
    timerFn()

    assert.equal(watchCalls, 2, 'watcher must reattach once the dir exists')
    assert.equal(watchTargets[1], dirPath)
  })

  it('dir logs non-ENOENT watch errors', function () {
    const Watch = loadWatch()
    const errors = []

    fs.watch = () => {
      const err = new Error('denied')
      err.code = 'EACCES'
      throw err
    }
    console.error = (msg) => errors.push(msg)

    Watch.dir({ config_path: '/tmp/no-such-dir' })

    assert.equal(errors.length, 1)
    assert.match(errors[0], /Error watching directory/)
  })

  it('dir2 tolerates a stale watchCb (post-teardown race)', function () {
    const Watch = loadWatch()
    const dirPath = path.resolve('test/config/dir2-stale')
    const reader = {
      _read_args: {
        [dirPath]: { opts: { watchCb: undefined } },
      },
    }

    let watchListener
    fs.watch = (target, opts, listener) => {
      watchListener = listener
      return { close() {}, unref() {} }
    }

    global.setTimeout = (fn) => {
      assert.doesNotThrow(fn, 'sedation callback must not throw on stale watchCb')
      return { unref() {} }
    }
    global.clearTimeout = () => {}

    Watch.dir2(reader, dirPath)
    watchListener('change', 'host.pem')
  })

  it('close() shuts the watcher, clears pending sedation timers, and is idempotent', function () {
    const Watch = loadWatch()
    const dirPath = path.resolve('test/config/close-me')
    const childFile = path.join(dirPath, 'a.ini')

    let closeCalls = 0
    let listener
    fs.watch = (target, opts, l) => {
      listener = l
      return {
        close() {
          closeCalls++
        },
        unref() {},
      }
    }

    let pendingTimer = false
    let clearedTimers = 0
    global.setTimeout = () => {
      pendingTimer = true
      return { unref() {} }
    }
    global.clearTimeout = () => {
      if (pendingTimer) {
        clearedTimers++
        pendingTimer = false
      }
    }

    const reader = {
      _read_args: {
        [dirPath]: { opts: { watchCb() {} } },
        [childFile]: { type: 'ini', options: {}, cb() {} },
      },
    }

    Watch.dir2(reader, dirPath)
    // Trigger an event so a sedation timer gets queued under dirPath.
    listener('change', 'a.ini')
    assert.ok(pendingTimer, 'a sedation timer should be pending before close')

    Watch.close(reader, dirPath)

    assert.equal(closeCalls, 1, 'fs.watch().close() must be invoked exactly once')
    assert.equal(clearedTimers, 1, 'pending sedation timer under dirPath must be cleared')
    assert.equal(reader._read_args[dirPath], undefined, 'reader._read_args entry must be removed')

    // Second close must be a no-op (no fs.watch to close, no timers to clear).
    Watch.close(reader, dirPath)
    assert.equal(closeCalls, 1, 'second close() must not invoke close again')
  })

  it('dir and dir2 callbacks reload and invoke watchCb', function () {
    const Watch = loadWatch()
    const cfgPath = path.resolve('test/config')
    const dirPath = path.resolve('test/config/dir')
    const filename = 'test.ini'
    const fullPath = path.join(cfgPath, filename)

    const reader = {
      config_path: cfgPath,
      _read_args: {
        [fullPath]: {
          type: 'ini',
          options: {},
          cb_calls: 0,
          cb() {
            this.cb_calls++
          },
        },
        [dirPath]: {
          opts: {
            watchCb_calls: 0,
            watchCb() {
              this.watchCb_calls++
            },
          },
        },
      },
      load_config_calls: 0,
      load_config() {
        this.load_config_calls++
      },
      last_load_error() {
        return undefined
      },
    }

    const watchCalls = []
    const watchers = []

    fs.watch = (target, opts, listener) => {
      watchCalls.push({ target, opts, listener })
      const w = {
        unref_calls: 0,
        close() {},
        unref() {
          this.unref_calls++
        },
      }
      watchers.push(w)
      return w
    }

    global.setTimeout = (fn) => {
      fn()
      return 1
    }
    global.clearTimeout = () => {}
    console.log = () => {}

    Watch.dir(reader)
    watchCalls[0].listener('change')
    watchCalls[0].listener('change', 'nope.ini')
    watchCalls[0].listener('change', filename)

    Watch.dir2(reader, dirPath)
    watchCalls[1].listener('change', '1.ext')

    assert.equal(reader.load_config_calls, 1)
    assert.equal(reader._read_args[fullPath].cb_calls, 1)
    assert.equal(reader._read_args[dirPath].opts.watchCb_calls, 1)
    assert.equal(watchCalls[1].opts.persistent, false)
    assert.equal(watchCalls[1].opts.recursive, /win|darwin/.test(process.platform))
    assert.equal(watchers[1].unref_calls, 1)
  })
})

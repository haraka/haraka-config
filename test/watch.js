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

  it('the enoent poller leaves a file no reader watches alone', function () {
    const Watch = loadWatch()
    const name = path.join('test', 'config', 'missing-nowatch.ini')
    const reader = {
      _read_args: {
        [name]: { readers: [{ type: 'ini', options: { no_watch: true }, cb() {} }] },
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

    fs.watch = () => {
      watchCalls++
      const err = new Error('missing')
      err.code = 'ENOENT'
      throw err
    }
    fs.stat = (file, cb) => cb(null, {})
    global.setInterval = (fn) => {
      timerFn = fn
      return { unref() {} }
    }
    console.log = () => {}

    // a watching reader queued it; only an opted-out one is left
    Watch.attach(reader, name, reader._read_args[name])
    assert.equal(watchCalls, 1)

    timerFn()

    assert.equal(reader.load_config_calls, 0, 'an opted-out reader is not reloaded')
    assert.equal(watchCalls, 1, 'and no watcher is attached for it')
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
    console.log = () => {}

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

  it('dir reloads a watching reader though a no_watch reader registered last', function () {
    const Watch = loadWatch()
    const cfgPath = path.resolve('test/config')
    const fullPath = path.join(cfgPath, 'test.ini')
    const loads = []
    const reader = {
      config_path: cfgPath,
      _read_args: {
        // the last reader to register supplies the top-level type/options
        [fullPath]: {
          type: 'ini',
          options: { no_watch: true },
          readers: [
            { type: 'ini', options: undefined, cb() {} },
            { type: 'ini', options: { no_watch: true }, cb() {} },
          ],
        },
      },
      load_config(file, type, options) {
        loads.push(options)
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
    global.setTimeout = (fn) => {
      fn()
      return 1
    }
    global.clearTimeout = () => {}
    console.log = () => {}

    Watch.dir(reader, cfgPath)
    listener('change', 'test.ini')

    assert.deepEqual(loads, [undefined], 'only the reader that wanted watching reloads')
  })

  it('dir skips a slot no reader watches', function () {
    const Watch = loadWatch()
    const cfgPath = path.resolve('test/config')
    const fullPath = path.join(cfgPath, 'test.ini')
    let scheduled = 0
    let loads = 0
    const reader = {
      config_path: cfgPath,
      _read_args: {
        [fullPath]: {
          type: 'ini',
          options: { no_watch: true },
          readers: [{ type: 'ini', options: { no_watch: true }, cb() {} }],
        },
      },
      load_config() {
        loads++
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
    global.setTimeout = (fn) => {
      scheduled++
      fn()
      return 1
    }
    global.clearTimeout = () => {}
    console.log = () => {}

    Watch.dir(reader, cfgPath)
    listener('change', 'test.ini')

    assert.equal(scheduled, 0)
    assert.equal(loads, 0)
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

  // A config.get of a file inside a getDir'd directory puts both a dir watcher
  // and a tree watcher on it, and one write wakes both. Neither attach order
  // may skip a watcher, and neither wake order may cancel the other's reload.
  function both_deliver(attach, wake) {
    const Watch = loadWatch()
    const dirPath = path.resolve('test/config/tls')
    const filePath = path.join(dirPath, 'a.ini')
    const effects = []
    const reader = {
      config_path: path.resolve('test/config'),
      _read_args: {
        [filePath]: {
          type: 'ini',
          options: undefined,
          readers: [{ type: 'ini', options: undefined, cb: () => effects.push('file-cb') }],
        },
        [dirPath]: { opts: { watchCb: () => effects.push('watchCb') } },
      },
      load_config: () => effects.push('load_config'),
      last_load_error() {
        return undefined
      },
    }

    const listeners = {}
    fs.watch = (target, opts, listener) => {
      // Watch.dir passes no `recursive`; Watch.dir2 always does
      listeners['recursive' in opts ? 'tree' : 'dir'] = listener
      return { close() {}, unref() {} }
    }
    // a real queue: clearTimeout must actually cancel, as in production
    const pending = new Map()
    let id = 0
    global.setTimeout = (fn) => {
      pending.set(++id, fn)
      return id
    }
    global.clearTimeout = (t) => pending.delete(t)
    console.log = () => {}

    const attach_watcher = {
      dir: () => Watch.dir(reader, dirPath),
      tree: () => Watch.dir2(reader, dirPath),
    }
    for (const kind of attach) attach_watcher[kind]()
    assert.deepEqual(Object.keys(listeners).toSorted(), ['dir', 'tree'], 'neither attach may be skipped')

    for (const kind of wake) listeners[kind]('change', 'a.ini')
    for (const [t, fn] of [...pending]) {
      pending.delete(t)
      fn()
    }

    assert.deepEqual(effects.toSorted(), ['file-cb', 'load_config', 'watchCb'])
  }

  const orders = [
    ['dir', 'tree'],
    ['tree', 'dir'],
  ]
  for (const attach of orders) {
    for (const wake of orders) {
      it(`dir and dir2 both deliver: attached ${attach.join(' then ')}, woken ${wake.join(' then ')}`, () =>
        both_deliver(attach, wake))
    }
  }

  it('close() drops a watcher every remaining reader opted out of', function () {
    const Watch = loadWatch()
    const name = path.join('test', 'config', 'shared.ini')
    const quiet = {}
    const active = {}
    const reader = {
      _read_args: {
        [name]: {
          type: 'ini',
          options: undefined,
          readers: [
            { type: 'ini', options: { no_watch: true }, owner: quiet, cb() {} },
            { type: 'ini', options: undefined, owner: active, cb() {} },
          ],
        },
      },
      load_config() {},
      last_load_error() {
        return undefined
      },
    }

    let closeCalls = 0
    fs.watch = () => ({
      close() {
        closeCalls++
      },
      unref() {},
    })

    Watch.file(reader, name, 'ini', null, undefined)
    Watch.close(reader, name, active)

    // Watch.reload skips opted-out readers, so this watcher would serve nobody
    assert.equal(closeCalls, 1)
  })

  it('close() unqueues a pending directory once its last file stops', function () {
    const Watch = loadWatch()
    const dirPath = path.resolve('test/config/not-yet-created')
    const filePath = path.join(dirPath, 'a.ini')
    const owner = {}
    const reader = {
      config_path: path.resolve('test/config'),
      _read_args: {
        [filePath]: {
          type: 'ini',
          options: undefined,
          readers: [{ type: 'ini', options: undefined, owner, cb() {} }],
        },
      },
      load_config() {},
      last_load_error() {
        return undefined
      },
    }

    const attached = []
    fs.watch = () => {
      const err = new Error('missing')
      err.code = 'ENOENT'
      throw err
    }
    fs.stat = (target, cb) => cb(null, {})
    let timerFn
    global.setInterval = (fn) => {
      timerFn = fn
      return { unref() {} }
    }

    Watch.dir(reader, dirPath) // ENOENT: queued for the poller, no watcher yet
    Watch.close(reader, filePath, owner)

    fs.watch = (target) => {
      attached.push(target)
      return { close() {}, unref() {} }
    }
    timerFn()

    assert.deepEqual(attached, [], 'nothing reads that directory any more')
  })

  it('close() leaves the shared directory watcher to the files still read', function () {
    const Watch = loadWatch()
    const cfgPath = path.resolve('test/config')
    const stopped = path.join(cfgPath, 'a.ini')
    const kept = path.join(cfgPath, 'b.ini')
    const reader = {
      config_path: cfgPath,
      _read_args: {
        [stopped]: { type: 'ini', options: {}, cb() {} },
        [kept]: { type: 'ini', options: {}, cb() {} },
      },
      load_config_calls: 0,
      load_config() {
        this.load_config_calls++
      },
      last_load_error() {
        return undefined
      },
    }

    const closed = []
    let listener
    fs.watch = (target, opts, l) => {
      listener = l
      return {
        close() {
          closed.push(target)
        },
        unref() {},
      }
    }
    global.setTimeout = (fn) => {
      fn()
      return 1
    }
    global.clearTimeout = () => {}
    console.log = () => {}

    Watch.dir(reader, cfgPath)
    // only the last tracked file inside it releases the dir watcher
    Watch.close(reader, stopped)
    Watch.close(reader, cfgPath)

    assert.deepEqual(closed, [], 'the dir watcher serves b.ini too')
    listener('change', 'b.ini')
    assert.equal(reader.load_config_calls, 1, 'b.ini still hot reloads')
  })

  it('dir avoids duplicate watchers on one directory', function () {
    const Watch = loadWatch()
    const cfgPath = path.resolve('test/config')
    let watchCalls = 0
    fs.watch = () => {
      watchCalls++
      return { close() {}, unref() {} }
    }

    Watch.dir({ config_path: cfgPath, _read_args: {} }, cfgPath)
    Watch.dir({ config_path: cfgPath, _read_args: {} }, cfgPath)

    assert.equal(watchCalls, 1)
  })

  it('close() drops the directory watcher once its last file stops', function () {
    const Watch = loadWatch()
    const cfgPath = path.resolve('test/config')
    const only = path.join(cfgPath, 'a.ini')
    const subdir = path.join(cfgPath, 'tls')
    const reader = {
      config_path: cfgPath,
      _read_args: {
        [only]: { type: 'ini', options: {}, cb() {} },
        // a getDir slot in the same dir must not keep the watcher alive
        [subdir]: { opts: {} },
        // nor may a file in a subdirectory: its own dir watcher serves it
        [path.join(subdir, 'deep.ini')]: { type: 'ini', options: {}, cb() {} },
      },
    }

    const closed = []
    fs.watch = (target) => ({
      close() {
        closed.push(target)
      },
      unref() {},
    })

    Watch.dir(reader, cfgPath)
    Watch.close(reader, only)

    assert.deepEqual(closed, [cfgPath])
  })

  it('close() drops only the calling owner, keeping the watcher for the rest', function () {
    const Watch = loadWatch()
    const name = path.join('test', 'config', 'shared.ini')
    const leaving = {}
    const staying = {}
    const reloaded = []
    const reader = {
      _read_args: {
        [name]: {
          type: 'list',
          options: undefined,
          readers: [
            { type: 'ini', options: undefined, owner: staying, cb: () => reloaded.push('staying') },
            { type: 'list', options: undefined, owner: leaving, cb: () => reloaded.push('leaving') },
          ],
        },
      },
      load_config() {},
      last_load_error() {
        return undefined
      },
    }

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
    global.setTimeout = (fn) => {
      fn()
      return 1
    }
    global.clearTimeout = () => {}
    console.log = () => {}

    Watch.file(reader, name, 'ini', null, {})
    Watch.close(reader, name, leaving)

    assert.equal(closeCalls, 0, 'a file another owner still reads stays watched')
    assert.equal(reader._read_args[name].type, 'ini', 'the flat fields follow a surviving registration')

    listener('change')
    assert.deepEqual(reloaded, ['staying'])

    Watch.close(reader, name, staying)
    assert.equal(closeCalls, 1)
    assert.equal(reader._read_args[name], undefined)
  })

  it('close() on a file leaves a getDir watchCb pending for its directory', function () {
    const Watch = loadWatch()
    const dirPath = path.resolve('test/config/tls')
    const filePath = path.join(dirPath, 'a.pem')
    const owner = {}
    const effects = []
    const reader = {
      _read_args: {
        [dirPath]: { opts: { watchCb: () => effects.push('watchCb') } },
        [filePath]: {
          type: 'binary',
          options: undefined,
          readers: [{ type: 'binary', options: undefined, owner, cb() {} }],
        },
      },
      load_config() {},
      last_load_error() {
        return undefined
      },
    }

    let treeListener
    fs.watch = (target, opts, listener) => {
      if ('recursive' in opts) treeListener = listener
      return { close() {}, unref() {} }
    }
    const pending = new Map()
    let id = 0
    global.setTimeout = (fn) => {
      pending.set(++id, fn)
      return id
    }
    global.clearTimeout = (t) => pending.delete(t)

    Watch.dir2(reader, dirPath)
    treeListener('change', 'a.pem')
    // another owner stops that one file while the directory's watchCb is pending
    Watch.close(reader, filePath, owner)
    for (const [t, fn] of [...pending]) {
      pending.delete(t)
      fn()
    }

    assert.deepEqual(effects, ['watchCb'], 'the getDir consumer still hears about its directory')
  })

  it('onEvent does not reload a slot that has become a getDir target', function () {
    const Watch = loadWatch()
    const name = path.resolve('test/config/tls')
    const loads = []
    const reader = {
      _read_args: { [name]: { type: 'binary', options: undefined, cb() {} } },
      load_config: (file) => loads.push(file),
      last_load_error() {
        return undefined
      },
    }

    let listener
    fs.watch = (target, opts, l) => {
      listener = l
      return { close() {}, unref() {} }
    }
    global.setTimeout = (fn) => {
      fn()
      return 1
    }
    global.clearTimeout = () => {}
    console.log = () => {}

    Watch.file(reader, name, 'binary', null, undefined)
    reader._read_args[name] = { opts: { watchCb() {} } } // a getDir of the same path
    listener('change')

    assert.deepEqual(loads, [], 'load_config on a directory would throw EISDIR')
  })

  it('close() without an owner speaks for every owner', function () {
    const Watch = loadWatch()
    const name = path.join('test', 'config', 'shared.ini')
    const reader = {
      _read_args: {
        [name]: {
          type: 'ini',
          options: undefined,
          readers: [
            { type: 'ini', options: undefined, owner: {}, cb() {} },
            { type: 'ini', options: undefined, owner: {}, cb() {} },
          ],
        },
      },
      load_config() {},
      last_load_error() {
        return undefined
      },
    }

    let closeCalls = 0
    fs.watch = () => ({
      close() {
        closeCalls++
      },
      unref() {},
    })

    Watch.file(reader, name, 'ini', null, undefined)
    Watch.close(reader, name)

    assert.equal(closeCalls, 1)
    assert.equal(reader._read_args[name], undefined)
  })

  it('closeAll() closes every kind of watcher', function () {
    const Watch = loadWatch()
    const cfgPath = path.resolve('test/config')
    const filePath = path.join(cfgPath, 'a.ini')
    const treePath = path.join(cfgPath, 'tls')
    const reader = {
      config_path: cfgPath,
      _read_args: { [treePath]: { opts: { watchCb() {} } } },
      load_config() {},
      last_load_error() {
        return undefined
      },
    }

    const closed = []
    fs.watch = (target) => ({
      close() {
        closed.push(target)
      },
      unref() {},
    })

    Watch.file(reader, filePath, 'ini', null, undefined)
    Watch.dir(reader, cfgPath)
    Watch.dir2(reader, treePath)

    Watch.closeAll()

    assert.deepEqual(closed.toSorted(), [filePath, cfgPath, treePath].toSorted())
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

  describe('reload with several readers', function () {
    it('reload calls the callback of every reader of a file', function () {
      const Watch = loadWatch()
      const called = []
      const reader = {
        load_config() {},
        last_load_error() {},
      }
      const one = { type: 'list', options: undefined, cb: () => called.push('one') }
      const two = { type: 'list', options: undefined, cb: () => called.push('two') }

      console.log = () => {}
      Watch.reload(reader, 'test/config/host_list', { ...two, readers: [one, two] })

      assert.deepEqual(called, ['one', 'two'])
    })

    it('reload refreshes the cache entry each reader reads', function () {
      const Watch = loadWatch()
      const loaded = []
      const reader = {
        load_config(name, type, options) {
          loaded.push([type, options])
        },
        last_load_error() {},
      }
      const list = { type: 'list', options: undefined, cb() {} }
      const value = { type: 'value', options: { booleans: ['a.b'] }, cb() {} }

      console.log = () => {}
      Watch.reload(reader, 'test/config/shared.ini', { ...value, readers: [list, value] })

      assert.deepEqual(loaded, [
        ['list', undefined],
        ['value', { booleans: ['a.b'] }],
      ])
    })

    it('reload without readers uses the single registration', function () {
      const Watch = loadWatch()
      let called = 0
      const reader = {
        load_config() {},
        last_load_error() {},
      }

      console.log = () => {}
      Watch.reload(reader, 'test/config/test.ini', { type: 'ini', options: undefined, cb: () => called++ })

      assert.equal(called, 1)
    })

    it('a throwing callback does not stop the other readers', function () {
      const Watch = loadWatch()
      const loaded = []
      const errors = []
      const reader = {
        load_config(name, type) {
          loaded.push(type)
        },
        last_load_error() {},
      }

      console.error = (...args) => errors.push(args)
      console.log = () => {}

      Watch.reload(reader, 'shared.ini', {
        readers: [
          {
            type: 'ini',
            options: undefined,
            cb() {
              throw new Error('plugin blew up')
            },
          },
          { type: 'list', options: undefined, cb() {} },
        ],
      })

      assert.deepEqual(loaded, ['ini', 'list'])
      assert.match(errors[0][0], /Reload callback for shared.ini threw:/)
      assert.equal(errors[0][1].message, 'plugin blew up')
    })

    it('reload announces a failure raised by any reader', function () {
      const Watch = loadWatch()
      const errors = []
      const logs = []
      const reader = {
        load_config() {},
        last_load_error(name, type, options) {
          return options ? new Error('bad parse') : undefined
        },
      }

      console.error = (msg) => errors.push(msg)
      console.log = (msg) => logs.push(msg)

      const err = Watch.reload(reader, 'shared.ini', {
        readers: [
          { type: 'ini', options: undefined, cb() {} },
          { type: 'ini', options: { a: 1 }, cb() {} },
        ],
      })

      assert.equal(err.message, 'bad parse')
      assert.deepEqual(logs, [])
      assert.equal(errors.length, 1)
      assert.match(errors[0], /bad parse/)
    })

    it('reload skips a reader that asked for no_watch', function () {
      const Watch = loadWatch()
      const loaded = []
      const called = []
      const reader = {
        load_config(name, type, options) {
          loaded.push(options)
        },
        last_load_error() {},
      }

      console.log = () => {}
      Watch.reload(reader, 'shared.ini', {
        readers: [
          { type: 'ini', options: undefined, cb: () => called.push('watching') },
          { type: 'ini', options: { no_watch: true }, cb: () => called.push('no_watch') },
        ],
      })

      assert.deepEqual(called, ['watching'])
      assert.deepEqual(loaded, [undefined])
    })

    it('reload is silent when every reader asked for no_watch', function () {
      const Watch = loadWatch()
      const logs = []
      let loads = 0
      let calls = 0
      const reader = {
        load_config() {
          loads++
        },
        last_load_error() {},
      }

      console.log = (msg) => logs.push(msg)
      const err = Watch.reload(reader, 'shared.ini', {
        readers: [{ type: 'ini', options: { no_watch: true }, cb: () => calls++ }],
      })

      assert.equal(loads, 0)
      assert.equal(calls, 0)
      assert.equal(err, undefined)
      assert.deepEqual(logs, [], 'nothing was reloaded, so nothing is announced')
    })

    it('owners reading a file alike share one parse', function () {
      const Watch = loadWatch()
      const loaded = []
      const called = []
      const reader = {
        load_config(name, type, options) {
          loaded.push([type, options])
        },
        last_load_error() {},
      }
      const options = { booleans: ['main.bool'] }

      console.log = () => {}
      Watch.reload(reader, 'shared.ini', {
        readers: [
          { type: 'ini', options, cb: () => called.push('one') },
          // a second owner, equal options by value, its own object
          { type: 'ini', options: { ...options }, cb: () => called.push('two') },
          { type: 'list', options: undefined, cb: () => called.push('three') },
        ],
      })

      assert.deepEqual(
        loaded,
        [
          ['ini', options],
          ['list', undefined],
        ],
        'one parse per type+options, not one per owner',
      )
      assert.deepEqual(called, ['one', 'two', 'three'])
    })

    // Neither survives interpolation: no .message, no string form.
    for (const [label, thrown] of [
      ['null', null],
      ['an object with no prototype', Object.create(null)],
    ]) {
      it(`a callback throwing ${label} does not abort the reload`, function () {
        const Watch = loadWatch()
        const loaded = []
        const errors = []
        const reader = {
          load_config(name, type) {
            loaded.push(type)
          },
          last_load_error() {},
        }

        console.error = (...args) => errors.push(args)
        console.log = () => {}

        Watch.reload(reader, 'shared.ini', {
          readers: [
            {
              type: 'ini',
              cb() {
                throw thrown
              },
            },
            { type: 'list', cb() {} },
          ],
        })

        assert.deepEqual(loaded, ['ini', 'list'], 'the reader after the thrower still reloads')
        assert.match(errors[0][0], /Reload callback for shared.ini threw:/)
        assert.equal(errors[0][1], thrown)
      })
    }
  })
})

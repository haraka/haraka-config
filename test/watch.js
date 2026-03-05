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
  let consoleError
  let consoleLog

  beforeEach(function () {
    fsWatch = fs.watch
    fsStat = fs.stat
    setTimeoutFn = global.setTimeout
    clearTimeoutFn = global.clearTimeout
    setIntervalFn = global.setInterval
    consoleError = console.error
    consoleLog = console.log
  })

  afterEach(function () {
    fs.watch = fsWatch
    fs.stat = fsStat
    global.setTimeout = setTimeoutFn
    global.clearTimeout = clearTimeoutFn
    global.setInterval = setIntervalFn
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

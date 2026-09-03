'use strict'

const assert = require('node:assert/strict')
const { afterEach, beforeEach, describe, it } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// fs.watch is mocked here; the platform only decides whether files get their
// own watchers, so default to one where they do not and counts stay deterministic
function loadWatch(platform = 'linux') {
  const saved = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    delete require.cache[require.resolve('../lib/watch')]
    return require('../lib/watch')
  } finally {
    Object.defineProperty(process, 'platform', saved)
  }
}

const enoent = () => Object.assign(new Error('missing'), { code: 'ENOENT' })
const emfile = () => Object.assign(new Error('too many open files'), { code: 'EMFILE' })

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
  let tick
  let intervalsCleared
  let tmp

  beforeEach(function () {
    Object.assign(saved, {
      watch: fs.watch,
      setTimeout: global.setTimeout,
      clearTimeout: global.clearTimeout,
      setInterval: global.setInterval,
      clearInterval: global.clearInterval,
      error: console.error,
      log: console.log,
    })
    watchCalls.length = 0
    watchers.length = 0
    tick = undefined
    intervalsCleared = 0
    tmp = undefined
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
    // sedation timers fire immediately; the reconcile interval is run by hand
    global.setTimeout = (fn) => {
      fn()
      return 1
    }
    global.clearTimeout = () => {}
    global.setInterval = (fn) => {
      tick = fn
      return { unref() {} }
    }
    global.clearInterval = () => intervalsCleared++
    console.log = () => {}
  })

  afterEach(function () {
    fs.watch = saved.watch
    global.setTimeout = saved.setTimeout
    global.clearTimeout = saved.clearTimeout
    global.setInterval = saved.setInterval
    global.clearInterval = saved.clearInterval
    console.error = saved.error
    console.log = saved.log
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
    delete require.cache[require.resolve('../lib/watch')]
  })

  const cfgPath = path.resolve('test/config')
  const subDir = path.join(cfgPath, 'dir')

  // a private directory of real files: the watcher decides by stat what changed
  function files(...names) {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hc-watch-')))
    const dir = path.join(tmp, 'config')
    fs.mkdirSync(dir)
    for (const name of names) fs.writeFileSync(path.join(dir, name), `${name} v1`)
    return dir
  }
  const grow = (file) => fs.appendFileSync(file, ' changed')

  // fs.watch fails while its target is missing, as the real one does
  function realistic() {
    const plainWatch = fs.watch
    fs.watch = (target, ...rest) => {
      if (!fs.existsSync(target)) throw enoent()
      return plainWatch(target, ...rest)
    }
  }

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

  it('a named event for a tracked file reloads it and invokes its callback', function () {
    const Watch = loadWatch()
    const file = path.join(subDir, 'test.ini')
    const reader = mockReader({ [file]: fileSlot() })

    Watch.dir(reader, subDir)
    watchCalls[0].listener('change', 'untracked.ini')
    watchCalls[0].listener('change', 'test.ini')

    assert.equal(reader.load_config_calls, 1)
    assert.equal(reader._read_args[file].cb_calls, 1)
  })

  it('an event naming no tracked file reloads only what changed', function () {
    const Watch = loadWatch()
    const dir = files('a.ini', 'b.ini')
    const a = path.join(dir, 'a.ini')
    const b = path.join(dir, 'b.ini')
    const reader = mockReader({ [a]: fileSlot(), [b]: fileSlot() })
    Watch.file(reader, a)
    Watch.file(reader, b)

    grow(a)
    watchCalls[0].listener('change') // some platforms name nothing
    assert.equal(reader.load_config_calls, 1)
    assert.equal(reader._read_args[a].cb_calls, 1)

    watchCalls[0].listener('rename', path.basename(dir)) // kqueue names the directory itself
    assert.equal(reader.load_config_calls, 1, 'nothing changed since')

    grow(b)
    watchCalls[0].listener('rename', path.basename(dir))
    assert.equal(reader.load_config_calls, 2)
    assert.equal(reader._read_args[b].cb_calls, 1)
  })

  it('a config read from its fallback reloads when the fallback changes', function () {
    const Watch = loadWatch()
    const dir = files('x.yaml')
    const json = path.join(dir, 'x.json')
    const yaml = path.join(dir, 'x.yaml')
    const reader = mockReader({ [json]: { ...fileSlot(), type: 'json', fallbacks: [yaml] } })
    Watch.file(reader, json)

    grow(yaml)
    watchCalls[0].listener('change', 'x.yaml')

    assert.equal(reader.load_config_calls, 1)
    assert.equal(reader._read_args[json].cb_calls, 1)
  })

  it('a fallback is ignored while the requested file exists', function () {
    const Watch = loadWatch()
    const dir = files('x.json', 'x.yaml')
    const json = path.join(dir, 'x.json')
    const yaml = path.join(dir, 'x.yaml')
    const reader = mockReader({ [json]: { ...fileSlot(), type: 'json', fallbacks: [yaml] } })
    Watch.file(reader, json)

    grow(yaml)
    watchCalls[0].listener('change', 'x.yaml')
    assert.equal(reader.load_config_calls, 0)

    fs.unlinkSync(json)
    watchCalls[0].listener('rename', 'x.json')
    assert.equal(reader.load_config_calls, 1, 'the fallback takes over')

    grow(yaml)
    watchCalls[0].listener('change', 'x.yaml')
    assert.equal(reader.load_config_calls, 2, 'and is now the file that matters')
  })

  it('a directory watched by a relative path reloads its relative slots', function () {
    const Watch = loadWatch()
    const dir = path.join('test', 'config')
    const file = path.join(dir, 'test.ini')
    const reader = mockReader({ [file]: fileSlot() })

    Watch.dir(reader, dir)
    watchCalls[0].listener('change', 'test.ini')

    assert.equal(reader.load_config_calls, 1)
  })

  it('uses an absolute filename from a recursive watcher as is', function () {
    const Watch = loadWatch()
    const nested = path.join(subDir, 'sub', 'x.ini')
    const reader = mockReader({ [nested]: fileSlot() })

    Watch.dir(reader, subDir, { recursive: true })
    watchCalls[0].listener('change', nested)

    assert.equal(reader.load_config_calls, 1)
  })

  it('reloads with the read args current when the timer fires', function () {
    const Watch = loadWatch()
    const file = path.join(subDir, 'test.ini')
    const reader = mockReader({ [file]: fileSlot() })
    const types = []
    reader.load_config = (name, type) => types.push(type)
    let pending
    global.setTimeout = (fn) => {
      pending = fn
      return 1
    }

    Watch.dir(reader, subDir)
    watchCalls[0].listener('change', 'test.ini')
    reader._read_args[file] = { ...fileSlot(), type: 'value' } // read again during the debounce
    pending()
    assert.deepEqual(types, ['value'])

    watchCalls[0].listener('change', 'test.ini')
    delete reader._read_args[file] // stopped during the debounce
    pending()
    assert.deepEqual(types, ['value'], 'a stopped file is not reloaded')
  })

  it('dir skips no_watch slots', function () {
    const Watch = loadWatch()
    const file = path.join(subDir, 'test.ini')
    const reader = mockReader({ [file]: { type: 'ini', options: { no_watch: true } } })

    Watch.dir(reader, subDir)
    watchCalls[0].listener('change', 'test.ini')

    assert.equal(reader.load_config_calls, 0)
  })

  it('dir skips getDir slots so it cannot load_config a directory (EISDIR)', function () {
    const Watch = loadWatch()
    const reader = mockReader({ [subDir]: dirSlot() })

    Watch.dir(reader, cfgPath)
    watchCalls[0].listener('change', 'dir')

    assert.equal(reader.load_config_calls, 0)
  })

  it('one watcher serves file reloads and a getDir watchCb on the same directory', function () {
    const Watch = loadWatch()
    const file = path.join(subDir, 'a.pem')
    const reader = mockReader({ [subDir]: dirSlot(), [file]: fileSlot() })

    Watch.dir(reader, subDir)
    Watch.dir(reader, subDir, { recursive: true })
    watchCalls.at(-1).listener('change', 'a.pem')

    assert.equal(reader.load_config_calls, 1)
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

  it('falls back to a plain watcher where fs.watch cannot recurse', function () {
    const Watch = loadWatch()
    const plainWatch = fs.watch
    fs.watch = (target, opts, listener) => {
      if (opts.recursive) throw Object.assign(new Error('unsupported'), { code: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' })
      return plainWatch(target, opts, listener)
    }
    const reader = mockReader()

    Watch.dir(reader, subDir, { recursive: true })
    assert.equal(watchCalls.length, 1)
    assert.equal(watchCalls[0].opts.recursive, undefined)

    Watch.dir(reader, subDir, { recursive: true })
    assert.equal(watchCalls.length, 1, 'the fallback is not retried')
  })

  it('ignores a watchCb that is not a function', function () {
    const Watch = loadWatch()
    const reader = mockReader({ [subDir]: { opts: { watchCb: 'nope' } } })

    Watch.dir(reader, subDir, { recursive: true })

    assert.doesNotThrow(() => watchCalls[0].listener('change', 'a.pem'))
  })

  it('watchCb tolerates a slot torn down before the sedation timer fires', function () {
    const Watch = loadWatch()
    let pending
    global.setTimeout = (fn) => {
      pending = fn
      return 1
    }
    const reader = mockReader({ [subDir]: dirSlot() })

    Watch.dir(reader, subDir, { recursive: true })
    watchCalls[0].listener('change', 'a.pem')
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

  it('a slot re-read with no_watch releases what only it needed', function () {
    const Watch = loadWatch()
    const file = path.join(subDir, 'test.ini')
    const reader = mockReader({ [file]: fileSlot() })
    Watch.file(reader, file)
    assert.equal(watchCalls.length, 1)

    reader._read_args[file].options = { no_watch: true }
    Watch.file(reader, file)

    assert.equal(watchers[0].close_calls, 1)
    assert.equal(intervalsCleared, 1)
  })

  describe('where directory events do not report writes', function () {
    const file = path.join(subDir, 'test.ini')

    it('linux, darwin and win32 rely on the directory watcher alone', function () {
      for (const os of ['linux', 'darwin', 'win32']) {
        const Watch = loadWatch(os)
        Watch.file(mockReader({ [file]: fileSlot() }), file)
        assert.deepEqual(
          watchCalls.map((c) => c.target),
          [subDir],
          os,
        )
        Watch.closeAll()
        watchCalls.length = 0
      }
    })

    it('each tracked file gets its own watcher, and its change event reloads it', function () {
      const Watch = loadWatch('freebsd')
      const reader = mockReader({ [file]: fileSlot() })

      Watch.file(reader, file)
      assert.deepEqual(
        watchCalls.map((c) => c.target),
        [subDir, file],
      )

      watchCalls[1].listener('change')
      assert.equal(reader.load_config_calls, 1)
      assert.equal(reader._read_args[file].cb_calls, 1)
    })

    it('a rename event drops the file watcher, and the reload re-attaches it', function () {
      const Watch = loadWatch('freebsd')
      const reader = mockReader({ [file]: fileSlot() })
      Watch.file(reader, file)

      watchCalls[1].listener('rename')

      assert.equal(reader.load_config_calls, 1)
      assert.equal(watchers[1].close_calls, 1)
      assert.deepEqual(
        watchCalls.map((c) => c.target),
        [subDir, file, file],
      )
    })

    it('a missing file is left to its directory watcher', function () {
      const Watch = loadWatch('freebsd')
      const plainWatch = fs.watch
      let exists = false
      fs.watch = (target, ...rest) => {
        if (target === file && !exists) throw enoent()
        return plainWatch(target, ...rest)
      }
      const errors = []
      console.error = (msg) => errors.push(msg)
      const reader = mockReader({ [file]: fileSlot() })

      Watch.file(reader, file)
      assert.deepEqual(
        watchCalls.map((c) => c.target),
        [subDir],
      )
      assert.deepEqual(errors, [])

      exists = true
      watchCalls[0].listener('rename', 'test.ini')
      assert.equal(reader.load_config_calls, 1)
      assert.deepEqual(
        watchCalls.map((c) => c.target),
        [subDir, file],
      )
    })

    it('the file actually read is watched, a fallback included', function () {
      const Watch = loadWatch('freebsd')
      const dir = files('x.yaml')
      const json = path.join(dir, 'x.json')
      const yaml = path.join(dir, 'x.yaml')
      const reader = mockReader({ [json]: { ...fileSlot(), type: 'json', fallbacks: [yaml] } })

      Watch.file(reader, json)

      assert.deepEqual(
        watchCalls.map((c) => c.target),
        [dir, yaml],
      )
    })

    it('a reload reopens the file watcher on what the name resolves to now', function () {
      const Watch = loadWatch('freebsd')
      const dir = files('v1.pem', 'v2.pem')
      const link = path.join(dir, 'cert.pem')
      fs.symlinkSync(path.join(dir, 'v1.pem'), link)
      const reader = mockReader({ [link]: fileSlot() })
      Watch.file(reader, link)
      assert.deepEqual(
        watchCalls.map((c) => c.target),
        [dir, link],
      )

      fs.unlinkSync(link)
      fs.symlinkSync(path.join(dir, 'v2.pem'), link)
      Watch.reconcile(reader)

      assert.equal(reader.load_config_calls, 1)
      assert.equal(watchers[1].close_calls, 1)
      assert.deepEqual(
        watchCalls.map((c) => c.target),
        [dir, link, link],
      )
    })
  })

  describe('a symlinked config', function () {
    it('reloads within a pass of its target changing', function () {
      const Watch = loadWatch()
      const dir = files()
      fs.mkdirSync(path.join(tmp, 'real'))
      const target = path.join(tmp, 'real', 'cert.pem')
      fs.writeFileSync(target, 'v1')
      const link = path.join(dir, 'cert.pem')
      fs.symlinkSync(target, link)
      const reader = mockReader({ [link]: fileSlot() })
      Watch.file(reader, link)

      Watch.reconcile(reader)
      assert.equal(reader.load_config_calls, 0, 'nothing changed')

      grow(target)
      Watch.reconcile(reader)
      assert.equal(reader.load_config_calls, 1)
      assert.equal(reader._read_args[link].cb_calls, 1)
    })

    it('a retargeted link is caught however deep it sits (cert.pem -> ..data/cert.pem)', function () {
      const Watch = loadWatch()
      const dir = files()
      const link = path.join(dir, 'cert.pem')
      const version = (v) => {
        fs.mkdirSync(path.join(dir, v))
        fs.writeFileSync(path.join(dir, v, 'cert.pem'), v)
      }
      version('..v1')
      fs.symlinkSync('..v1', path.join(dir, '..data'))
      fs.symlinkSync(path.join('..data', 'cert.pem'), link)
      const reader = mockReader({ [link]: fileSlot() })
      Watch.file(reader, link)

      version('..v2')
      fs.rmSync(path.join(dir, '..data'))
      fs.symlinkSync('..v2', path.join(dir, '..data'))
      Watch.reconcile(reader)

      assert.equal(reader.load_config_calls, 1)
    })

    it('a dangling link reloads when its target returns', function () {
      const Watch = loadWatch()
      const dir = files()
      const target = path.join(tmp, 'cert.pem')
      fs.writeFileSync(target, 'v1')
      const link = path.join(dir, 'cert.pem')
      fs.symlinkSync(target, link)
      const reader = mockReader({ [link]: fileSlot() })
      Watch.file(reader, link)

      fs.unlinkSync(target)
      Watch.reconcile(reader)
      assert.equal(reader.load_config_calls, 1, 'gone')

      fs.writeFileSync(target, 'v2')
      Watch.reconcile(reader)
      assert.equal(reader.load_config_calls, 2, 'back')
    })
  })

  describe('reconcile', function () {
    it('runs on an interval that starts with the first watch and stops when nothing is tracked', function () {
      const Watch = loadWatch()
      const file = path.join(subDir, 'test.ini')
      const reader = mockReader({ [file]: fileSlot() })
      assert.equal(tick, undefined)

      Watch.file(reader, file)
      assert.equal(typeof tick, 'function')

      Watch.close(reader, file)
      assert.equal(intervalsCleared, 1)
    })

    it('attaches a missing directory once it exists, and notifies its getDir consumer', function () {
      const Watch = loadWatch()
      realistic()
      const errors = []
      console.error = (msg) => errors.push(msg)
      tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hc-watch-')))
      const dir = path.join(tmp, 'config')
      const reader = mockReader({ [dir]: dirSlot() })

      Watch.dir(reader, dir, { recursive: true })
      assert.deepEqual(watchCalls, [])
      assert.deepEqual(errors, [], 'a missing directory is not news')

      tick()
      assert.deepEqual(watchCalls, [], 'still missing')

      fs.mkdirSync(dir)
      tick()
      assert.equal(watchCalls.length, 1)
      assert.equal(watchCalls[0].opts.recursive, true)
      assert.equal(reader._read_args[dir].opts.watchCb_calls, 1)
    })

    it('reloads a config whose file changed without an event, and nothing else', function () {
      const Watch = loadWatch()
      const dir = files('a.ini', 'b.ini')
      const a = path.join(dir, 'a.ini')
      const b = path.join(dir, 'b.ini')
      const reader = mockReader({ [a]: fileSlot(), [b]: fileSlot() })
      Watch.file(reader, a)
      Watch.file(reader, b)

      tick()
      assert.equal(reader.load_config_calls, 0)

      grow(a)
      tick()
      assert.equal(reader.load_config_calls, 1)
      assert.equal(reader._read_args[a].cb_calls, 1)
      assert.equal(reader._read_args[b].cb_calls, 0)

      tick()
      assert.equal(reader.load_config_calls, 1, 'a reload records what it read')
    })

    it("a reload's callback may stop a sibling before the pass reaches it", function () {
      const Watch = loadWatch()
      const dir = files('a.ini', 'b.ini')
      const a = path.join(dir, 'a.ini')
      const b = path.join(dir, 'b.ini')
      const reader = mockReader({ [a]: { ...fileSlot(), cb: () => Watch.close(reader, b) }, [b]: fileSlot() })
      Watch.file(reader, a)
      Watch.file(reader, b)

      grow(a)
      grow(b)
      tick()

      assert.equal(reader.load_config_calls, 1, "b was stopped by a's callback")
      assert.equal(reader._read_args[b], undefined)
    })

    it('follows the fallback as the requested file comes and goes', function () {
      const Watch = loadWatch()
      const dir = files('x.json')
      const json = path.join(dir, 'x.json')
      const yaml = path.join(dir, 'x.yaml')
      const reader = mockReader({ [json]: { ...fileSlot(), type: 'json', fallbacks: [yaml] } })
      Watch.file(reader, json)

      fs.unlinkSync(json)
      fs.writeFileSync(yaml, 'k: v')
      tick()
      assert.equal(reader.load_config_calls, 1)

      fs.writeFileSync(json, '{"k":"back"}')
      tick()
      assert.equal(reader.load_config_calls, 2)
    })

    it('rewatches a directory swapped under its watcher, and reloads its configs', function () {
      const Watch = loadWatch()
      const dir = files('a.ini')
      const a = path.join(dir, 'a.ini')
      const reader = mockReader({ [a]: fileSlot() })
      Watch.file(reader, a)

      fs.mkdirSync(path.join(tmp, 'config.new'))
      fs.writeFileSync(path.join(tmp, 'config.new', 'a.ini'), 'a.ini v2')
      fs.rmSync(dir, { recursive: true })
      fs.renameSync(path.join(tmp, 'config.new'), dir)
      tick()

      assert.equal(watchers[0].close_calls, 1)
      assert.equal(watchCalls.length, 2)
      assert.equal(reader.load_config_calls, 1)
    })

    it('leaves a vanished directory for a later pass', function () {
      const Watch = loadWatch()
      realistic()
      const dir = files()
      const reader = mockReader({ [dir]: dirSlot() })
      Watch.dir(reader, dir, { recursive: true })

      fs.rmdirSync(dir)
      tick()
      assert.equal(watchers[0].close_calls, 1)
      assert.equal(watchCalls.length, 1)

      fs.mkdirSync(dir)
      tick()
      assert.equal(watchCalls.length, 2)
      assert.equal(reader._read_args[dir].opts.watchCb_calls, 1)
    })

    it('a reload made by the pass cancels the same reload an event had queued', function () {
      const Watch = loadWatch()
      const timers = new Map()
      let next = 0
      global.setTimeout = (fn) => {
        timers.set(++next, fn)
        return next
      }
      global.clearTimeout = (id) => timers.delete(id)
      const dir = files('a.ini')
      const a = path.join(dir, 'a.ini')
      const reader = mockReader({ [a]: fileSlot() })
      Watch.file(reader, a)

      grow(a)
      watchCalls[0].listener('change', 'a.ini')
      assert.equal(timers.size, 1, 'a reload is queued')

      tick()
      assert.equal(reader.load_config_calls, 1)
      assert.equal(timers.size, 0, 'and the queued one is cancelled')
    })

    it('a getDir tree is fingerprinted when its watcher attaches, so nothing before the first pass is lost', function () {
      const Watch = loadWatch()
      const dir = files('a.ini')
      const reader = mockReader({ [dir]: dirSlot() })
      Watch.dir(reader, dir, { recursive: true })

      fs.writeFileSync(path.join(dir, 'b.ini'), 'b') // its event was missed
      tick()

      assert.equal(reader._read_args[dir].opts.watchCb_calls, 1)
    })

    it('the fingerprint follows a symlinked subdirectory, once', function () {
      const Watch = loadWatch()
      const dir = files('a.ini')
      fs.mkdirSync(path.join(tmp, 'linked'))
      fs.writeFileSync(path.join(tmp, 'linked', 'k.pem'), 'k v1')
      fs.symlinkSync(path.join(tmp, 'linked'), path.join(dir, 'sub'))
      fs.symlinkSync(dir, path.join(dir, 'loop'))
      const reader = mockReader({ [dir]: dirSlot() })
      Watch.dir(reader, dir, { recursive: true })
      const told = () => reader._read_args[dir].opts.watchCb_calls

      tick()
      assert.equal(told(), 0)

      grow(path.join(tmp, 'linked', 'k.pem'))
      tick()
      assert.equal(told(), 1)
    })

    it('tells a getDir consumer about a change anywhere in its tree that produced no event', function () {
      const Watch = loadWatch()
      const dir = files('a.ini')
      fs.mkdirSync(path.join(dir, 'sub'))
      fs.writeFileSync(path.join(dir, 'sub', 'b.ini'), 'b v1')
      const reader = mockReader({ [dir]: dirSlot() })
      Watch.dir(reader, dir, { recursive: true })
      const told = () => reader._read_args[dir].opts.watchCb_calls

      tick()
      assert.equal(told(), 0, 'nothing changed')

      fs.writeFileSync(path.join(dir, 'sub', 'c.ini'), 'c') // nested: the root's own mtime does not move
      tick()
      assert.equal(told(), 1)
      tick()
      assert.equal(told(), 1, 'told once')

      grow(path.join(dir, 'sub', 'b.ini')) // an in-place edit, which kqueue never reports
      tick()
      assert.equal(told(), 2)

      fs.writeFileSync(path.join(dir, 'd.ini'), 'd')
      watchCalls[0].listener('rename', 'd.ini')
      assert.equal(told(), 3, 'an event still tells it at once')
      tick()
      assert.equal(told(), 3, 'and the pass does not repeat it')
    })

    it('retries a failed recursive upgrade, keeping the plain watcher meanwhile', function () {
      const Watch = loadWatch()
      let refuse = true
      const plainWatch = fs.watch
      fs.watch = (target, opts, listener) => {
        if (opts.recursive && refuse) throw emfile()
        return plainWatch(target, opts, listener)
      }
      const errors = []
      console.error = (msg) => errors.push(msg)
      const reader = mockReader({ [path.join(subDir, '1.ext')]: fileSlot(), [subDir]: dirSlot() })
      Watch.dir(reader, subDir)

      Watch.dir(reader, subDir, { recursive: true })
      assert.equal(errors.length, 1)
      assert.equal(watchers[0].close_calls, 0, 'the plain watcher survives')

      tick()
      assert.equal(errors.length, 1, 'retries are quiet')

      refuse = false
      tick()
      assert.equal(watchCalls.length, 2)
      assert.equal(watchCalls[1].opts.recursive, true)
      assert.equal(watchers[0].close_calls, 1)
      assert.equal(reader._read_args[subDir].opts.watchCb_calls, 1, 'the getDir consumer is told to re-read')
      assert.equal(reader.load_config_calls, 0, 'an upgrade is not a change')
    })

    it('logs a failure once, then stops trying when the slot is gone', function () {
      const Watch = loadWatch()
      fs.watch = () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' })
      }
      const errors = []
      console.error = (msg) => errors.push(msg)
      const file = path.join(subDir, 'test.ini')
      const reader = mockReader({ [file]: fileSlot() })

      Watch.file(reader, file)
      assert.equal(errors.length, 1)
      tick()
      assert.equal(errors.length, 1)

      Watch.close(reader, file)
      assert.equal(intervalsCleared, 1, 'nothing left to reconcile')
    })

    it("a watcher's 'error' event drops it and reopens it at once", function () {
      const Watch = loadWatch()
      const handlers = {}
      const plainWatch = fs.watch
      fs.watch = (...args) => Object.assign(plainWatch(...args), { on: (ev, fn) => (handlers[ev] = fn) })
      const errors = []
      console.error = (msg) => errors.push(msg)
      const reader = mockReader()

      Watch.dir(reader, subDir)
      const stale = handlers.error
      stale(new Error('EPERM'))
      assert.equal(errors.length, 1)
      assert.equal(watchers[0].close_calls, 1)
      assert.equal(watchCalls.length, 2, 'reopened')

      stale(new Error('late'))
      assert.equal(watchCalls.length, 2, 'an error from the replaced watcher is ignored')
      assert.equal(errors.length, 1, 'and not logged')
    })

    it('an obsolete recursive wish dies with its getDir slot', function () {
      const Watch = loadWatch()
      const plainWatch = fs.watch
      fs.watch = (target, opts, listener) => {
        if (opts.recursive) throw emfile()
        return plainWatch(target, opts, listener)
      }
      console.error = () => {}
      const reader = mockReader({ [path.join(subDir, '1.ext')]: fileSlot(), [subDir]: dirSlot() })
      Watch.dir(reader, subDir)
      Watch.dir(reader, subDir, { recursive: true })

      Watch.close(reader, subDir)
      tick()

      assert.equal(watchCalls.length, 1, 'no further upgrade attempt')
      assert.equal(watchers[0].close_calls, 0, 'the plain watcher the file needs stays')
    })
  })

  describe('close', function () {
    it("clears the target's pending debounces, removes its slot, and is idempotent", function () {
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
      assert.equal(pending.size, 2, 'a check of the directory and its watchCb')

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

    it("closing a directory's last slot clears its pending check", function () {
      const Watch = loadWatch()
      const timers = new Map()
      let next = 0
      global.setTimeout = (fn) => {
        timers.set(++next, fn)
        return next
      }
      global.clearTimeout = (id) => timers.delete(id)
      const file = path.join(subDir, 'test.ini')
      const reader = mockReader({ [file]: fileSlot() })

      Watch.dir(reader, subDir)
      watchCalls[0].listener('change')
      assert.equal(timers.size, 1, 'a check of the directory is pending')

      Watch.close(reader, file)
      assert.equal(timers.size, 0)
      assert.equal(watchers[0].close_calls, 1)
    })

    it('stopping a getDir() slot keeps a pending check for the children sharing its watcher', function () {
      const Watch = loadWatch()
      const timers = new Map()
      let next = 0
      global.setTimeout = (fn) => {
        timers.set(++next, fn)
        return next
      }
      global.clearTimeout = (id) => timers.delete(id)
      const dir = files('a.ini')
      const a = path.join(dir, 'a.ini')
      const reader = mockReader({ [dir]: dirSlot(), [a]: fileSlot() })
      Watch.file(reader, a)
      Watch.dir(reader, dir, { recursive: true })

      grow(a)
      watchCalls.at(-1).listener('change')
      assert.equal(timers.size, 2, 'a check and a watchCb are pending')

      Watch.close(reader, dir)
      assert.equal(timers.size, 1, 'only the watchCb is cleared')

      for (const fn of timers.values()) fn()
      assert.equal(reader.load_config_calls, 1, 'the changed child still reloads')
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

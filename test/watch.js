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
    watchCalls[0].listener('change', 'untracked.ini')
    watchCalls[0].listener('change', 'test.ini')

    assert.equal(reader.load_config_calls, 1)
    assert.equal(reader._read_args[file].cb_calls, 1)
  })

  it('an event without a filename reloads every tracked file in the directory', function () {
    const Watch = loadWatch()
    const a = path.join(subDir, 'a.ini')
    const b = path.join(subDir, 'b.ini')
    const reader = mockReader({ [a]: fileSlot(), [b]: fileSlot(), [subDir]: dirSlot() })

    Watch.dir(reader, subDir)
    watchCalls[0].listener('change')

    assert.equal(reader.load_config_calls, 2)
    assert.equal(reader._read_args[subDir].opts.watchCb_calls, 1)
  })

  it('an event naming the directory itself (kqueue) reloads every tracked file in it', function () {
    const Watch = loadWatch()
    const a = path.join(subDir, 'a.ini')
    const b = path.join(subDir, 'b.ini')
    const reader = mockReader({ [a]: fileSlot(), [b]: fileSlot() })

    Watch.dir(reader, subDir)
    watchCalls[0].listener('rename', path.basename(subDir))

    assert.equal(reader.load_config_calls, 2)
    assert.equal(watchCalls.length, 1, 'the directory is unchanged, so its watcher is kept')
  })

  it('a directory swapped under its watcher is rewatched, and its configs reloaded', function () {
    const Watch = loadWatch()
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hc-swap-')))
    const dir = path.join(tmp, 'config')
    const file = path.join(dir, 'a.ini')
    try {
      fs.mkdirSync(dir)
      fs.writeFileSync(file, 'v1')
      const reader = mockReader({ [file]: fileSlot() })
      Watch.dir(reader, dir)

      fs.mkdirSync(path.join(tmp, 'config.new'))
      fs.writeFileSync(path.join(tmp, 'config.new', 'a.ini'), 'v2')
      fs.rmSync(dir, { recursive: true })
      fs.renameSync(path.join(tmp, 'config.new'), dir)
      watchCalls[0].listener('rename', 'config')

      assert.equal(watchers[0].close_calls, 1)
      assert.equal(watchCalls.length, 2)
      assert.equal(reader.load_config_calls, 1)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('reloads a config read from a fallback file when that file changes', function () {
    const Watch = loadWatch()
    const json = path.join(subDir, 'x.json')
    const yaml = path.join(subDir, 'x.yaml')
    const reader = mockReader({ [json]: { ...fileSlot(), type: 'json', fallbacks: [yaml] } })

    Watch.file(reader, json)
    watchCalls[0].listener('change', 'x.yaml')

    assert.equal(reader.load_config_calls, 1)
    assert.equal(reader._read_args[json].cb_calls, 1)
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

    it('an error on a file watcher drops it, and the reload re-attaches it', function () {
      const Watch = loadWatch('freebsd')
      const handlers = {}
      const plainWatch = fs.watch
      fs.watch = (...args) => Object.assign(plainWatch(...args), { on: (ev, fn) => (handlers[ev] = fn) })
      console.error = () => {}
      const reader = mockReader({ [file]: fileSlot() })
      Watch.file(reader, file)

      handlers.error(new Error('EIO'))

      assert.equal(watchers[1].close_calls, 1)
      assert.equal(reader.load_config_calls, 1)
      assert.deepEqual(
        watchCalls.map((c) => c.target),
        [subDir, file, file],
      )
    })

    it('a fallback source is watched directly too, and released with its config', function () {
      const Watch = loadWatch('freebsd')
      const json = path.join(subDir, 'x.json')
      const yaml = path.join(subDir, 'x.yaml')
      const reader = mockReader({ [json]: { ...fileSlot(), type: 'json', fallbacks: [yaml] } })

      Watch.file(reader, json)
      assert.deepEqual(
        watchCalls.map((c) => c.target),
        [subDir, json, yaml],
      )
      watchCalls[2].listener('change')
      assert.equal(reader._read_args[json].cb_calls, 1)

      Watch.close(reader, json)
      assert.deepEqual(
        watchers.map((w) => w.close_calls),
        [1, 1, 1],
      )
    })
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

    it('reloads once a deleted target is recreated', function () {
      const Watch = loadWatch()
      const link = path.join(tmp, 'config', 'cert.pem')
      const target = path.join(tmp, 'real', 'cert.pem')
      const reader = mockReader({ [link]: fileSlot() })
      Watch.file(reader, link)
      const real = watchCalls.find((c) => c.target === path.join(tmp, 'real'))

      fs.unlinkSync(target)
      real.listener('rename', 'cert.pem')
      assert.equal(reader.load_config_calls, 1)

      fs.writeFileSync(target, 'v2')
      real.listener('rename', 'cert.pem')
      assert.equal(reader.load_config_calls, 2)
      assert.equal(watchCalls.length, 2, 'the target directory watcher is kept throughout')
    })

    it('two links to one target both reload when it changes', function () {
      const Watch = loadWatch()
      const a = path.join(tmp, 'config', 'cert.pem')
      const b = path.join(tmp, 'config', 'chain.pem')
      fs.symlinkSync(path.join(tmp, 'real', 'cert.pem'), b)
      const reader = mockReader({ [a]: fileSlot(), [b]: fileSlot() })
      Watch.file(reader, a)
      Watch.file(reader, b)

      watchCalls.find((c) => c.target === path.join(tmp, 'real')).listener('change', 'cert.pem')
      assert.equal(reader._read_args[a].cb_calls, 1)
      assert.equal(reader._read_args[b].cb_calls, 1)
    })

    it('retargeting a link releases the old target directory watcher', function () {
      const Watch = loadWatch()
      const link = path.join(tmp, 'config', 'cert.pem')
      const reader = mockReader({ [link]: fileSlot() })
      Watch.file(reader, link)
      const real = watchers[watchCalls.findIndex((c) => c.target === path.join(tmp, 'real'))]

      fs.mkdirSync(path.join(tmp, 'other'))
      fs.writeFileSync(path.join(tmp, 'other', 'cert.pem'), 'v2')
      fs.unlinkSync(link)
      fs.symlinkSync(path.join(tmp, 'other', 'cert.pem'), link)
      Watch.file(reader, link)

      assert.equal(real.close_calls, 1)
      assert.deepEqual(watchCalls.map((c) => c.target).sort(), [
        path.join(tmp, 'config'),
        path.join(tmp, 'other'),
        path.join(tmp, 'real'),
      ])
      Watch.close(reader, link)
      assert.deepEqual(
        watchers.map((w) => w.close_calls),
        [1, 1, 1],
      )
    })

    it('a fallback source that is a symlink registers its target too', function () {
      const Watch = loadWatch()
      const json = path.join(tmp, 'config', 'x.json')
      const yaml = path.join(tmp, 'config', 'x.yaml')
      fs.writeFileSync(path.join(tmp, 'real', 'x.yaml'), 'k: v')
      fs.symlinkSync(path.join(tmp, 'real', 'x.yaml'), yaml)
      const reader = mockReader({ [json]: { ...fileSlot(), type: 'json', fallbacks: [yaml] } })

      Watch.file(reader, json)
      assert.deepEqual(watchCalls.map((c) => c.target).sort(), [path.join(tmp, 'config'), path.join(tmp, 'real')])

      watchCalls.find((c) => c.target === path.join(tmp, 'real')).listener('change', 'x.yaml')
      assert.equal(reader._read_args[json].cb_calls, 1)
    })

    for (const [first, second] of [
      ['link', 'target'],
      ['target', 'link'],
    ]) {
      it(`on the BSDs the target's file watcher outlives closing the ${first}`, function () {
        const Watch = loadWatch('freebsd')
        const paths = { link: path.join(tmp, 'config', 'cert.pem'), target: path.join(tmp, 'real', 'cert.pem') }
        const reader = mockReader({ [paths.link]: fileSlot(), [paths.target]: fileSlot() })
        Watch.file(reader, paths.link)
        Watch.file(reader, paths.target)
        const targetWatcher = watchers[watchCalls.findIndex((c) => c.target === paths.target)]

        Watch.close(reader, paths[first])
        assert.equal(targetWatcher.close_calls, 0)
        Watch.close(reader, paths[second])
        assert.equal(targetWatcher.close_calls, 1)
      })
    }

    it('reloads when an intermediate link is retargeted (cert.pem -> ..data/cert.pem)', function () {
      const Watch = loadWatch()
      const cfg = path.join(tmp, 'config')
      const link = path.join(cfg, 'cert.pem')
      const version = (v) => {
        fs.mkdirSync(path.join(cfg, v))
        fs.writeFileSync(path.join(cfg, v, 'cert.pem'), v)
      }
      version('..v1')
      fs.symlinkSync('..v1', path.join(cfg, '..data'))
      fs.unlinkSync(link)
      fs.symlinkSync(path.join('..data', 'cert.pem'), link)
      const reader = mockReader({ [link]: fileSlot() })

      Watch.file(reader, link)
      assert.deepEqual(watchCalls.map((c) => c.target).sort(), [cfg, path.join(cfg, '..v1')])

      version('..v2')
      // Windows cannot rename a link over an existing directory link
      fs.rmSync(path.join(cfg, '..data'))
      fs.symlinkSync('..v2', path.join(cfg, '..data'))
      watchCalls[0].listener('rename', '..data')

      assert.equal(reader._read_args[link].cb_calls, 1)
      assert.equal(watchers[1].close_calls, 1, 'the old version directory is released')
      assert.deepEqual(watchCalls.map((c) => c.target).sort(), [cfg, path.join(cfg, '..v1'), path.join(cfg, '..v2')])
    })

    it('reloads when a linked parent directory outside the config dir is retargeted', function () {
      const Watch = loadWatch()
      const cfg = path.join(tmp, 'config')
      const link = path.join(cfg, 'cert.pem')
      const srv = path.join(tmp, 'srv')
      for (const v of ['v1', 'v2']) {
        fs.mkdirSync(path.join(srv, v), { recursive: true })
        fs.writeFileSync(path.join(srv, v, 'cert.pem'), v)
      }
      fs.symlinkSync(path.join(srv, 'v1'), path.join(srv, 'current'))
      fs.unlinkSync(link)
      fs.symlinkSync(path.join(srv, 'current', 'cert.pem'), link)
      const reader = mockReader({ [link]: fileSlot() })

      Watch.file(reader, link)
      assert.deepEqual(watchCalls.map((c) => c.target).sort(), [cfg, srv, path.join(srv, 'v1')])

      fs.rmSync(path.join(srv, 'current'))
      fs.symlinkSync(path.join(srv, 'v2'), path.join(srv, 'current'))
      watchCalls.find((c) => c.target === srv).listener('rename', 'current')

      assert.equal(reader._read_args[link].cb_calls, 1)
      assert.deepEqual(watchCalls.map((c) => c.target).sort(), [cfg, srv, path.join(srv, 'v1'), path.join(srv, 'v2')])
      assert.equal(watchers[watchCalls.findIndex((c) => c.target === path.join(srv, 'v1'))].close_calls, 1)
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

    it("a watcher's 'error' event drops it, and the poller reopens the directory", function () {
      const Watch = loadWatch()
      const handlers = {}
      const plainWatch = fs.watch
      fs.watch = (...args) => Object.assign(plainWatch(...args), { on: (ev, fn) => (handlers[ev] = fn) })
      const errors = []
      console.error = (msg) => errors.push(msg)
      const reader = mockReader()

      Watch.dir(reader, subDir)
      const stale = handlers.error
      assert.doesNotThrow(() => stale(new Error('EPERM')))
      assert.match(errors[0], /Error watching directory/)
      assert.equal(watchers[0].close_calls, 1)

      timerFn()
      assert.equal(watchCalls.length, 2, 'the poller reopened the directory')
      Watch.dir(reader, subDir)
      assert.equal(watchCalls.length, 2, 'and registered it')

      stale(new Error('late'))
      Watch.dir(reader, subDir)
      assert.equal(watchCalls.length, 2, 'an error from the replaced watcher is ignored')
    })

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

    it('a recursive request made while the stat is in flight wins', function () {
      const Watch = loadWatch()
      let calls = 0
      const plainWatch = fs.watch
      fs.watch = (...args) => {
        if (++calls <= 2) throw enoent()
        return plainWatch(...args)
      }
      let pendingStat
      fs.stat = (target, cb) => (pendingStat = cb)
      const reader = mockReader()

      Watch.dir(reader, subDir)
      timerFn()
      Watch.dir(reader, subDir, { recursive: true })
      pendingStat(null, {})

      assert.equal(watchCalls.length, 1)
      assert.equal(watchCalls[0].opts.recursive, true)
    })

    it('keeps polling a directory whose watcher fails to open for another reason', function () {
      const Watch = loadWatch()
      let calls = 0
      const plainWatch = fs.watch
      fs.watch = (...args) => {
        calls++
        if (calls === 1) throw enoent()
        if (calls === 2) throw Object.assign(new Error('too many open files'), { code: 'EMFILE' })
        return plainWatch(...args)
      }
      const errors = []
      console.error = (msg) => errors.push(msg)
      const reader = mockReader()

      Watch.dir(reader, subDir)
      timerFn()
      assert.equal(watchCalls.length, 0)
      assert.equal(errors.length, 1)

      timerFn()
      assert.equal(watchCalls.length, 1, 'the next poll opens it')
      Watch.dir(reader, subDir)
      assert.equal(watchCalls.length, 1, 'and it is registered')
    })

    it('a directory whose watcher fails to open is logged, then retried', function () {
      const Watch = loadWatch()
      let calls = 0
      const plainWatch = fs.watch
      fs.watch = (...args) => {
        if (++calls === 1) throw Object.assign(new Error('denied'), { code: 'EACCES' })
        return plainWatch(...args)
      }
      const errors = []
      console.error = (msg) => errors.push(msg)
      const reader = mockReader()

      Watch.dir(reader, subDir)
      assert.equal(errors.length, 1)
      assert.match(errors[0], /Error watching directory/)
      assert.equal(watchCalls.length, 0)

      timerFn()
      assert.equal(watchCalls.length, 1)
      Watch.dir(reader, subDir)
      assert.equal(watchCalls.length, 1, 'and it is registered')
    })

    it('a failed recursive upgrade keeps the plain watcher, then retries', function () {
      const Watch = loadWatch()
      const plainWatch = fs.watch
      let refuse = true
      fs.watch = (target, opts, listener) => {
        if (opts.recursive && refuse) throw Object.assign(new Error('too many open files'), { code: 'EMFILE' })
        return plainWatch(target, opts, listener)
      }
      console.error = () => {}
      const reader = mockReader({ [path.join(subDir, '1.ext')]: fileSlot() })
      Watch.dir(reader, subDir)

      Watch.dir(reader, subDir, { recursive: true })
      assert.equal(watchers[0].close_calls, 0, 'the plain watcher survives')
      Watch.dir(reader, subDir)
      assert.equal(watchCalls.length, 1, 'and is still registered')

      refuse = false
      timerFn()
      assert.equal(watchCalls.length, 2)
      assert.equal(watchCalls[1].opts.recursive, true)
      assert.equal(watchers[0].close_calls, 1)
      assert.equal(reader.load_config_calls, 0, 'an upgrade is not a reappearance: nothing is reloaded')
    })

    it('a watched directory that disappears goes back to the poller', function () {
      const Watch = loadWatch()
      const plainWatch = fs.watch
      fs.watch = (target, ...rest) => {
        if (!fs.existsSync(target)) throw enoent()
        return plainWatch(target, ...rest)
      }
      const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hc-gone-')))
      const dir = path.join(tmp, 'config')
      try {
        fs.mkdirSync(dir)
        const reader = mockReader()
        Watch.dir(reader, dir)

        fs.rmdirSync(dir)
        watchCalls[0].listener('rename', 'config')
        assert.equal(watchers[0].close_calls, 1)
        assert.equal(watchCalls.length, 1)
        assert.equal(typeof timerFn, 'function', 'queued for the poller')

        fs.mkdirSync(dir)
        timerFn()
        assert.equal(watchCalls.length, 2)
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
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

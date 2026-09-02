'use strict'

const fs = require('node:fs')
const path = require('node:path')

const RELOAD_DELAY = 5 * 1000
const DIR_CALLBACK_DELAY = 2 * 1000
const ENOENT_POLL_INTERVAL = 60 * 1000

const watchers = {} // dir -> { watcher, recursive }
const sedation_timers = {}
const enoent = { timer: false, dirs: new Map() } // dir -> { recursive }

const Watch = {}

// Reload a watched config file. Never throws: a parse failure leaves the
// previously cached value in effect, logs the failure distinctly, and passes
// the error to the callback. The directory watcher stays active, so once the
// file is corrected the next event reloads the now-valid config.
Watch.reload = (reader, name, args) => {
  reader.load_config(name, args.type, args.options)
  const err = reader.last_load_error(name, args.type, args.options)
  if (err) {
    console.error(`Reload of ${name} failed; keeping previous config (watching for a fix): ${err.message}`)
  } else {
    console.log(`Reloaded file: ${name}`)
  }
  if (typeof args.cb === 'function') args.cb(err || undefined)
  return err
}

function debounce(key, delay, fn) {
  clearTimeout(sedation_timers[key])
  sedation_timers[key] = setTimeout(() => {
    delete sedation_timers[key]
    fn()
  }, delay)
}

function open_watcher(dir, recursive, listener) {
  const opts = { persistent: false, recursive }
  let watcher
  try {
    watcher = fs.watch(dir, opts, listener)
  } catch (e) {
    if (!recursive || e.code !== 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') throw e
    watcher = fs.watch(dir, { persistent: false }, listener)
  }
  watcher.unref?.()
  return watcher
}

// Watch a directory: reload tracked files inside it on change and, when it is
// a getDir() target, invoke that watchCb. `recursive` is needed by getDir(),
// which walks the subtree; a plain watcher on the same dir is upgraded.
Watch.dir = (reader, dir, { recursive = false } = {}) => {
  // a request queued while the dir was missing keeps its recursion requirement
  if (enoent.dirs.get(dir)?.recursive) recursive = true

  const existing = watchers[dir]
  if (existing) {
    if (!recursive || existing.recursive) return
    existing.watcher.close()
    delete watchers[dir]
  }

  try {
    watchers[dir] = { watcher: open_watcher(dir, recursive, Watch.onEvent(reader, dir)), recursive }
    unqueue(dir)
  } catch (e) {
    if (e.code !== 'ENOENT') return console.error(`Error watching directory ${dir}(${e})`)
    // callers may track files under dirs that don't exist yet. Poll quietly
    // and attach the watcher once the dir is created.
    enoent.dirs.set(dir, { recursive })
    Watch.ensure_enoent_timer(reader)
  }
}

Watch.onEvent = (reader, dir) => (fse, filename) => {
  // close() may have run between the event firing and this handler
  if (!watchers[dir] || !filename) return

  const full_path = path.join(dir, filename)
  const args = reader._read_args[full_path]
  // getDir() registers its directory as { opts }; load_config() on a
  // directory would throw EISDIR
  if (args && !args.opts && !args.options?.no_watch) {
    debounce(full_path, RELOAD_DELAY, () => Watch.reload(reader, full_path, args))
  }

  // looked up again when the timer fires: the slot may be gone by then
  if (reader._read_args[dir]?.opts?.watchCb) {
    debounce(dir, DIR_CALLBACK_DELAY, () => reader._read_args[dir]?.opts?.watchCb?.())
  }
}

// A dir that appears with files already in it produces no per-file events
Watch.reload_tracked = (reader, dir) => {
  for (const [name, args] of Object.entries(reader._read_args)) {
    if (path.dirname(name) !== dir || args.opts || args.options?.no_watch) continue
    if (fs.existsSync(name)) Watch.reload(reader, name, args)
  }
}

Watch.ensure_enoent_timer = (reader) => {
  if (enoent.timer) return
  enoent.timer = setInterval(() => {
    if (!enoent.dirs.size) return Watch.stop_enoent_timer()

    // snapshot: a dir that fails to attach is re-queued during the walk
    for (const [dir, opts] of [...enoent.dirs]) {
      fs.stat(dir, (err) => {
        // still missing, or closed while the stat was in flight
        if (err || !enoent.dirs.has(dir)) return
        unqueue(dir)
        Watch.dir(reader, dir, opts)
        Watch.reload_tracked(reader, dir)
      })
    }
  }, ENOENT_POLL_INTERVAL)
  enoent.timer.unref() // don't block process exit
}

Watch.stop_enoent_timer = () => {
  if (!enoent.timer) return
  clearInterval(enoent.timer)
  enoent.timer = false
}

// the poller runs only while something is pending
function unqueue(dir) {
  enoent.dirs.delete(dir)
  if (!enoent.dirs.size) Watch.stop_enoent_timer()
}

function close_watcher(dir) {
  if (!watchers[dir]) return
  try {
    watchers[dir].watcher.close()
  } catch (ignore) {}
  delete watchers[dir]
}

function clear_timer(key) {
  clearTimeout(sedation_timers[key])
  delete sedation_timers[key]
}

// whether a slot relies on the watcher for `dir`: a getDir() callback on the
// dir itself, or a watched file directly inside it
function needs_watcher(name, args, dir) {
  if (args.opts) return name === dir && typeof args.opts.watchCb === 'function'
  return path.dirname(name) === dir && !args.options?.no_watch
}

function still_tracked(reader, dir) {
  return Object.entries(reader?._read_args ?? {}).some(([name, args]) => needs_watcher(name, args, dir))
}

// Stop watching `target`, a file or a getDir() directory, and release its
// directory watcher once nothing else in that directory relies on it. Idempotent.
Watch.close = (reader, target) => {
  // only the target's own debounce: a pending reload of a child file belongs
  // to that child's still-tracked slot
  clear_timer(target)
  if (reader?._read_args) delete reader._read_args[target]

  for (const dir of new Set([target, path.dirname(target)])) {
    if (still_tracked(reader, dir)) continue
    unqueue(dir)
    close_watcher(dir)
  }
}

Watch.closeAll = () => {
  for (const dir of Object.keys(watchers)) close_watcher(dir)
  for (const key of Object.keys(sedation_timers)) clear_timer(key)
  enoent.dirs.clear()
  Watch.stop_enoent_timer()
}

module.exports = Watch

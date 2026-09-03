'use strict'

const fs = require('node:fs')
const path = require('node:path')

const RELOAD_DELAY = 5 * 1000
const DIR_CALLBACK_DELAY = 2 * 1000
const RECONCILE_INTERVAL = 60 * 1000

// inotify, ReadDirectoryChangesW and FSEvents report a write to a file as a
// named event on its directory. kqueue (the BSDs) and event ports (illumos)
// report only entry changes, so there each file is watched directly as well.
const DIR_SEES_WRITES = ['linux', 'win32', 'darwin'].includes(process.platform)

const watchers = {} // dir -> { watcher, recursive, id }
const file_watchers = {} // config name -> FSWatcher on the file it is read from
const seen = {} // config name -> what the file it was read from looked like
const sedation_timers = {}
let timer = false

const Watch = {}

Watch.reload = (reader, name, args) => {
  clear_timer(name) // an event may have queued this same reload
  reader.load_config(name, args.type, args.options)
  Watch.file(reader, name)
  const err = reader.last_load_error(name, args.type, args.options)
  if (err) {
    console.error(`Reload of ${name} failed; keeping previous config (watching for a fix): ${err.message}`)
  } else {
    console.log(`Reloaded file: ${name}`)
  }
  if (typeof args.cb === 'function') args.cb(err || undefined)
  return err
}

const reloadable = (args) => args && !args.opts && !args.options?.no_watch

function debounce(key, delay, fn) {
  clearTimeout(sedation_timers[key])
  sedation_timers[key] = setTimeout(() => {
    delete sedation_timers[key]
    fn()
  }, delay)
}

function schedule_reload(reader, name) {
  if (!reloadable(reader._read_args[name])) return
  debounce(name, RELOAD_DELAY, () => {
    const latest = reader._read_args[name]
    if (reloadable(latest)) Watch.reload(reader, name, latest)
  })
}

function schedule_watchCb(reader, dir) {
  const opts = () => reader._read_args[dir]?.opts
  if (typeof opts()?.watchCb !== 'function') return
  debounce(dir, DIR_CALLBACK_DELAY, () => {
    const o = opts()
    if (typeof o?.watchCb !== 'function') return
    // the consumer re-reads now, so the next reconcile pass need not tell it again
    if (watchers[dir]?.tree !== undefined) watchers[dir].tree = fingerprint(dir)
    o.watchCb()
  })
}

// the file a config is read from (its own, else the first fallback present) and how it looks
function source(reader, name) {
  for (const p of [name, ...(reader._read_args[name]?.fallbacks ?? [])]) {
    try {
      const { dev, ino, mtimeMs, size } = fs.statSync(p)
      return { path: p, dev, ino, mtimeMs, size }
    } catch (ignore) {}
  }
  return null
}

const same_file = (a, b) => Boolean(a && b && a.dev === b.dev && a.ino === b.ino)
const same_source = (a, b) =>
  a === b || (same_file(a, b) && a.path === b.path && a.mtimeMs === b.mtimeMs && a.size === b.size)
const changed = (reader, name) => name in seen && !same_source(seen[name], source(reader, name))

// reload whatever in `dir` no longer looks like what was loaded
function check(reader, dir) {
  for (const [name, args] of Object.entries(reader._read_args)) {
    if (path.dirname(name) === dir && reloadable(args) && changed(reader, name)) Watch.reload(reader, name, args)
  }
}

Watch.onEvent = (reader, dir) => (fse, filename) => {
  if (!watchers[dir]) return
  // a recursive watcher may report an absolute filename; kqueue reports the
  // directory's own name on every event; some platforms report none
  const name = filename && (path.isAbsolute(filename) ? filename : path.join(dir, filename))
  if (reloadable(reader._read_args[name])) schedule_reload(reader, name)
  else debounce(`check ${dir}`, RELOAD_DELAY, () => check(reader, dir))
  schedule_watchCb(reader, dir)
}

function identity(target) {
  try {
    const { dev, ino } = fs.statSync(target)
    return { dev, ino }
  } catch (ignore) {
    return null
  }
}

// every entry below a getDir() directory and what it looks like, so an add,
// removal, rename or edit anywhere in the tree shows as a difference. Follows
// directory links as read_dir() does, once each
function fingerprint(dir) {
  const lines = []
  const visited = new Set()
  const walk = (d) => {
    let real
    try {
      real = fs.realpathSync(d)
    } catch (ignore) {
      return
    }
    if (visited.has(real)) return
    visited.add(real)
    for (const entry of fs.readdirSync(d).sort()) {
      const p = path.join(d, entry)
      try {
        const stat = fs.statSync(p)
        lines.push(`${path.relative(dir, p)} ${stat.ino} ${stat.mtimeMs} ${stat.size}`)
        if (stat.isDirectory()) walk(p)
      } catch (ignore) {
        lines.push(path.relative(dir, p))
      }
    }
  }
  try {
    walk(dir)
  } catch (ignore) {
    return null
  }
  return lines.join('\n')
}

function fs_watch(target, recursive, listener) {
  try {
    return fs.watch(target, { persistent: false, recursive }, listener)
  } catch (e) {
    if (recursive && e.code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM')
      return fs.watch(target, { persistent: false }, listener)
    throw e
  }
}

Watch.dir = (reader, dir, { recursive = false, quiet = false } = {}) => {
  ensure_timer(reader)
  const existing = watchers[dir]
  if (existing && (!recursive || existing.recursive)) return
  try {
    const watcher = fs_watch(dir, recursive, Watch.onEvent(reader, dir))
    // an FSWatcher closes its handle before emitting 'error'
    watcher.on?.('error', (e) => {
      if (watchers[dir]?.watcher !== watcher) return
      console.error(`Error watching directory ${dir} (${e})`)
      close_watcher(dir)
      Watch.dir(reader, dir, { recursive, quiet: true })
    })
    watcher.unref?.()
    existing?.watcher.close()
    watchers[dir] = { watcher, recursive, id: identity(dir), tree: recursive ? fingerprint(dir) : undefined }
  } catch (e) {
    // a missing directory is not news, and the reconcile pass retries every failure
    if (e.code === 'ENOENT' || quiet) return
    const what = existing ? `upgrading watcher on ${dir}, keeping the existing one` : `watching directory ${dir}`
    console.error(`Error ${what} (${e})`)
  }
}

function watch_file(reader, name, file, quiet = false) {
  if (DIR_SEES_WRITES || file_watchers[name]) return
  try {
    const watcher = fs.watch(file, { persistent: false }, (fse) => {
      if (file_watchers[name] !== watcher) return
      // kqueue follows the inode: a replaced file needs a fresh watcher, which the reload attaches
      if (fse === 'rename') drop_file_watcher(name)
      schedule_reload(reader, name)
    })
    watcher.on?.('error', (e) => {
      if (file_watchers[name] !== watcher) return
      console.error(`Error watching config file ${file} (${e})`)
      drop_file_watcher(name)
      schedule_reload(reader, name)
    })
    watcher.unref?.()
    file_watchers[name] = watcher
  } catch (e) {
    if (e.code === 'ENOENT' || quiet) return
    console.error(`Error watching config file ${file} (${e})`)
  }
}

function drop_file_watcher(name) {
  if (!file_watchers[name]) return
  try {
    file_watchers[name].close()
  } catch (ignore) {}
  delete file_watchers[name]
}

Watch.file = (reader, name) => {
  if (!reloadable(reader._read_args[name])) {
    delete seen[name]
    return prune(reader) // read with no_watch, perhaps after being watched
  }
  Watch.dir(reader, path.dirname(name))
  const src = source(reader, name)
  seen[name] = src
  // the file watcher follows whatever the name resolved to when it opened
  drop_file_watcher(name)
  watch_file(reader, name, src?.path ?? name)
  prune(reader)
}

// the directories the slots need watched, and whether recursively
function desired(reader) {
  const dirs = new Map()
  for (const [name, args] of Object.entries(reader?._read_args ?? {})) {
    if (args.opts) {
      if (typeof args.opts.watchCb === 'function') dirs.set(name, true)
    } else if (reloadable(args)) {
      dirs.set(path.dirname(name), dirs.get(path.dirname(name)) ?? false)
    }
  }
  return dirs
}

function prune(reader) {
  const dirs = desired(reader)
  for (const dir of Object.keys(watchers)) if (!dirs.has(dir)) close_watcher(dir)
  for (const name of Object.keys(file_watchers)) if (!reloadable(reader?._read_args?.[name])) drop_file_watcher(name)
  if (!dirs.size) stop_timer()
}

// every minute: attach what could not be, rewatch a directory swapped under
// its watcher, and reload any config whose file changed without an event
Watch.reconcile = (reader) => {
  for (const [dir, recursive] of desired(reader)) {
    const had = watchers[dir]
    if (had?.id && !same_file(had.id, identity(dir))) close_watcher(dir)
    Watch.dir(reader, dir, { recursive, quiet: true })
    const w = watchers[dir]
    if (!w || !recursive) continue
    // a fresh watcher, or a change in the tree that produced no event: the getDir() consumer re-reads
    const tree = fingerprint(dir)
    if (w !== had || (w.tree !== undefined && tree !== w.tree)) schedule_watchCb(reader, dir)
    w.tree = tree
  }
  for (const [name, args] of Object.entries(reader._read_args)) {
    if (!reloadable(args)) continue
    if (!(name in seen)) seen[name] = source(reader, name)
    else if (changed(reader, name)) Watch.reload(reader, name, args)
    else watch_file(reader, name, seen[name]?.path ?? name, true)
  }
}

function ensure_timer(reader) {
  if (timer) return
  timer = setInterval(() => Watch.reconcile(reader), RECONCILE_INTERVAL)
  timer.unref?.() // don't block process exit
}

function stop_timer() {
  if (!timer) return
  clearInterval(timer)
  timer = false
}

function close_watcher(dir) {
  if (!watchers[dir]) return
  try {
    watchers[dir].watcher.close()
  } catch (ignore) {}
  delete watchers[dir]
  clear_timer(dir)
  clear_timer(`check ${dir}`)
}

function clear_timer(key) {
  clearTimeout(sedation_timers[key])
  delete sedation_timers[key]
}

Watch.close = (reader, target) => {
  clear_timer(target) // a pending check of the directory may still serve other slots
  if (reader?._read_args) delete reader._read_args[target]
  delete seen[target]
  prune(reader)
}

Watch.closeAll = () => {
  for (const dir of Object.keys(watchers)) close_watcher(dir)
  for (const name of Object.keys(file_watchers)) drop_file_watcher(name)
  for (const key of Object.keys(sedation_timers)) clear_timer(key)
  for (const key of Object.keys(seen)) delete seen[key]
  stop_timer()
}

module.exports = Watch

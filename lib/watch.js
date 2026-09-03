'use strict'

const fs = require('node:fs')
const path = require('node:path')

const RELOAD_DELAY = 5 * 1000
const DIR_CALLBACK_DELAY = 2 * 1000
const ENOENT_POLL_INTERVAL = 60 * 1000

const DIR_SEES_WRITES = ['linux', 'win32', 'darwin'].includes(process.platform)

const watchers = {}
const file_watchers = {}
// alias path -> the config names read through it: a symlink's target, or a
// fallback file the reader would read instead (foo.yaml for foo.json)
const aliases = new Map()
const sedation_timers = {}
const enoent = { timer: false, dirs: new Map(), files: new Set() }

const Watch = {}

Watch.reload = (reader, name, args) => {
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

function dispatch(reader, changed) {
  for (const name of [changed, ...(aliases.get(changed) ?? [])]) schedule_reload(reader, name)
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

function open_watcher(reader, dir, recursive) {
  const watcher = fs_watch(dir, recursive, Watch.onEvent(reader, dir))
  // an FSWatcher closes its handle before emitting 'error'
  watcher.on?.('error', (e) => {
    if (watchers[dir]?.watcher !== watcher) return
    console.error(`Error watching directory ${dir}(${e})`)
    close_watcher(dir)
    enqueue(reader, dir, { recursive })
  })
  watcher.unref?.()
  return watcher
}

Watch.dir = (reader, dir, { recursive = false } = {}) => {
  if (enoent.dirs.get(dir)?.recursive) recursive = true

  const existing = watchers[dir]
  if (existing && (!recursive || existing.recursive)) return

  try {
    const watcher = open_watcher(reader, dir, recursive)
    existing?.watcher.close()
    watchers[dir] = { watcher, recursive, id: identity(dir) }
    unqueue(dir)
  } catch (e) {
    if (existing) console.error(`Error upgrading watcher on ${dir}, keeping the existing one (${e})`)
    else if (e.code !== 'ENOENT') console.error(`Error watching directory ${dir}(${e})`)
    enqueue(reader, dir, { recursive }) // the poller retries every failure, not only a missing dir
  }
}

function identity(dir) {
  try {
    const { dev, ino } = fs.statSync(dir)
    return { dev, ino }
  } catch (ignore) {
    return null
  }
}

// inotify and kqueue follow the inode: a directory deleted, moved or swapped
// under its watcher leaves the watcher on the old one
function replaced(dir, { id }) {
  if (!id) return false
  const now = identity(dir)
  return !now || now.dev !== id.dev || now.ino !== id.ino
}

function reopen(reader, dir, { recursive }) {
  close_watcher(dir)
  Watch.dir(reader, dir, { recursive })
  if (!watchers[dir]) return
  Watch.reload_tracked(reader, dir)
  schedule_watchCb(reader, dir)
}

const same_file = (a, b) => Boolean(a && b && a.dev === b.dev && a.ino === b.ino)

function watch_file(reader, file) {
  if (DIR_SEES_WRITES) return
  const current = file_watchers[file]
  const id = identity(file)
  // fs.watch follows a symlink as it opens: a retargeted link needs a fresh watcher
  if (current && (!current.id || !id || same_file(current.id, id))) return
  drop_file_watcher(file)
  try {
    const watcher = fs.watch(file, { persistent: false }, (fse) => {
      if (file_watchers[file]?.watcher !== watcher) return
      // kqueue follows the inode: a replaced file needs a fresh watcher, which the reload attaches
      if (fse === 'rename') drop_file_watcher(file)
      dispatch(reader, file)
    })
    watcher.on?.('error', (e) => {
      if (file_watchers[file]?.watcher !== watcher) return
      console.error(`Error watching config file ${file}(${e})`)
      drop_file_watcher(file)
      dispatch(reader, file)
    })
    watcher.unref?.()
    file_watchers[file] = { watcher, id }
    unqueue_file(file)
  } catch (e) {
    // a missing file is watched once its directory reports it
    if (e.code === 'ENOENT') return
    console.error(`Error watching config file ${file}(${e})`)
    enoent.files.add(file)
    Watch.ensure_enoent_timer(reader)
  }
}

// a file watcher may serve a config read directly and others read through it
function release_file(reader, file) {
  if (reloadable(reader?._read_args?.[file]) || aliases.has(file)) return
  unqueue_file(file)
  drop_file_watcher(file)
}

function drop_file_watcher(file) {
  if (!file_watchers[file]) return
  try {
    file_watchers[file].watcher.close()
  } catch (ignore) {}
  delete file_watchers[file]
}

// the first symlink among `p`, its parent, and its components below `base`.
// Higher ancestors are not inspected: a symlinked /etc/haraka or /etc must
// not put a watcher on /etc or /
function first_link(p, base) {
  const candidates = [path.dirname(p), p]
  if (p.startsWith(base + path.sep)) {
    candidates.length = 0
    let cur = base
    for (const seg of p.slice(base.length + 1).split(path.sep)) candidates.push((cur = path.join(cur, seg)))
  }
  for (const c of candidates) {
    try {
      if (fs.lstatSync(c).isSymbolicLink()) return c
    } catch (ignore) {
      return null
    }
  }
  return null
}

// every symlink met while resolving `name`, hop by hop, then the path reached.
// Each hop is an alias: retargeting any link in the chain reloads the config
function links_of(name) {
  const base = path.dirname(name)
  const found = new Set()
  let p = name
  for (let hops = 0; hops < 40; hops++) {
    const link = first_link(p, base)
    if (!link) break
    if (link !== name) found.add(link)
    let dest
    try {
      dest = path.resolve(path.dirname(link), fs.readlinkSync(link))
    } catch (ignore) {
      break
    }
    p = dest + p.slice(link.length)
  }
  if (p !== name) found.add(p)
  return found
}

function sources(reader, name) {
  const found = links_of(name)
  for (const alt of reader._read_args[name]?.fallbacks ?? []) for (const p of [alt, ...links_of(alt)]) found.add(p)
  return found
}

// drop `name` from every alias not in `keep`; returns the directories that lost a dependent
function forget(reader, name, keep = new Set()) {
  const dirs = new Set()
  for (const [alias, names] of aliases) {
    if (keep.has(alias) || !names.delete(name)) continue
    if (!names.size) {
      aliases.delete(alias)
      release_file(reader, alias)
    }
    dirs.add(path.dirname(alias))
  }
  return dirs
}

Watch.file = (reader, name) => {
  Watch.dir(reader, path.dirname(name))
  watch_file(reader, name)

  const current = sources(reader, name)
  const stale = forget(reader, name, current)
  for (const alias of current) {
    if (!aliases.has(alias)) aliases.set(alias, new Set())
    aliases.get(alias).add(name)
    Watch.dir(reader, path.dirname(alias))
    watch_file(reader, alias)
  }
  release(reader, stale)
}

// the configs reached through `dir`, each with the paths inside `dir` it is read via
function configs_in(reader, dir) {
  const found = new Map()
  const add = (name, via) => (found.get(name) ?? found.set(name, new Set()).get(name)).add(via)
  for (const name of Object.keys(reader._read_args)) if (path.dirname(name) === dir) add(name, name)
  for (const [alias, names] of aliases) if (path.dirname(alias) === dir) for (const name of names) add(name, alias)
  return found
}

Watch.onEvent = (reader, dir) => (fse, filename) => {
  const entry = watchers[dir]
  if (!entry) return

  // kqueue names the watched directory itself on every event, inotify does so
  // when the directory is deleted or moved, and some platforms name nothing
  if (!filename || filename === path.basename(dir)) {
    if (replaced(dir, entry)) reopen(reader, dir, entry)
    else for (const name of configs_in(reader, dir).keys()) schedule_reload(reader, name)
  } else {
    // a recursive watcher may report the filename as an absolute path
    dispatch(reader, path.isAbsolute(filename) ? filename : path.join(dir, filename))
  }

  schedule_watchCb(reader, dir)
}

function schedule_watchCb(reader, dir) {
  const opts = () => reader._read_args[dir]?.opts
  if (typeof opts()?.watchCb !== 'function') return
  debounce(dir, DIR_CALLBACK_DELAY, () => {
    const o = opts()
    if (typeof o?.watchCb === 'function') o.watchCb()
  })
}

Watch.reload_tracked = (reader, dir) => {
  for (const [name, vias] of configs_in(reader, dir)) {
    const args = reader._read_args[name]
    if (reloadable(args) && [...vias].some((p) => fs.existsSync(p))) Watch.reload(reader, name, args)
  }
}

function enqueue(reader, dir, opts) {
  enoent.dirs.set(dir, opts)
  Watch.ensure_enoent_timer(reader)
}

Watch.ensure_enoent_timer = (reader) => {
  if (enoent.timer) return
  enoent.timer = setInterval(() => {
    if (!enoent.dirs.size && !enoent.files.size) return Watch.stop_enoent_timer()

    for (const file of [...enoent.files]) watch_file(reader, file)
    for (const dir of [...enoent.dirs.keys()]) {
      fs.stat(dir, (err) => {
        // the request may have been upgraded or withdrawn while the stat was in flight
        const opts = enoent.dirs.get(dir)
        if (err || !opts) return
        const before = watchers[dir]?.watcher
        Watch.dir(reader, dir, opts) // unqueues on success; a failure stays queued
        const after = watchers[dir]?.watcher
        if (!after || after === before) return
        // a getDir() consumer missed whatever happened while its watcher was down or not recursive
        if (!before) Watch.reload_tracked(reader, dir)
        schedule_watchCb(reader, dir)
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

function unqueue(dir) {
  enoent.dirs.delete(dir)
  if (!enoent.dirs.size && !enoent.files.size) Watch.stop_enoent_timer()
}

function unqueue_file(file) {
  enoent.files.delete(file)
  if (!enoent.dirs.size && !enoent.files.size) Watch.stop_enoent_timer()
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

function needs_watcher(name, args, dir) {
  if (args.opts) return name === dir && typeof args.opts.watchCb === 'function'
  if (!reloadable(args)) return false
  if (path.dirname(name) === dir) return true
  return [...aliases].some(([alias, names]) => names.has(name) && path.dirname(alias) === dir)
}

function still_tracked(reader, dir) {
  return Object.entries(reader?._read_args ?? {}).some(([name, args]) => needs_watcher(name, args, dir))
}

const wants_recursion = (reader, dir) => typeof reader?._read_args?.[dir]?.opts?.watchCb === 'function'

function release(reader, dirs) {
  for (const dir of dirs) {
    if (!still_tracked(reader, dir)) {
      unqueue(dir)
      close_watcher(dir)
      continue
    }
    // a pending recursive upgrade must not outlive the getDir() slot that asked for it
    if (enoent.dirs.get(dir)?.recursive && !wants_recursion(reader, dir)) {
      if (watchers[dir]) unqueue(dir)
      else enoent.dirs.set(dir, { recursive: false })
    }
  }
}

Watch.close = (reader, target) => {
  clear_timer(target)
  if (reader?._read_args) delete reader._read_args[target]
  const dirs = forget(reader, target)
  release_file(reader, target)
  release(reader, new Set([target, path.dirname(target), ...dirs]))
}

Watch.closeAll = () => {
  for (const dir of Object.keys(watchers)) close_watcher(dir)
  for (const file of Object.keys(file_watchers)) drop_file_watcher(file)
  for (const key of Object.keys(sedation_timers)) clear_timer(key)
  aliases.clear()
  enoent.dirs.clear()
  enoent.files.clear()
  Watch.stop_enoent_timer()
}

module.exports = Watch

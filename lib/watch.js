'use strict'

const fs = require('node:fs')
const path = require('node:path')

const RELOAD_DELAY = 5 * 1000
const DIR_CALLBACK_DELAY = 2 * 1000
const ENOENT_POLL_INTERVAL = 60 * 1000

const DIR_SEES_WRITES = ['linux', 'win32', 'darwin'].includes(process.platform)

const watchers = {}
const file_watchers = {}

const aliases = new Map()
const sedation_timers = {}
const enoent = { timer: false, dirs: new Map() }

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
    console.error(`Error watching directory ${dir}(${e})`)
    if (watchers[dir]?.watcher !== watcher) return
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
    watchers[dir] = { watcher, recursive }
    unqueue(dir)
  } catch (e) {
    if (existing) return console.error(`Error upgrading watcher on ${dir}, keeping the existing one (${e})`)
    if (e.code !== 'ENOENT') return console.error(`Error watching directory ${dir}(${e})`)
    enqueue(reader, dir, { recursive })
  }
}

function watch_file(reader, file) {
  if (DIR_SEES_WRITES || file_watchers[file]) return
  try {
    const watcher = fs.watch(file, { persistent: false }, (fse) => {
      if (file_watchers[file] !== watcher) return
      // kqueue follows the inode: a replaced file needs a fresh watcher, which the reload attaches
      if (fse === 'rename') drop_file_watcher(file)
      dispatch(reader, file)
    })
    watcher.on?.('error', (e) => {
      console.error(`Error watching config file ${file}(${e})`)
      if (file_watchers[file] === watcher) drop_file_watcher(file)
    })
    watcher.unref?.()
    file_watchers[file] = watcher
  } catch (e) {
    // a missing file is watched once its directory reports it
    if (e.code !== 'ENOENT') console.error(`Error watching config file ${file}(${e})`)
  }
}

function drop_file_watcher(file) {
  if (!file_watchers[file]) return
  try {
    file_watchers[file].close()
  } catch (ignore) {}
  delete file_watchers[file]
}

function link_target(name) {
  try {
    if (!fs.lstatSync(name).isSymbolicLink()) return null
    try {
      return fs.realpathSync(name)
    } catch (ignore) {
      return path.resolve(path.dirname(name), fs.readlinkSync(name))
    }
  } catch (ignore) {
    return null
  }
}

function sources(reader, name) {
  const found = new Set()
  const target = link_target(name)
  if (target) found.add(target)
  const source = reader._read_args[name]?.source
  if (source && source !== name) found.add(source)
  return found
}

// drop `name` from every alias not in `keep`; returns the directories that lost a dependent
function forget(name, keep = new Set()) {
  const dirs = new Set()
  for (const [alias, names] of aliases) {
    if (keep.has(alias) || !names.delete(name)) continue
    if (!names.size) {
      aliases.delete(alias)
      drop_file_watcher(alias)
    }
    dirs.add(path.dirname(alias))
  }
  return dirs
}

Watch.file = (reader, name) => {
  Watch.dir(reader, path.dirname(name))
  watch_file(reader, name)

  const current = sources(reader, name)
  const stale = forget(name, current)
  for (const alias of current) {
    if (!aliases.has(alias)) aliases.set(alias, new Set())
    aliases.get(alias).add(name)
    Watch.dir(reader, path.dirname(alias))
    watch_file(reader, alias)
  }
  release(reader, stale)
}

// the configs reached through `dir`, each with the path inside `dir` it is read via
function configs_in(reader, dir) {
  const found = new Map()
  for (const name of Object.keys(reader._read_args)) if (path.dirname(name) === dir) found.set(name, name)
  for (const [alias, names] of aliases)
    if (path.dirname(alias) === dir) for (const name of names) found.set(name, alias)
  return found
}

Watch.onEvent = (reader, dir) => (fse, filename) => {
  if (!watchers[dir]) return

  if (filename) {
    // resolve, not join: a recursive watcher may report the filename as an absolute path
    dispatch(reader, path.resolve(dir, filename))
  } else {
    // kqueue (the BSDs) reports directory events without a filename
    for (const name of configs_in(reader, dir).keys()) schedule_reload(reader, name)
  }

  const opts = () => reader._read_args[dir]?.opts
  if (typeof opts()?.watchCb === 'function') {
    debounce(dir, DIR_CALLBACK_DELAY, () => {
      const o = opts()
      if (typeof o?.watchCb === 'function') o.watchCb()
    })
  }
}

Watch.reload_tracked = (reader, dir) => {
  for (const [name, via] of configs_in(reader, dir)) {
    const args = reader._read_args[name]
    if (reloadable(args) && fs.existsSync(via)) Watch.reload(reader, name, args)
  }
}

function enqueue(reader, dir, opts) {
  enoent.dirs.set(dir, opts)
  Watch.ensure_enoent_timer(reader)
}

Watch.ensure_enoent_timer = (reader) => {
  if (enoent.timer) return
  enoent.timer = setInterval(() => {
    if (!enoent.dirs.size) return Watch.stop_enoent_timer()

    for (const [dir, opts] of [...enoent.dirs]) {
      fs.stat(dir, (err) => {
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

function needs_watcher(name, args, dir) {
  if (args.opts) return name === dir && typeof args.opts.watchCb === 'function'
  if (!reloadable(args)) return false
  if (path.dirname(name) === dir) return true
  return [...aliases].some(([alias, names]) => names.has(name) && path.dirname(alias) === dir)
}

function still_tracked(reader, dir) {
  return Object.entries(reader?._read_args ?? {}).some(([name, args]) => needs_watcher(name, args, dir))
}

function release(reader, dirs) {
  for (const dir of dirs) {
    if (still_tracked(reader, dir)) continue
    unqueue(dir)
    close_watcher(dir)
  }
}

Watch.close = (reader, target) => {
  clear_timer(target)
  drop_file_watcher(target)
  if (reader?._read_args) delete reader._read_args[target]
  release(reader, new Set([target, path.dirname(target), ...forget(target)]))
}

Watch.closeAll = () => {
  for (const dir of Object.keys(watchers)) close_watcher(dir)
  for (const file of Object.keys(file_watchers)) drop_file_watcher(file)
  for (const key of Object.keys(sedation_timers)) clear_timer(key)
  aliases.clear()
  enoent.dirs.clear()
  Watch.stop_enoent_timer()
}

module.exports = Watch

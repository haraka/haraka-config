'use strict'

const fs = require('node:fs')
const path = require('node:path')

const RELOAD_DELAY = 5 * 1000
const DIR_CALLBACK_DELAY = 2 * 1000
const ENOENT_POLL_INTERVAL = 60 * 1000

const watchers = {}
const link_targets = {}
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

function debounce(key, delay, fn) {
  clearTimeout(sedation_timers[key])
  sedation_timers[key] = setTimeout(() => {
    delete sedation_timers[key]
    fn()
  }, delay)
}

const RECURSIVE_OK = ['win32', 'darwin'].includes(process.platform)

function open_watcher(dir, recursive, listener) {
  const watcher = fs.watch(dir, { persistent: false, recursive: recursive && RECURSIVE_OK }, listener)
  watcher.on?.('error', (e) => console.error(`Error watching directory ${dir}(${e})`))
  watcher.unref?.()
  return watcher
}

Watch.dir = (reader, dir, { recursive = false } = {}) => {
  if (enoent.dirs.get(dir)?.recursive) recursive = true

  const existing = watchers[dir]
  if (existing && (!recursive || existing.recursive)) return

  try {
    const watcher = open_watcher(dir, recursive, Watch.onEvent(reader, dir))
    existing?.watcher.close()
    watchers[dir] = { watcher, recursive }
    unqueue(dir)
  } catch (e) {
    if (existing) return console.error(`Error upgrading watcher on ${dir}, keeping the existing one (${e})`)
    if (e.code !== 'ENOENT') return console.error(`Error watching directory ${dir}(${e})`)
    enoent.dirs.set(dir, { recursive })
    Watch.ensure_enoent_timer(reader)
  }
}

function link_target(name) {
  try {
    return fs.lstatSync(name).isSymbolicLink() ? fs.realpathSync(name) : null
  } catch (ignore) {
    return null
  }
}

Watch.file = (reader, name) => {
  Watch.dir(reader, path.dirname(name))
  for (const t of Object.keys(link_targets)) if (link_targets[t] === name) delete link_targets[t]
  const target = link_target(name)
  if (!target) return
  link_targets[target] = name
  Watch.dir(reader, path.dirname(target))
}

Watch.onEvent = (reader, dir) => (fse, filename) => {
  if (!watchers[dir] || !filename) return

  const changed = path.join(dir, filename)
  for (const full_path of new Set([changed, link_targets[changed]].filter(Boolean))) {
    const args = reader._read_args[full_path]
    if (args && !args.opts && !args.options?.no_watch) {
      debounce(full_path, RELOAD_DELAY, () => Watch.reload(reader, full_path, args))
    }
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
  for (const [name, args] of Object.entries(reader._read_args)) {
    if (path.dirname(name) !== dir || args.opts || args.options?.no_watch) continue
    if (fs.existsSync(name)) Watch.reload(reader, name, args)
  }
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
  if (args.options?.no_watch) return false
  if (path.dirname(name) === dir) return true
  return Object.keys(link_targets).some((t) => link_targets[t] === name && path.dirname(t) === dir)
}

function still_tracked(reader, dir) {
  return Object.entries(reader?._read_args ?? {}).some(([name, args]) => needs_watcher(name, args, dir))
}

Watch.close = (reader, target) => {
  clear_timer(target)
  if (reader?._read_args) delete reader._read_args[target]

  const dirs = new Set([target, path.dirname(target)])
  for (const [t, link] of Object.entries(link_targets)) {
    if (link !== target) continue
    delete link_targets[t]
    dirs.add(path.dirname(t))
  }
  for (const dir of dirs) {
    if (still_tracked(reader, dir)) continue
    unqueue(dir)
    close_watcher(dir)
  }
}

Watch.closeAll = () => {
  for (const dir of Object.keys(watchers)) close_watcher(dir)
  for (const key of Object.keys(sedation_timers)) clear_timer(key)
  for (const t of Object.keys(link_targets)) delete link_targets[t]
  enoent.dirs.clear()
  Watch.stop_enoent_timer()
}

module.exports = Watch

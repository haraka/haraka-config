const fs = require('node:fs')
const path = require('node:path')

const enoent = { timer: false, files: new Set(), dirs: new Set() }
// One map per kind: a directory needs a dir watcher and getDir's recursive one
// at once, and sharing by path let each close or cancel the other. See #99.
// A dir or tree watcher owns many timers, one per path under it, so the timer
// maps are keyed by that path rather than by the watcher's.
const watchers = { file: {}, dir: {}, tree: {} }
const sedation_timers = { file: {}, dir: {}, tree: {} }

const Watch = {}

function close_watcher(kind, target) {
  if (!watchers[kind][target]) return
  try {
    watchers[kind][target].close()
  } catch (ignore) {}
  delete watchers[kind][target]
}

// Debounce `fn` for `target`, replacing whatever that kind had pending for it.
function sedate(kind, target, secs, fn) {
  clearTimeout(sedation_timers[kind][target])
  sedation_timers[kind][target] = setTimeout(() => {
    delete sedation_timers[kind][target]
    fn()
  }, secs * 1000)
}

function clear_timers(matches = () => true, kinds = Object.keys(sedation_timers)) {
  for (const kind of kinds) {
    const timers = sedation_timers[kind]
    for (const key of Object.keys(timers)) {
      if (!matches(key)) continue
      clearTimeout(timers[key])
      delete timers[key]
    }
  }
}

// Everyone who read this file. A _read_args entry carries the whole array;
// Watch.file attaches with a single { type, options, cb } of its own.
const registrations = (args) => (args.readers?.length ? args.readers : [args])

// `no_watch` is per reader: one that opted out is never reloaded, and never
// speaks for the readers that didn't.
const watched = (r) => !r.options?.no_watch

// getDir registers the directory path itself (as { opts }); its own recursive
// watcher handles those, and load_config() on a directory throws EISDIR.
const reloadable = (args) => Boolean(args) && !args.opts && registrations(args).some(watched)

// Reload a watched config file for every reader that wants it, and nothing
// at all when none does. Used by every watch path so they behave
// alike. Never throws: a parse failure leaves the previously cached value
// in effect, logs the failure distinctly, and passes the error to the
// callback. The caller's fs.watch stays active, so once the file is
// corrected the next event reloads the now-valid config.
Watch.reload = (reader, name, args) => {
  // Snapshot: a callback re-reads its config, which registers into this array.
  const readers = registrations(args).filter(watched)
  if (!readers.length) return
  let first_err
  const loaded = new Set()

  for (const reader_args of readers) {
    // A parse is per type+options, so owners that read a file alike share one.
    // Keyed here rather than by get_cache_key(), which collapses an overridden
    // file to its bare name and would merge that file's types onto one parse.
    const slot = JSON.stringify([reader_args.type, reader_args.options])
    if (!loaded.has(slot)) {
      loaded.add(slot)
      reader.load_config(name, reader_args.type, reader_args.options)
    }
    const err =
      typeof reader.last_load_error === 'function'
        ? reader.last_load_error(name, reader_args.type, reader_args.options)
        : undefined

    first_err ??= err

    // One subscriber's bad callback must not stop the rest from reloading.
    try {
      if (typeof reader_args.cb === 'function') reader_args.cb(err || undefined)
    } catch (e) {
      // Logged as an argument: a thrown null-prototype object has no string
      // conversion, so interpolating it would throw again inside this handler.
      console.error(`Reload callback for ${name} threw:`, e)
    }
  }

  if (first_err) {
    console.error(`Reload of ${name} failed; keeping previous config (watching for a fix): ${first_err.message}`)
  } else {
    console.log(`Reloaded file: ${name}`)
  }

  return first_err
}

Watch.ensure_enoent_timer = (reader) => {
  if (enoent.timer) return
  // Create timer
  enoent.timer = setInterval(() => {
    if (!enoent.files.size && !enoent.dirs.size) return Watch.stop_enoent_timer()

    for (const file of [...enoent.files]) {
      fs.stat(file, (err) => {
        // File now exists, and nobody unqueued it while we were polling
        if (err || !enoent.files.delete(file)) return
        const args = reader._read_args[file]
        // the caller tore this slot down, or every reader opted out, while we
        // were polling
        if (!reloadable(args)) return
        Watch.reload(reader, file, args)
        Watch.attach(reader, file, args)
      })
    }
    for (const dir of [...enoent.dirs]) {
      fs.stat(dir, (err) => {
        if (err || !enoent.dirs.delete(dir)) return
        // Dir now exists; re-enter Watch.dir which (re)attaches the watcher.
        Watch.dir(reader, dir)
      })
    }
  }, 60 * 1000)
  enoent.timer.unref() // don't block process exit
}

Watch.stop_enoent_timer = () => {
  if (!enoent.timer) return
  clearInterval(enoent.timer)
  enoent.timer = false
}

// Attach an fs.watch for `name`. Every attach site goes through here so an
// ENOENT is always queued for the poller rather than thrown
Watch.attach = (reader, name, args) => {
  try {
    watchers.file[name] = fs.watch(name, { persistent: false }, Watch.onEvent(reader, name, args))
  } catch (e) {
    if (e.code === 'ENOENT') {
      // ignore error when ENOENT
      enoent.files.add(name)
      Watch.ensure_enoent_timer(reader)
    } else {
      console.error(`Error watching config file: ${name} : ${e}`)
    }
  }
}

Watch.file = (reader, name, type, cb, options) => {
  // This works on all OS's, but watch_dir() above is preferred for Linux and
  // Windows as it is far more efficient.
  // NOTE: we need a fs.watch per file. It's impossible to watch non-existent
  // files. Instead, note which files we attempted
  // to watch that returned ENOENT and fs.stat each periodically
  if (watchers.file[name] || options?.no_watch) return

  Watch.attach(reader, name, { type, options, cb })
}

// Watch a directory; reload any tracked file inside it on change.
// https://nodejs.org/api/fs.html#fs_fs_watch_filename_options_listener
Watch.dir = (reader, dir_path) => {
  const cp = dir_path || reader.config_path
  if (watchers.dir[cp]) return

  try {
    watchers.dir[cp] = fs.watch(cp, { persistent: false }, (fse, filename) => {
      if (!filename) return
      const full_path = path.join(cp, filename)
      if (!reloadable(reader._read_args[full_path])) return
      sedate('dir', full_path, 5, () => {
        // the file may since have been read under another type, or stopped
        const latest = reader._read_args[full_path]
        if (reloadable(latest)) Watch.reload(reader, full_path, latest)
      })
    })
    watchers.dir[cp].unref?.()
  } catch (e) {
    if (e.code === 'ENOENT') {
      // callers may track files under dirs that don't exist yet. Poll
      // quietly and attach the watcher once the dir is created.
      enoent.dirs.add(cp)
      Watch.ensure_enoent_timer(reader)
    } else {
      console.error(`Error watching directory ${cp}(${e})`)
    }
  }
}

// used by getDir
Watch.dir2 = (reader, dirPath) => {
  if (watchers.tree[dirPath]) return
  const watchOpts = { persistent: false, recursive: true }

  // recursive is only supported on Windows (win32, win64) and macOS (darwin)
  if (!/win|darwin/.test(process.platform)) watchOpts.recursive = false

  watchers.tree[dirPath] = fs.watch(dirPath, watchOpts, (fse, filename) => {
    if (!filename) return
    const full_path = path.join(dirPath, filename)
    const args = reader._read_args[dirPath]
    sedate('tree', full_path, 2, () => {
      // args may be stale after caller teardown
      if (typeof args?.opts?.watchCb === 'function') args.opts.watchCb()
    })
  })
  watchers.tree[dirPath].unref()
}

// Drop `owner`'s registrations on `target`; true while some reader still wants
// it watched. No owner, or none recorded (a getDir slot), drops the whole slot.
function deregister(reader, target, owner) {
  const args = reader?._read_args?.[target]
  if (!args) return false

  const left = owner ? (args.readers ?? []).filter((r) => r.owner !== owner) : []
  if (!left.length) {
    delete reader._read_args[target]
    return false
  }

  // read_config reads the flat fields to decide a retype, and a retype drops
  // the previous type's `!file` injections without re-running the parse that
  // made them. Leaving a departed owner's type there loses another owner's
  // overrides permanently, so the fields follow a surviving registration.
  const { type, cb, options } = left.at(-1)
  Object.assign(args, { readers: left, type, cb, options })
  return left.some(watched)
}

// A directory watcher serves every tracked file inside it, so only the last of
// them releases it. lib/reader.js exports one Reader, so scanning that reader's
// files is scanning every file this watcher serves.
function release_dir(reader, dir) {
  // without the reader's files we can't tell whether the watcher is still
  // needed, and closing it would stop hot reload for every file in `dir`
  const tracked = reader?._read_args
  if (!tracked) return
  for (const name in tracked) {
    if (path.dirname(name) === dir && reloadable(tracked[name])) return
  }
  close_watcher('dir', dir)
  enoent.dirs.delete(dir)
}

// Idempotent. A target another owner still watches keeps its watchers.
Watch.close = (reader, target, owner) => {
  if (deregister(reader, target, owner)) return

  close_watcher('file', target)
  const closing_tree = Boolean(watchers.tree[target])
  close_watcher('tree', target)

  const prefix = path.join(target, path.sep)
  const under = (key) => key === target || key.startsWith(prefix)
  // a tree timer belongs to the getDir consumer at its root, so stopping one
  // file inside that tree must not cancel the directory's pending watchCb
  clear_timers(under, closing_tree ? undefined : ['file', 'dir'])
  // unqueue, here and in release_dir: the poller would otherwise attach a
  // watcher for something nothing reads any more
  enoent.files.delete(target)
  enoent.dirs.delete(target)
  release_dir(reader, path.dirname(target))
}

// Close every watcher and clear every sedation timer.
Watch.closeAll = () => {
  for (const [kind, by_target] of Object.entries(watchers)) {
    for (const target of Object.keys(by_target)) close_watcher(kind, target)
  }
  clear_timers()
  enoent.files.clear()
  enoent.dirs.clear()
  Watch.stop_enoent_timer()
}

Watch.onEvent = (reader, name, args) => {
  return (fse) => {
    // close() may have run between the event firing and this handler: don't
    // reload, and don't resurrect a watcher the caller asked us to drop.
    if (!watchers.file[name]) return
    // the file may since have been read under another type
    const latest = () => reader._read_args?.[name] ?? args

    sedate('file', name, 5, () => {
      const args_now = latest()
      if (reloadable(args_now)) Watch.reload(reader, name, args_now)
    })

    if (fse !== 'rename') return
    // https://github.com/joyent/node/issues/2062
    // After a rename event, re-watch the file
    close_watcher('file', name)
    Watch.attach(reader, name, latest())
  }
}

module.exports = Watch

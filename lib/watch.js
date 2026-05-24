const fs = require('node:fs')
const path = require('node:path')

const enoent = { timer: false, files: new Set(), dirs: new Set() }
const watchers = {}
const sedation_timers = {}

const Watch = {}

// Reload a watched config file. Used by every watch path so they behave
// alike. Never throws: a parse failure leaves the previously cached value
// in effect, logs the failure distinctly, and passes the error to the
// callback. The caller's fs.watch stays active, so once the file is
// corrected the next event reloads the now-valid config.
Watch.reload = (reader, name, args) => {
  reader.load_config(name, args.type, args.options)
  const err =
    typeof reader.last_load_error === 'function' ? reader.last_load_error(name, args.type, args.options) : undefined
  if (err) {
    console.error(`Reload of ${name} failed; keeping previous config (watching for a fix): ${err.message}`)
  } else {
    console.log(`Reloaded file: ${name}`)
  }
  if (typeof args.cb === 'function') args.cb(err || undefined)
  return err
}

Watch.ensure_enoent_timer = (reader) => {
  if (enoent.timer) return
  // Create timer
  enoent.timer = setInterval(() => {
    for (const file of enoent.files) {
      fs.stat(file, (err) => {
        if (err) return
        // File now exists
        enoent.files.delete(file)
        const args = reader._read_args[file]
        Watch.reload(reader, file, args)
        watchers[file] = fs.watch(file, { persistent: false }, Watch.onEvent(reader, file, args))
      })
    }
    for (const dir of enoent.dirs) {
      fs.stat(dir, (err) => {
        if (err) return
        // Dir now exists; re-enter Watch.dir which (re)attaches the watcher.
        enoent.dirs.delete(dir)
        Watch.dir(reader, dir)
      })
    }
  }, 60 * 1000)
  enoent.timer.unref() // don't block process exit
}

Watch.file = (reader, name, type, cb, options) => {
  // This works on all OS's, but watch_dir() above is preferred for Linux and
  // Windows as it is far more efficient.
  // NOTE: we need a fs.watch per file. It's impossible to watch non-existent
  // files. Instead, note which files we attempted
  // to watch that returned ENOENT and fs.stat each periodically
  if (watchers[name] || (options && options.no_watch)) return

  try {
    watchers[name] = fs.watch(name, { persistent: false }, Watch.onEvent(reader, name, { type, options, cb }))
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

// Watch a directory; reload any tracked file inside it on change.
// https://nodejs.org/api/fs.html#fs_fs_watch_filename_options_listener
Watch.dir = (reader, dir_path) => {
  const cp = dir_path || reader.config_path
  if (watchers[cp]) return

  try {
    watchers[cp] = fs.watch(cp, { persistent: false }, (fse, filename) => {
      if (!filename) return
      const full_path = path.join(cp, filename)
      const args = reader._read_args[full_path]
      if (!args) return
      if (args.options?.no_watch) return
      if (sedation_timers[full_path]) {
        clearTimeout(sedation_timers[full_path])
      }
      sedation_timers[full_path] = setTimeout(() => {
        delete sedation_timers[full_path]
        Watch.reload(reader, full_path, args)
      }, 5 * 1000)
    })
    watchers[cp].unref?.()
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
  if (watchers[dirPath]) return
  const watchOpts = { persistent: false, recursive: true }

  // recursive is only supported on Windows (win32, win64) and macOS (darwin)
  if (!/win|darwin/.test(process.platform)) watchOpts.recursive = false

  watchers[dirPath] = fs.watch(dirPath, watchOpts, (fse, filename) => {
    // console.log(`event: ${fse}, ${filename}`);
    if (!filename) return
    const full_path = path.join(dirPath, filename)
    const args = reader._read_args[dirPath]
    // console.log(args);
    if (sedation_timers[full_path]) {
      clearTimeout(sedation_timers[full_path])
    }
    sedation_timers[full_path] = setTimeout(() => {
      delete sedation_timers[full_path]
      // args may be stale after caller teardown
      if (typeof args?.opts?.watchCb === 'function') args.opts.watchCb()
    }, 2 * 1000)
  })
  watchers[dirPath].unref()
}

// Close the watcher on `target` and clear any sedation timers under it. Idempotent.
Watch.close = (reader, target) => {
  if (watchers[target]) {
    try {
      watchers[target].close()
    } catch (ignore) {}
    delete watchers[target]
  }
  const prefix = target.endsWith(path.sep) ? target : target + path.sep
  for (const key of Object.keys(sedation_timers)) {
    if (key === target || key.startsWith(prefix)) {
      clearTimeout(sedation_timers[key])
      delete sedation_timers[key]
    }
  }
  if (reader?._read_args?.[target]) {
    delete reader._read_args[target]
  }
}

// Close every watcher and clear every sedation timer.
Watch.closeAll = () => {
  for (const target of Object.keys(watchers)) {
    try {
      watchers[target].close()
    } catch (ignore) {}
    delete watchers[target]
  }
  for (const key of Object.keys(sedation_timers)) {
    clearTimeout(sedation_timers[key])
    delete sedation_timers[key]
  }
}

Watch.onEvent = (reader, name, args) => {
  return (fse) => {
    if (sedation_timers[name]) {
      clearTimeout(sedation_timers[name])
    }

    sedation_timers[name] = setTimeout(() => {
      delete sedation_timers[name]
      Watch.reload(reader, name, args)
    }, 5 * 1000)

    if (fse !== 'rename') return
    // https://github.com/joyent/node/issues/2062
    // After a rename event, re-watch the file
    watchers[name].close()
    try {
      watchers[name] = fs.watch(name, { persistent: false }, Watch.onEvent(reader, name, args))
    } catch (e) {
      if (e.code === 'ENOENT') {
        enoent.files.add(name)
        Watch.ensure_enoent_timer(reader)
      } else {
        console.error(`Error watching file: ${name} : ${e}`)
      }
    }
  }
}

module.exports = Watch

const fs = require('node:fs')
const path = require('node:path')

const enoent = { timer: false, files: [] }
const watchers = {}
const sedation_timers = {}

module.exports.ensure_enoent_timer = (reader) => {
  if (enoent.timer) return
  // Create timer
  enoent.timer = setInterval(() => {
    for (const file of Object.keys(enoent.files)) {
      fs.stat(file, (err) => {
        if (err) return
        // File now exists
        delete enoent.files[file]
        const args = reader._read_args[file]
        reader.load_config(file, args.type, args.options, args.cb)
        watchers[file] = fs.watch(
          file,
          { persistent: false },
          this.onEvent(reader, file, args),
        )
      })
    }
  }, 60 * 1000)
  enoent.timer.unref() // don't block process exit
}

module.exports.file = (reader, name, type, cb, options) => {
  // This works on all OS's, but watch_dir() above is preferred for Linux and
  // Windows as it is far more efficient.
  // NOTE: we need a fs.watch per file. It's impossible to watch non-existent
  // files. Instead, note which files we attempted
  // to watch that returned ENOENT and fs.stat each periodically
  if (watchers[name] || (options && options.no_watch)) return

  try {
    watchers[name] = fs.watch(
      name,
      { persistent: false },
      this.onEvent(reader, name, { type, options, cb }),
    )
  } catch (e) {
    if (e.code === 'ENOENT') {
      // ignore error when ENOENT
      enoent.files[name] = true
      this.ensure_enoent_timer(reader)
    } else {
      console.error(`Error watching config file: ${name} : ${e}`)
    }
  }
}

// used to watch main haraka config dir
module.exports.dir = (reader) => {
  // NOTE: Has OS platform limitations:
  // https://nodejs.org/api/fs.html#fs_fs_watch_filename_options_listener
  const cp = reader.config_path
  if (watchers[cp]) return

  try {
    watchers[cp] = fs.watch(cp, { persistent: false }, (fse, filename) => {
      if (!filename) return
      const full_path = path.join(cp, filename)
      const args = reader._read_args[full_path]
      if (!args) return
      if (args.options?.no_watch) return
      if (sedation_timers[filename]) {
        clearTimeout(sedation_timers[filename])
      }
      sedation_timers[filename] = setTimeout(() => {
        console.log(`Reloading file: ${full_path}`)
        reader.load_config(full_path, args.type, args.options)
        delete sedation_timers[filename]
        if (typeof args.cb === 'function') args.cb()
      }, 5 * 1000)
    })
  } catch (e) {
    console.error(`Error watching directory ${cp}(${e})`)
  }
}

// used by getDir
module.exports.dir2 = (reader, dirPath) => {
  if (watchers[dirPath]) return
  const watchOpts = { persistent: false, recursive: true }

  // recursive is only supported on Windows (win32, win64) and macOS (darwin)
  if (!/win/.test(process.platform)) watchOpts.recursive = false

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
      args.opts.watchCb()
    }, 2 * 1000)
  })
}

module.exports.onEvent = (reader, name, args) => {
  return (fse) => {
    if (sedation_timers[name]) {
      clearTimeout(sedation_timers[name])
    }

    sedation_timers[name] = setTimeout(() => {
      console.log(`Reloading file: ${name}`)
      reader.load_config(name, args.type, args.options)
      delete sedation_timers[name]
      if (typeof args.cb === 'function') args.cb()
    }, 5 * 1000)

    if (fse !== 'rename') return
    // https://github.com/joyent/node/issues/2062
    // After a rename event, re-watch the file
    watchers[name].close()
    try {
      watchers[name] = fs.watch(
        name,
        { persistent: false },
        this.onEvent(...arguments),
      )
    } catch (e) {
      if (e.code === 'ENOENT') {
        enoent.files[name] = true
        this.ensure_enoent_timer(reader)
      } else {
        console.error(`Error watching file: ${name} : ${e}`)
      }
    }
  }
}

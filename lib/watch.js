const fs = require('node:fs')
const path = require('node:path')

module.exports.file = (reader, name, type, cb, options) => {
  // This works on all OS's, but watch_dir() above is preferred for Linux and
  // Windows as it is far more efficient.
  // NOTE: we need a fs.watch per file. It's impossible to watch non-existent
  // files. Instead, note which files we attempted
  // to watch that returned ENOENT and fs.stat each periodically
  if (reader._watchers[name] || (options && options.no_watch)) return

  try {
    reader._watchers[name] = fs.watch(
      name,
      { persistent: false },
      reader.on_watch_event(name, type, options, cb),
    )
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // ignore error when ENOENT
      console.error(`Error watching config file: ${name} : ${e}`)
    } else {
      reader._enoent.files[name] = true
      reader.ensure_enoent_timer()
    }
  }
}

module.exports.dir = (reader) => {
  // NOTE: Has OS platform limitations:
  // https://nodejs.org/api/fs.html#fs_fs_watch_filename_options_listener
  const cp = reader.config_path
  if (reader._watchers[cp]) return

  try {
    reader._watchers[cp] = fs.watch(
      cp,
      { persistent: false },
      (fse, filename) => {
        if (!filename) return
        const full_path = path.join(cp, filename)
        const args = reader._read_args[full_path]
        if (!args) return
        if (args.options?.no_watch) return
        if (reader._sedation_timers[filename]) {
          clearTimeout(reader._sedation_timers[filename])
        }
        reader._sedation_timers[filename] = setTimeout(() => {
          console.log(`Reloading file: ${full_path}`)
          reader.load_config(full_path, args.type, args.options)
          delete reader._sedation_timers[filename]
          if (typeof args.cb === 'function') args.cb()
        }, 5 * 1000)
      },
    )
  } catch (e) {
    console.error(`Error watching directory ${cp}(${e})`)
  }
}

module.exports.dir2 = (reader, dirPath) => {
  if (reader._watchers[dirPath]) return
  const watchOpts = { persistent: false, recursive: true }

  // recursive is only supported on Windows (win32, win64) and macOS (darwin)
  if (!/win/.test(process.platform)) watchOpts.recursive = false

  reader._watchers[dirPath] = fs.watch(dirPath, watchOpts, (fse, filename) => {
    // console.log(`event: ${fse}, ${filename}`);
    if (!filename) return
    const full_path = path.join(dirPath, filename)
    const args = reader._read_args[dirPath]
    // console.log(args);
    if (reader._sedation_timers[full_path]) {
      clearTimeout(reader._sedation_timers[full_path])
    }
    reader._sedation_timers[full_path] = setTimeout(() => {
      delete reader._sedation_timers[full_path]
      args.opts.watchCb()
    }, 2 * 1000)
  })
}

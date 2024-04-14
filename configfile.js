'use strict'

const fs = require('fs')
const path = require('path')

let config_dir_candidates = [
  // these work when this file is loaded as require('./config.js')
  path.join(__dirname, 'config'), // Haraka ./config dir
  __dirname, // npm packaged plugins
]

class cfreader {
  constructor() {
    this.watch_files = true
    this._config_cache = {}
    this._read_args = {}
    this._watchers = {}
    this._enoent_timer = false
    this._enoent_files = {}
    this._sedation_timers = {}
    this._overrides = {}

    this.get_path_to_config_dir()

    // for "ini" type files
    this.regex = {
      section: /^\s*\[\s*([^\]]*?)\s*\]\s*$/,
      param: /^\s*([\w@:._\-/[\]]+)\s*(?:=\s*(.*?)\s*)?$/,
      comment: /^\s*[;#].*$/,
      line: /^\s*(.*?)\s*$/,
      blank: /^\s*$/,
      continuation: /\\[ \t]*$/,
      is_integer: /^-?\d+$/,
      is_float: /^-?\d+\.\d+$/,
      is_truth: /^(?:true|yes|ok|enabled|on|1)$/i,
      is_array: /(.+)\[\]$/,
    }
  }

  get_path_to_config_dir() {
    if (process.env.HARAKA) {
      // console.log(`process.env.HARAKA: ${process.env.HARAKA}`);
      this.config_path = path.join(process.env.HARAKA, 'config')
      return
    }

    if (process.env.NODE_ENV === 'test') {
      // loaded by haraka-config/test/*
      this.config_path = path.join(__dirname, 'test', 'config')
      return
    }

    // these work when this is loaded with require('haraka-config')
    if (/node_modules[\\/]haraka-config$/.test(__dirname)) {
      config_dir_candidates = [
        path.join(__dirname, '..', '..', 'config'), // haraka/Haraka/*
        path.join(__dirname, '..', '..'), // npm packaged modules
      ]
    }

    for (const candidate of config_dir_candidates) {
      try {
        const stat = fs.statSync(candidate)
        if (stat && stat.isDirectory()) {
          this.config_path = candidate
          return
        }
      } catch (ignore) {
        console.error(ignore.message)
      }
    }
  }

  on_watch_event(name, type, options, cb) {
    return (fse) => {
      if (this._sedation_timers[name]) {
        clearTimeout(this._sedation_timers[name])
      }
      this._sedation_timers[name] = setTimeout(() => {
        console.log(`Reloading file: ${name}`)
        this.load_config(name, type, options)
        delete this._sedation_timers[name]
        if (typeof cb === 'function') cb()
      }, 5 * 1000)

      if (fse !== 'rename') return
      // https://github.com/joyent/node/issues/2062
      // After a rename event, re-watch the file
      this._watchers[name].close()
      try {
        this._watchers[name] = fs.watch(
          name,
          { persistent: false },
          this.on_watch_event(...arguments),
        )
      } catch (e) {
        if (e.code === 'ENOENT') {
          this._enoent_files[name] = true
          this.ensure_enoent_timer()
        } else {
          console.error(`Error watching file: ${name} : ${e}`)
        }
      }
    }
  }

  watch_dir() {
    // NOTE: Has OS platform limitations:
    // https://nodejs.org/api/fs.html#fs_fs_watch_filename_options_listener
    const cp = this.config_path
    if (this._watchers[cp]) return

    try {
      this._watchers[cp] = fs.watch(
        cp,
        { persistent: false },
        (fse, filename) => {
          if (!filename) return
          const full_path = path.join(cp, filename)
          if (!this._read_args[full_path]) return
          const args = this._read_args[full_path]
          if (args.options && args.options.no_watch) return
          if (this._sedation_timers[filename]) {
            clearTimeout(this._sedation_timers[filename])
          }
          this._sedation_timers[filename] = setTimeout(() => {
            console.log(`Reloading file: ${full_path}`)
            this.load_config(full_path, args.type, args.options)
            delete this._sedation_timers[filename]
            if (typeof args.cb === 'function') args.cb()
          }, 5 * 1000)
        },
      )
    } catch (e) {
      console.error(`Error watching directory ${cp}(${e})`)
    }
    return
  }

  watch_file(name, type, cb, options) {
    // This works on all OS's, but watch_dir() above is preferred for Linux and
    // Windows as it is far more efficient.
    // NOTE: we need a fs.watch per file. It's impossible to watch non-existent
    // files. Instead, note which files we attempted
    // to watch that returned ENOENT and fs.stat each periodically
    if (this._watchers[name] || (options && options.no_watch)) return

    try {
      this._watchers[name] = fs.watch(
        name,
        { persistent: false },
        this.on_watch_event(name, type, options, cb),
      )
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // ignore error when ENOENT
        console.error(`Error watching config file: ${name} : ${e}`)
      } else {
        this._enoent_files[name] = true
        this.ensure_enoent_timer()
      }
    }
  }

  get_cache_key(name, options) {
    // Ignore options etc. if this is an overriden value
    if (this._overrides[name]) return name

    if (options) {
      // ordering of objects isn't guaranteed to be consistent, but typically is.
      return name + JSON.stringify(options)
    }

    if (this._read_args[name] && this._read_args[name].options) {
      return name + JSON.stringify(this._read_args[name].options)
    }

    return name
  }

  read_config(name, type, cb, options) {
    // Store arguments used so we can:
    // 1. re-use them by filename later
    // 2. to know which files we've read, so we can ignore
    //    other files written to the same directory.

    this._read_args[name] = {
      type,
      cb,
      options,
    }

    // Check cache first
    if (!process.env.WITHOUT_CONFIG_CACHE) {
      const cache_key = this.get_cache_key(name, options)
      // console.log(`\tcache_key: ${cache_key}`);
      if (this._config_cache[cache_key] !== undefined) {
        // console.log(`\t${name} is cached`);
        return this._config_cache[cache_key]
      }
    }

    // load config file
    const result = this.load_config(name, type, options)
    if (!this.watch_files) return result

    // We can watch the directory on these platforms which
    // allows us to notice when files are newly created.
    switch (process.platform) {
      case 'win32':
      case 'win64':
      case 'linux':
        this.watch_dir()
        break
      default:
        // All other operating systems
        this.watch_file(name, type, cb, options)
    }

    return result
  }

  read_dir(name, opts) {
    return new Promise((resolve, reject) => {
      this._read_args[name] = { opts }
      const type = opts.type || 'binary'

      isDirectory(name)
        .then(() => {
          return fsReadDir(name)
        })
        .then((fileList) => {
          const reader = require(path.resolve(__dirname, 'readers', type))
          const promises = []
          for (const file of fileList) {
            promises.push(reader.loadPromise(path.resolve(name, file)))
          }
          return Promise.all(promises)
        })
        .then((fileList) => {
          // console.log(fileList);
          resolve(fileList)
        })
        .catch(reject)

      if (opts.watchCb) this.fsWatchDir(name)
    })
  }

  ensure_enoent_timer() {
    if (this._enoent_timer) return
    // Create timer
    this._enoent_timer = setInterval(() => {
      const files = Object.keys(this._enoent_files)
      for (const fileOuter of files) {
        /* BLOCK SCOPE */
        ;((file) => {
          fs.stat(file, (err) => {
            if (err) return
            // File now exists
            delete this._enoent_files[file]
            const args = this._read_args[file]
            this.load_config(file, args.type, args.options, args.cb)
            this._watchers[file] = fs.watch(
              file,
              { persistent: false },
              this.on_watch_event(file, args.type, args.options, args.cb),
            )
          })
        })(fileOuter) // END BLOCK SCOPE
      }
    }, 60 * 1000)
    this._enoent_timer.unref() // This shouldn't block exit
  }

  get_filetype_reader(type) {
    switch (type) {
      case 'list':
      case 'value':
      case 'data':
      case '':
        return require(path.resolve(__dirname, 'readers', 'flat'))
    }
    return require(path.resolve(__dirname, 'readers', type))
  }

  load_config(name, type, options) {
    let result

    if (!type) {
      type = path.extname(name).toLowerCase().substring(1)
    }

    let cfrType = this.get_filetype_reader(type)

    if (!fs.existsSync(name)) {
      if (!/\.h?json$/.test(name)) {
        return cfrType.empty(options, type)
      }

      const yaml_name = name.replace(/\.h?json$/, '.yaml')
      if (!fs.existsSync(yaml_name)) return cfrType.empty(options, type)

      name = yaml_name
      type = 'yaml'

      cfrType = this.get_filetype_reader(type)
    }

    const cache_key = this.get_cache_key(name, options)
    try {
      switch (type) {
        case 'ini':
          result = cfrType.load(name, options, this.regex)
          break
        case 'hjson':
        case 'json':
        case 'yaml':
          result = cfrType.load(name)
          this.process_file_overrides(name, options, result)
          break
        // case 'binary':
        default:
          result = cfrType.load(name, type, options, this.regex)
      }
      this._config_cache[cache_key] = result
    } catch (err) {
      console.error(err.message)
      if (this._config_cache[cache_key]) {
        return this._config_cache[cache_key]
      }
      return cfrType.empty(options, type)
    }
    return result
  }

  process_file_overrides(name, options, result) {
    // We might be re-loading this file:
    //     * build a list of cached overrides
    //     * remove them and add them back
    const cp = this.config_path
    const cache_key = this.get_cache_key(name, options)

    if (this._config_cache[cache_key]) {
      for (const ck in this._config_cache[cache_key]) {
        if (ck.substr(0, 1) === '!')
          delete this._config_cache[path.join(cp, ck.substr(1))]
      }
    }

    // Allow JSON files to create or overwrite other config file data
    // by prefixing the outer variable name with ! e.g. !smtp.ini
    for (const key in result) {
      if (key.substr(0, 1) !== '!') continue
      const fn = key.substr(1)
      // Overwrite the config cache for this filename
      console.log(`Overriding file ${fn} with config from ${name}`)
      this._config_cache[path.join(cp, fn)] = result[key]
    }
  }

  fsWatchDir(dirPath) {
    if (this._watchers[dirPath]) return
    const watchOpts = { persistent: false, recursive: true }

    // recursive is only supported on Windows (win32, win64) and macOS (darwin)
    if (!/win/.test(process.platform)) watchOpts.recursive = false

    this._watchers[dirPath] = fs.watch(dirPath, watchOpts, (fse, filename) => {
      // console.log(`event: ${fse}, ${filename}`);
      if (!filename) return
      const full_path = path.join(dirPath, filename)
      const args = this._read_args[dirPath]
      // console.log(args);
      if (this._sedation_timers[full_path]) {
        clearTimeout(this._sedation_timers[full_path])
      }
      this._sedation_timers[full_path] = setTimeout(() => {
        delete this._sedation_timers[full_path]
        args.opts.watchCb()
      }, 2 * 1000)
    })
  }
}

module.exports = new cfreader()

function isDirectory(filepath) {
  return new Promise((resolve, reject) => {
    fs.stat(filepath, (err, stat) => {
      if (err) return reject(err)
      resolve(stat.isDirectory())
    })
  })
}

function fsReadDir(filepath) {
  return new Promise((resolve, reject) => {
    fs.readdir(filepath, (err, fileList) => {
      if (err) return reject(err)
      resolve(fileList)
    })
  })
}

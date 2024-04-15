'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const watch = require('./watch')

let config_dir_candidates = [
  path.join(__dirname, '..', 'config'), // Haraka ./config dir
  path.join(__dirname, '..'), // npm packaged plugins
]

class cfreader {
  constructor() {
    this.watch_files = true
    this._config_cache = {}
    this._read_args = {}
    this._watchers = {}
    this._enoent = { timer: false, files: [] }
    this._sedation_timers = {}
    this._overrides = {}

    this.get_path_to_config_dir()
  }

  get_path_to_config_dir() {
    if (process.env.HARAKA) {
      // console.log(`process.env.HARAKA: ${process.env.HARAKA}`);
      this.config_path = path.join(process.env.HARAKA, 'config')
      return
    }

    if (process.env.NODE_ENV === 'test') {
      // console.log(`loaded by haraka-config/test/*`)
      this.config_path = path.join(__dirname, '..', 'test', 'config')
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
        if (stat?.isDirectory()) {
          this.config_path = candidate
          return
        }
      } catch (ignore) {
        console.error(ignore.message)
      }
    }
  }

  getType(fileName) {
    const ext = path.extname(fileName).substring(1).toLowerCase()
    switch (ext) {
      case 'hjson':
      case 'json':
      case 'yaml':
      case 'js':
      case 'ini':
      case 'list':
      case 'data':
        return ext
      case 'yml':
        return 'yaml'
      case 'pem':
      case 'bin':
      case 'binary':
        return 'binary'
      default:
        return 'value'
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
          this._enoent.files[name] = true
          this.ensure_enoent_timer()
        } else {
          console.error(`Error watching file: ${name} : ${e}`)
        }
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
        watch.dir(this)
        break
      default:
        // All other operating systems
        watch.file(this, name, type, cb, options)
    }

    return result
  }

  read_dir(name, opts = {}) {
    return new Promise((resolve, reject) => {
      this._read_args[name] = { opts }

      fsp
        .stat(name)
        .then((stat) => stat.isDirectory())
        .then(() => fsp.readdir(name))
        .then(async (fileList) => {
          const contents = []
          for (const file of fileList) {
            const type = opts.type ?? this.getType(file)
            contents.push(
              this.load_config(path.resolve(name, file), type, opts),
            )
          }
          return contents
        })
        .then(resolve)
        .catch(reject)

      if (opts.watchCb) watch.dir2(this, name)
    })
  }

  ensure_enoent_timer() {
    if (this._enoent.timer) return
    // Create timer
    this._enoent.timer = setInterval(() => {
      for (const file of Object.keys(this._enoent.files)) {
        fs.stat(file, (err) => {
          if (err) return
          // File now exists
          delete this._enoent.files[file]
          const args = this._read_args[file]
          this.load_config(file, args.type, args.options, args.cb)
          this._watchers[file] = fs.watch(
            file,
            { persistent: false },
            this.on_watch_event(file, args.type, args.options, args.cb),
          )
        })
      }
    }, 60 * 1000)
    this._enoent.timer.unref() // This shouldn't block exit
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

    if (!type) type = this.getType(name)

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
          result = cfrType.load(name, options)
          break
        case 'hjson':
        case 'json':
        case 'yaml':
          result = cfrType.load(name)
          this.process_file_overrides(name, options, result)
          break
        // case 'binary':
        default:
          result = cfrType.load(name, type, options)
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
}

module.exports = new cfreader()

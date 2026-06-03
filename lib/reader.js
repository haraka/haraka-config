'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const watch = require('./watch')

let config_dir_candidates = [
  path.join(__dirname, '..', 'config'), // Haraka ./config dir
  path.join(__dirname, '..'), // npm packaged plugins
]

class Reader {
  constructor() {
    this.watch_files = true
    this._config_cache = {}
    this._read_args = {}
    this._overrides = {}
    this._load_errors = {}

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

    // when loaded with require('haraka-config')
    if (__dirname.split(path.sep).slice(-3).toString() === 'node_modules,haraka-config,lib') {
      config_dir_candidates = [
        path.join(__dirname, '..', '..', '..', 'config'), // haraka/Haraka/*
        path.join(__dirname, '..', '..', '..'), // npm packaged modules
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
        // console.error(ignore.message)
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

    switch (process.platform) {
      // these platforms allow us to notice when files are created.
      case 'win32':
      case 'win64':
      case 'linux':
        watch.dir(this, path.dirname(name))
        break
      default:
        // All other operating systems
        watch.file(this, name, type, cb, options)
    }

    return result
  }

  stop_watching(target) {
    watch.close(this, target)
  }

  async read_dir(name, opts = {}) {
    this._read_args[name] = { opts }

    const contents = []
    const dirs = []

    const stat = await fsp.stat(name)
    if (stat.isDirectory()) dirs.push(name)

    for (const dir of dirs) {
      for (const entry of await fsp.readdir(dir)) {
        const entryPath = path.join(dir, entry)
        const stat = await fsp.stat(entryPath)
        if (stat.isDirectory()) dirs.push(entryPath) // recursion
        if (stat.isFile()) {
          const type = opts.type ?? this.getType(entry)
          contents.push({
            path: entryPath,
            data: this.load_config(entryPath, type, opts),
          })
        }
      }
    }

    if (opts.watchCb) watch.dir2(this, name)
    return contents
  }

  get_filetype_reader(type) {
    switch (type) {
      case 'list':
      case 'value':
      case 'data':
      case '':
        return require(path.resolve(__dirname, 'readers', 'flat'))
      case 'json':
      case 'hjson':
      case 'yaml':
        return require(path.resolve(__dirname, 'readers', 'structured'))
    }
    return require(path.resolve(__dirname, 'readers', type))
  }

  // When `name` doesn't exist on disk, apply fallbacks:
  //   *.h?json        -> *.yaml   (yaml is friendlier to hand-write)
  //   <name>          -> <name>.js (lets a .js module supply config,
  //                                 e.g. from process.env -- issue #39;
  //                                 requires HARAKA_JS_CONFIG=1 env var)
  // Returns { name, type }; `missing` is true when nothing exists.
  // Used by both load_config() and last_load_error() so their cache keys
  // can never drift apart.
  _resolve_missing(name, type) {
    if (fs.existsSync(name)) return { name, type, missing: false }

    if (/\.h?json$/.test(name)) {
      const yaml_name = name.replace(/\.h?json$/, '.yaml')
      if (fs.existsSync(yaml_name)) return { name: yaml_name, type: 'yaml', missing: false }
      return { name, type, missing: true }
    }

    if (!/\.js$/.test(name) && process.env.HARAKA_JS_CONFIG) {
      const js_name = `${name}.js`
      if (fs.existsSync(js_name)) return { name: js_name, type: 'js', missing: false }
    }

    return { name, type, missing: true }
  }

  load_config(name, type, options) {
    let result

    if (!type) type = this.getType(name)

    // Key the cache/errors by the *requested* name+options, not the
    // post-fallback file. read_config(), last_load_error(), and the file
    // watcher all use the requested name, so they must agree on the slot.
    const cache_key = this.get_cache_key(name, options)

    const resolved = this._resolve_missing(name, type)
    const cfrType = this.get_filetype_reader(resolved.type)
    if (resolved.missing) return cfrType.empty(options, resolved.type)
    name = resolved.name
    type = resolved.type

    try {
      switch (type) {
        case 'ini':
          result = cfrType.load(name, options)
          break
        case 'hjson':
        case 'json':
        case 'yaml':
          result = cfrType.load(name, type)
          this.process_file_overrides(name, options, result, cache_key)
          break
        // case 'binary':
        default:
          result = cfrType.load(name, type, options)
      }
      this._config_cache[cache_key] = result
      delete this._load_errors[cache_key]
    } catch (err) {
      // Record the failure so reload paths can tell a successful reload
      // apart from a fall-back to the previously cached value, instead of
      // silently pretending the new config was applied.
      console.error(err.message)
      this._load_errors[cache_key] = err
      if (this._config_cache[cache_key]) {
        return this._config_cache[cache_key]
      }
      return cfrType.empty(options, type)
    }
    return result
  }

  // The error from the most recent failed load of this config, or
  // undefined if the last load succeeded.
  last_load_error(name, type, options) {
    // Same slot as load_config: keyed by the requested name+options.
    return this._load_errors[this.get_cache_key(name, options)]
  }

  process_file_overrides(name, options, result, cache_key) {
    // We might be re-loading this file:
    //     * build a list of cached overrides
    //     * remove them and add them back
    const cp = this.config_path
    if (!cache_key) cache_key = this.get_cache_key(name, options)

    if (this._config_cache[cache_key]) {
      for (const ck in this._config_cache[cache_key]) {
        if (ck.substr(0, 1) === '!') delete this._config_cache[path.join(cp, ck.substr(1))]
      }
    }

    // Allow JSON files to create or overwrite other config file data
    // by prefixing the outer variable name with ! e.g. !smtp.ini
    for (const key in result) {
      if (key.substr(0, 1) !== '!') continue
      const fn = key.substr(1)
      // Overwrite the config cache for this filename
      console.log(`Overriding file ${fn} with config from ${name}`)
      const cache_key = path.join(cp, fn)
      this._overrides[cache_key] = true
      this._config_cache[cache_key] = result[key]
    }
  }
}

module.exports = new Reader()

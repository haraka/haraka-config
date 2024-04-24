'use strict'

const path = require('path')

const reader = require('./lib/reader')

class Config {
  constructor(root_path, no_overrides) {
    this.root_path = root_path || reader.config_path

    if (process.env.HARAKA_TEST_DIR) {
      this.root_path = path.join(process.env.HARAKA_TEST_DIR, 'config')
      return
    }
    if (process.env.HARAKA && !no_overrides) {
      this.overrides_path = root_path || reader.config_path
      this.root_path = path.join(process.env.HARAKA, 'config')
    }
  }

  get(...args) {
    /* eslint prefer-const: 0 */
    let [name, type, cb, options] = this.arrange_args(args)
    if (!type) type = 'value'

    const full_path = path.isAbsolute(name)
      ? name
      : path.resolve(this.root_path, name)

    let results = reader.read_config(full_path, type, cb, options)

    if (this.overrides_path) {
      const overrides_path = path.resolve(this.overrides_path, name)

      const overrides = reader.read_config(overrides_path, type, cb, options)

      results = merge_config(results, overrides, type)
    }

    // Pass arrays by value to prevent config being modified accidentally.
    if (Array.isArray(results)) return results.slice()

    return results
  }

  getInt(filename, default_value) {
    if (!filename) return NaN

    const full_path = path.resolve(this.root_path, filename)
    const r = parseInt(reader.read_config(full_path, 'value', null, null), 10)

    if (!isNaN(r)) return r
    return parseInt(default_value, 10)
  }

  getDir(name, opts, done) {
    reader
      .read_dir(path.resolve(this.root_path, name), opts)
      .then((files) => {
        done(null, files) // keep the API consistent
      })
      .catch(done)
  }

  arrange_args(args) {
    /* ways get() can be called:
            config.get('thing');
            config.get('thing', type);
            config.get('thing', cb);
            config.get('thing', cb, options);
            config.get('thing', options);
            config.get('thing', type, cb);
            config.get('thing', type, options);
            config.get('thing', type, cb, options);
        */
    const fs_name = args.shift()
    let fs_type = null
    let cb
    let options

    for (const arg of args) {
      if ([undefined, null].includes(arg)) continue
      switch (typeof arg) {
        case 'function':
          cb = arg
          continue
        case 'object':
          options = arg
          continue
        case 'string':
          if (/^(ini|value|list|data|h?json|js|yaml|binary)$/.test(arg)) {
            fs_type = arg
            continue
          }
          console.log(`unknown string: ${arg}`)
          continue
      }
      // console.log(`unknown arg: ${arg}, typeof: ${typeof arg}`);
    }

    if (!fs_type) fs_type = reader.getType(fs_name)

    return [fs_name, fs_type, cb, options]
  }

  module_config(defaults_path, overrides_path) {
    const cfg = new Config(path.join(defaults_path, 'config'), true)
    if (overrides_path) {
      cfg.overrides_path = path.join(overrides_path, 'config')
    }
    return cfg
  }
}

module.exports = new Config()

function merge_config(defaults, overrides, type) {
  switch (type) {
    case 'ini':
    case 'hjson':
    case 'json':
    case 'js':
    case 'yaml':
      return merge_struct(JSON.parse(JSON.stringify(defaults)), overrides)
  }

  if (
    Array.isArray(overrides) &&
    Array.isArray(defaults) &&
    overrides.length > 0
  ) {
    return overrides
  }

  if (overrides != null) return overrides

  return defaults
}

function merge_struct(defaults, overrides) {
  for (const k in overrides) {
    if (k in defaults) {
      if (typeof overrides[k] === 'object' && typeof defaults[k] === 'object') {
        defaults[k] = merge_struct(defaults[k], overrides[k])
      } else {
        defaults[k] = overrides[k]
      }
    } else {
      defaults[k] = overrides[k]
    }
  }
  return defaults
}

'use strict'

const path = require('node:path')

const reader = require('./lib/reader')
const types = require('./lib/types')

// Resolve a caller-supplied config name against `base`.
// Absolute paths are an explicit, documented opt-in (e.g. /etc/services).
// Relative names must stay inside `base`; a `..` escape is rejected so a
// name can't reach files outside the configured config directory.
function safe_resolve(base, name) {
  if (path.isAbsolute(name)) return name
  const resolved = path.resolve(base, name)
  const rel = path.relative(base, resolved)
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`config name '${name}' escapes the config directory (${base})`)
  }
  return resolved
}

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
    const [name, type, cb, options] = this.arrange_args(args)

    const full_path = safe_resolve(this.root_path, name)
    const defaults = reader.read_config(full_path, type, cb, options)

    const overrides_path = this.overrides_path && safe_resolve(this.overrides_path, name)
    if (!overrides_path || overrides_path === full_path) return clone(defaults)

    return merge_config(defaults, reader.read_config(overrides_path, type, cb, options), type)
  }

  getInt(filename, default_value) {
    if (!filename) return NaN

    const r = parseInt(this.get(filename, 'value'), 10)

    if (!isNaN(r)) return r
    return parseInt(default_value, 10)
  }

  getDir(name, opts, done) {
    const dir = safe_resolve(this.root_path, name)

    // no callback, return promise
    if (arguments.length < 3) return reader.read_dir(dir, opts)

    reader
      .read_dir(dir, opts)
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
          if (types.is_type(arg)) {
            fs_type = arg
            continue
          }
          throw new Error(`unknown config type: ${arg}`)
      }
      // console.log(`unknown arg: ${arg}, typeof: ${typeof arg}`);
    }

    if (!fs_type) fs_type = types.type_of(fs_name)

    return [fs_name, fs_type, cb, options]
  }

  stop_watching(name) {
    const full_path = safe_resolve(this.root_path, name)
    // close both the path itself (getDir target) and its parent (get target)
    reader.stop_watching(full_path)
    reader.stop_watching(path.dirname(full_path))
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
  if (types.is_mergeable(type)) {
    if (overrides == null) return clone(defaults)
    if (isMapping(overrides) && isMapping(defaults)) return merge_struct(clone(defaults), overrides)
    if (isMapping(overrides) && !Object.keys(overrides).length) return clone(defaults)
    return clone(overrides)
  }

  // flat list/data: a non-empty override replaces the default; an empty
  // override (e.g. a missing override file, which reads as []) leaves the
  // default in place rather than silently wiping it
  if (Array.isArray(overrides)) return clone(overrides.length ? overrides : defaults)

  // flat value: only a present (non-null) override replaces the default
  return clone(overrides ?? defaults)
}

const isObject = (v) => typeof v === 'object' && v !== null
const isPlain = (v) => [null, Object.prototype].includes(Object.getPrototypeOf(v))
const isMapping = (v) => isObject(v) && isPlain(v)
const isPlainData = (v) => isObject(v) && (Array.isArray(v) || Buffer.isBuffer(v) || isPlain(v))

function clone(v, seen = new WeakMap()) {
  if (!isPlainData(v)) return v
  if (Buffer.isBuffer(v)) return Buffer.from(v)
  if (seen.has(v)) return seen.get(v)
  if (Array.isArray(v) && v.every((x) => !isObject(x))) {
    const out = v.slice()
    seen.set(v, out)
    return out
  }
  const out = Array.isArray(v) ? [] : Object.create(Object.getPrototypeOf(v))
  seen.set(v, out)
  for (const k of Object.keys(v)) {
    if (['__proto__', 'constructor', 'prototype'].includes(k)) continue
    out[k] = clone(v[k], seen)
  }
  return out
}

const shallow = (v) => Object.assign(Object.create(Object.getPrototypeOf(v)), v)

function merge_struct(defaults, overrides, merging = new Map()) {
  if (merging.has(overrides)) return merging.get(overrides)
  merging.set(overrides, defaults)
  for (const k in overrides) {
    if (['__proto__', 'constructor', 'prototype'].includes(k) || overrides[k] === null) continue
    const target = Object.hasOwn(defaults, k) ? defaults[k] : undefined
    const merge_into = isMapping(overrides[k]) && isMapping(target)
    defaults[k] = merge_into ? merge_struct(shallow(target), overrides[k], merging) : clone(overrides[k])
  }
  merging.delete(overrides)
  return defaults
}

// JSON overrides needs smtp.(json|yaml) loaded early
module.exports.get('smtp.json')

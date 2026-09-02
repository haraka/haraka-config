'use strict'

const path = require('node:path')

// Resolve to an absolute module id. Callers may pass a path relative to
// cwd; bare require() would otherwise resolve it relative to this file.
function module_id(name) {
  return require.resolve(path.resolve(name))
}

// require() caches modules, so without busting the cache an edited .js
// config (or a changed process.env it reads) would never be picked up by
// the file watcher. Bust it so .js hot-reloads like every other format.
function fresh_require(name) {
  const id = module_id(name)
  delete require.cache[id]
  return require(id)
}

exports.load = (name) => {
  return fresh_require(name)
}

exports.empty = () => {
  return {}
}

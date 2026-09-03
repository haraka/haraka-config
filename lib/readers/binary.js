'use strict'

exports.load = (name) => {
  return require('node:fs').readFileSync(name)
}

exports.empty = () => {
  return null
}

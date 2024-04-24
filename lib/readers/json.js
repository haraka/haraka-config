'use strict'

exports.load = (name) => {
  return JSON.parse(require('node:fs').readFileSync(name))
}

exports.loadPromise = async (name) => {
  return JSON.parse(await require('node:fs/promises').readFile(name))
}

exports.empty = () => {
  return {}
}

'use strict'

const hjson = require('hjson')

exports.load = (name) => {
  return hjson.parse(require('node:fs').readFileSync(name, 'UTF-8'))
}

exports.loadPromise = async (name) => {
  return hjson.parse(await require('node:fs/promises').readFile(name, 'UTF-8'))
}

exports.empty = () => {
  return {}
}

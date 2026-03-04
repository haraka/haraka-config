'use strict'

const yaml = require('yaml')

exports.load = (name) => {
  return yaml.parse(require('node:fs').readFileSync(name, 'UTF-8'))
}

exports.loadPromise = async (name) => {
  return yaml.parse(await require('node:fs/promises').readFile(name, 'UTF-8'))
}

exports.empty = () => {
  return {}
}

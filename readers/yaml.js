'use strict'

const yaml = require('js-yaml')

exports.load = (name) => {
  return yaml.load(require('node:fs').readFileSync(name, 'UTF-8'))
}

exports.loadPromise = async (name) => {
  return yaml.load(await require('node:fs/promises').readFile(name, 'UTF-8'))
}

exports.empty = () => {
  return {}
}

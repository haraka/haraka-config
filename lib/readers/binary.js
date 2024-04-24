'use strict'

exports.load = (name) => {
  return require('node:fs').readFileSync(name)
}

exports.loadPromise = async (name) => {
  return {
    path: name,
    data: await require('node:fs/promises').readFile(name),
  }
}

exports.empty = () => {
  return null
}

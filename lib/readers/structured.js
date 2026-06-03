'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const yaml = require('yaml')

const UNSUPPORTED_TYPE = 'Unsupported structured config type'

const parseHjson = (data) => {
  try {
    return require('hjson').parse(data)
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' && /'hjson'/.test(err.message)) {
      throw new Error('HJSON support requires the optional dependency "hjson". Install it with `npm install hjson`.', {
        cause: err,
      })
    }
    throw err
  }
}

const getParser = (type) => {
  switch (type) {
    case 'json':
      return JSON.parse
    case 'hjson':
      return parseHjson
    case 'yaml':
      return yaml.parse
    default:
      throw new Error(`${UNSUPPORTED_TYPE}: ${type}`)
  }
}

exports.load = (name, type) => getParser(type)(fs.readFileSync(name, 'UTF-8'))

exports.loadPromise = async (name, type) => getParser(type)(await fsp.readFile(name, 'UTF-8'))

exports.empty = () => ({})

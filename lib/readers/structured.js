'use strict'

const fs = require('node:fs')
const yaml = require('yaml')

const { UNSAFE_KEYS } = require('../unsafe-keys')

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

function sanitize(node, name, seen) {
  if (node === null || typeof node !== 'object') return node
  if (seen.has(node)) return node // yaml anchors can make the graph cyclic
  seen.add(node)

  if (Array.isArray(node)) {
    for (const item of node) sanitize(item, name, seen)
    return node
  }

  const proto = Object.getPrototypeOf(node)
  if (proto !== null && proto !== Object.prototype) {
    exports.logger(`Ignoring unsafe key '__proto__' in config file '${name}'`)
    Object.setPrototypeOf(node, Object.prototype)
  }

  for (const key of Object.keys(node)) {
    if (UNSAFE_KEYS.has(key)) {
      exports.logger(`Ignoring unsafe key '${key}' in config file '${name}'`)
      delete node[key]
      continue
    }
    sanitize(node[key], name, seen)
  }

  return node
}

exports.load = (name, type) => sanitize(getParser(type)(fs.readFileSync(name, 'UTF-8')), name, new WeakSet())

exports.empty = () => ({})

exports.logger = (msg) => {
  console.log(msg)
}

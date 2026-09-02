'use strict'

const path = require('node:path')

const flat = require('./readers/flat')
const structured = require('./readers/structured')

// Every config type and the reader that loads it.
const READERS = new Map([
  ['value', flat],
  ['list', flat],
  ['data', flat],
  ['ini', require('./readers/ini')],
  ['json', structured],
  ['hjson', structured],
  ['yaml', structured],
  ['js', require('./readers/js')],
  ['binary', require('./readers/binary')],
])

// file extensions that don't share their type's name
const EXTENSION_ALIASES = new Map([
  ['yml', 'yaml'],
  ['pem', 'binary'],
  ['bin', 'binary'],
])

// object results merge key-by-key across the override layer; the rest are
// replaced whole
const MERGEABLE = new Set(['ini', 'json', 'hjson', 'yaml', 'js'])

exports.is_type = (name) => READERS.has(name)

exports.reader_for = (type) => {
  const reader = READERS.get(type)
  if (!reader) throw new Error(`unknown config type: ${type}`)
  return reader
}

// the type a file name implies; anything unrecognized is a flat value
exports.type_of = (fileName) => {
  const ext = path.extname(fileName).slice(1).toLowerCase()
  if (READERS.has(ext)) return ext
  return EXTENSION_ALIASES.get(ext) ?? 'value'
}

exports.is_mergeable = (type) => MERGEABLE.has(type)

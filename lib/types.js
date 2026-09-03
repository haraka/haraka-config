'use strict'

const path = require('node:path')

const flat = require('./readers/flat')
const structured = require('./readers/structured')

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

const EXTENSION_ALIASES = new Map([
  ['yml', 'yaml'],
  ['pem', 'binary'],
  ['bin', 'binary'],
])

const MERGEABLE = new Set(['ini', 'json', 'hjson', 'yaml', 'js'])

exports.is_type = (name) => READERS.has(name)

exports.reader_for = (type) => {
  const reader = READERS.get(type)
  if (!reader) throw new Error(`unknown config type: ${type}`)
  return reader
}

exports.type_of = (fileName) => {
  const ext = path.extname(fileName).slice(1).toLowerCase()
  if (READERS.has(ext)) return ext
  return EXTENSION_ALIASES.get(ext) ?? 'value'
}

exports.is_mergeable = (type) => MERGEABLE.has(type)

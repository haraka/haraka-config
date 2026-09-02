'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const regex = require('../regex')

const LINE_BREAK = /\r\n|\r|\n/

exports.load = (name, type, options) => exports.parseValue(name, type, options, fs.readFileSync(name, 'UTF-8'))

exports.empty = (options, type) => (type === 'value' ? null : [])

exports.parseValue = (name, type, options, data) => {
  if (type === 'data') return parseDataLines(data)

  const lines = parseLines(data)
  // an empty `me` means this host
  if (!lines.length && path.basename(name) === 'me') return [os.hostname()]
  if (type === 'list') return lines
  return lines.length ? coerceScalar(lines[0], options) : null
}

// every line verbatim, blanks and comments included
function parseDataLines(data) {
  const lines = data.split(LINE_BREAK)
  if (lines.at(-1) === '') lines.pop() // a trailing line break doesn't start a line
  return lines
}

function parseLines(data) {
  return data
    .split(LINE_BREAK)
    .filter((line) => !regex.blank.test(line) && !regex.comment.test(line))
    .map((line) => line.trim())
}

function coerceScalar(value, options) {
  if (Array.isArray(options?.booleans) && options.booleans.includes(value)) return regex.is_truth.test(value)
  if (regex.is_integer.test(value)) return parseInt(value, 10)
  if (regex.is_float.test(value)) return parseFloat(value)
  return value
}

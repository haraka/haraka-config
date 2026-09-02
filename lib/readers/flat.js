'use strict'

const regex = require('../regex')

exports.load = (...args) => {
  return this.parseValue(...args, require('node:fs').readFileSync(args[0], 'UTF-8'))
}

exports.parseValue = (name, type, options, data) => {
  if (type === 'data') return parseDataLines(data)

  const result = parseLines(data)

  if (result.length && type !== 'list' && type !== 'data') {
    return coerceScalar(result[0], options)
  }

  // Return hostname for 'me' if no result
  if (/\/me$/.test(name) && !(result && result.length)) {
    return [require('os').hostname()]
  }

  // For value types with no result
  if (!(type && (type === 'list' || type === 'data'))) {
    if (!(result && result.length)) return null
  }

  return result
}

// 'data' type: every line verbatim, preserving blanks and comments.
function parseDataLines(data) {
  const result = []
  while (data.length > 0) {
    const match = data.match(/^([^\r\n]*)\r?\n?/)
    result.push(match[1])
    data = data.slice(match[0].length)
  }
  return result
}

// list/value types: trimmed values, skipping comments and blank lines.
function parseLines(data) {
  const result = []
  for (const line of data.split(/\r\n|\r|\n/)) {
    if (regex.comment.test(line)) continue
    if (regex.blank.test(line)) continue

    const line_data = regex.line.exec(line)
    if (!line_data) continue

    result.push(line_data[1].trim())
  }
  return result
}

function coerceScalar(value, options) {
  if (options && in_array(value, options.booleans)) return regex.is_truth.test(value)
  if (regex.is_integer.test(value)) return parseInt(value, 10)
  if (regex.is_float.test(value)) return parseFloat(value)
  return value
}

exports.empty = (options, type) => (type === 'value' ? null : [])

function in_array(item, array) {
  if (!Array.isArray(array)) return false
  return array.includes(item)
}

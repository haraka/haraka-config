'use strict'

const regex = require('../regex')

exports.load = (...args) => {
  return this.parseValue(
    ...args,
    require('node:fs').readFileSync(args[0], 'UTF-8'),
  )
}

exports.loadPromise = async (...args) => {
  return this.parseValue(
    ...args,
    await require('node:fs/promises').readFile(args[0], 'UTF-8'),
  )
}

exports.parseValue = (name, type, options, data) => {
  let result = []

  if (type === 'data') {
    while (data.length > 0) {
      const match = data.match(/^([^\r\n]*)\r?\n?/)
      result.push(match[1])
      data = data.slice(match[0].length)
    }
    return result
  }

  for (const line of data.split(/\r\n|\r|\n/)) {
    if (regex.comment.test(line)) continue
    if (regex.blank.test(line)) continue

    const line_data = regex.line.exec(line)
    if (!line_data) continue

    result.push(line_data[1].trim())
  }

  if (result.length && type !== 'list' && type !== 'data') {
    result = result[0]
    if (options && in_array(result, options.booleans)) {
      return regex.is_truth.test(result)
    }
    if (regex.is_integer.test(result)) {
      return parseInt(result, 10)
    }
    if (regex.is_float.test(result)) {
      return parseFloat(result)
    }
    return result
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

exports.empty = (options, type) => {
  switch (type) {
    case 'flat':
    case 'value':
      return null
    default:
      return []
  }
}

function in_array(item, array) {
  if (!Array.isArray(array)) return false
  return array.includes(item)
}

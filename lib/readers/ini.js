'use strict'

const regex = require('../regex')

exports.load = (...args) => {
  return this.parseIni(
    ...args,
    require('node:fs').readFileSync(args[0], 'UTF-8'),
  )
}

exports.loadPromise = async (...args) => {
  return this.parseIni(
    ...args,
    await require('node:fs/promises').readFile(args[0], 'UTF-8'),
  )
}

exports.parseIni = (name, options = {}, data) => {
  let result = { main: {} }
  let current_sect = result.main
  let current_sect_name = 'main'
  this.bool_matches = []
  if (options?.booleans) {
    this.bool_matches = options.booleans.slice()
  }

  // Initialize any booleans
  result = this.init_booleans(options, result)

  let pre = ''

  for (let line of data.split(/\r\n|\r|\n/)) {
    if (regex.comment.test(line)) continue
    if (regex.blank.test(line)) continue

    let match = regex.section.exec(line)
    if (match) {
      if (!result[match[1]]) result[match[1]] = {}
      current_sect = result[match[1]]
      current_sect_name = match[1]
      continue
    }

    if (regex.continuation.test(line)) {
      pre += line.replace(regex.continuation, '')
      continue
    }

    line = `${pre}${line}`
    pre = ''

    match = regex.param.exec(line)
    if (!match) {
      exports.logger(`Invalid line in config file '${name}': ${line}`)
      continue
    }

    const keyName = match[1]
    const keyVal = match[2]

    const setter = this.getSetter(current_sect, regex.is_array.test(keyName))

    if (
      exports.isDeclaredBoolean(`${current_sect_name}.${keyName}`) ||
      exports.isDeclaredBoolean(`*.${keyName}`)
    ) {
      current_sect[keyName] = regex.is_truth.test(keyVal)
    } else if (regex.is_integer.test(keyVal)) {
      setter(keyName, parseInt(keyVal, 10))
    } else if (regex.is_float.test(keyVal)) {
      setter(keyName, parseFloat(keyVal))
    } else {
      setter(keyName, keyVal)
    }
  }

  return result
}

exports.empty = (options) => {
  this.bool_matches = []
  return this.init_booleans(options, { main: {} })
}

exports.getSetter = (current_sect, isArray) => {
  if (isArray) {
    return (key, value) => {
      key = key.replace('[]', '')
      if (!current_sect[key]) current_sect[key] = []
      current_sect[key].push(value)
    }
  } else {
    return (key, value) => {
      current_sect[key] = value
    }
  }
}

exports.isDeclaredBoolean = (entry) => {
  if (exports.bool_matches.includes(entry)) return true
  return false
}

exports.init_booleans = (options, result) => {
  if (!options) return result
  if (!Array.isArray(options.booleans)) return result

  // console.log(options.booleans);
  for (let i = 0; i < options.booleans.length; i++) {
    const m = /^(?:([^. ]+)\.)?(.+)/.exec(options.booleans[i])
    if (!m) continue

    let section = m[1] || 'main'
    let key = m[2]

    const bool_default =
      section[0] === '+' ? true : key[0] === '+' ? true : false

    if (section.match(/^(-|\+)/)) section = section.substr(1)
    if (key.match(/^(-|\+)/)) key = key.substr(1)

    if (section === '*') continue // wildcard, don't initialize

    // so boolean detection in the next section will match
    if (options.booleans.indexOf(`${section}.${key}`) === -1) {
      this.bool_matches.push(`${section}.${key}`)
    }

    if (!result[section]) result[section] = {}
    result[section][key] = bool_default
  }

  return result
}

exports.logger = (msg) => {
  console.log(msg)
}

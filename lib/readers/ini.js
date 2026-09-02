'use strict'

const regex = require('../regex')
const { UNSAFE_KEYS } = require('../unsafe-keys')

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)

const newSection = () => Object.create(null)

exports.load = (...args) => {
  return this.parseIni(...args, require('node:fs').readFileSync(args[0], 'UTF-8'))
}

exports.loadPromise = async (...args) => {
  return this.parseIni(...args, await require('node:fs/promises').readFile(args[0], 'UTF-8'))
}

exports.parseIni = (name, options = {}, data) => {
  let result = newSection()
  result.main = newSection()
  let current_sect = result.main
  let current_sect_name = 'main'
  this.bool_matches = []
  if (options?.booleans) {
    this.bool_matches = options.booleans.slice()
  }

  result = this.init_booleans(options, result)

  let pre = ''

  for (let line of data.split(/\r\n|\r|\n/)) {
    if (regex.comment.test(line)) continue
    if (regex.blank.test(line)) continue

    const match = regex.section.exec(line)
    if (match) {
      current_sect_name = match[1]
      current_sect = resolveSection(result, current_sect_name, name)
      continue
    }

    if (regex.continuation.test(line)) {
      pre += line.replace(regex.continuation, '')
      continue
    }

    line = `${pre}${line}`
    pre = ''

    applyParamLine(line, current_sect, current_sect_name, name)
  }

  return result
}

function resolveSection(result, sect, name) {
  if (UNSAFE_KEYS.has(sect)) {
    exports.logger(`Ignoring unsafe section name '[${sect}]' in config file '${name}'`)
    return newSection()
  }
  if (!hasOwn(result, sect)) result[sect] = newSection()
  return result[sect]
}

function applyParamLine(line, current_sect, current_sect_name, name) {
  const match = regex.param.exec(line)
  if (!match) {
    exports.logger(`Invalid line in config file '${name}': ${line}`)
    return
  }

  const keyName = match[1]
  const keyVal = match[2]

  const isArray = regex.is_array.test(keyName)
  const baseKey = isArray ? keyName.replace('[]', '') : keyName
  if (UNSAFE_KEYS.has(baseKey)) {
    exports.logger(`Ignoring unsafe key '${keyName}' in config file '${name}'`)
    return
  }

  const setter = exports.getSetter(current_sect, isArray)
  assignValue(current_sect, current_sect_name, keyName, keyVal, setter)
}

function assignValue(current_sect, current_sect_name, keyName, keyVal, setter) {
  if (exports.isDeclaredBoolean(`${current_sect_name}.${keyName}`) || exports.isDeclaredBoolean(`*.${keyName}`)) {
    current_sect[keyName] = regex.is_truth.test(keyVal)
  } else if (regex.is_integer.test(keyVal)) {
    setter(keyName, parseInt(keyVal, 10))
  } else if (regex.is_float.test(keyVal)) {
    setter(keyName, parseFloat(keyVal))
  } else {
    setter(keyName, keyVal)
  }
}

exports.empty = (options) => {
  this.bool_matches = []
  const result = newSection()
  result.main = newSection()
  return this.init_booleans(options, result)
}

exports.getSetter = (current_sect, isArray) => {
  if (isArray) {
    return (key, value) => {
      key = key.replace('[]', '')
      if (!hasOwn(current_sect, key) || !Array.isArray(current_sect[key])) {
        current_sect[key] = []
      }
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
  if (!options || !Array.isArray(options.booleans)) return result

  for (const decl of options.booleans) {
    const parsed = parseBooleanDecl(decl)
    if (!parsed) continue

    const { section, key, bool_default } = parsed
    if (section === '*') continue // wildcard, don't initialize
    if (UNSAFE_KEYS.has(section) || UNSAFE_KEYS.has(key)) continue

    // so boolean detection in the next section will match
    if (options.booleans.indexOf(`${section}.${key}`) === -1) {
      this.bool_matches.push(`${section}.${key}`)
    }

    if (!hasOwn(result, section)) result[section] = newSection()
    result[section][key] = bool_default
  }

  return result
}

function parseBooleanDecl(decl) {
  const m = /^(?:([^. ]+)\.)?(.+)/.exec(decl)
  if (!m) return null

  let section = m[1] || 'main'
  let key = m[2]
  const bool_default = section[0] === '+' || key[0] === '+'

  if (/^[-+]/.test(section)) section = section.slice(1)
  if (/^[-+]/.test(key)) key = key.slice(1)

  return { section, key, bool_default }
}

exports.logger = (msg) => {
  console.log(msg)
}

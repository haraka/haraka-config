'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const hjson = require('hjson')
const yaml = require('yaml')

// Formats parsed from the whole file in one shot. The config type picks the
// parser; everything else (reading, empty value) is identical.
const parsers = {
  json: (data) => JSON.parse(data),
  hjson: (data) => hjson.parse(data),
  yaml: (data) => yaml.parse(data),
}

exports.load = (name, type) => parsers[type](fs.readFileSync(name, 'UTF-8'))

exports.loadPromise = async (name, type) => parsers[type](await fsp.readFile(name, 'UTF-8'))

exports.empty = () => ({})

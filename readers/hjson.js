'use strict'

const fs = require('fs')
const hjson = require('hjson')

exports.load = (name) => {
  return hjson.parse(fs.readFileSync(name, 'utf8'))
}

exports.empty = () => {
  return {}
}

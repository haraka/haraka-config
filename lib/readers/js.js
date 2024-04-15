'use strict'

exports.load = (name) => {
  return require(name)
}

exports.loadPromise = async (name) => {
  return require(name)
}

exports.empty = () => {
  return {}
}

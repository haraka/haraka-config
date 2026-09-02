'use strict'

// Config data must never be able to reach an object's prototype chain.
// Shared by every format that can express these names: ini section and key
// names, and json/hjson/yaml object keys.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

module.exports = { UNSAFE_KEYS }

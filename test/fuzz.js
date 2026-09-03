'use strict'

// Seeded property fuzzer, one test per target. Each iteration derives its own
// generator from (FUZZ_SEED, target, iteration), so a failure replays alone:
//   FUZZ_SEED=<seed> FUZZ_ONLY=<target> FUZZ_START=<i> FUZZ_ITERATIONS=1 node --test test/fuzz.js
// FUZZ_ITERATIONS is per target. FUZZ_SLOW_MS flags slow inputs.

const assert = require('node:assert/strict')
const { after, before, describe, it } = require('node:test')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { isDeepStrictEqual } = require('node:util')

process.env.NODE_ENV = 'test'
for (const v of ['HARAKA', 'HARAKA_TEST_DIR', 'WITHOUT_CONFIG_CACHE', 'HARAKA_JS_CONFIG']) delete process.env[v]

const reader = require('../lib/reader')
reader.watch_files = false
const config = require('../config')
const types = require('../lib/types')
const ini = require('../lib/readers/ini')
const flat = require('../lib/readers/flat')
const structured = require('../lib/readers/structured')
const { UNSAFE_KEYS } = require('../lib/unsafe-keys')

// a short pass under `npm test`, a long one under `npm run fuzz`
const ITERATIONS = Number(process.env.FUZZ_ITERATIONS ?? (process.env.npm_lifecycle_event === 'fuzz' ? 5000 : 200))
const SEED = Number(process.env.FUZZ_SEED ?? Date.now() % 2 ** 31)
const START = Number(process.env.FUZZ_START ?? 0)
const SLOW_MS = Number(process.env.FUZZ_SLOW_MS ?? 500)
const ONLY = process.env.FUZZ_ONLY?.split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// ---------------------------------------------------------------- generators

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hash = (s) => {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h | 0
}
const rngFor = (name, i) => mulberry32((SEED ^ hash(name) ^ Math.imul(i + 1, 0x9e3779b9)) | 0)

const int = (rng, max) => Math.floor(rng() * max)
const pick = (rng, arr) => arr[int(rng, arr.length)]
const chance = (rng, p) => rng() < p
const times = (rng, max, fn) => Array.from({ length: int(rng, max + 1) }, fn)

const WORDS = ['main', 'key', 'value', 'foo', 'bar', 'me', 'smtp', 'reject', 'true', 'false', 'yes', 'no', 'on', 'off']
const SCALARS = ['1', '0', '-1', '3.14', '1e5', '0x1f', 'NaN', 'Infinity', '', ' ', 'ünï', '日本', '﻿', ' ', '\0']
const UNSAFE = [...UNSAFE_KEYS, 'toString', 'hasOwnProperty', '__defineGetter__', 'valueOf']
const CHARS = ' \t[]=;#\\*+-._/:@,"\'{}!\r\n'
const NEWLINES = ['\n', '\r\n', '\r']

const word = (rng) => pick(rng, chance(rng, 0.15) ? UNSAFE : chance(rng, 0.7) ? WORDS : SCALARS)
const junk = (rng, max = 12) =>
  times(rng, max, () => (chance(rng, 0.5) ? CHARS[int(rng, CHARS.length)] : word(rng))).join('')
const joinLines = (rng, lines) => lines.join(pick(rng, NEWLINES)) + (chance(rng, 0.5) ? pick(rng, NEWLINES) : '')

function genIni(rng) {
  return joinLines(
    rng,
    times(rng, 30, () => {
      switch (int(rng, 9)) {
        case 0:
          return `[${junk(rng, 2)}${word(rng)}${junk(rng, 2)}]`
        case 1:
          return `${word(rng)}${chance(rng, 0.3) ? '[]' : ''}=${junk(rng)}`
        case 2:
          return `${word(rng)}=${junk(rng)}\\`
        case 3:
          return `${pick(rng, [';', '#'])}${junk(rng)}`
        case 4:
          return word(rng)
        case 5:
          return `  ${word(rng)}  =  ${junk(rng)}  `
        case 6:
          return ''
        case 7:
          return `${word(rng)}.${word(rng)}=${word(rng)}`
        default:
          return junk(rng, 20)
      }
    }),
  )
}

function genBooleans(rng) {
  if (chance(rng, 0.4)) return undefined
  const sign = () => pick(rng, ['', '', '+', '-'])
  const section = () => (chance(rng, 0.5) ? `${pick(rng, [...WORDS.slice(0, 4), '*', ...UNSAFE])}.` : '')
  return { booleans: times(rng, 5, () => `${sign()}${section()}${sign()}${word(rng)}`) }
}

function genFlat(rng) {
  return joinLines(
    rng,
    times(rng, 20, () => {
      switch (int(rng, 5)) {
        case 0:
          return word(rng)
        case 1:
          return `${pick(rng, [';', '#'])}${junk(rng)}`
        case 2:
          return `  ${word(rng)}  `
        case 3:
          return ''
        default:
          return junk(rng)
      }
    }),
  )
}

// A mapping tree for the structured formats. Aliases point at an ancestor or
// the node itself, so yaml gets shared nodes and cycles.
function genTree(rng, depth = 0, ancestors = []) {
  const node = { entries: [] }
  const targets = [...ancestors.slice(1), node]
  node.entries = times(rng, depth > 3 ? 2 : 5, () => {
    const r = rng()
    let value
    if (r < 0.45 || depth > 4) value = pick(rng, [0, 1, -7, 2.5, 'str', '', true, false, null, 'yes', '__proto__'])
    else if (r < 0.55) value = { alias: pick(rng, targets) }
    else if (r < 0.65) value = { list: times(rng, 4, () => pick(rng, [1, 'a', null])) }
    else value = genTree(rng, depth + 1, [...ancestors, node])
    return [word(rng), value]
  })
  return node
}

function emitYaml(node, indent = '', anchors = new Map()) {
  const anchor = (n) => {
    if (!anchors.has(n)) anchors.set(n, `n${anchors.size}`)
    return anchors.get(n)
  }
  if (!node.entries.length) return `&${anchor(node)} {}`
  const lines = []
  for (const [k, v] of node.entries) {
    const key = `${indent}${JSON.stringify(k)}:`
    if (v && typeof v === 'object') {
      if (v.alias) lines.push(`${key} *${anchor(v.alias)}`)
      else if (v.list) lines.push(`${key} ${JSON.stringify(v.list)}`)
      else if (!v.entries.length) lines.push(`${key} &${anchor(v)} {}`)
      else lines.push(`${key} &${anchor(v)}`, emitYaml(v, `${indent}  `, anchors))
    } else {
      lines.push(`${key} ${JSON.stringify(v)}`)
    }
  }
  return lines.join('\n')
}

// yaml aliases have no json form; they become null
function emitJson(node) {
  const value = (v) => {
    if (v && typeof v === 'object') {
      if (v.alias) return 'null'
      if (v.list) return JSON.stringify(v.list)
      return emitJson(v)
    }
    return JSON.stringify(v)
  }
  return `{${node.entries.map(([k, v]) => `${JSON.stringify(k)}: ${value(v)}`).join(', ')}}`
}

function mutate(rng, text) {
  if (!text.length || chance(rng, 0.7)) return text
  const at = int(rng, text.length)
  return chance(rng, 0.5) ? text.slice(0, at) + text.slice(at + 1) : text.slice(0, at) + junk(rng, 3) + text.slice(at)
}

function genStructured(rng, type = pick(rng, ['json', 'yaml', 'yaml'])) {
  // documents that are not a mapping at all
  if (chance(rng, 0.08))
    return {
      type,
      text: pick(
        rng,
        type === 'json'
          ? ['null', '42', '"s"', '[]', '[1, 2]']
          : ['', '# only a comment\n', 'null', '~', '42', '- a\n- b\n'],
      ),
    }
  const tree = genTree(rng)
  const text = type === 'json' ? emitJson(tree) : chance(rng, 0.8) ? `${emitYaml(tree)}\n` : emitYaml(tree)
  return { type, text: mutate(rng, text) }
}

// -------------------------------------------------------------------- oracles

const PROTOTYPES = [Object.prototype, Array.prototype, Function.prototype, Buffer.prototype]
const protoSnapshot = () => PROTOTYPES.map((p) => Object.getOwnPropertyNames(p).sort().join())
const PRISTINE = protoSnapshot()

function assertNoPollution() {
  assert.deepEqual(protoSnapshot(), PRISTINE, 'a prototype gained or lost a property')
  assert.equal({}.polluted, undefined)
  assert.equal([].polluted, undefined)
}

const isObject = (v) => typeof v === 'object' && v !== null

// no unsafe own key anywhere; optionally every node has a null prototype
function walk(value, { nullProto = false } = {}, seen = new Set()) {
  if (!isObject(value) || seen.has(value)) return
  seen.add(value)
  if (Buffer.isBuffer(value)) return
  if (nullProto && !Array.isArray(value)) assert.equal(Object.getPrototypeOf(value), null, 'ini node has a prototype')
  for (const k of Object.keys(value)) {
    assert.ok(!UNSAFE_KEYS.has(k), `unsafe key '${k}' survived`)
    walk(value[k], { nullProto }, seen)
  }
}

const ESCAPE = /escapes the config directory/
const FS_ERRORS = new Set(['ENOENT', 'ENOTDIR', 'EISDIR', 'EACCES', 'ENAMETOOLONG', 'EINVAL', 'ERR_INVALID_ARG_VALUE'])

function isParseError(e) {
  return (
    e instanceof SyntaxError || /YAML/.test(e.name) || (e instanceof ReferenceError && /alias|anchor/i.test(e.message))
  )
}

function inside(root, p) {
  const rel = path.relative(root, p)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

// record every path the filesystem layer is asked about
function traceFs(fn) {
  const touched = []
  const patched = []
  const trace = (mod, name) => {
    const orig = mod[name]
    mod[name] = (p, ...rest) => {
      touched.push(String(p))
      return orig.call(mod, p, ...rest)
    }
    patched.push(() => (mod[name] = orig))
  }
  for (const name of ['existsSync', 'readFileSync', 'statSync', 'lstatSync', 'readdirSync', 'realpathSync'])
    trace(fs, name)
  for (const name of ['stat', 'lstat', 'readdir', 'realpath', 'readFile']) trace(fsp, name)
  const restore = () => patched.forEach((r) => r())
  return Promise.resolve()
    .then(fn)
    .then(
      (v) => (restore(), { touched, value: v }),
      (e) => (restore(), { touched, error: e }),
    )
}

// ------------------------------------------------------------------- targets

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'haraka-config-fuzz-'))
const layers = { defaults: path.join(tmp, 'default'), overrides: path.join(tmp, 'override') }
for (const dir of Object.values(layers)) fs.mkdirSync(path.join(dir, 'config'), { recursive: true })
const sandbox = path.join(tmp, 'sandbox')
fs.mkdirSync(sandbox)
fs.writeFileSync(path.join(sandbox, 'a.ini'), '[s]\nk=v\n')

const targets = {
  ini(rng) {
    const data = genIni(rng)
    const options = genBooleans(rng)
    const result = ini.parseIni('fuzz.ini', options, data)
    walk(result, { nullProto: true })
    assert.equal(Object.getPrototypeOf(result.main), null)
    return { data, options }
  },

  flat(rng) {
    const data = genFlat(rng)
    const type = pick(rng, ['value', 'list', 'data', undefined, ''])
    const name = pick(rng, ['/etc/haraka/config/x', '/etc/haraka/config/me', 'me'])
    const options = chance(rng, 0.3) ? { booleans: times(rng, 3, () => word(rng)) } : null
    const result = flat.parseValue(name, type, options, data)
    if (type === 'list' || type === 'data') assert.ok(Array.isArray(result))
    if (type === 'data')
      assert.deepEqual(result, flat.parseValue(name, type, options, data), 'data parse is not stable')
    return { data, type, name, options }
  },

  structured(rng, i) {
    const { type, text } = genStructured(rng)
    const file = path.join(tmp, `s${i}.${type}`)
    fs.writeFileSync(file, text)
    try {
      const result = structured.load(file, type)
      walk(result)
      structured.load(file, type) // a second parse of the same text must behave the same
    } catch (e) {
      if (!isParseError(e)) throw e
    } finally {
      fs.unlinkSync(file)
    }
    return { type, text }
  },

  // end to end: defaults + overrides through the reader, merge, and copy
  get(rng, i) {
    const ext = pick(rng, ['.ini', '.json', '.yaml', '.yml', '.list', '.data', '.flat', '', '.pem'])
    const name = `f${i}${ext}`
    const type = types.type_of(name)
    const content = () => {
      if (type === 'ini') return genIni(rng)
      if (type === 'binary') return Buffer.from(times(rng, 64, () => int(rng, 256)))
      if (types.is_mergeable(type)) {
        const { text } = genStructured(rng, type)
        if (!chance(rng, 0.2)) return text
        const override = `"!${word(rng)}.ini": {"main": {"x": 1}}`
        return text.startsWith('{') ? `{${override}, ${text.slice(1)}` : `${override}\n${text}`
      }
      return genFlat(rng)
    }
    const files = { defaults: content() }
    if (chance(rng, 0.6)) files.overrides = content()
    for (const [layer, body] of Object.entries(files)) fs.writeFileSync(path.join(layers[layer], 'config', name), body)

    const cfg = config.module_config(layers.defaults, files.overrides ? layers.overrides : undefined)
    const options = type === 'ini' ? genBooleans(rng) : undefined
    const args = type === 'value' && chance(rng, 0.5) ? [name, 'list'] : [name, options]

    const a = cfg.get(...args)
    const b = cfg.get(...args)
    walk(a)
    assert.ok(isDeepStrictEqual(a, b), 'two reads of the same config differ')
    if (isObject(a)) {
      assert.notEqual(a, b, 'get() returned the cached object itself')
      if (Buffer.isBuffer(a)) {
        if (a.length) a[0] ^= 0xff
      } else if (Array.isArray(a)) a.push('fuzz')
      else a.fuzz = 1
      assert.ok(isDeepStrictEqual(cfg.get(...args), b), 'a mutation of one result reached the next')
    }
    assert.equal(typeof cfg.getInt(name), 'number')
    for (const layer of Object.keys(files)) fs.unlinkSync(path.join(layers[layer], 'config', name))
    return { name, files, args }
  },

  // names may not reach files outside the config dir unless given as absolute
  async resolve(rng) {
    const PARTS = [
      '..',
      '.',
      'a',
      'b c',
      'config',
      'me',
      'smtp.ini',
      'test.ini',
      'dir',
      '\0',
      '~',
      '%2e%2e',
      'C:',
      '',
      '...',
      '..\\',
    ]
    let name = times(rng, 6, () => pick(rng, PARTS)).join(pick(rng, ['/', '/', '\\', '']))
    // absolute names are allowed through, so keep them inside our own tmp dir
    if (path.isAbsolute(name) || chance(rng, 0.15)) {
      name = path.join(sandbox, name)
      if (!inside(sandbox, name)) name = path.join(sandbox, 'escaped')
    }
    const type = pick(rng, ['value', 'list', 'ini', 'json', 'binary'])
    const useDir = chance(rng, 0.3)

    const { touched, error } = await traceFs(() => (useDir ? config.getDir(name, { type }) : config.get(name, type)))
    if (error && !ESCAPE.test(error.message) && !FS_ERRORS.has(error.code)) throw error
    if (!path.isAbsolute(name)) {
      for (const p of touched)
        assert.ok(inside(config.root_path, path.resolve(p)), `touched ${p} for name ${JSON.stringify(name)}`)
    }
    return { name, type, useDir, touched: touched.length }
  },

  types(rng) {
    const name = `${junk(rng, 6)}${pick(rng, ['', '.', '.INI', '.yml', '.PEM', '.js', `.${word(rng)}`, '.tar.gz', '/'])}`
    const type = types.type_of(name)
    assert.ok(types.is_type(type), `type_of('${name}') gave '${type}'`)
    assert.ok(types.reader_for(type))
    const guess = junk(rng, 4)
    if (types.is_type(guess)) assert.ok(types.reader_for(guess))
    else assert.throws(() => types.reader_for(guess), /unknown config type/)
    return { name, type, guess }
  },
}

// Doubling probe for regex backtracking: the parsers should be about linear
// in the length of a line.
const REDOS = {
  'open bracket then spaces': (n) => `[${' '.repeat(n)}`,
  'bracketed spaces then tail': (n) => `[${' '.repeat(n)}]${' '.repeat(n)}x`,
  'key spaces no equals': (n) => `k${' '.repeat(n)}x`,
  'equals then spaces': (n) => `k=${' '.repeat(n)}`,
  'value padded both sides': (n) => `k=${' '.repeat(n)}x${' '.repeat(n)}`,
  'spaces then continuation': (n) => `${' '.repeat(n)}\\`,
  'only tabs': (n) => '\t'.repeat(n),
  'many array brackets': (n) => `${'[]'.repeat(n)}=1`,
  'long key': (n) => `${'a'.repeat(n)}=1`,
  'flat padded value': (n) => `${' '.repeat(n)}v${' '.repeat(n)}`,
}
const probed = new Set()
targets.redos = (rng) => {
  const pattern = pick(rng, Object.keys(REDOS))
  if (probed.has(pattern)) return null
  probed.add(pattern)
  const time = (n) => {
    const line = REDOS[pattern](n)
    let best = Infinity
    for (let k = 0; k < 2; k++) {
      const t0 = performance.now()
      ini.parseIni('redos.ini', {}, line)
      flat.parseValue('redos', 'value', null, line)
      flat.parseValue('redos', 'list', null, line)
      best = Math.min(best, performance.now() - t0)
    }
    return best
  }
  const ms = [1000, 2000, 4000].map(time)
  const ratio = ms[2] / Math.max(ms[1], 0.01)
  assert.ok(
    ratio < 3.2 || ms[2] < 30,
    `superlinear: ${pattern} n=1k/2k/4k -> ${ms.map((t) => t.toFixed(1)).join(' / ')} ms (x${ratio.toFixed(1)} per doubling)`,
  )
  return { pattern, ms }
}

// -------------------------------------------------------------------- tests

const show = (input) => {
  const text = JSON.stringify(input, (k, v) => (Buffer.isBuffer(v) ? `<Buffer ${v.length}>` : v)) ?? String(input)
  return text.length > 600 ? `${text.slice(0, 600)}…` : text
}

const replay = (name, i) =>
  `FUZZ_SEED=${SEED} FUZZ_ONLY=${name} FUZZ_START=${i} FUZZ_ITERATIONS=1 node --test test/fuzz.js`

describe('fuzz', function () {
  const names = Object.keys(targets).filter((t) => !ONLY || ONLY.includes(t))
  assert.ok(names.length, `FUZZ_ONLY matched no target; have: ${Object.keys(targets).join(', ')}`)

  const quiet = () => {}
  const real = { log: console.log, error: console.error }
  before(() => {
    console.log = console.error = quiet
    ini.logger = structured.logger = quiet
  })
  after(() => {
    console.log = real.log
    console.error = real.error
    fs.rmSync(tmp, { recursive: true, force: true })
    require('../lib/watch').closeAll()
  })

  for (const name of names) {
    it(`${name}: ${ITERATIONS} iterations from #${START}, seed ${SEED}`, async function () {
      const failures = []
      for (let i = START; i < START + ITERATIONS; i++) {
        const rng = rngFor(name, i)
        let input
        const t0 = performance.now()
        try {
          input = await targets[name](rng, i)
          assertNoPollution()
        } catch (e) {
          const kind = e.code === 'ERR_ASSERTION' ? 'invariant' : e.name
          failures.push({ i, kind, message: e.message, input, stack: e.stack })
        }
        const ms = performance.now() - t0
        if (ms > SLOW_MS && name !== 'redos') failures.push({ i, kind: 'slow', message: `${ms.toFixed(0)} ms`, input })
      }
      if (!failures.length) return

      const report = failures
        .slice(0, 5)
        .map((f) =>
          [
            `#${f.i} (${f.kind}): ${f.message}`,
            f.input !== undefined && `  input: ${show(f.input)}`,
            f.kind !== 'invariant' &&
              f.kind !== 'slow' &&
              f.stack &&
              `  ${f.stack.split('\n').slice(1, 4).join('\n  ')}`,
            `  replay: ${replay(name, f.i)}`,
          ]
            .filter(Boolean)
            .join('\n'),
        )
      assert.fail(`${failures.length} failure(s) in ${name}\n${report.join('\n')}`)
    })
  }
})

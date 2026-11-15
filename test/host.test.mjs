/**
 * Smoke test for the host half against a fake Cordis context.
 *
 * The point is not to re-test `describe.js` (its own suite does that) but to
 * prove that {@link collectInventory} walks a Loader-shaped object, merges rows,
 * and emits the wire shape the panel expects — without a DSH process.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { collectInventory, loadCurated, normalizeConfig } from '../lib/index.js'

/** Build a temporary package directory with a manifest and README. */
function makePackage(root, name, manifest, readme) {
  const dir = join(root, 'node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, ...manifest }, null, 2))
  if (readme !== undefined) writeFileSync(join(dir, 'README.md'), readme)
  return dir
}

/** A fake `pluginPackages` that answers from a name → dir map. */
function fakePackages(dirs) {
  return {
    packageOf(specifier) {
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
      const dir = dirs.get(name)
      if (dir === undefined) return undefined
      return { name, dir, manifestPath: join(dir, 'package.json') }
    },
    metaOf() {
      return undefined
    },
  }
}

/** A fake `ctx` with only the services the host half reads. */
function fakeContext({ entries, dirs, profileDir }) {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    baseUrl: `file:///${profileDir.replace(/\\/g, '/')}/package.json`,
    get(name) {
      if (name === 'loader') return { entries: () => entries }
      if (name === 'pluginPackages') return fakePackages(dirs)
      if (name === 'profileContext') return { name: 'desktop', dir: profileDir }
      if (name === 'webServer') return null
      return undefined
    },
    effect() {},
  }
}

test('collectInventory merges rows, skips official packages and keeps the wire shape', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pe-host-'))
  const profileDir = join(root, 'profile')
  mkdirSync(profileDir, { recursive: true })

  const petDir = makePackage(root, 'dsh-pet', { version: '0.3.8', description: 'A blue fish.' })
  const subDir = makePackage(root, '@acme/demo', { version: '1.2.0', description: 'Demo bundle.' })
  const officialDir = makePackage(root, '@deepseek-ai/dsh-base', { version: '9.9.9', description: 'core' })

  const dirs = new Map([
    ['dsh-pet', petDir],
    ['@acme/demo', subDir],
    ['@deepseek-ai/dsh-base', officialDir],
  ])

  const entries = [
    { id: 'pet', options: { name: 'dsh-pet' }, disabled: false, fiber: { state: 2 } },
    { id: 'demo', options: { name: '@acme/demo' }, disabled: false, fiber: { state: 2 } },
    { id: 'demo-tools', options: { name: '@acme/demo/tools' }, disabled: true, fiber: { state: 3 } },
    { id: 'base', options: { name: '@deepseek-ai/dsh-base' }, disabled: false, fiber: { state: 2 } },
    { id: 'group', options: { name: 'ignored', group: true } },
    { id: 'builtin', options: { name: 'cordis:group' } },
  ]

  const ctx = fakeContext({ entries, dirs, profileDir })
  const settings = normalizeConfig({ lang: 'zh', includeOfficial: false })
  const payload = collectInventory(ctx, settings, new Map(), (name) => {
    const dir = dirs.get(name)
    return dir === undefined ? { packageName: name } : { packageName: name, dir, manifestPath: join(dir, 'package.json') }
  })

  assert.equal(payload.plugins.length, 2, 'official packages stay hidden by default')
  assert.equal(payload.counts.rows, 4, 'group rows are skipped but subpath rows are inventory rows')

  const demo = payload.plugins.find((plugin) => plugin.packageName === '@acme/demo')
  assert.equal(demo.rowCount, 2)
  assert.deepEqual(demo.entryIds, ['demo', 'demo-tools'])
  assert.equal(demo.fiberPhase, 'active', 'the healthiest row wins')
  assert.equal(demo.untranslated, true)
  assert.equal(demo.firstParty, false)

  const pet = payload.plugins.find((plugin) => plugin.packageName === 'dsh-pet')
  assert.equal(pet.version, '0.3.8')
  assert.equal(pet.summary, 'A blue fish.')
  assert.equal(payload.profile.name, 'desktop')
  assert.equal(typeof payload.generatedAt, 'string')
  assert.equal(payload.counts.untranslated, 2)
})

test('includeOfficial exposes the shipped rows too', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pe-host-'))
  const profileDir = join(root, 'profile')
  mkdirSync(profileDir, { recursive: true })
  const officialDir = makePackage(root, '@deepseek-ai/dsh-base', { version: '9.9.9', description: 'core' })
  const dirs = new Map([['@deepseek-ai/dsh-base', officialDir]])

  const ctx = fakeContext({
    entries: [{ id: 'base', options: { name: '@deepseek-ai/dsh-base' }, disabled: false, fiber: { state: 2 } }],
    dirs,
    profileDir,
  })
  const payload = collectInventory(ctx, normalizeConfig({ includeOfficial: true }), new Map(), (name) => {
    const dir = dirs.get(name)
    return { packageName: name, dir, manifestPath: join(dir, 'package.json') }
  })
  assert.equal(payload.plugins.length, 1)
  assert.equal(payload.plugins[0].official, true)
})

test('a broken Loader yields an empty but well-formed payload', () => {
  const ctx = {
    logger: { warn() {} },
    get() {
      throw new Error('no services')
    },
    effect() {},
  }
  const payload = collectInventory(ctx, normalizeConfig({}), new Map(), (name) => ({ packageName: name }))
  assert.deepEqual(payload.plugins, [])
  assert.equal(payload.counts.rows, 0)
})

test('normalizeConfig applies safe defaults', () => {
  const settings = normalizeConfig(undefined)
  assert.equal(settings.lang, 'zh')
  assert.equal(settings.includeOfficial, false)
  assert.equal(settings.summaryChars > 0, true)
  assert.equal(normalizeConfig({ lang: 'en', includeOfficial: true }).lang, 'en')
  assert.equal(normalizeConfig({ summaryChars: -3 }).summaryChars > 0, true)
})

test('the shipped dictionary loads with 20+ authored entries', () => {
  const curated = loadCurated({ logger: { debug() {}, warn() {} } }, { debug() {}, warn() {} })
  assert.equal(curated.size >= 20, true)
  assert.equal(curated.get('dsh-pet').title, '桌面宠物')
})

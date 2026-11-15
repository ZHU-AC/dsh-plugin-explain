/**
 * Unit tests for the pure helpers behind the panel.
 *
 * Run with `node --test test/` from the package root. Nothing here needs a DSH
 * Host: the rules under test are exactly the ones that decide what the user
 * reads, so they are worth isolating from React and the Loader.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  bareName,
  buildRecord,
  clip,
  describePackage,
  filterRecords,
  hasChinese,
  manifestSlice,
  mergeRows,
  readmeSummary,
  repositoryUrl,
  shortName,
  sortWeight,
  stripMarkdown,
} from '../lib/describe.js'

test('hasChinese accepts Han and rejects Latin-only text', () => {
  assert.equal(hasChinese('插件说明'), true)
  assert.equal(hasChinese('plugin guide'), false)
  assert.equal(hasChinese('——'), false)
  assert.equal(hasChinese(undefined), false)
})

test('stripMarkdown removes badges, HTML and links but keeps prose', () => {
  const markdown = [
    '<p align="center">',
    '  <img src="./logo.svg" alt="logo" />',
    '</p>',
    '# dsh-genui',
    '',
    '[![npm](https://img.shields.io/npm/v/dsh-genui)](https://npmjs.com)',
    '',
    '让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的回答，从「一段文字」变成「一个能点的界面」。',
  ].join('\n')
  const prose = stripMarkdown(markdown)
  assert.equal(prose.includes('<'), false)
  assert.equal(prose.includes('shields.io'), false)
  assert.equal(prose.includes('一个能点的界面'), true)
})

test('readmeSummary skips the title and badge block and returns the tagline', () => {
  const markdown = [
    '<!-- comment -->',
    '<p align="center"><img src="x.svg" alt="x" /></p>',
    '',
    '# dsh-video-storyboard',
    '',
    '[![test](https://x)](https://y)  [![npm](https://z)](https://w)',
    '',
    '> 让 AI 真正“看过”一段视频：一张分镜图加一份带时间码的文本清单。',
    '',
    '## Install',
    '',
    '```bash',
    'npm i dsh-video-storyboard',
    '```',
  ].join('\n')
  const summary = readmeSummary(markdown, 120)
  assert.equal(summary.includes('看过'), true)
  assert.equal(summary.includes('npm i'), false)
  assert.equal(summary.length <= 120, true)
})

test('readmeSummary returns an empty string when there is no prose', () => {
  assert.equal(readmeSummary('<img src="a.png" />'), '')
  assert.equal(readmeSummary(''), '')
  assert.equal(readmeSummary('# Title'), '')
})

test('clip appends an ellipsis only when it truncates', () => {
  assert.equal(clip('abc', 10), 'abc')
  assert.equal(clip('abcdefghij', 5), 'abcd…')
})

test('the summary ladder prefers authored text over every package source', () => {
  const result = describePackage({
    curated: { title: '生成式界面', summary: '人工写的中文说明。', usage: '不需要手动调用。', tags: ['界面'] },
    metaTitle: 'package title',
    metaDescription: 'Package Chinese description',
    description: 'English description',
    readmeZh: '中文 README 里的段落。中文 README 里的段落。',
  })
  assert.equal(result.source, 'dictionary')
  assert.equal(result.title, '生成式界面')
  assert.equal(result.summary, '人工写的中文说明。')
  assert.equal(result.usage, '不需要手动调用。')
  assert.deepEqual(result.tags, ['界面'])
  assert.equal(result.untranslated, false)
})

test('a Chinese README excerpt is preferred over an English description', () => {
  const result = describePackage({
    description: 'English only description of a plugin.',
    readmeZh: '这是一段足够长的中文 README 段落，用来验证回退顺序是否按预期工作。',
  })
  assert.equal(result.source, 'readme-zh')
  assert.equal(result.untranslated, false)
  assert.equal(result.summary.includes('回退顺序'), true)
})

test('with no Chinese anywhere the English text is kept and flagged', () => {
  const result = describePackage({ description: 'Free web search for DeepSeek Harness.' })
  assert.equal(result.summary, 'Free web search for DeepSeek Harness.')
  assert.equal(result.untranslated, true)
  assert.equal(result.source, 'package-json-en')
})

test('a package with no text at all reports source "none"', () => {
  const result = describePackage({})
  assert.equal(result.summary, '')
  assert.equal(result.source, 'none')
  assert.equal(result.untranslated, false)
})

test('mergeRows collapses a package and its subpath rows into one card', () => {
  const cards = mergeRows([
    { entryId: 'a', moduleName: '@acme/pkg', packageName: '@acme/pkg', enabled: true, fiberPhase: 'active' },
    { entryId: 'b', moduleName: '@acme/pkg/tools', packageName: '@acme/pkg', enabled: false, fiberPhase: 'failed' },
    { entryId: 'c', moduleName: 'other', packageName: 'other', enabled: true, fiberPhase: 'pending' },
  ])
  assert.equal(cards.length, 2)
  const acme = cards.find((card) => card.packageName === '@acme/pkg')
  assert.equal(acme.rowCount, 2)
  assert.deepEqual(acme.entryIds, ['a', 'b'])
  assert.equal(acme.enabled, true, 'one live row keeps the card enabled')
  assert.equal(acme.fiberPhase, 'active', 'the healthiest phase wins')
  assert.equal(acme.subpath, true)
})

test('mergeRows ignores malformed rows', () => {
  assert.deepEqual(mergeRows([null, {}, { moduleName: '' }]), [])
  assert.deepEqual(mergeRows(undefined), [])
})

test('bareName and shortName strip subpaths, scopes and prefixes', () => {
  assert.equal(bareName('@scope/pkg/tools'), '@scope/pkg')
  assert.equal(bareName('plain'), 'plain')
  assert.equal(shortName('@scope/dsh-plugin-thing'), 'thing')
  assert.equal(shortName('dsh-free-search'), 'free-search')
  assert.equal(shortName('dshmarket'), 'dshmarket')
})

test('repositoryUrl normalises the forms npm allows', () => {
  assert.equal(repositoryUrl('github:acme/widget'), undefined)
  assert.equal(repositoryUrl('acme/widget'), 'https://github.com/acme/widget')
  assert.equal(repositoryUrl('git+https://github.com/acme/widget.git'), 'https://github.com/acme/widget')
  assert.equal(repositoryUrl('git@github.com:acme/widget.git'), 'https://github.com/acme/widget')
  assert.equal(repositoryUrl({ url: 'git+ssh://git@github.com/acme/widget.git' }), 'https://github.com/acme/widget')
  assert.equal(repositoryUrl(undefined), undefined)
})

test('manifestSlice keeps only the keys the panel reads', () => {
  const slice = manifestSlice({
    name: 'x',
    version: '1.0.0',
    description: 'd',
    scripts: { postinstall: 'rm -rf /' },
    dependencies: { y: '1' },
  })
  assert.deepEqual(Object.keys(slice).sort(), ['description', 'name', 'version'])
  assert.equal(manifestSlice(null), null)
})

test('buildRecord reads a real package directory without a Host', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pe-'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'demo', version: '2.3.4', description: 'English only demo package.' }),
  )
  writeFileSync(join(dir, 'README.md'), '# demo\n\nA demo package that explains itself in English only.\n')
  const card = mergeRows([{ moduleName: 'demo', packageName: 'demo', enabled: true, fiberPhase: 'active' }])[0]
  const record = buildRecord({
    card,
    manifest: manifestSlice({ name: 'demo', version: '2.3.4', description: 'English only demo package.' }),
    dir,
    curated: undefined,
    readmeCache: new Map(),
    maxChars: 200,
  })
  assert.equal(record.packageName, 'demo')
  assert.equal(record.version, '2.3.4')
  assert.equal(record.title, 'demo')
  assert.equal(record.untranslated, true)
  assert.equal(record.official, false)
  assert.equal(sortWeight(record) > 0, true)
})

test('buildRecord prefers the authored dictionary for a known package', () => {
  const card = mergeRows([{ moduleName: 'dsh-pet', packageName: 'dsh-pet', enabled: true, fiberPhase: 'active' }])[0]
  const record = buildRecord({
    card,
    manifest: { name: 'dsh-pet', version: '0.3.8', description: 'A blue fish.' },
    dir: undefined,
    curated: { title: '桌面宠物', summary: '一只住在界面上的蓝色大肥鱼。', tags: ['装饰'] },
    readmeCache: new Map(),
  })
  assert.equal(record.title, '桌面宠物')
  assert.equal(record.source, 'dictionary')
  assert.equal(record.untranslated, false)
  assert.deepEqual(record.tags, ['装饰'])
})

test('filterRecords matches Chinese titles, package names and tags', () => {
  const records = [
    { title: '免费联网搜索', shortName: 'free-search', packageName: 'dsh-free-search', summary: '搜索', tags: ['搜索'], modules: [] },
    { title: '桌面宠物', shortName: 'pet', packageName: 'dsh-pet', summary: '一只鱼', tags: ['装饰'], modules: [] },
  ]
  assert.equal(filterRecords(records, '搜索').length, 1)
  assert.equal(filterRecords(records, 'dsh-').length, 2)
  assert.equal(filterRecords(records, '  装饰 ').length, 1)
  assert.equal(filterRecords(records, '').length, 2)
  assert.equal(filterRecords(records, '不存在').length, 0)
})

test('sortWeight puts the readable third-party entries first', () => {
  const good = { official: false, untranslated: false, enabled: true, fiberPhase: 'active' }
  const englishOnly = { official: false, untranslated: true, enabled: true, fiberPhase: 'active' }
  const official = { official: true, untranslated: false, enabled: true, fiberPhase: 'active' }
  assert.equal(sortWeight(good) < sortWeight(englishOnly), true)
  assert.equal(sortWeight(englishOnly) < sortWeight(official), true)
})

test('the shipped dictionary covers every bundle the desktop profile lists', async () => {
  const { readFileSync } = await import('node:fs')
  const dictionary = JSON.parse(readFileSync(new URL('../lib/data/curated.zh.json', import.meta.url), 'utf8'))
  const profile = JSON.parse(
    readFileSync(join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh', 'profiles', 'desktop', 'package.json'), 'utf8'),
  )
  const bundles = profile?.dsh?.profile?.bundles ?? []
  const missing = bundles.filter((bundle) => dictionary.plugins[bundle] === undefined)
  assert.deepEqual(missing, [], `curated.zh.json is missing: ${missing.join(', ')}`)
})

test('every dictionary entry has a Chinese summary', async () => {
  const { readFileSync } = await import('node:fs')
  const dictionary = JSON.parse(readFileSync(new URL('../lib/data/curated.zh.json', import.meta.url), 'utf8'))
  for (const [packageName, entry] of Object.entries(dictionary.plugins)) {
    assert.equal(hasChinese(entry.summary), true, `${packageName} has no Chinese summary`)
    assert.equal(typeof entry.usage, 'string', `${packageName} has no usage line`)
  }
})

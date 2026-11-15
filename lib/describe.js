/**
 * Pure helpers for `dsh-plugin-explain`.
 *
 * Everything in this module is free of DSH, React and Node-specific behaviour
 * except `node:fs` inside {@link readPackageManifest}, so the interesting rules
 * (which text wins, how a README becomes one sentence, how Loader rows collapse
 * into one card per package) are unit-testable without a running Host.
 *
 * @module dsh-plugin-explain/lib/describe
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The slice of `package.json` this plugin reads. */
const MANIFEST_KEYS = [
  'name',
  'version',
  'description',
  'homepage',
  'repository',
  'author',
  'keywords',
  'private',
]

/** Chinese README filenames, best first. */
const ZH_README_NAMES = [
  'README.zh.md',
  'README.zh-CN.md',
  'README.zh_cn.md',
  'README.zh-Hans.md',
  'README.zh_CN.md',
  'README.cn.md',
]

/** English README filenames, best first. */
const EN_README_NAMES = ['README.md', 'README.en.md', 'readme.md']

/** A CJK codepoint test that also accepts full-width punctuation. */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/

/**
 * Whether a string carries Chinese text (not just Chinese punctuation).
 *
 * @param {unknown} value Candidate text.
 * @returns {boolean} true when at least one Han character is present.
 */
export function hasChinese(value) {
  if (typeof value !== 'string') return false
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(value)
}

/** Collapse runs of whitespace into single spaces and trim. */
function oneLine(value) {
  return String(value ?? '')
    .replace(/[\s\u3000]+/g, ' ')
    .trim()
}

/**
 * Turn a Markdown fragment into a single readable sentence.
 *
 * Strips fenced blocks, HTML, images, badges, links (keeping their text),
 * emphasis markers, list bullets, table rows and heading hashes. The result is
 * plain prose that can be rendered without a Markdown renderer.
 *
 * @param {string} markdown Raw Markdown text.
 * @returns {string} Plain prose, possibly empty.
 */
export function stripMarkdown(markdown) {
  if (typeof markdown !== 'string' || markdown.length === 0) return ''
  let text = markdown.replace(/\r\n?/g, '\n')
  text = text.replace(/```[\s\S]*?```/g, ' ')
  text = text.replace(/~~~[\s\S]*?~~~/g, ' ')
  text = text.replace(/<!--[\s\S]*?-->/g, ' ')
  text = text.replace(/<[^>]+>/g, ' ')
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  text = text.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, ' ')
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  text = text.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
  text = text.replace(/https?:\/\/\S+/g, ' ')
  text = text.replace(/`([^`]*)`/g, '$1')
  text = text.replace(/(\*\*|__|\*|_|~~)/g, '')
  text = text.replace(/^\s{0,3}#{1,6}\s*/gm, '')
  text = text.replace(/^\s{0,3}>\s?/gm, '')
  text = text.replace(/^\s{0,3}[-*+]\s+/gm, '')
  text = text.replace(/^\s{0,3}\d+[.)]\s+/gm, '')
  text = text.replace(/^\s*\|.*\|\s*$/gm, ' ')
  text = text.replace(/^\s*[-=]{3,}\s*$/gm, ' ')
  return oneLine(text)
}

/**
 * Pick the first paragraph of a README that looks like a description.
 *
 * READMEs open with a logo, a badge row, an H1 and then a tagline. This keeps
 * the first paragraph that is long enough to be prose and does not consist of
 * only a title or only links.
 *
 * @param {string} markdown Raw README text.
 * @param {number} [maxChars] Hard length cap before an ellipsis is appended.
 * @returns {string} The chosen paragraph, or an empty string.
 */
export function readmeSummary(markdown, maxChars = 320) {
  if (typeof markdown !== 'string' || markdown.length === 0) return ''
  const withoutCode = markdown
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, '\n\n')
    .replace(/~~~[\s\S]*?~~~(?![^~]*~~~)/g, '\n\n')
    .replace(/<!--[\s\S]*?-->/g, '\n\n')

  const blocks = withoutCode.split(/\n{2,}/)
  for (const block of blocks) {
    const raw = block.trim()
    if (raw.length === 0) continue
    // A block of only badges, images, links or an HTML wrapper carries no prose.
    if (/^<[a-z!/]/i.test(raw) && !/<(p|div)[^>]*>[\s\S]{40,}/i.test(raw)) {
      const inner = stripMarkdown(raw)
      if (inner.length >= 24 && !onlyNoise(raw)) return clip(inner, maxChars)
      continue
    }
    const text = stripMarkdown(raw)
    if (text.length < 24) continue
    if (onlyNoise(text)) continue
    if (/^(install|安装|installation|usage|用法|quick start|快速开始|license|许可)/i.test(text)) continue
    return clip(text, maxChars)
  }

  // Fall back to the whole document: some READMEs are one long paragraph.
  const flat = stripMarkdown(withoutCode)
  return flat.length >= 24 ? clip(flat, maxChars) : ''
}

/** A paragraph that is only a link list or a duplicated title. */
function onlyNoise(text) {
  const words = text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  if (words.length === 0) return true
  const letters = text.replace(/[^\p{L}]+/gu, '')
  if (letters.length < 12) return true
  return false
}

/** Cut to `maxChars`, appending an ellipsis when something was dropped. */
export function clip(value, maxChars = 320) {
  const text = oneLine(value)
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 320
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`
}

/**
 * Normalise the `repository` field of a manifest into a browsable URL.
 *
 * @param {unknown} repository Manifest value: a string, `{ url }`, or absent.
 * @returns {string | undefined} An http(s) URL when one can be derived.
 */
export function repositoryUrl(repository) {
  const raw =
    typeof repository === 'string'
      ? repository
      : repository !== null && typeof repository === 'object' && typeof repository.url === 'string'
        ? repository.url
        : undefined
  if (raw === undefined) return undefined
  let url = raw.trim()
  const shorthand = /^([\w.-]+)\/([\w.-]+)$/.exec(url)
  if (shorthand !== null) return `https://github.com/${shorthand[1]}/${shorthand[2]}`
  url = url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@/, 'https://')
  url = url.replace(/^git@([^:]+):/, 'https://$1/')
  if (url.endsWith('.git')) url = url.slice(0, -4)
  if (!/^https?:\/\//i.test(url)) return undefined
  return url
}

/** Turn a file path into a `file:` URL the ESM resolver accepts. */
export function fileUrlOf(path) {
  try {
    return pathToFileURL(path).href
  } catch {
    return undefined
  }
}

/**
 * Derive a package root from a manifest path.
 *
 * @param {string} manifestPath Absolute path of a `package.json`.
 * @returns {string} The containing directory.
 */
export function packageDirOf(manifestPath) {
  return manifestPath.replace(/[\\/][^\\/]+$/, '')
}

/**
 * Read a manifest without throwing.
 *
 * @param {string} manifestPath Absolute path of a `package.json`.
 * @returns {object | null} The parsed JSON object, or `null`.
 */
export function readPackageManifest(manifestPath) {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * Read the richest available text file inside a package directory.
 *
 * @param {string} dir Package root.
 * @param {'zh' | 'en'} lang Wanted language.
 * @returns {{ name: string, text: string } | null} The file that was read.
 */
export function readReadme(dir, lang) {
  const names = lang === 'zh' ? [...ZH_README_NAMES, ...EN_README_NAMES] : [...EN_README_NAMES, ...ZH_README_NAMES]
  for (const name of names) {
    try {
      const text = readFileSync(join(dir, name), 'utf8')
      if (typeof text === 'string' && text.length > 0) return { name, text }
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/**
 * Decide the one-line Chinese summary for one package.
 *
 * The order is a quality ladder, not a guess: an authored dictionary entry
 * beats the package's own localized metadata, which beats a Chinese
 * `description`, which beats an excerpt of a Chinese README. Only when no
 * Chinese text exists anywhere does it fall back to the English description,
 * and the caller is told so through `untranslated` instead of receiving a
 * machine translation the user cannot verify.
 *
 * @param {object} input Facts gathered for one package.
 * @param {object} [input.curated] Dictionary entry: `{ title, summary, usage, tags }`.
 * @param {'zh' | 'en'} [input.metaLang] Language the registry/localized title uses.
 * @param {string} [input.metaTitle] Localized title from DSH metadata, if any.
 * @param {string} [input.metaDescription] Localized description from DSH metadata.
 * @param {string} [input.description] Raw manifest `description`.
 * @param {string} [input.readmeZh] Chinese README text, if one exists.
 * @param {string} [input.readmeEn] English README text, if one exists.
 * @param {number} [maxChars] Summary length cap.
 * @returns {{ title?: string, summary: string, usage?: string, tags?: string[], source: string, untranslated: boolean }}
 */
export function describePackage(input = {}, maxChars = 320) {
  const curated = input.curated !== null && typeof input.curated === 'object' ? input.curated : undefined
  const curatedTitle = nonEmpty(curated?.title)
  const curatedSummary = nonEmpty(curated?.summary)
  const curatedUsage = nonEmpty(curated?.usage)
  const curatedTags = Array.isArray(curated?.tags) ? curated.tags.filter((tag) => typeof tag === 'string') : undefined

  if (curatedSummary !== undefined && hasChinese(curatedSummary)) {
    return {
      title: curatedTitle,
      summary: clip(curatedSummary, maxChars),
      usage: curatedUsage,
      tags: curatedTags,
      source: 'dictionary',
      untranslated: false,
    }
  }

  const metaTitle = nonEmpty(input.metaTitle)
  const metaDescription = nonEmpty(input.metaDescription)
  const description = nonEmpty(input.description)

  if (metaDescription !== undefined && hasChinese(metaDescription)) {
    return {
      title: curatedTitle ?? (metaTitle !== undefined && hasChinese(metaTitle) ? metaTitle : undefined),
      summary: clip(metaDescription, maxChars),
      usage: curatedUsage,
      tags: curatedTags,
      source: 'package-locale',
      untranslated: false,
    }
  }

  if (description !== undefined && hasChinese(description)) {
    return {
      title: curatedTitle ?? (metaTitle !== undefined && hasChinese(metaTitle) ? metaTitle : undefined),
      summary: clip(description, maxChars),
      usage: curatedUsage,
      tags: curatedTags,
      source: 'package-json',
      untranslated: false,
    }
  }

  // A Chinese README is the last Chinese source. Prefer a README paragraph that
  // really is Chinese over one that merely mentions a Chinese word.
  const zhExcerpt = readmeSummary(input.readmeZh, maxChars)
  if (zhExcerpt !== '' && hasChinese(zhExcerpt)) {
    return {
      title: curatedTitle ?? (hasChinese(metaTitle ?? '') ? metaTitle : undefined),
      summary: zhExcerpt,
      usage: curatedUsage,
      tags: curatedTags,
      source: 'readme-zh',
      untranslated: false,
    }
  }

  const en = description ?? metaDescription ?? readmeSummary(input.readmeEn, maxChars) ?? ''
  return {
    title: curatedTitle ?? metaTitle,
    summary: clip(en, maxChars),
    usage: curatedUsage,
    tags: curatedTags,
    source: en === '' ? 'none' : description !== undefined ? 'package-json-en' : 'fallback-en',
    untranslated: en !== '',
  }
}

/** A trimmed non-empty string, or `undefined`. */
function nonEmpty(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/**
 * Reduce Loader rows to one card per package.
 *
 * A bundle can contribute several rows (a package plus a subpath entry such as
 * `pkg/tools`), and a row can appear both globally and inside an agent preset.
 * The panel is about packages, so rows collapse by their package name while the
 * original entry ids stay visible for diagnostics.
 *
 * @param {Array<{ entryId?: string | null, moduleName: string, enabled?: boolean, fiberPhase?: string | null, packageName?: string }>} rows Loader rows.
 * @returns {Array<{ packageName: string, moduleName: string, enabled: boolean, fiberPhase: string | null, entryIds: string[], rowCount: number, subpath: boolean }>}
 */
export function mergeRows(rows) {
  const byPackage = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row === null || typeof row !== 'object') continue
    const moduleName = typeof row.moduleName === 'string' ? row.moduleName : ''
    if (moduleName.length === 0) continue
    const packageName =
      typeof row.packageName === 'string' && row.packageName.length > 0 ? row.packageName : bareName(moduleName)
    const existing = byPackage.get(packageName)
    const phase = typeof row.fiberPhase === 'string' ? row.fiberPhase : null
    const enabled = row.enabled !== false
    if (existing === undefined) {
      byPackage.set(packageName, {
        packageName,
        names: [moduleName],
        moduleName,
        enabled,
        fiberPhase: phase,
        entryIds: typeof row.entryId === 'string' ? [row.entryId] : [],
        rowCount: 1,
      })
      continue
    }
    existing.rowCount += 1
    if (!existing.names.includes(moduleName)) existing.names.push(moduleName)
    if (typeof row.entryId === 'string' && !existing.entryIds.includes(row.entryId)) existing.entryIds.push(row.entryId)
    // The card reports the healthiest phase and the enabled state that any row
    // holds: one live row means the feature is reachable.
    existing.enabled = existing.enabled || enabled
    if (phaseRank(phase) > phaseRank(existing.fiberPhase)) existing.fiberPhase = phase
  }

  const cards = []
  for (const value of byPackage.values()) {
    cards.push({
      packageName: value.packageName,
      moduleName: value.moduleName,
      names: value.names,
      enabled: value.enabled,
      fiberPhase: value.fiberPhase,
      entryIds: value.entryIds,
      rowCount: value.rowCount,
      subpath: value.names.some((name) => name !== value.packageName),
    })
  }
  return cards
}

/** Order phases by how alive they are, so merging keeps the best one. */
function phaseRank(phase) {
  switch (phase) {
    case 'active':
      return 5
    case 'loading':
      return 4
    case 'pending':
      return 3
    case 'unloading':
      return 2
    case 'failed':
      return 1
    default:
      return 0
  }
}

/**
 * Strip a package subpath and an npm scope from a module name.
 *
 * @param {string} moduleName A Loader module identifier such as `@scope/pkg/tools`.
 * @returns {string} `@scope/pkg`, or the input when it names no subpath.
 */
export function bareName(moduleName) {
  if (typeof moduleName !== 'string') return ''
  const parts = moduleName.split('/')
  if (moduleName.startsWith('@')) {
    if (parts.length < 2) return moduleName
    return parts.slice(0, 2).join('/')
  }
  return parts[0]
}

/**
 * Short display name: drop the npm scope and the DSH package prefixes.
 *
 * @param {string} packageName Full package name.
 * @returns {string} A readable stem such as `free-search`.
 */
export function shortName(packageName) {
  if (typeof packageName !== 'string') return ''
  const bare = packageName.replace(/^@[^/]+\//, '')
  return bare.replace(/^dsh-plugin-/, '').replace(/^dsh-/, '')
}

/** Manifest type label used by the panel's source badge. */
function manifestType(manifest) {
  if (manifest === null || typeof manifest !== 'object') return undefined
  return typeof manifest.private === 'boolean' ? manifest.private : undefined
}

/**
 * Build the wire payload for one package.
 *
 * @param {object} options
 * @param {{ packageName: string, moduleName: string, names: string[], enabled: boolean, fiberPhase: string | null, entryIds: string[], rowCount: number, subpath: boolean }} options.card Merged row group.
 * @param {object | null} options.manifest Parsed `package.json`.
 * @param {string} [options.dir] Package root.
 * @param {'zh' | 'en'} [options.metaLang] Language of the DSH metadata strings.
 * @param {object} [options.meta] DSH display metadata: `{ title, description, icon }`.
 * @param {object} [options.curated] Dictionary entry.
 * @param {Map<string, object>} [options.readmeCache] Per-run README cache.
 * @param {number} [options.maxChars] Summary cap.
 * @returns {object} The panel's per-plugin record.
 */
export function buildRecord(options) {
  const { card, manifest, dir, metaLang = 'zh', meta = {}, curated, readmeCache } = options
  const maxChars = options.maxChars ?? 320
  const manifestDescription = typeof manifest?.description === 'string' ? manifest.description : undefined

  let readmeZh
  let readmeEn
  if (dir !== undefined && readmeCache !== undefined) {
    readmeZh = cachedReadme(readmeCache, dir, 'zh', 'zh')?.text
    readmeEn = cachedReadme(readmeCache, dir, 'en', 'en')?.text
  }

  const described = describePackage(
    {
      curated,
      metaLang,
      metaTitle: pickLocalized(meta.title, metaLang),
      metaDescription: pickLocalized(meta.description, metaLang),
      description: manifestDescription,
      readmeZh,
      readmeEn,
    },
    maxChars,
  )

  const title = described.title ?? curatedTitleOrUndefined(curated) ?? pickLocalized(meta.title, metaLang) ?? shortName(card.packageName)

  return {
    packageName: card.packageName,
    moduleName: card.moduleName,
    modules: card.names,
    entryIds: card.entryIds,
    rowCount: card.rowCount,
    subpath: card.subpath,
    title,
    shortName: shortName(card.packageName),
    summary: described.summary,
    usage: described.usage,
    tags: described.tags ?? [],
    source: described.source,
    untranslated: described.untranslated,
    version: typeof manifest?.version === 'string' ? manifest.version : undefined,
    description: manifestDescription,
    homepage: typeof manifest?.homepage === 'string' ? manifest.homepage : undefined,
    repository: repositoryUrl(manifest?.repository),
    author: authorName(manifest?.author),
    keywords: Array.isArray(manifest?.keywords) ? manifest.keywords.filter((k) => typeof k === 'string').slice(0, 8) : [],
    private: manifestType(manifest),
    icon: typeof meta.icon === 'string' ? meta.icon : undefined,
    enabled: card.enabled,
    fiberPhase: card.fiberPhase,
    official: card.packageName.startsWith('@deepseek-ai/'),
  }
}

/** Dictionary title without running it through the text ladder. */
function curatedTitleOrUndefined(curated) {
  return curated !== null && typeof curated === 'object' && typeof curated.title === 'string' && curated.title.trim() !== ''
    ? curated.title.trim()
    : undefined
}

/** A localized DSH metadata value is either a string or a `{ zh, en }` map. */
function pickLocalized(value, lang) {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object') {
    const preferred = value[lang]
    if (typeof preferred === 'string') return preferred
    if (typeof value.en === 'string') return value.en
  }
  return undefined
}

/** Read one README per (dir, lang) pair, memoised for one Host request. */
function cachedReadme(cache, dir, want, key) {
  const composite = `${dir}\u0000${key}`
  if (cache.has(composite)) return cache.get(composite)
  const found = typeof dir === 'string' ? readReadme(dir, want) : null
  cache.set(composite, found)
  return found
}

/** `author` may be a string or `{ name }`. */
function authorName(author) {
  if (typeof author === 'string') return author
  if (author !== null && typeof author === 'object' && typeof author.name === 'string') return author.name
  return undefined
}

/**
 * Rank a record for the panel's default order: third-party first, then the
 * packages whose Chinese text needed no guesswork.
 *
 * @param {object} record A record produced by {@link buildRecord}.
 * @returns {number} Sort weight, lower first.
 */
export function sortWeight(record) {
  let weight = 0
  if (record.official === true) weight += 100
  if (record.untranslated === true) weight += 10
  if (record.fiberPhase === 'failed') weight += 5
  if (record.enabled === false) weight += 2
  return weight
}

/**
 * Filter records by a free-text query.
 *
 * @param {object[]} records Records from {@link buildRecord}.
 * @param {string} query Raw user input.
 * @returns {object[]} Matching records, same order.
 */
export function filterRecords(records, query) {
  const needle = oneLine(query).toLowerCase()
  if (needle === '') return records
  const terms = needle.split(' ').filter((term) => term.length > 0)
  return records.filter((record) => {
    const haystack = [
      record.title,
      record.shortName,
      record.packageName,
      record.summary,
      record.description,
      record.usage,
      ...(record.tags ?? []),
      ...(record.modules ?? []),
    ]
      .filter((value) => typeof value === 'string')
      .join(' ')
      .toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

/**
 * Validate the manifest slice that this plugin actually uses.
 *
 * @param {unknown} manifest Parsed `package.json`.
 * @returns {object | null} A shallow copy limited to the known keys.
 */
export function manifestSlice(manifest) {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return null
  const slice = {}
  for (const key of MANIFEST_KEYS) {
    if (manifest[key] !== undefined) slice[key] = manifest[key]
  }
  return Object.keys(slice).length === 0 ? null : slice
}

export { CJK }

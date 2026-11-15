/**
 * Host half of `dsh-plugin-explain`.
 *
 * The browser never reads the filesystem: this half enumerates the live Loader,
 * resolves every row to its owning package, and answers two read-only HTTP
 * endpoints under `/plugin-explain`. It deliberately does not import any
 * `@deepseek-ai/*` module, so a DSH upgrade cannot break it through an internal
 * path; every Host service it touches is optional and accessed defensively.
 *
 * @module dsh-plugin-explain
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import {
  bareName,
  buildRecord,
  clip,
  manifestSlice,
  mergeRows,
  packageDirOf,
  readPackageManifest,
  readReadme,
  readmeSummary,
  sortWeight,
  stripMarkdown,
} from './describe.js'

/** Loader entry id; also the settings namespace owned by this plugin. */
export const name = 'plugin-explain'

/** Only the Loader is mandatory: without it there is nothing to describe. */
export const inject = ['loader']

/** The single route prefix this plugin owns. */
const PREFIX = '/plugin-explain'

/** Default summary cap when configuration omits one. */
const DEFAULT_SUMMARY_CHARS = 320

/**
 * Inert defaults so the composed row in `cordis.patch.yml` may stay empty.
 *
 * @type {object}
 */
export const Config = undefined

/**
 * Install the host half.
 *
 * @param {object} ctx Cordis context of this plugin entry.
 * @param {object} [config] Row configuration.
 */
export function apply(ctx, config) {
  const settings = normalizeConfig(config)
  const logger = safeLogger(ctx)
  const curated = loadCurated(ctx, logger)
  // Bare package names must resolve the way the Host resolves them: from the
  // profile directory, not from this file's own location inside it.
  const resolver = createResolver(ctx, logger)

  const collect = () => collectInventory(ctx, settings, curated, resolver)

  ctx.effect(
    () =>
      installRoutes(ctx, {
        settings,
        logger,
        collect,
        resolver,
      }),
    'plugin-explain: routes',
  )

  logger.debug?.(`[plugin-explain] ready (lang=${settings.lang}, includeOfficial=${settings.includeOfficial})`)
}

/**
 * Answer both endpoints, or nothing at all when the composition carries no web
 * server (a headless Host still loads the plugin without failing).
 *
 * @param {object} ctx Cordis context.
 * @param {{ settings: object, logger: object, collect: () => object, resolver: (name: string, baseUrl?: string) => object }} options Runtime pieces.
 * @returns {() => void} Disposer.
 */
function installRoutes(ctx, { settings, logger, collect, resolver }) {
  const webServer = softService(ctx, 'webServer')
  if (webServer === null || typeof webServer.register !== 'function') {
    logger.warn?.('[plugin-explain] no webServer in this composition; the panel has nothing to read')
    return () => {}
  }

  const dispose = webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (request, response) => {
      try {
        const url = new URL(String(request.url ?? '/'), 'http://placeholder')
        const pathname = url.pathname

        if (request.method !== 'GET' && request.method !== 'HEAD') {
          respond(response, 405, { 'content-type': 'text/plain; charset=utf-8' }, 'method not allowed')
          return
        }
        if (!isTrustedLocalRequest(request, webServer)) {
          respond(response, 403, { 'content-type': 'text/plain; charset=utf-8' }, 'forbidden')
          return
        }

        if (pathname === `${PREFIX}/api/list`) {
          const payload = collect()
          respondJson(response, 200, payload)
          return
        }

        if (pathname === `${PREFIX}/api/readme`) {
          const packageName = url.searchParams.get('pkg') ?? ''
          const detail = readmeDetail(packageName, settings, resolver)
          if (detail === null) {
            respondJson(response, 404, { error: 'not-found', packageName })
            return
          }
          respondJson(response, 200, detail)
          return
        }

        if (pathname === `${PREFIX}/api/health`) {
          respondJson(response, 200, { ok: true, name, version: thisVersion() })
          return
        }

        respond(response, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'not found')
      } catch (error) {
        logger.warn?.('[plugin-explain] request failed', error)
        if (!response.headersSent) {
          respond(response, 500, { 'content-type': 'text/plain; charset=utf-8' }, 'internal error')
        } else {
          response.end()
        }
      }
    },
  })

  return typeof dispose === 'function' ? dispose : () => {}
}

/**
 * Walk the Loader and build the panel payload.
 *
 * @param {object} ctx Cordis context.
 * @param {ReturnType<typeof normalizeConfig>} settings Normalized configuration.
 * @param {Map<string, object>} curated Dictionary keyed by package name.
 * @param {(name: string) => { packageName: string, dir?: string, manifestPath?: string }} resolver Package locator.
 * @returns {object} `{ generatedAt, profile, counts, plugins }`
 */
export function collectInventory(ctx, settings, curated, resolver) {
  const loader = softService(ctx, 'loader')
  const packages = softService(ctx, 'pluginPackages')
  const profile = softService(ctx, 'profileContext')

  const rows = []
  const entries = loader !== null && typeof loader.entries === 'function' ? [...loader.entries()] : []
  for (const entry of entries) {
    const options = entry?.options
    if (options === undefined || options === null) continue
    if (options.group) continue
    const moduleName = typeof options.name === 'string' ? options.name : undefined
    if (moduleName === undefined || moduleName.length === 0) continue
    if (moduleName.startsWith('cordis:')) continue

    const baseUrl = entry?.parent?.tree?.ctx?.baseUrl
    const found = resolveWithService(packages, moduleName, baseUrl)
    rows.push({
      entryId: typeof entry.id === 'string' ? entry.id : null,
      moduleName,
      packageName: found?.packageName ?? bareName(moduleName),
      enabled: entry.disabled !== true,
      fiberPhase: phaseOf(entry),
    })
  }

  const cards = mergeRows(rows)
  const readmeCache = new Map()
  const plugins = []

  for (const card of cards) {
    if (settings.includeOfficial !== true && card.packageName.startsWith('@deepseek-ai/')) continue
    const resolved = resolveWithService(packages, card.packageName, undefined) ?? resolver(card.packageName)
    const manifest = resolved.manifestPath === undefined ? null : manifestSlice(readPackageManifest(resolved.manifestPath))
    const meta = resolved.meta ?? {}
    const record = buildRecord({
      card,
      manifest,
      dir: resolved.dir,
      metaLang: settings.lang === 'en' ? 'en' : 'zh',
      meta,
      curated: curated.get(card.packageName),
      readmeCache,
      maxChars: settings.summaryChars,
    })
    record.firstParty = isFirstParty(card.packageName)
    plugins.push(record)
  }

  plugins.sort((left, right) => {
    const byWeight = sortWeight(left) - sortWeight(right)
    if (byWeight !== 0) return byWeight
    return left.packageName.localeCompare(right.packageName)
  })

  return {
    generatedAt: new Date().toISOString(),
    plugin: { name, version: thisVersion() },
    profile: profileSummary(profile),
    lang: settings.lang,
    counts: {
      rows: rows.length,
      plugins: plugins.length,
      untranslated: plugins.filter((plugin) => plugin.untranslated === true).length,
      failed: plugins.filter((plugin) => plugin.fiberPhase === 'failed').length,
    },
    plugins,
  }
}

/**
 * Resolve one module name through the Host's package service.
 *
 * `pluginPackages.packageOf` is the authoritative resolver the Host itself uses,
 * so it is tried first; `undefined` means the service could not answer and the
 * caller should fall back to a plain Node resolution.
 *
 * @param {object | null} packages `ctx.pluginPackages`, when present.
 * @param {string} moduleName Loader module identifier.
 * @param {string} [baseUrl] Resolution base of the owning Loader tree.
 * @returns {{ packageName: string, dir?: string, manifestPath?: string, meta?: object } | undefined}
 */
function resolveWithService(packages, moduleName, baseUrl) {
  if (packages === null || typeof packages?.packageOf !== 'function') return undefined
  try {
    const found = packages.packageOf(moduleName, baseUrl)
    if (found === undefined || found === null) return undefined
    const meta = typeof packages.metaOf === 'function' ? packages.metaOf(moduleName, baseUrl) : undefined
    return {
      packageName: typeof found.name === 'string' && found.name.length > 0 ? found.name : bareName(moduleName),
      dir: typeof found.dir === 'string' ? found.dir : undefined,
      manifestPath: typeof found.manifestPath === 'string' ? found.manifestPath : undefined,
      meta: meta !== null && typeof meta === 'object' ? meta : undefined,
    }
  } catch {
    return undefined
  }
}

/**
 * Build a package locator that searches the profile's own module tree.
 *
 * A bare name must resolve the way the Host resolves it — from the profile
 * directory — not from this file's location or the process working directory.
 *
 * @param {object} ctx Cordis context, read for `profileContext` and `baseUrl`.
 * @param {ReturnType<typeof safeLogger>} logger Guarded logger.
 * @returns {(name: string) => { packageName: string, dir?: string, manifestPath?: string }}
 */
function createResolver(ctx, logger) {
  const profile = softService(ctx, 'profileContext')
  const bases = []
  if (typeof profile?.dir === 'string' && profile.dir.length > 0) {
    bases.push(`${profile.dir.replace(/\\/g, '/')}/package.json`)
  }
  if (typeof ctx?.baseUrl === 'string' && ctx.baseUrl.length > 0) bases.push(ctx.baseUrl)

  const cache = new Map()

  return (packageName) => {
    if (typeof packageName !== 'string' || packageName.length === 0) return { packageName }
    if (cache.has(packageName)) return cache.get(packageName)
    const bare = bareName(packageName)

    const anchors = [...bases, import.meta.url]
    for (const anchor of anchors) {
      try {
        const require = createRequire(anchor)
        const manifestPath = require.resolve(`${bare}/package.json`)
        const found = { packageName: bare, dir: packageDirOf(manifestPath), manifestPath }
        cache.set(packageName, found)
        return found
      } catch {
        /* try the next anchor */
      }
    }

    // Some packages do not export `./package.json`; locate the directory instead
    // and read the manifest from disk.
    for (const anchor of anchors) {
      try {
        const require = createRequire(anchor)
        const resolved = require.resolve(bare)
        const dir = findPackageDir(resolved, bare)
        if (dir !== undefined) {
          const found = { packageName: bare, dir, manifestPath: `${dir.replace(/[\\/]$/, '')}${sepFor(dir)}package.json` }
          cache.set(packageName, found)
          return found
        }
      } catch {
        /* try the next anchor */
      }
    }

    logger.debug?.(`[plugin-explain] could not locate package ${packageName}`)
    const missing = { packageName: bare }
    cache.set(packageName, missing)
    return missing
  }
}

/** Walk up from a resolved entry file to the directory owning `bare`. */
function findPackageDir(resolvedEntry, bare) {
  if (typeof resolvedEntry !== 'string') return undefined
  const normalized = resolvedEntry.replace(/\\/g, '/')
  const marker = `/${bare}/`
  const index = normalized.lastIndexOf(marker)
  if (index === -1) return undefined
  return normalized.slice(0, index + marker.length - 1)
}

/** The separator used by a path string. */
function sepFor(path) {
  return path.includes('/') ? '/' : '\\'
}

/** Map a Cordis fiber state onto the inventory's public phase vocabulary. */
function phaseOf(entry) {
  const fiber = entry?.fiber
  if (fiber === undefined || fiber === null) return null
  switch (fiber.state) {
    case 0:
      return 'pending'
    case 1:
      return 'loading'
    case 2:
      return 'active'
    case 3:
      return 'failed'
    case 4:
      return null
    case 5:
      return 'unloading'
    default:
      return null
  }
}

/** A profile summary for the panel header. */
function profileSummary(profile) {
  if (profile === null || profile === undefined) return undefined
  const dir = typeof profile.dir === 'string' ? profile.dir : undefined
  const profileName = typeof profile.name === 'string' ? profile.name : undefined
  if (dir === undefined && profileName === undefined) return undefined
  return { name: profileName, dir }
}

/** Whether a package ships with DSH itself rather than being user-added. */
function isFirstParty(packageName) {
  return packageName.startsWith('@deepseek-ai/')
}

/**
 * Read the full README for one package, on demand.
 *
 * @param {string} packageName Package the panel asked about.
 * @param {ReturnType<typeof normalizeConfig>} settings Normalized configuration.
 * @param {(name: string) => { packageName: string, dir?: string, manifestPath?: string }} resolver Package locator.
 * @returns {object | null} `{ packageName, lang, file, summary, text }` or `null`.
 */
function readmeDetail(packageName, settings, resolver) {
  if (typeof packageName !== 'string' || packageName.length === 0 || packageName.length > 214) return null
  if (/[\u0000-\u001f]/.test(packageName)) return null
  const resolved = resolver(packageName)
  if (resolved.dir === undefined) return null
  const zh = readReadme(resolved.dir, 'zh')
  const en = readReadme(resolved.dir, 'en')
  const chosen = zh !== null && hasCjk(zh.text) ? zh : en
  if (chosen === null) {
    return { packageName, lang: settings.lang, file: null, summary: '', text: '' }
  }
  const limit = Math.max(1000, settings.readmeChars)
  const cleaned = stripMarkdown(chosen.text)
  return {
    packageName,
    lang: hasCjk(chosen.text) ? 'zh' : 'en',
    file: chosen.name,
    summary: readmeSummary(chosen.text, settings.summaryChars),
    text: clip(cleaned, limit),
  }
}

/** Whether a string carries Chinese text. */
function hasCjk(value) {
  return typeof value === 'string' && /[\u3400-\u4dbf\u4e00-\u9fff]/.test(value)
}

/**
 * Load the authored Chinese dictionary that ships beside this module.
 *
 * A missing or malformed dictionary is not fatal: every package then falls back
 * to its own metadata.
 *
 * @param {object} ctx Cordis context, used only for its base URL.
 * @param {ReturnType<typeof safeLogger>} logger Guarded logger.
 * @returns {Map<string, object>} Dictionary keyed by package name.
 */
export function loadCurated(ctx, logger) {
  const map = new Map()
  const candidates = []
  candidates.push(new URL('./data/curated.zh.json', import.meta.url))

  let dirname
  try {
    dirname = fileURLToPath(new URL('.', import.meta.url))
  } catch {
    dirname = undefined
  }

  for (const url of candidates) {
    try {
      const text = readFileSync(url, 'utf8')
      if (typeof text !== 'string') continue
      const parsed = JSON.parse(text)
      const entries = parsed !== null && typeof parsed === 'object' ? parsed.plugins ?? parsed : {}
      for (const [key, value] of Object.entries(entries)) {
        if (value !== null && typeof value === 'object') map.set(key, value)
      }
      logger.debug?.(`[plugin-explain] ${map.size} dictionary entries loaded from ${dirname ?? 'the package'}`)
      return map
    } catch (error) {
      logger.warn?.('[plugin-explain] could not read the dictionary', error)
    }
    break
  }
  return map
}

/** Resolve one optional service by name without throwing. */
function softService(ctx, serviceName) {
  if (ctx === null || ctx === undefined) return null
  try {
    const found = typeof ctx.get === 'function' ? ctx.get(serviceName) : undefined
    if (found !== null && found !== undefined) return found
  } catch {
    /* services throw on access when absent in some compositions */
  }
  try {
    const viaProperty = ctx[serviceName]
    if (viaProperty !== null && viaProperty !== undefined) return viaProperty
  } catch {
    /* ignore */
  }
  return null
}

/** A logger that can never throw into a request. */
function safeLogger(ctx) {
  const logger = ctx?.logger
  const wrap = (level) => (...args) => {
    try {
      const fn = logger?.[level]
      if (typeof fn === 'function') fn(...args)
    } catch {
      /* logging must never fail a request */
    }
  }
  return { debug: wrap('debug'), info: wrap('info'), warn: wrap('warn'), error: wrap('error') }
}

/** This package's own version, read once. */
let cachedVersion
function thisVersion() {
  if (cachedVersion !== undefined) return cachedVersion
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    cachedVersion = typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    cachedVersion = '0.0.0'
  }
  return cachedVersion
}

/**
 * Write a JSON body.
 *
 * @param {import('node:http').ServerResponse} response Response.
 * @param {number} status HTTP status.
 * @param {unknown} body Serialisable payload.
 */
function respondJson(response, status, body) {
  const text = JSON.stringify(body)
  respond(response, status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text)),
    'cache-control': 'no-store',
  }, text)
}

/** Write a plain body with the given headers. */
function respond(response, status, headers, body) {
  if (response.headersSent) {
    response.end(body)
    return
  }
  response.writeHead(status, headers)
  response.end(body)
}

/**
 * Loopback + same-origin check for the fallback route.
 *
 * The Connection channel authenticates the browser for us; a plain route does
 * not, so it repeats the documented policy: a loopback Host (or the exact bind
 * literal), no cross-site fetch metadata, and a same-authority `Origin` when one
 * is present.
 *
 * @param {import('node:http').IncomingMessage} request Request.
 * @param {object} webServer The web server service.
 * @returns {boolean} Whether the request may be answered.
 */
function isTrustedLocalRequest(request, webServer) {
  const headers = request.headers ?? {}
  const rawHost = String(headers.host ?? '')
  if (rawHost.length === 0) return false
  const hostname = stripPort(rawHost)
  if (!isLoopbackName(hostname)) {
    let bindHost
    try {
      bindHost = webServer.host
    } catch {
      bindHost = undefined
    }
    if (typeof bindHost !== 'string' || normalizeHost(bindHost) !== normalizeHost(hostname)) return false
  }
  if (String(headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return false
  const origin = headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    try {
      const parsed = new URL(origin)
      if (normalizeHost(parsed.host) !== normalizeHost(rawHost)) return false
    } catch {
      return false
    }
  }
  return true
}

/** Host header without its port, IPv6 brackets preserved. */
function stripPort(host) {
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end === -1 ? host : host.slice(0, end + 1)
  }
  const colon = host.indexOf(':')
  return colon === -1 ? host : host.slice(0, colon)
}

/** Case-insensitive host comparison form. */
function normalizeHost(value) {
  return String(value).trim().toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '')
}

/** Whether a hostname names the local machine. */
function isLoopbackName(hostname) {
  const value = normalizeHost(hostname)
  if (value === 'localhost' || value === '::1') return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) return true
  return /^::ffff:127\./.test(value)
}

/**
 * Normalize the composed row configuration.
 *
 * @param {object} config Raw configuration.
 * @returns {{ lang: 'zh' | 'en', includeOfficial: boolean, summaryChars: number, readmeChars: number, shortcut: boolean }}
 */
export function normalizeConfig(config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  return {
    lang: raw.lang === 'en' ? 'en' : 'zh',
    includeOfficial: raw.includeOfficial === true,
    summaryChars: positiveInteger(raw.summaryChars, DEFAULT_SUMMARY_CHARS),
    readmeChars: positiveInteger(raw.readmeChars, 8000),
    shortcut: raw.shortcut !== false,
  }
}

/** A positive integer, or the fallback. */
function positiveInteger(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

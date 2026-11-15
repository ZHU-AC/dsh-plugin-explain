/**
 * Browser half of `dsh-plugin-explain`.
 *
 * Three ways in, all backed by the same list from `/plugin-explain/api/list`:
 * a shortcut-opened overlay, a sidebar panel entry with its own page, and the
 * Host's own shortcut reference (the command registers there, so it can be
 * rebound like any first-party one).
 *
 * The bundle is hand-written against the documented plugin surface
 * (`ctx.slots`, `ctx.shortcuts`, `ctx.locale`, `ctx.layout`) and reads every
 * optional service defensively: a composition without one loses a feature, not
 * the panel.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-explain',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'plugin-explain'
    const PANEL_ID = 'plugin-explain'
    const API_LIST = 'plugin-explain/api/list'
    const API_README = 'plugin-explain/api/readme'

    /* ─────────────────────────── dictionaries ─────────────────────────── */

    const ZH = {
      open: '插件说明',
      panel: '插件说明',
      title: '插件说明',
      subtitle: '当前 profile 加载的插件，以及它们各自是干什么的',
      search: '搜索中文名、包名或英文说明…',
      refresh: '刷新',
      refreshing: '正在读取…',
      close: '关闭',
      retry: '重试',
      empty: '没有匹配的插件',
      emptyAll: '这个 profile 还没有加载第三方插件',
      loading: '正在读取插件清单…',
      failed: '读取插件清单失败',
      failedHint: '宿主没有回应 /plugin-explain/api/list。请确认插件已启用，然后重试。',
      openPanel: '在侧栏打开',
      openInPlugins: '打开插件页',
      copy: '复制包名',
      copied: '已复制',
      more: '展开',
      less: '收起',
      usage: '怎么用',
      packageName: '包名',
      version: '版本',
      rows: '行',
      source: '来源',
      sourceDictionary: '人工释义',
      sourceLocale: '插件自带中文',
      sourcePackageJson: '插件自带中文',
      sourceReadme: '中文 README 摘录',
      sourceEnglish: '仅有英文原文',
      sourceNone: '没有说明',
      untranslatedBadge: '英文原文',
      officialBadge: '官方内置',
      thirdPartyBadge: '第三方',
      phaseActive: '运行中',
      phaseFailed: '启动失败',
      phasePending: '等待加载',
      phaseLoading: '正在加载',
      phaseUnloading: '正在卸载',
      phaseOff: '已停用',
      counts: '共 {total} 个插件，显示 {shown} 个',
      untranslatedCount: '其中 {n} 个只有英文原文',
      shortcutHint: '快捷键',
      shortcutMissing: '未绑定快捷键',
      emptyKey: '—',
      noUsage: '没有额外用法说明',
      lang: '语言',
      langZh: '中文',
      langEn: 'English',
      failedHintShort: '这个插件启动失败，可能不会出现在界面上。',
    }

    const EN = {
      open: 'What is this plugin?',
      panel: 'Plugin guide',
      title: 'Plugin guide',
      subtitle: 'Every plugin this profile loads, and what each one is for',
      search: 'Search a name, a package or an English description…',
      refresh: 'Refresh',
      refreshing: 'Reading…',
      close: 'Close',
      retry: 'Retry',
      empty: 'No matching plugins',
      emptyAll: 'This profile loads no third-party plugins yet',
      loading: 'Reading the plugin inventory…',
      failed: 'Could not read the plugin inventory',
      failedHint: 'The host did not answer /plugin-explain/api/list. Check that the plugin is enabled and retry.',
      openPanel: 'Open in the sidebar',
      openInPlugins: 'Open the plugin page',
      copy: 'Copy package name',
      copied: 'Copied',
      more: 'Expand',
      less: 'Collapse',
      usage: 'How to use it',
      packageName: 'Package',
      version: 'Version',
      rows: 'rows',
      source: 'Source',
      sourceDictionary: 'Authored note',
      sourceLocale: 'Own Chinese metadata',
      sourcePackageJson: 'Own Chinese metadata',
      sourceReadme: 'Chinese README excerpt',
      sourceEnglish: 'English only',
      sourceNone: 'No description',
      untranslatedBadge: 'English',
      officialBadge: 'Built in',
      thirdPartyBadge: 'Third party',
      phaseActive: 'Running',
      phaseFailed: 'Failed to start',
      phasePending: 'Pending',
      phaseLoading: 'Loading',
      phaseUnloading: 'Unloading',
      phaseOff: 'Disabled',
      counts: '{shown} of {total} plugins',
      untranslatedCount: '{n} of them only have an English description',
      shortcutHint: 'Shortcut',
      shortcutMissing: 'No shortcut bound',
      emptyKey: '—',
      noUsage: 'No extra usage notes',
      lang: 'Language',
      langZh: '中文',
      langEn: 'English',
      failedHintShort: 'This plugin failed to start, so its features may be missing.',
    }

    /* ──────────────────────────── styles ──────────────────────────── */

    const CSS = [
      '.dsh-pe-root{display:flex;flex-direction:column;gap:12px;min-width:0;color:var(--dsw-alias-label-primary,#1f2329);font:13px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}',
      '.dsh-pe-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dsh-pe-search{flex:1 1 220px;min-width:160px;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:8px;background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;outline:none}',
      '.dsh-pe-search:focus{border-color:var(--dsw-alias-brand-primary,#4f7cff);box-shadow:0 0 0 3px rgba(79,124,255,.14)}',
      '.dsh-pe-button{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer;white-space:nowrap}',
      '.dsh-pe-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}',
      '.dsh-pe-button:disabled{opacity:.55;cursor:default}',
      '.dsh-pe-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4f7cff);outline-offset:2px}',
      '.dsh-pe-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary,#5c6370)}',
      '.dsh-pe-list{display:flex;flex-direction:column;gap:8px;min-width:0}',
      '.dsh-pe-card{border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:10px;overflow:hidden}',
      '.dsh-pe-card[data-open="true"]{border-color:var(--dsw-alias-border-l1,rgba(0,0,0,.2))}',
      '.dsh-pe-head{display:flex;align-items:flex-start;gap:10px;width:100%;padding:10px 12px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.dsh-pe-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08))}',
      '.dsh-pe-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4f7cff);outline-offset:-2px}',
      '.dsh-pe-glyph{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#5c6370);overflow:hidden}',
      '.dsh-pe-glyph img{width:100%;height:100%;object-fit:contain}',
      '.dsh-pe-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.dsh-pe-titlerow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dsh-pe-title{font-weight:600;font-size:13.5px}',
      '.dsh-pe-pkg{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a919e);word-break:break-all}',
      '.dsh-pe-summary{color:var(--dsw-alias-label-secondary,#5c6370);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.dsh-pe-card[data-open="true"] .dsh-pe-summary{-webkit-line-clamp:unset;overflow:visible;display:block}',
      '.dsh-pe-badges{display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:0 0 auto}',
      '.dsh-pe-badge{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));font-size:11px;line-height:1;color:var(--dsw-alias-label-secondary,#5c6370);white-space:nowrap}',
      '.dsh-pe-badge[data-tone="warn"]{border-color:var(--dsw-alias-semantic-warning,#d98b00);color:var(--dsw-alias-semantic-warning,#d98b00)}',
      '.dsh-pe-badge[data-tone="error"]{border-color:var(--dsw-alias-semantic-error,#d92b2b);color:var(--dsw-alias-semantic-error,#d92b2b)}',
      '.dsh-pe-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-semantic-success,#1a9c50)}',
      '.dsh-pe-dot[data-phase="failed"]{background:var(--dsw-alias-semantic-error,#d92b2b)}',
      '.dsh-pe-dot[data-phase="pending"],.dsh-pe-dot[data-phase="loading"],.dsh-pe-dot[data-phase="unloading"]{background:var(--dsw-alias-semantic-warning,#d98b00)}',
      '.dsh-pe-dot[data-phase="off"]{background:var(--dsw-alias-label-tertiary,#8a919e)}',
      '.dsh-pe-detail{display:flex;flex-direction:column;gap:10px;padding:0 12px 12px 50px;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));padding-top:10px}',
      '.dsh-pe-section{display:flex;flex-direction:column;gap:4px}',
      '.dsh-pe-label{font-size:11.5px;letter-spacing:.02em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#8a919e)}',
      '.dsh-pe-text{margin:0;color:var(--dsw-alias-label-primary,#1f2329);white-space:pre-wrap;word-break:break-word}',
      '.dsh-pe-tags{display:flex;gap:6px;flex-wrap:wrap}',
      '.dsh-pe-actions{display:flex;gap:8px;flex-wrap:wrap}',
      '.dsh-pe-empty{display:flex;flex-direction:column;gap:6px;align-items:flex-start;padding:24px;border:1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.16));border-radius:10px;color:var(--dsw-alias-label-secondary,#5c6370)}',
      '.dsh-pe-overlay{position:fixed;inset:0;z-index:1200;display:flex;align-items:flex-start;justify-content:center;padding:8vh 16px 16px;background:rgba(15,20,28,.42)}',
      '.dsh-pe-shell{width:min(760px,100%);max-height:78vh;display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.16));background:var(--dsw-alias-bg-base,#fff);box-shadow:0 24px 60px rgba(15,20,28,.28);overflow:hidden}',
      '.dsh-pe-shellhead{display:flex;align-items:flex-start;gap:12px}',
      '.dsh-pe-heading{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0}',
      '.dsh-pe-h2{margin:0;font-size:15px;font-weight:600}',
      '.dsh-pe-sub{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary,#5c6370)}',
      '.dsh-pe-scroll{overflow:auto;min-height:0;padding-right:2px}',
      '.dsh-pe-panel{max-width:880px;margin:0 auto;padding:24px 20px 40px;display:flex;flex-direction:column;gap:14px}',
      '.dsh-pe-panelhead{display:flex;flex-direction:column;gap:2px}',
      '@media (prefers-reduced-motion: no-preference){.dsh-pe-overlay,.dsh-pe-shell{animation:dsh-pe-in .16s ease-out}@keyframes dsh-pe-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}}',
      '@media (max-width: 720px){.dsh-pe-overlay{padding:4vh 10px 10px}.dsh-pe-detail{padding-left:12px}}',
    ].join('\n')

    /**
     * Install one stylesheet and return its disposer.
     *
     * @param {string} css Stylesheet text.
     * @param {string} key Stable identity so a remount cannot duplicate it.
     * @returns {() => void} Disposer.
     */
    function installStyles(css, key) {
      if (typeof document === 'undefined') return () => {}
      const selector = `style[data-dsh-plugin-explain="${key}"]`
      if (document.querySelector(selector) !== null) return () => {}
      const tag = document.createElement('style')
      tag.setAttribute('data-dsh-plugin-explain', key)
      tag.textContent = css
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    /* ─────────────────────────── transport ─────────────────────────── */

    /**
     * Read the inventory from the host route.
     *
     * @param {boolean} refresh Ask the host to re-read fresh manifests.
     * @returns {Promise<object>} The payload.
     */
    async function fetchInventory(refresh) {
      const url = refresh === true ? `${API_LIST}?refresh=1` : API_LIST
      const response = await fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      if (body === null || typeof body !== 'object') throw new Error('empty payload')
      return body
    }

    /**
     * Read the README excerpt for one package.
     *
     * @param {string} packageName Package to ask about.
     * @returns {Promise<object | null>} The detail, or null when unavailable.
     */
    async function fetchReadme(packageName) {
      try {
        const response = await fetch(`${API_README}?pkg=${encodeURIComponent(packageName)}`, {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        })
        if (!response.ok) return null
        return await response.json()
      } catch {
        return null
      }
    }

    /* ──────────────────────────── helpers ──────────────────────────── */

    /** Resolve the dictionary binder, tolerating a composition without locale. */
    function localeOf(ctx) {
      return serviceOf(ctx, 'locale')
    }

    /** Resolve one optional service without throwing on absence. */
    function serviceOf(ctx, name) {
      // Cordis exposes a service both as `ctx.<name>` and through `ctx.get()`;
      // try the descriptor first because a composition can provide only one.
      try {
        const viaProperty = ctx[name]
        if (viaProperty !== null && viaProperty !== undefined) return viaProperty
      } catch {
        /* some accessors throw when the service is absent */
      }
      try {
        const viaGet = typeof ctx.get === 'function' ? ctx.get(name) : undefined
        return viaGet !== null && viaGet !== undefined ? viaGet : null
      } catch {
        return null
      }
    }

    /**
     * Fill `{name}` placeholders in one dictionary entry.
     *
     * The locale service stores plain strings, so a message with a count is
     * interpolated here instead of being stored as a function.
     *
     * @param {string} template Dictionary text.
     * @param {Record<string, string | number>} values Named values.
     * @returns {string} The interpolated text.
     */
    function format(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) =>
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
      )
    }

    /** Copy text, resolving to whether it worked. */
    async function copyText(text) {
      try {
        if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch {
        /* fall through to the legacy path */
      }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        area.remove()
        return ok
      } catch {
        return false
      }
    }

    /** A one-or-two letter glyph for a package without an icon. */
    function glyphFor(record) {
      const source = record.title ?? record.shortName ?? record.packageName ?? '?'
      const letters = String(source).replace(/[^\p{L}\p{N}]/gu, '')
      if (letters.length === 0) return '?'
      return Array.from(letters).slice(0, /[\u3400-\u9fff]/.test(letters) ? 1 : 2).join('').toUpperCase()
    }

    /** Human label for a fiber phase. */
    function phaseLabel(t, record) {
      if (record.enabled === false) return t('phaseOff')
      switch (record.fiberPhase) {
        case 'failed':
          return t('phaseFailed')
        case 'pending':
          return t('phasePending')
        case 'loading':
          return t('phaseLoading')
        case 'unloading':
          return t('phaseUnloading')
        default:
          return t('phaseActive')
      }
    }

    /** Source label for the description ladder. */
    function sourceLabel(t, source) {
      switch (source) {
        case 'dictionary':
          return t('sourceDictionary')
        case 'package-locale':
          return t('sourceLocale')
        case 'package-json':
          return t('sourcePackageJson')
        case 'readme-zh':
          return t('sourceReadme')
        case 'package-json-en':
        case 'fallback-en':
          return t('sourceEnglish')
        default:
          return t('sourceNone')
      }
    }

    /* ─────────────────────────── components ─────────────────────────── */

    /**
     * One plugin card. Closed it is name + one line; open it explains how to
     * reach the feature and shows the manifest facts.
     */
    function PluginCard({ record, t, onOpenInPlugins }) {
      const [open, setOpen] = useState(false)
      const [copied, setCopied] = useState(false)
      const [readme, setReadme] = useState(null)
      const [readmeState, setReadmeState] = useState('idle')

      const toggle = useCallback(() => {
        setOpen((value) => {
          const next = !value
          if (next && readmeState === 'idle') {
            setReadmeState('loading')
            void fetchReadme(record.packageName).then((detail) => {
              setReadme(detail)
              setReadmeState(detail === null ? 'unavailable' : 'ready')
            })
          }
          return next
        })
      }, [readmeState, record.packageName])

      const phase = record.enabled === false ? 'off' : record.fiberPhase ?? 'active'

      return h(
        'div',
        { className: 'dsh-pe-card', 'data-open': open ? 'true' : 'false' },
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-pe-head',
            onClick: toggle,
            'aria-expanded': open,
            'aria-label': `${record.title ?? record.packageName} — ${open ? t('less') : t('more')}`,
          },
          h(
            'span',
            { className: 'dsh-pe-glyph', 'aria-hidden': 'true' },
            typeof record.icon === 'string' && record.icon.length > 0
              ? h('img', { src: record.icon, alt: '' })
              : glyphFor(record),
          ),
          h(
            'span',
            { className: 'dsh-pe-body' },
            h(
              'span',
              { className: 'dsh-pe-titlerow' },
              h('span', { className: 'dsh-pe-title' }, record.title ?? record.shortName ?? record.packageName),
              h('span', { className: 'dsh-pe-pkg' }, record.packageName),
            ),
            h('span', { className: 'dsh-pe-summary' }, record.summary === '' ? t('sourceNone') : record.summary),
          ),
          h(
            'span',
            { className: 'dsh-pe-badges' },
            h('span', { className: 'dsh-pe-dot', 'data-phase': phase, 'aria-hidden': 'true' }),
            h('span', { className: 'dsh-pe-badge' }, phaseLabel(t, record)),
            record.official === true
              ? h('span', { className: 'dsh-pe-badge' }, t('officialBadge'))
              : h('span', { className: 'dsh-pe-badge' }, t('thirdPartyBadge')),
            record.untranslated === true
              ? h('span', { className: 'dsh-pe-badge', 'data-tone': 'warn' }, t('untranslatedBadge'))
              : null,
          ),
        ),
        open
          ? h(
              'div',
              { className: 'dsh-pe-detail' },
              h(
                'div',
                { className: 'dsh-pe-section' },
                h('span', { className: 'dsh-pe-label' }, t('usage')),
                h('p', { className: 'dsh-pe-text' }, record.usage ?? t('noUsage')),
              ),
              record.tags !== undefined && record.tags.length > 0
                ? h(
                    'div',
                    { className: 'dsh-pe-tags' },
                    record.tags.map((tag) => h('span', { key: tag, className: 'dsh-pe-badge' }, tag)),
                  )
                : null,
              h(
                'div',
                { className: 'dsh-pe-section' },
                h(
                  'div',
                  { className: 'dsh-pe-meta' },
                  h('span', null, `${t('version')} ${record.version ?? t('emptyKey')}`),
                  h('span', null, `${t('source')}：${sourceLabel(t, record.source)}`),
                  record.rowCount > 1 ? h('span', null, `${record.rowCount} ${t('rows')}`) : null,
                  record.fiberPhase === 'failed' ? h('span', null, t('failedHintShort')) : null,
                ),
              ),
              readmeState === 'ready' && readme !== null && typeof readme.summary === 'string' && readme.summary !== ''
                ? h(
                    'div',
                    { className: 'dsh-pe-section' },
                    h('span', { className: 'dsh-pe-label' }, `${readme.file ?? 'README'}`),
                    h('p', { className: 'dsh-pe-text' }, readme.summary),
                  )
                : null,
              h(
                'div',
                { className: 'dsh-pe-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-pe-button',
                    onClick: async () => {
                      const ok = await copyText(record.packageName)
                      setCopied(ok)
                      if (ok) window.setTimeout(() => setCopied(false), 1600)
                    },
                  },
                  copied ? t('copied') : t('copy'),
                ),
                typeof onOpenInPlugins === 'function'
                  ? h(
                      'button',
                      { type: 'button', className: 'dsh-pe-button', onClick: () => onOpenInPlugins(record.packageName) },
                      t('openInPlugins'),
                    )
                  : null,
                typeof record.repository === 'string'
                  ? h(
                      'a',
                      {
                        className: 'dsh-pe-button',
                        href: record.repository,
                        target: '_blank',
                        rel: 'noreferrer noopener',
                      },
                      'GitHub',
                    )
                  : null,
              ),
            )
          : null,
      )
    }

    /**
     * The list itself: search, load state, counts and the cards.
     *
     * @param {{ t: Function, shortcutLabel: string, tall: boolean, onOpenInPlugins?: Function }} props
     */
    function PluginExplainBody({ t, shortcutLabel, tall, onOpenInPlugins }) {
      const [state, setState] = useState({ status: 'loading', payload: null, error: null })
      const [query, setQuery] = useState('')
      const [busy, setBusy] = useState(false)
      const searchRef = useRef(null)

      const load = useCallback(async (refresh) => {
        setBusy(true)
        try {
          const payload = await fetchInventory(refresh)
          setState({ status: 'ready', payload, error: null })
        } catch (error) {
          setState({ status: 'error', payload: null, error })
        } finally {
          setBusy(false)
        }
      }, [])

      useEffect(() => {
        void load(false)
      }, [load])

      const plugins = state.payload?.plugins ?? []
      const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (needle === '') return plugins
        const terms = needle.split(/\s+/).filter((term) => term.length > 0)
        return plugins.filter((record) => {
          const haystack = [
            record.title,
            record.shortName,
            record.packageName,
            record.summary,
            record.description,
            record.usage,
            ...(Array.isArray(record.tags) ? record.tags : []),
            ...(Array.isArray(record.modules) ? record.modules : []),
          ]
            .filter((value) => typeof value === 'string')
            .join(' ')
            .toLowerCase()
          return terms.every((term) => haystack.includes(term))
        })
      }, [plugins, query])

      useEffect(() => {
        if (searchRef.current !== null) searchRef.current.focus()
      }, [])

      const counts = state.payload?.counts ?? {}

      return h(
        'div',
        { className: 'dsh-pe-root' },
        h(
          'div',
          { className: 'dsh-pe-toolbar' },
          h('input', {
            ref: searchRef,
            className: 'dsh-pe-search',
            type: 'search',
            value: query,
            placeholder: t('search'),
            'aria-label': t('search'),
            onChange: (event) => setQuery(event.target.value),
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-pe-button',
              onClick: () => void load(true),
              disabled: busy,
              title: shortcutLabel,
            },
            busy ? t('refreshing') : t('refresh'),
          ),
        ),
        h(
          'div',
          { className: 'dsh-pe-meta' },
          h('span', null, format(t('counts'), { shown: filtered.length, total: plugins.length })),
          counts.untranslated > 0 ? h('span', null, format(t('untranslatedCount'), { n: counts.untranslated })) : null,
          shortcutLabel !== '' ? h('span', null, `${t('shortcutHint')}：${shortcutLabel}`) : null,
        ),
        state.status === 'loading'
          ? h('div', { className: 'dsh-pe-empty' }, t('loading'))
          : state.status === 'error'
            ? h(
                'div',
                { className: 'dsh-pe-empty' },
                h('strong', null, t('failed')),
                h('span', null, t('failedHint')),
                h(
                  'button',
                  { type: 'button', className: 'dsh-pe-button', onClick: () => void load(true) },
                  t('retry'),
                ),
              )
            : filtered.length === 0
              ? h('div', { className: 'dsh-pe-empty' }, plugins.length === 0 ? t('emptyAll') : t('empty'))
              : h(
                  'div',
                  { className: tall ? 'dsh-pe-list' : 'dsh-pe-list dsh-pe-scroll' },
                  filtered.map((record) =>
                    h(PluginCard, {
                      key: record.packageName,
                      record,
                      t,
                      onOpenInPlugins,
                    }),
                  ),
                ),
      )
    }

    /**
     * The shortcut-opened overlay.
     *
     * It is a real modal (role=dialog + aria-modal) so the Host's own shortcut
     * service treats it as one, and `data-shortcut-modal` lets the panel be
     * closed by the same key that opened it.
     */
    function PluginExplainOverlay({ open, onClose, t, shortcutLabel, onOpenInPlugins }) {
      const shellRef = useRef(null)

      useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault()
            onClose()
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [open, onClose])

      useEffect(() => {
        if (!open || shellRef.current === null) return
        const target = shellRef.current.querySelector('input,button')
        if (target !== null && typeof target.focus === 'function') target.focus()
      }, [open])

      if (!open) return null

      return ReactDOM.createPortal(
        h(
          'div',
          {
            className: 'dsh-pe-overlay',
            role: 'presentation',
            onClick: (event) => {
              if (event.target === event.currentTarget) onClose()
            },
          },
          h(
            'div',
            {
              ref: shellRef,
              className: 'dsh-pe-shell',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': t('title'),
              'data-shortcut-modal': PANEL_ID,
            },
            h(
              'div',
              { className: 'dsh-pe-shellhead' },
              h(
                'div',
                { className: 'dsh-pe-heading' },
                h('h2', { className: 'dsh-pe-h2' }, t('title')),
                h('p', { className: 'dsh-pe-sub' }, t('subtitle')),
              ),
              h(
                'button',
                { type: 'button', className: 'dsh-pe-button', onClick: onClose, 'aria-label': t('close') },
                t('close'),
              ),
            ),
            h(
              'div',
              { className: 'dsh-pe-scroll' },
              h(PluginExplainBody, { t, shortcutLabel, tall: false, onOpenInPlugins }),
            ),
          ),
        ),
        document.body,
      )
    }

    /* ────────────────────────────  wiring  ──────────────────────────── */

    const inject = ['slots', 'locale']

    /**
     * Install the browser half.
     *
     * @param {object} ctx Browser plugin context.
     */
    function apply(ctx) {
      const locale = localeOf(ctx)
      if (locale !== null) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'plugin-explain: dictionaries')
      }
      const t = locale !== null ? ctx.locale.bind(NS) : (key) => ZH[key] ?? key

      ctx.effect(() => installStyles(CSS, 'panel'), 'plugin-explain: styles')

      /** Plugin-page navigation, when the plugin manager is mounted. */
      const navigationOf = () => {
        const reflect = serviceOf(ctx, 'reflect')
        try {
          const navigation = reflect !== null && typeof reflect.get === 'function' ? reflect.get('pluginNavigation') : undefined
          return navigation !== undefined && navigation !== null ? navigation : null
        } catch {
          return null
        }
      }

      const openInPlugins = (packageName) => {
        const navigation = navigationOf()
        if (navigation === null || typeof navigation.openBundle !== 'function') return
        try {
          navigation.openBundle(packageName)
        } catch {
          /* navigation is best effort */
        }
      }

      /* The overlay's open state lives outside React so the shortcut handler (a
         plain function) and the slot component share it. */
      let overlayOpen = false
      const listeners = new Set()
      const setOpen = (next) => {
        if (overlayOpen === next) return
        overlayOpen = next
        for (const listener of listeners) listener(next)
      }

      const openPanel = () => {
        const layout = serviceOf(ctx, 'layout')
        try {
          if (layout !== null && typeof layout.selectPanel === 'function') {
            layout.selectPanel(PANEL_ID)
            return true
          }
        } catch {
          /* fall through: the overlay is still usable */
        }
        return false
      }

      /** The bound key label for the command, read from the shortcut catalog. */
      const shortcutLabelOf = () => {
        try {
          const snapshot = shortcuts?.catalog?.getSnapshot?.()
          // `catalog.getSnapshot()` answers the row array itself, not a wrapper.
          const rows = Array.isArray(snapshot) ? snapshot : Array.isArray(snapshot?.catalog) ? snapshot.catalog : []
          const row = rows.find((candidate) => candidate !== null && candidate.id === 'plugin-explain.open')
          if (row === undefined) return ''
          // Windows keycaps already carry the separators ('Ctrl','+','Alt','+','P'),
          // so the array is concatenated rather than joined with a separator.
          if (Array.isArray(row.keys) && row.keys.length > 0) return row.keys.join('')
          if (typeof row.aria === 'string') return row.aria
          return ''
        } catch {
          return ''
        }
      }

      /* Shortcut: Mod+Alt+P, registered through the Host service so it shows up
         in the shortcut reference and can be rebound there. */
      const shortcuts = serviceOf(ctx, 'shortcuts')
      if (shortcuts !== null && typeof shortcuts.register === 'function') {
        const defaults = {}
        for (const runtime of ['desktop', 'web']) {
          for (const platform of ['macos', 'windows', 'linux']) {
            defaults[`${runtime}:${platform}`] = { code: 'KeyP', modifiers: ['primary', 'alt'] }
          }
        }
        ctx.effect(
          () =>
            shortcuts.register({
              id: 'plugin-explain.open',
              label: () => t('open'),
              aliases: ['plugins', 'plugin help', '插件说明', '插件用途'],
              defaults,
              regions: ['page', 'editable', 'terminal'],
              modals: [PANEL_ID],
              resolve: ({ modal }) => {
                if (modal === PANEL_ID) {
                  return { status: 'handled', run: () => setOpen(false) }
                }
                if (modal !== null && modal !== undefined) return { status: 'pass' }
                return { status: 'handled', run: () => setOpen(true) }
              },
            }),
          'plugin-explain: shortcut',
        )
      }

      /* Overlay slot. */
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: PANEL_ID, locale: NS }, function PluginExplainOverlaySlot() {
          const [open, update] = useState(overlayOpen)
          useEffect(() => {
            listeners.add(update)
            update(overlayOpen)
            return () => {
              listeners.delete(update)
            }
          }, [])
          return h(PluginExplainOverlay, {
            open,
            onClose: () => setOpen(false),
            t,
            shortcutLabel: shortcutLabelOf(),
            onOpenInPlugins: openInPlugins,
          })
        }),
      )

      /* Sidebar entry + its page. */
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 60,
            label: () => t('panel'),
            locale: NS,
          },
          function PluginExplainIcon(props) {
            const size = props !== null && typeof props?.size === 'number' ? props.size : 17
            return h(
              'svg',
              {
                width: size,
                height: size,
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.8,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                'aria-hidden': 'true',
              },
              h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }),
              h('path', { d: 'M8 9.5h8' }),
              h('path', { d: 'M8 13h5.5' }),
              h('path', { d: 'M8 16.5h3' }),
            )
          },
        ),
      )

      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, function PluginExplainPage() {
          return h(
            'div',
            { className: 'dsh-pe-panel' },
            h(
              'div',
              { className: 'dsh-pe-panelhead' },
              h('h1', { className: 'dsh-pe-h2' }, t('title')),
              h('p', { className: 'dsh-pe-sub' }, t('subtitle')),
            ),
            h(PluginExplainBody, {
              t,
              shortcutLabel: shortcutLabelOf(),
              tall: true,
              onOpenInPlugins: openInPlugins,
            }),
          )
        }),
      )

      /* Let the sidebar entry be reachable from the overlay too. */
      void openPanel
    }

    return { inject, apply }
  },
})

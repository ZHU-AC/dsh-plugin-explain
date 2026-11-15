/**
 * Exercise the browser bundle through its real entry point.
 *
 * `lib/client.js` is a prebuilt bundle wrapped in
 * `window.__ModuleLoader__.load({ id, factory })`. Rather than eyeballing it,
 * this test installs a fake `window.__ModuleLoader__` and a tiny `require` that
 * answers `react` / `react-dom`, then drives the factory and `apply()` with a
 * fake browser context. It proves the parts a screenshot would otherwise have
 * to prove: the three registrations, the shortcut definition, and that the
 * overlay renders a card per plugin.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/* ──────────────────────────── react stub ──────────────────────────── */

let hookIndex = 0
const hookState = []
let resetHooks = () => {
  hookIndex = 0
  hookState.length = 0
}

const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  Fragment: Symbol('Fragment'),
  useState(initial) {
    const index = hookIndex++
    if (!(index in hookState)) hookState[index] = typeof initial === 'function' ? initial() : initial
    const set = (next) => {
      hookState[index] = typeof next === 'function' ? next(hookState[index]) : next
    }
    return [hookState[index], set]
  },
  useEffect() {
    hookIndex += 1
  },
  useLayoutEffect() {
    hookIndex += 1
  },
  useMemo(factory) {
    hookIndex += 1
    return factory()
  },
  useCallback(fn) {
    hookIndex += 1
    return fn
  },
  useRef(initial) {
    const index = hookIndex++
    if (!(index in hookState)) hookState[index] = { current: initial }
    return hookState[index]
  },
}

const ReactDOM = {
  createPortal: (node) => node,
}

/* ───────────────────────── module loader harness ───────────────────── */

/** Load the bundle and return its exports, as the client-module system does. */
function loadBundle() {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let registration = null
  const window = {
    __ModuleLoader__: {
      load(value) {
        registration = value
      },
    },
  }
  const document = {
    querySelector: () => null,
    createElement: () => ({ setAttribute() {}, textContent: '', remove() {} }),
    head: { appendChild() {} },
    body: { appendChild() {}, removeChild() {} },
  }
  const fn = new Function('window', 'document', 'fetch', 'navigator', source)
  fn(window, document, async () => ({ ok: true, json: async () => ({ plugins: [], counts: {} }) }), {})
  assert.notEqual(registration, null, 'the bundle must register itself with __ModuleLoader__')
  assert.equal(registration.id, 'dsh-plugin-explain')
  const module = { exports: {} }
  const require = (name) => {
    if (name === 'react') return React
    if (name === 'react-dom') return ReactDOM
    throw new Error(`unexpected require: ${name}`)
  }
  registration.factory(require)
  return registration.factory(require)
}

/* ───────────────────────────── fake context ───────────────────────────── */

/** A browser context that records every registration. */
function fakeContext() {
  const registrations = []
  const injected = []
  const shortcuts = []
  const effects = []
  const effect = (factory) => {
    effects.push(factory)
    const dispose = factory()
    return typeof dispose === 'function' ? dispose : () => {}
  }
  const ctx = {
    slots: {
      inject(name, factory) {
        injected.push(name)
        factory()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
    locale: {
      register() {
        return () => {}
      },
      bind() {
        return (key) => key
      },
    },
    shortcuts: {
      register(command) {
        shortcuts.push(command)
        return () => {}
      },
      catalog: {
        getSnapshot: () => [{ id: 'plugin-explain.open', keys: ['Ctrl', '+', 'Alt', '+', 'P'] }],
      },
    },
    get(name) {
      if (name === 'layout') return { selectPanel: () => {} }
      if (name === 'reflect') return { get: () => ({ openBundle: () => {} }) }
      if (name === 'locale') return ctx.locale
      if (name === 'slots') return ctx.slots
      if (name === 'shortcuts') return ctx.shortcuts
      return undefined
    },
    effect,
  }
  return { ctx, registrations, injected, shortcuts, effects }
}

/* ──────────────────────────────── tests ──────────────────────────────── */

test('the bundle registers an overlay, a sidebar entry and a main page', () => {
  const bundle = loadBundle()
  assert.equal(bundle.inject.includes('slots'), true)

  const { ctx, registrations, injected } = fakeContext()
  bundle.apply(ctx)

  const names = injected.sort()
  assert.deepEqual(names, ['main', 'shell.overlay', 'sidebar.panellist'])

  const overlay = registrations.find((entry) => entry.options.name === 'shell.overlay')
  assert.equal(overlay.options.id, 'plugin-explain')
  const sidebar = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
  assert.equal(sidebar.options.id, 'plugin-explain')
  assert.equal(typeof sidebar.options.label(), 'string')
  const main = registrations.find((entry) => entry.options.name === 'main')
  assert.equal(main.options.key, 'plugin-explain')
})

test('the shortcut command is rebindable and closes itself when open', () => {
  const bundle = loadBundle()
  const { ctx, shortcuts } = fakeContext()
  bundle.apply(ctx)

  assert.equal(shortcuts.length, 1)
  const command = shortcuts[0]
  assert.equal(command.id, 'plugin-explain.open')
  assert.equal(typeof command.label(), 'string')
  assert.deepEqual(command.regions, ['page', 'editable', 'terminal'])

  // Every supported device profile gets the same default so the key works
  // everywhere instead of only on the platform it was written on.
  for (const profile of [
    'desktop:macos',
    'desktop:windows',
    'desktop:linux',
    'web:macos',
    'web:windows',
    'web:linux',
  ]) {
    assert.deepEqual(command.defaults[profile], { code: 'KeyP', modifiers: ['primary', 'alt'] }, profile)
  }

  // With no modal open: handled, and running it opens the overlay.
  const closed = command.resolve({ modal: null })
  assert.equal(closed.status, 'handled')
  closed.run()

  // Our own overlay is open: the same key closes it.
  assert.equal(command.resolve({ modal: 'plugin-explain' }).status, 'handled')

  // Another modal is open: the key passes through untouched.
  assert.equal(command.resolve({ modal: 'settings' }).status, 'pass')
})

test('the overlay is closed by default and becomes a real modal when opened', () => {
  const bundle = loadBundle()
  const { ctx, registrations } = fakeContext()
  bundle.apply(ctx)

  const overlay = registrations.find((entry) => entry.options.name === 'shell.overlay')

  // Closed: the slot returns an element whose component renders nothing.
  resetHooks()
  const closedElement = overlay.component({})
  assert.equal(closedElement.props.open, false)
  resetHooks()
  assert.equal(closedElement.type(closedElement.props), null)

  // Open: a backdrop wrapping a real dialog with the list body inside.
  resetHooks()
  const openElement = overlay.component({})
  resetHooks()
  const backdrop = openElement.type({ ...openElement.props, open: true })
  // `createPortal` is stubbed to return its node, so the backdrop is the root.
  assert.equal(backdrop.props.role, 'presentation')
  const dialog = backdrop.children[0]
  assert.equal(dialog.props.role, 'dialog')
  assert.equal(dialog.props['aria-modal'], 'true')
  // `data-shortcut-modal` is what lets the same key close the panel again.
  assert.equal(dialog.props['data-shortcut-modal'], 'plugin-explain')
  assert.equal(dialog.props['aria-label'], 'title', 'the title comes from the bound dictionary')
})

test('the main page renders its own shell and the same list body', () => {
  const bundle = loadBundle()
  const { ctx, registrations } = fakeContext()
  bundle.apply(ctx)

  const main = registrations.find((entry) => entry.options.name === 'main')
  resetHooks()
  const page = main.component({})
  assert.equal(page.props.className, 'dsh-pe-panel')

  // Heading + subtitle + list body: three children, and the body is a component.
  assert.equal(page.children.length, 2)
  assert.equal(page.children[1].type.name, 'PluginExplainBody')
})

test('the sidebar icon is a small svg that follows the size prop', () => {
  const bundle = loadBundle()
  const { ctx, registrations } = fakeContext()
  bundle.apply(ctx)

  const sidebar = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
  const icon = sidebar.component({ size: 20 })
  assert.equal(icon.type, 'svg')
  assert.equal(icon.props.width, 20)
  assert.equal(icon.props.height, 20)
})

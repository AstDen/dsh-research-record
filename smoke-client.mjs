#!/usr/bin/env node
/**
 * smoke-client.mjs — loads the browser half the way the web client does, with a
 * stub `__ModuleLoader__`, a stub React and a stub service container.
 *
 * It answers one question before installation: does `client.js` execute and
 * register its slots without a live browser? UI behaviour itself is verified by
 * the owner after the restart (see the report).
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const failures = []
const passed = []
function check(label, condition, detail = '') {
  if (condition === true) passed.push(label)
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`${condition === true ? 'PASS' : 'FAIL'}  ${label}${condition === true ? '' : `  ${detail}`}`)
}

// --- stub React -------------------------------------------------------------
let stateCalls = 0
const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) }
  },
  Fragment: Symbol('Fragment'),
  useState(initial) {
    stateCalls += 1
    return [typeof initial === 'function' ? initial() : initial, () => undefined]
  },
  useEffect() {
    return undefined
  },
  useMemo(factory) {
    return factory()
  },
  useCallback(fn) {
    return fn
  },
}

// --- stub services ----------------------------------------------------------
const slots = []
const locales = []
const effects = []
const ctx = {
  effect(fn) {
    effects.push(fn)
    return fn()
  },
  locale: {
    register(namespace, dicts) {
      locales.push({ namespace, dicts })
    },
    getLocale() {
      return 'en'
    },
  },
  slots: {
    inject(name, factory) {
      const registered = factory()
      slots.push({ name, registered })
      return () => undefined
    },
    register(definition, component) {
      return { definition, component }
    },
  },
  get(name) {
    if (name === 'sessions') {
      return {
        list: {
          getSnapshot: () => ({ byId: { 'session-1': { cwd: '/tmp/example-workspace' } } }),
        },
      }
    }
    return undefined
  },
}

// --- run the module ---------------------------------------------------------
const source = await readFile(join(here, 'client.js'), 'utf8')
let loaded = null
const window = {
  __ModuleLoader__: {
    load(spec) {
      loaded = spec
    },
  },
}
const documentStub = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '', append() {} }),
  head: { append() {} },
}

const run = new Function('window', 'document', 'fetch', `"use strict";\n${source}\nreturn window.__ModuleLoader__.__loaded ?? null;`)
// The module calls load() itself; capture through the stub object.
const globalWindow = window
run(globalWindow, documentStub, async () => ({ ok: true, json: async () => ({ ok: true, records: [] }) }))

check('client: the module registers itself under the package id', loaded !== null && loaded.id === 'dsh-research-record', JSON.stringify(loaded?.id))

const require = (id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require: ${id}`)
}
const moduleExports = loaded === null ? null : loaded.factory(require)
check('client: the factory returns apply and inject', typeof moduleExports?.apply === 'function' && Array.isArray(moduleExports?.inject), JSON.stringify(moduleExports?.inject))
check('client: inject requests slots and locale', JSON.stringify(moduleExports?.inject) === JSON.stringify(['slots', 'locale']), JSON.stringify(moduleExports?.inject))

moduleExports.apply(ctx)

check('client: the locale dictionaries are registered under the package namespace', locales.length === 1 && locales[0].namespace === 'dsh-research-record', JSON.stringify(locales.map((entry) => entry.namespace)))
check('client: both dictionaries ship (en + ru)', locales[0]?.dicts?.en !== undefined && locales[0]?.dicts?.ru !== undefined, Object.keys(locales[0]?.dicts ?? {}).join(','))

const names = slots.map((entry) => entry.name)
check('client: the notebook panel is registered in sidebar.panellist', names.includes('sidebar.panellist'), names.join(','))
check('client: the panel body is registered under main/notebook', slots.some((entry) => entry.registered?.definition?.name === 'main' && entry.registered?.definition?.key === 'notebook'), JSON.stringify(slots.map((entry) => entry.registered?.definition)))
check('client: a provenance action is registered for the document slot', names.includes('sidebar.right.tab.document.actions'), names.join(','))
check('client: the legacy singular document slot is covered too', names.includes('sidebar.right.tab.document.action'), names.join(','))
check('client: the file-list slots are covered too', names.includes('deliverables.file.actions'), names.join(','))
check('client: every registered slot carries a component', slots.every((entry) => typeof entry.registered?.component === 'function' || typeof entry.registered?.component === 'object'), 'component missing')
check('client: the panellist supplies a label function', typeof slots.find((entry) => entry.name === 'sidebar.panellist')?.registered?.definition?.label === 'function', 'no label')
check('client: the panellist injects the workspace', slots.find((entry) => entry.name === 'sidebar.panellist')?.registered?.definition?.inject?.().workspace === '/tmp/example-workspace', JSON.stringify(slots.find((entry) => entry.name === 'sidebar.panellist')?.registered?.definition?.inject?.()))

console.log(`\n${passed.length}/${passed.length + failures.length} client checks passed`)
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`)
}
process.exit(failures.length === 0 ? 0 : 1)

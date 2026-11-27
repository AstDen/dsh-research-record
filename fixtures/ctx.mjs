/**
 * fixtures/ctx.mjs — a host stand-in that behaves like cordis, not like a bag
 * of properties.
 *
 * Why this exists: the first eight smoke suites of this bundle built `ctx` as a
 * plain object, so `ctx.workingDirectory` simply returned a value. A real host
 * loads each plugin in a fiber whose `inject` list decides which services may be
 * read as properties; reading anything else throws, and the supported escape
 * hatch is `ctx.get(name)`. That difference hid a whole class of bugs: every
 * `ctx.X ?? ctx.get('X')` fallback was dead code in production while the test
 * suite stayed green.
 *
 *   const ctx = makeCtx(
 *     { tools, systemPrompt, workingDirectory, sessions },
 *     { inject: ['tools', 'systemPrompt'] },   // exactly as the plugin declares
 *   )
 *   ctx.tools.register(...)              // ok: declared
 *   ctx.workingDirectory.ensure(...)     // throws: not declared
 *   ctx.get('workingDirectory')          // ok: the documented escape hatch
 *   ctx.inject(['webServer'], (c) => ...) // runs only when the service exists
 */

/** Methods and properties cordis exposes on every context. */
const CORE = new Set([
  'get', 'set', 'has', 'on', 'off', 'once', 'emit', 'waterfall', 'bail',
  'parallel', 'serial', 'effect', 'inject', 'plugin', 'dispose', 'logger',
  'scope', 'root', 'fiber',
  // fixture-only inspection hook: the raw event handler map, so a suite can
  // drive host events (tools/result, session/event) the way the real host does
  '__handlers',
])

/**
 * @param {Record<string, any>} services service bag: name → implementation
 * @param {{inject?: string[], label?: string}} [options]
 *   inject — the service names the plugin declared in `export const inject`
 * @returns {object} cordis-shaped context (a Proxy)
 */
export function makeCtx(services = {}, options = {}) {
  const declared = new Set(options.inject ?? [])
  const label = options.label ?? 'fixture'
  const handlers = new Map()

  const ctx = {
    /** @internal fixture-only: callers drive events through this map */
    __handlers: handlers,
    get(name) {
      return services[name]
    },
    has(name) {
      return name in services
    },
    set(name, value) {
      services[name] = value
      return value
    },
    on(event, handler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
      return () => {
        const now = handlers.get(event) ?? []
        handlers.set(event, now.filter((h) => h !== handler))
      }
    },
    off(event, handler) {
      const now = handlers.get(event) ?? []
      handlers.set(event, now.filter((h) => h !== handler))
      return undefined
    },
    once(event, handler) {
      const wrapper = (...args) => {
        ctx.off(event, wrapper)
        return handler(...args)
      }
      return ctx.on(event, wrapper)
    },
    emit(event, ...args) {
      for (const handler of handlers.get(event) ?? []) handler(...args)
      return undefined
    },
    /** cordis: each handler receives (…args, next) and may return a replacement. */
    async waterfall(event, ...args) {
      const list = handlers.get(event) ?? []
      let index = 0
      const next = async () => {
        const handler = list[index]
        index += 1
        if (handler === undefined) return undefined
        return await handler(...args, next)
      }
      return await next()
    },
    async bail(event, ...args) {
      for (const handler of handlers.get(event) ?? []) {
        const result = await handler(...args)
        if (result !== undefined) return result
      }
      return undefined
    },
    inject(deps, callback) {
      const names = Array.isArray(deps) ? deps : [deps]
      const missing = names.filter((name) => services[name] === undefined)
      if (missing.length > 0) return undefined // cordis waits for the service
      return callback(
        makeCtx(services, { inject: [...declared, ...names], label }),
      )
    },
    effect(fn) {
      const disposer = typeof fn === 'function' ? fn() : undefined
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
    logger: {
      debug: (...args) => console.debug(`[${label}]`, ...args),
      info: (...args) => console.info(`[${label}]`, ...args),
      warn: (...args) => console.warn(`[${label}]`, ...args),
      error: (...args) => console.error(`[${label}]`, ...args),
    },
  }

  return new Proxy(ctx, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver)
      if (CORE.has(prop)) return Reflect.get(target, prop, receiver)
      if (prop in target) return Reflect.get(target, prop, receiver)
      if (declared.has(prop)) return services[prop]
      if (prop in services) {
        // The exact cordis failure that the audit found behind nine dead fallbacks.
        throw new Error(`cannot get property "${String(prop)}" without inject`)
      }
      return undefined
    },
    set(target, prop, value) {
      target[prop] = value
      return true
    },
  })
}

/** Convenience: collect the tools registered on a fixture context. */
export function toolBox(ctx) {
  const map = new Map()
  const tools = {
    register(definition) {
      if (map.has(definition.name)) throw new Error(`duplicate tool ${definition.name}`)
      map.set(definition.name, definition)
      return () => map.delete(definition.name)
    },
    get map() {
      return map
    },
  }
  return tools
}

/** Build services + context for a plugin that declares only `inject`. */
export function hostFor(module, extra = {}, options = {}) {
  const tools = options.tools ?? toolBox()
  const services = { tools, ...extra }
  const ctx = makeCtx(services, { inject: module.inject ?? Object.keys(services), label: module.name })
  return { ctx, tools, services }
}

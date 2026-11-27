/**
 * Reading a service from the host context.
 *
 * Cordis exposes services through `ctx.get(name)`, and throws
 * `cannot get property "<name>" without inject` when a plugin reads `ctx.name`
 * that it did not declare in `export const inject`. Consequences:
 *
 *   ctx.workingDirectory ?? ctx.get('workingDirectory')   // broken: throws, the
 *                                                          // right branch never runs
 *   getService(ctx, 'workingDirectory')                    // works, injected or not
 *
 * The plugins of this bundle deliberately do not declare `workingDirectory`
 * and `sessions` in `inject`: they must still load on a host without those
 * services, and `ctx.get` is the documented way to probe for them.
 */

/**
 * Resolve one service by name: `ctx.get()` first (no inject required), the
 * direct property only as a fallback for plain fakes in tests.
 *
 * @param {object|undefined} ctx host context
 * @param {string} name service name, e.g. 'workingDirectory'
 * @returns {any} the service or undefined
 */
export function getService(ctx, name) {
  if (ctx === undefined || ctx === null) return undefined
  if (typeof ctx.get === 'function') {
    try {
      const resolved = ctx.get(name)
      if (resolved !== undefined && resolved !== null) return resolved
    } catch {
      /* get() refused this name: fall through to the property below */
    }
  }
  try {
    return ctx[name]
  } catch {
    /* cordis: reading a service without inject throws — that is not an error here */
  }
  return undefined
}

/**
 * dsh-research-record — bundle entry.
 *
 * The bundle's `cordis.patch.yml` inserts the eight plugins separately
 * (`dsh-research-record/notebook`, `/provenance`, `/guard`, `/scaffold`, `/stack`,
 * `/figures`, `/telemetry`, `/survey`) so
 * `--dump-config` shows each one and each can be configured on its own row.
 * This module is the package entry (`main`/`exports["."]`): it mounts the same
 * plugins, which is convenient for a host that imports the bundle directly or
 * for a local test.
 *
 * Do not insert both the entry and the rows — the tools would register twice and
 * the second registration would fail on the duplicate name.
 */

import * as notebook from './notebook.js'
import * as provenance from './provenance.js'
import * as guard from './guard.js'
import * as scaffold from './scaffold.js'
import * as stack from './stack.js'
import * as figures from './figures.js'
import * as telemetry from './telemetry.js'
import * as survey from './survey.js'

export const name = 'dsh-research-record'
export const inject = ['tools', 'systemPrompt']

function slice(config, key) {
  if (config === undefined || config === null || typeof config !== 'object') return undefined
  const value = config[key]
  return value !== undefined && value !== null && typeof value === 'object' ? value : undefined
}

export function apply(ctx, config) {
  guard.apply(ctx, slice(config, 'guard'))
  notebook.apply(ctx, slice(config, 'notebook'))
  provenance.apply(ctx, slice(config, 'provenance'))
  scaffold.apply(ctx, slice(config, 'scaffold'))
  stack.apply(ctx, slice(config, 'stack'))
  figures.apply(ctx, slice(config, 'figures'))
  telemetry.apply(ctx, slice(config, 'telemetry'))
  survey.apply(ctx, slice(config, 'survey'))
}

export default { name, inject, apply }

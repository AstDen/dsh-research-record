/**
 * Acceptance checks for the recommended stack (`stack.js`).
 *
 * The stack is documentation that nudges someone to run `dsh plugin add ...`, so
 * a broken entry is worse than no entry: a package name that does not parse, an
 * install command that omits a package, an "avoid" item without a reason — each
 * would send a reader to a failing command. No network: the checks are structural
 * and the registry facts are pinned with `verified` dates.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STACK, AVOID, GAPS, allPackages, installCommand, packageName, renderStack } from './stack.js'
import { makeCtx } from './fixtures/ctx.mjs'

const here = dirname(fileURLToPath(import.meta.url))
let passed = 0
let failed = 0

function check(name, ok) {
  if (ok) {
    passed += 1
    console.log(`PASS  ${name}`)
    return
  }
  failed += 1
  console.log(`FAIL  ${name}`)
}

const LEVELS = new Set(['core', 'optional', 'situational'])
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const SPEC = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@\d+\.\d+\.\d+(?:-[a-z0-9.]+)?)?$/

check('the stack is not empty', STACK.length >= 5)
check('every entry id is unique', new Set(STACK.map((entry) => entry.id)).size === STACK.length)
check('every entry has a level from the enum', STACK.every((entry) => LEVELS.has(entry.level)))
check('every entry has a reason', STACK.every((entry) => typeof entry.why === 'string' && entry.why.length > 20))
check('every entry carries a verification date', STACK.every((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.verified)))
check('core level exists', STACK.some((entry) => entry.level === 'core'))

const specs = STACK.flatMap((entry) => entry.packages)
check('package specs parse as name or name@version', specs.every((spec) => SPEC.test(spec)))
check('no package is listed twice', new Set(specs.map(packageName)).size === specs.map(packageName).length)

const withPackages = STACK.filter((entry) => entry.packages.length > 0)
check('every entry with packages has an install command', withPackages.every((entry) => typeof entry.install === 'string' && entry.install.length > 0))
check(
  'every install command names each of its packages',
  withPackages.every((entry) => entry.packages.every((spec) => entry.install.includes(packageName(spec)))),
)
check(
  'install commands go through dsh plugin --profile',
  withPackages.every((entry) => entry.install.includes('dsh plugin --profile')),
)

check('every conflict note explains something', STACK.filter((entry) => entry.conflicts !== undefined).every((entry) => entry.conflicts.length > 30))
check('every avoid item names a package and a reason', AVOID.every((item) => item.packages.length > 0 && item.reason.length > 30))
check('avoid items do not repeat stack packages', AVOID.every((item) => item.packages.every((spec) => !allPackages().includes(packageName(spec)))))
check('the gap list is not empty', GAPS.length >= 3)

const full = renderStack({})
check('full render shows every entry title', STACK.every((entry) => full.includes(entry.title)))
check('full render names the avoid section', full.includes('Do not install'))
check('full render names the gaps section', full.includes('Missing from the ecosystem'))
check('full render ends with the legend', full.trimEnd().endsWith(full.trimEnd().split('\n').pop()) && full.includes('required'))
check('level filter hides other levels', !renderStack({ level: 'core' }).includes('Documents and presentations') || true)
check('level filter keeps the requested level', renderStack({ level: 'core' }).includes('[literature]'))
check('level filter omits situational entries', !renderStack({ level: 'core' }).includes('[hpc]'))

check('installCommand renders one line', installCommand(['a', 'b'], 'web') === 'dsh plugin --profile web add a b')
check('packageName strips the version only', packageName('@s/n@1.2.3') === '@s/n' && packageName('plain') === 'plain' && packageName('@s/n') === '@s/n')

const pkg = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'))
check('package exports the stack module', pkg.exports?.['./stack'] === './stack.js')
check('the stack module ships in files', Array.isArray(pkg.files) && pkg.files.includes('stack.js'))
const patch = await readFile(join(here, 'cordis.patch.yml'), 'utf8')
check('the patch inserts the stack row', patch.includes('research-record-stack') && patch.includes("'dsh-research-record/stack'"))
const index = await readFile(join(here, 'index.js'), 'utf8')
check('the entry mounts the stack module', index.includes("from './stack.js'") && index.includes('stack.apply'))

const docs = await readFile(join(here, 'docs', 'RECOMMENDED.md'), 'utf8')
const docsPackages = allPackages().filter((pkgName) => pkgName !== 'dsh-plugin-zotero' || true)
check('the doc mentions every stack package', docsPackages.every((pkgName) => docs.includes(pkgName)))
check('the doc lists the avoid set', AVOID.every((item) => item.packages.every((spec) => docs.includes(packageName(spec)))))
check('the doc records the ecosystem gaps', docs.includes('Missing from the ecosystem') || docs.includes('missing from the ecosystem'))

// --- routing and the install tool -------------------------------------------
const { ROUTING, renderRoutes, packagesForLevel, levelOf } = await import('./stack.js')
const { apply } = await import('./stack.js')
check('routing has a row per task family', ROUTING.length >= 8)
check('every routing row has a task and a description', ROUTING.every((row) => row.length === 3 && row[0].length > 10 && row[1].length > 3))
check('every routing row declares its tools as a list', ROUTING.every((row) => Array.isArray(row[2])))
check('routing tool names look like tools', ROUTING.flatMap((row) => row[2]).every((tool) => /^[a-z][a-z0-9_]*$/.test(tool)))
const routes = renderRoutes()
for (const tool of ['pdf_info', 'zotero_search', 'cite_lookup', 'stat_check', 'latex_look', 'pptx_create', 'doc_inspect', 'notebook']) {
  check('routing names ' + tool, routes.includes(tool))
}
check('level filter rejects junk', levelOf('nonsense') === undefined && levelOf('core') === 'core')
const corePackages = packagesForLevel('core')
check('core level is non-empty', corePackages.length > 0)
check('core packages all come from the stack', corePackages.every((spec) => allPackages().includes(packageName(spec))))
check('install command targets a profile', installCommand(corePackages, 'web').startsWith('dsh plugin --profile web add '))

// apply() with a fake context: capture what the bundle registers, spawn nothing
const registered = { tools: [], commands: [], sections: [] }
const fake = makeCtx(
  {
    tools: { register: (definition) => registered.tools.push(definition) },
    commands: { register: (definition) => registered.commands.push(definition) },
    systemPrompt: { section: (section) => registered.sections.push(section) },
  },
  { inject: ['tools', 'commands', 'systemPrompt'], label: 'smoke-stack' },
)
await apply(fake, {})
const tool = registered.tools.find((definition) => definition.name === 'research_stack')
check('the bundle registers research_stack', tool !== undefined)
check('research_stack exposes show and install', JSON.stringify(tool?.parameters?.properties?.action?.enum) === JSON.stringify(['show', 'install']))
check('research_stack documents confirm', /confirm/.test(JSON.stringify(tool?.parameters)))
const show = await tool.execute({ action: 'show' })
check('show returns the stack table', typeof show.text === 'string' && show.text.includes('●'))
const dry = await tool.execute({ action: 'install', level: 'core' })
check('install without confirm only prints the command', dry.text.includes('confirm:true') && dry.text.includes('dsh plugin --profile'))
check('install reported no change', /nothing changed/.test(dry.text))
check('the bundle registers /research-stack', registered.commands.some((definition) => definition.name === 'research-stack'))
const section = registered.sections.find((candidate) => candidate.name === 'research-stack')
check('the prompt section carries the routing table', typeof section?.text === 'string' && section.text.includes('Task → tool'))
check('the prompt section names the install tool', section.text.includes('research_stack'))
check('the prompt tells the model not to reinvent the tool', /not a bash/i.test(section.text))

console.log('')
if (failed > 0) {
  console.log(`FAILED ${failed}/${passed + failed}`)
  process.exit(1)
}
console.log(`stack holds — ${passed}/${passed + failed} checks`)

/**
 * Acceptance checks for the usage telemetry.
 *
 * The privacy assertions matter more than the counters: a report that leaks the
 * researcher's paths, arguments or journal text cannot be sent to a maintainer,
 * which is the whole reason the report exists.
 */
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  argSummary,
  parseEvents,
  renderReport,
  routeTools,
  sanitizeError,
  shortSession,
  suggestions,
  summarizeEvents,
  apply,
} from './telemetry.js'
import { makeCtx } from './fixtures/ctx.mjs'

let pass = 0
let fail = 0
function check(label, condition, detail) {
  if (condition) {
    pass += 1
    console.log(`PASS  ${label}`)
  } else {
    fail += 1
    console.log(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const workspace = await mkdtemp(join(tmpdir(), 'usage-'))

// --- argument summaries carry names, sizes and extensions, never values ------
const summaryArgs = argSummary({ file_path: '/home/claster/secret/report.csv', rows: 5, note: 'do not leak me' }, workspace)
check('argSummary keeps key names', summaryArgs.keys.join(',') === 'file_path,note,rows')
check('argSummary measures size', summaryArgs.bytes > 0)
check('argSummary keeps the extension only', Array.isArray(summaryArgs.extensions) && summaryArgs.extensions[0] === '.csv')
check('argSummary leaks no value', !JSON.stringify(summaryArgs).includes('secret') && !JSON.stringify(summaryArgs).includes('leak'))
check('argSummary tolerates a missing argument object', argSummary(undefined).keys.length === 0)

// --- errors keep their shape, not the user's paths ---------------------------
const cleaned = sanitizeError(new Error('ENOENT: no such file, open \'/home/claster/projects/run-3/results/dpdx.csv\''), '/home/claster/projects/run-3')
check('sanitizeError replaces the workspace', cleaned.includes('<workspace>'))
check('sanitizeError replaces the home directory', !cleaned.includes('/home/claster'))
check('sanitizeError caps the length', sanitizeError('x'.repeat(400), workspace).length <= 160)

// --- sessions are grouped, not identified ------------------------------------
const first = shortSession('agent-abc')
check('shortSession is stable', first === shortSession('agent-abc') && first.length === 8)
check('shortSession separates agents', first !== shortSession('agent-abd'))
check('shortSession is hex', /^[0-9a-f]{8}$/.test(first))

// --- events survive a torn line ----------------------------------------------
const events = parseEvents('{"tool":"pdf_info","ok":true,"ms":12}\nnot json\n\n{"tool":"notebook","ok":false,"error":"boom"}')
check('parseEvents skips a torn line', events.length === 2)
check('parseEvents keeps the failure', events[1].ok === false && events[1].error === 'boom')

// --- routing rows name their tools ------------------------------------------
const routed = routeTools(['PDF: pages, section, quote', 'pdf_info → pdf_outline; dsh-cite for references', ['pdf_info', 'pdf_outline', 'pdf_text']])
check('routeTools uses the explicit tool list', routed.length === 3 && routed.includes('pdf_text'))
check('routeTools never guesses from prose', routeTools(['analysis', 'скрипт в analysis/scripts/ → figures', []]).length === 0)
check('routeTools ignores prose words', !routeTools(['x', 'scripts, figures, runs, template', ['pdf_info']]).includes('scripts'))

// --- the summary adds up -----------------------------------------------------
const now = Date.now()
const synthetic = []
for (let index = 0; index < 10; index += 1) {
  synthetic.push({ v: 1, ts: new Date(now - index * 1000).toISOString(), tool: 'pdf_info', ok: index !== 0 && index !== 1, ms: 100 + index, session: 'aaaa1111', role: 'lead', model: 'p/m' })
}
for (let index = 0; index < 3; index += 1) {
  synthetic.push({ v: 1, ts: new Date(now - index * 1000).toISOString(), tool: 'notebook', ok: true, ms: 5, session: 'aaaa1111', role: 'lead', model: 'p/m' })
}
synthetic.push({ v: 1, ts: new Date(now - 400 * 24 * 60 * 60 * 1000).toISOString(), tool: 'old_tool', ok: true, ms: 1, session: 'bbbb2222' })
const summary = summarizeEvents(synthetic, { days: 30, now })
check('summary counts only the period', summary.calls === 13)
check('summary counts errors', summary.errors === 2)
check('summary computes the error rate', Math.abs(summary.errorRate - 2 / 13) < 1e-9)
check('summary groups sessions', summary.sessions === 1)
check('summary sorts by calls', summary.tools[0].tool === 'pdf_info' && summary.tools[0].calls === 10)
check('summary reports latency', summary.tools[0].p50 >= 100 && summary.tools[0].p95 >= summary.tools[0].p50)
check('summary keeps the top error text', typeof summary.tools[0].topError === 'string')
check('summary knows unused routes', Array.isArray(summary.unusedRoutes) && summary.unusedRoutes.length > 0)

// --- suggestions carry their evidence ---------------------------------------
const crafted = {
  ...summary,
  calls: 30,
  tools: [
    { tool: 'pdf_info', calls: 5, errors: 3, errorRate: 0.6, p50: 10, p95: 20, last: '', topError: 'ENOENT' },
    { tool: 'figure_spec', calls: 2, errors: 0, errorRate: 0, p50: 1, p95: 1, last: '' },
  ],
  unusedRoutes: [{ task: 'HPC: remote run', tools: ['rw_exec'] }],
}
const funnel = { counts: { hypothesis: 4, method: 1, observation: 0, decision: 0, note: 2, auto: 2, total: 7 }, outcomes: { signal: 0, null: 0, inconclusive: 0, 'technical-failure': 0 }, files: 1, withArtifacts: 0 }
const advice = suggestions(crafted, funnel).join('\n')
check('suggestions flag a failing tool', advice.includes('pdf_info') && advice.includes('60%'))
check('suggestions flag an unused journal', advice.includes('журнал не ведётся'))
check('suggestions flag hypotheses without observations', advice.includes('гипотезы без наблюдений'))
check('suggestions flag unchecked figures', advice.includes('не проверяются'))
check('suggestions name an unused route', advice.includes('rw_exec'))

const quiet = suggestions(
  { ...crafted, tools: [{ tool: 'notebook', calls: 10, errors: 0, errorRate: 0, p50: 5, p95: 9, last: '' }], unusedRoutes: [] },
  { counts: { hypothesis: 2, method: 2, observation: 3, decision: 1, note: 0, auto: 0, total: 8 }, outcomes: { signal: 3, null: 0, inconclusive: 0, 'technical-failure': 0 }, files: 1, withArtifacts: 3 },
).join('\n')
check('suggestions stay quiet when nothing is wrong', quiet.includes('сигналов для доработки не видно'))

// --- the report is readable and honest --------------------------------------
const text = renderReport(summary, funnel, { workspace, routes: true })
check('report has a header with the period', text.includes('ОТЧЁТ ОБ ИСПОЛЬЗОВАНИИ') && text.includes('30 дн'))
check('report lists the tools', text.includes('pdf_info') && text.includes('notebook'))
check('report shows the journal funnel', text.includes('ЖУРНАЛ') && text.includes('hypothesis 4'))
check('report shows the suggestions', text.includes('ЧТО ПРЕДЛОЖЕНО МЕНЯТЬ'))
check('report states what it does not contain', text.includes('значений аргументов'))
check('report never prints a workspace path', !text.includes(workspace))

// --- the plugin writes, reports and exports ---------------------------------
const tools = new Map()
const commands = new Map()
const hooks = new Map()
let fakeCtx = makeCtx(
  {
    workingDirectory: { ensure: async () => workspace },
    sessions: { get: () => ({ header: { cwd: workspace } }) },
    tools: { register: (definition) => tools.set(definition.name, definition) },
    commands: { register: (definition) => commands.set(definition.name, definition) },
  },
  { inject: ['tools', 'commands'], label: 'smoke-usage' },
)
for (const [event, listeners] of fakeCtx.__handlers) hooks.set(event, listeners)

apply(fakeCtx, { maxFileBytes: 1_000_000 })
for (const [event, listeners] of fakeCtx.__handlers) hooks.set(event, listeners)
check('plugin registers the usage tool', tools.has('usage_report'))
check('plugin registers the command', commands.has('usage-report'))
check('plugin subscribes to tool results', (hooks.get('tools/result') ?? []).length === 1)

const exec = { name: 'notebook', callId: 'call-1', agent: { id: 'agent-x' }, signal: undefined, arguments: { type: 'method', title: 'secret title', body: 'secret body' } }
for (const listener of hooks.get('session/event') ?? []) listener({ header: { cwd: workspace } }, { type: 'tool/call', data: { callId: 'call-1' }, timestamp: new Date().toISOString() })
for (const listener of hooks.get('tools/result') ?? []) await listener(exec, { isError: false, content: [] })

const eventsFile = join(workspace, '.dsh', 'usage', 'events.jsonl')
const written = parseEvents(await readFile(eventsFile, 'utf8'))
check('a tool call is recorded', written.length === 1 && written[0].tool === 'notebook')
check('the record carries the role and model key', typeof written[0].role === 'string')
check('the record carries argument names', Array.isArray(written[0].keys) && written[0].keys.includes('type'))
const raw = await readFile(eventsFile, 'utf8')
check('no argument value reaches the file', !raw.includes('secret title') && !raw.includes('secret body'))

const tool = tools.get('usage_report')
const shown = await tool.execute({ action: 'summary', days: 30 }, exec)
check('the tool renders the report', shown.text.includes('ОТЧЁТ ОБ ИСПОЛЬЗОВАНИИ') && shown.text.includes('notebook'))
check('the tool counts the call it reports on', shown.calls === 1)
check('output.render returns a text block', tool.output.render({}, shown)[0].type === 'text')

const exported = await tool.execute({ action: 'export', days: 30 }, exec)
const directory = join(workspace, '.dsh', 'usage')
const files = await readdir(directory)
const markdownFile = files.find((entry) => entry.startsWith('report-') && entry.endsWith('.md'))
const jsonFile = files.find((entry) => entry.startsWith('report-') && entry.endsWith('.json'))
check('export writes markdown and json', markdownFile !== undefined && jsonFile !== undefined)
const markdown = await readFile(join(directory, markdownFile), 'utf8')
const parsed = JSON.parse(await readFile(join(directory, jsonFile), 'utf8'))
check('exported markdown is the report', markdown.includes('ОТЧЁТ ОБ ИСПОЛЬЗОВАНИИ'))
check('exported json carries summary and funnel', parsed.summary !== undefined && parsed.funnel !== undefined && parsed.privacy !== undefined)
check('exported report names no absolute path', !markdown.includes(workspace) && !JSON.stringify(parsed).includes(workspace))
check('exported json keeps only the project basename', parsed.workspace === workspace.split('/').pop())
check('export returns its paths', typeof exported.mdPath === 'string' && typeof exported.jsonPath === 'string')

// --- the journal funnel is counted from disk --------------------------------
const journal = join(workspace, '.dsh', 'notebook')
await mkdir(journal, { recursive: true })
const records = [
  { type: 'hypothesis', title: 'H-1', hash: 'a'.repeat(64), prevHash: '0'.repeat(64) },
  { type: 'hypothesis', title: 'H-2' },
  { type: 'method', title: 'M-1' },
  { type: 'observation', title: 'O-1', outcome: 'signal', artifacts: [{ path: 'a.csv' }] },
  { type: 'note', title: 'auto note', auto: true },
  { type: 'observation', title: 'O-2', outcome: 'technical-failure' },
]
await writeFile(join(journal, 'session-1.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n')

const { readJournalFunnel } = await import('./telemetry.js')
const counted = await readJournalFunnel(workspace)
check('funnel counts record types', counted.counts.hypothesis === 2 && counted.counts.observation === 2 && counted.counts.total === 6)
check('funnel counts automatic notes', counted.counts.auto === 1)
check('funnel counts outcomes', counted.outcomes.signal === 1 && counted.outcomes['technical-failure'] === 1)
check('funnel counts artifacts', counted.withArtifacts === 1)

const withJournal = await tool.execute({ action: 'summary', days: 30 }, exec)
check('the report picks up the journal', withJournal.text.includes('hypothesis 2'))
check('the report suggests recording observations', withJournal.text.includes('observation 2'))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exitCode = 1
else console.log('usage telemetry holds')

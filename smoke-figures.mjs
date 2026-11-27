/**
 * Smoke test for the figure tools: geometry, the Python/JS agreement, and a
 * real PDF built by figurelib and checked by figure_check.
 *
 * Run: node smoke-figures.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { GEOMETRY, apply, planLayout } from './figures.js'
import { makeCtx } from './fixtures/ctx.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
let failures = 0
let checks = 0

function check(label, condition, detail) {
  checks += 1
  if (condition) {
    console.log(`PASS  ${label}`)
    return
  }
  failures += 1
  console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
}

function fakeCtx() {
  const tools = new Map()
  const ctx = makeCtx(
    {
      tools: {
        register(definition) {
          if (tools.has(definition.name)) throw new Error(`duplicate tool ${definition.name}`)
          tools.set(definition.name, definition)
          return () => tools.delete(definition.name)
        },
      },
    },
    { inject: ['tools'], label: 'smoke-figures' },
  )
  ctx.toolsMap = tools
  return ctx
}

// ── geometry (JS side) ─────────────────────────────────────────────────────
const one = planLayout({ panels: 1, widthMm: 90 })
const oneDefault = planLayout({ panels: 1 })
check('one panel is 90 x 50 mm', one.widthMm === 90 && one.heightMm === 50)
check('one panel gets no letters', one.letters === false)
check('one panel defaults to the 90 mm column', oneDefault.widthMm === 90)
check('one panel keeps the legend inside the panel', /INSIDE/.test(one.legend))

const two = planLayout({ panels: 2 })
check('two panels are 190 x 50 mm rigidly', two.widthMm === 190 && two.heightMm === 50)
check('two panels get letters', two.letters === true)
check('two panel legend goes inside the panel', /INSIDE/.test(two.legend))

const three = planLayout({ panels: 3 })
check('three panels add the footer band (190 x 58 mm)', three.widthMm === 190 && three.heightMm === 58)
check('three panel legend goes below', /below/.test(three.legend))

const column = planLayout({ panels: 3, arrangement: 'col' })
check('column of three is 165 mm tall', column.heightMm === 165 && column.nrows === 3)

let threw = false
try { planLayout({ panels: 2, widthMm: 100 }) } catch { threw = true }
check('a 100 mm sheet is refused', threw)

threw = false
try { planLayout({ panels: 4 }) } catch { threw = true }
check('four panels in a row are refused', threw)

check('geometry mirrors the journal widths', GEOMETRY.widthsMm.join() === '90,190')
check('panel height is 50 mm', GEOMETRY.panelHeightMm === 50)
check('Russian letters start with а, б', GEOMETRY.letters.ru[0] === 'а' && GEOMETRY.letters.ru[1] === 'б')

// ── JS and Python must agree ───────────────────────────────────────────────
const py = (code) => execFileSync('python3', ['-c', code], { cwd: HERE, encoding: 'utf8' }).trim()

try {
  const pyLayouts = JSON.parse(py(`
import json, sys
sys.path.insert(0, '.')
import figurelib as fg
print(json.dumps([fg.get_layout(1, 'row', 90)['figsize_mm'],
                  fg.get_layout(2, 'row', 190)['figsize_mm'],
                  fg.get_layout(3, 'row', 190)['figsize_mm'],
                  fg.get_layout(3, 'col', 190)['figsize_mm']]))
`))
  check('python agrees on one panel', pyLayouts[0][0] === 90 && pyLayouts[0][1] === 50, JSON.stringify(pyLayouts[0]))
  check('python agrees on two panels', pyLayouts[1][0] === 190 && pyLayouts[1][1] === 50, JSON.stringify(pyLayouts[1]))
  check('python agrees on three panels', pyLayouts[2][0] === 190 && pyLayouts[2][1] === 58, JSON.stringify(pyLayouts[2]))
  check('python agrees on a column', pyLayouts[3][0] === 190 && pyLayouts[3][1] === 165, JSON.stringify(pyLayouts[3]))
} catch (error) {
  check('python figurelib answers', false, String(error).slice(0, 400))
}

try {
  const style = JSON.parse(py(`
import json, sys
sys.path.insert(0, '.')
import figurelib as fg
print(json.dumps({'font': fg.FONT_FAMILY, 'size': fg.FONT_SIZE,
                  'widths': list(fg.JOURNAL_WIDTHS_MM)}))
`))
  check('font family matches between JS and Python', style.font === GEOMETRY.fontFamily, style.font)
  check('font size matches', style.size === GEOMETRY.fontSizePt, String(style.size))
  check('widths match', style.widths.join() === GEOMETRY.widthsMm.join(), style.widths.join())
} catch (error) {
  check('python style constants readable', false, String(error).slice(0, 400))
}

// ── tools ──────────────────────────────────────────────────────────────────
const ctx = fakeCtx()
apply(ctx)
check('registers figure_spec', ctx.toolsMap.has('figure_spec'))
check('registers figure_check', ctx.toolsMap.has('figure_check'))
check('tools have parameters and render', ['figure_spec', 'figure_check'].every((toolName) => {
  const tool = ctx.toolsMap.get(toolName)
  return tool.parameters && typeof tool.output.render === 'function'
}))

const spec = await ctx.toolsMap.get('figure_spec').execute({ panels: 2 })
const specText = spec.text ?? spec
check('figure_spec reports the sheet', /190 × 50 mm/.test(specText), String(specText).slice(0, 200))
check('figure_spec reports a/b letters', /а, б/.test(specText), String(specText).slice(0, 200))
check('figure_spec mentions the check step', /figure_check/.test(specText))

// ── a real figure, then figure_check ───────────────────────────────────────
const workspace = mkdtempSync(join(tmpdir(), 'fig-smoke-'))
try {
  const out = join(workspace, 'smoke_en.pdf')
  py(`
import sys
sys.path.insert(0, ${JSON.stringify(HERE)})
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import figurelib as fg

fig, (ax_a, ax_b) = fg.make_figure(2, arrangement='row', width_mm=190)
x = np.linspace(0, 150, 40)
for i, level in enumerate([10, 100, 1200]):
    ax_a.plot(x, 900 + i * 40 + 5 * np.sin(x / 20), lw=1.2, label=f'$F_R$={level}')
    ax_b.plot(x, 0.2 + 0.05 * i + 0.01 * np.cos(x / 25), lw=1.2)
ax_a.set_xlabel('$R$, mm'); ax_a.set_ylabel('$T_s$, K')
ax_b.set_xlabel('$R$, mm'); ax_b.set_ylabel('$u$, m/s')
fg.setup_panel_label(ax_a, 'a')
fg.setup_panel_label(ax_b, 'b')
fg.save_figure(fig, ${JSON.stringify(out)})
`)

  const tool = ctx.toolsMap.get('figure_check')
  const report = await tool.execute({ pdf: out, expect_width_mm: 190, expect_height_mm: 50 })
  check('figure_check accepts a correct sheet', report.ok === true, JSON.stringify(report.warnings ?? []).slice(0, 300))
  const [w, h] = report.page_size_mm ?? []
  check('figure_check measures 190 x 50 mm', Math.abs(w - 190) < 0.6 && Math.abs(h - 50) < 0.6, `${w} x ${h}`)
  check('figure_check finds the journal font', (report.fonts ?? []).some((font) => font.includes('LinLibertine')), (report.fonts ?? []).join(','))

  const wrong = await tool.execute({ pdf: out, expect_width_mm: 90, expect_height_mm: 50 })
  check('figure_check reports a wrong width', wrong.ok === false && /width/.test(String(wrong.text)), String(wrong.text).slice(0, 200))
} catch (error) {
  check('figurelib builds a PDF', false, String(error).slice(0, 600))
} finally {
  rmSync(workspace, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.log('figures: FAILED')
  process.exitCode = 1
} else {
  console.log('figures hold')
}

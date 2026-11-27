/**
 * Figure tools: what sheet size a panel grid must have, and whether a finished
 * PDF obeys the journal rules.
 *
 * The Python side (figurelib/) draws; these two tools answer the questions
 * that come *before* drawing and *after* saving, when no plot exists yet and
 * when the PDF is already a file on disk.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Journal geometry, mirrored from figurelib/style.py (smoke keeps them in sync). */
export const GEOMETRY = {
  widthsMm: [90, 190],
  panelHeightMm: 50,
  maxCols: 3,
  maxRows: 5,
  fontFamily: 'Linux Libertine O',
  fontSizePt: 8,
  letters: {
    ru: [...'абвгдежзиклмн'],
    en: [...'abcdefghijklmnopqrstuvwxyz'],
  },
}

export const name = 'research-record-figures'
export const inject = ['tools']

function mmToPt(mm) {
  return (mm / 25.4) * 72
}

/**
 * Sheet size for a panel grid.
 *
 * `row` is a single row of panels across the page: one panel takes the 90 mm
 * column, two panels take both columns and keep the 50 mm data height with the
 * legend inside the panel, three panels add the footer-legend band below.
 */
export function planLayout({ panels, arrangement = 'row', widthMm = 190, extraLegendMm = 8, colHeightMm = 55 }) {
  if (!Number.isInteger(panels) || panels < 1) throw new Error('panels must be a positive integer')
  if (!GEOMETRY.widthsMm.includes(widthMm)) {
    throw new Error(`widthMm must be one of ${GEOMETRY.widthsMm.join(', ')} — the journal prints 90 mm (one column) or 190 mm (two columns)`)
  }

  let nrows
  let ncols
  let heightMm
  if (arrangement === 'row') {
    if (panels > GEOMETRY.maxCols) throw new Error(`a row takes at most ${GEOMETRY.maxCols} panels; use a column arrangement`)
    nrows = 1
    ncols = panels
    heightMm = GEOMETRY.panelHeightMm + (panels > 2 ? extraLegendMm : 0)
  } else if (arrangement === 'col') {
    if (panels > GEOMETRY.maxRows) throw new Error(`a column takes at most ${GEOMETRY.maxRows} panels`)
    nrows = panels
    ncols = 1
    heightMm = colHeightMm * panels
  } else {
    throw new Error("arrangement must be 'row' or 'col'")
  }

  const letters = panels >= 2
  const legend = panels === 1 ? 'to the right of the panel, outside the data area'
    : panels === 2 ? 'INSIDE the panel, in the corner with the fewest data points (auto_legend)'
      : 'below the panels, in the reserved band (measure it, do not guess)'

  return { nrows, ncols, widthMm, heightMm, legend, letters }
}

function renderPlan(plan, language = 'ru') {
  const letters = GEOMETRY.letters[language] ?? GEOMETRY.letters.en
  const list = plan.letters ? `да — ${letters.slice(0, plan.nrows * plan.ncols).join(', ')}` : 'нет (одна панель буквы не получает)'
  return [
    `Sheet: ${plan.widthMm} × ${plan.heightMm} mm`,
    `  = ${mmToPt(plan.widthMm).toFixed(3)} × ${mmToPt(plan.heightMm).toFixed(3)} pt (so pdfinfo shows these numbers)`,
    `Grid: ${plan.nrows} × ${plan.ncols}`,
    `Legend: ${plan.legend}`,
    `Panel letters: ${list}`,
    'Checks after saving:',
    `  · page size is ${plan.widthMm} × ${plan.heightMm} mm (figure_check)`,
    `  · fonts embedded and ${GEOMETRY.fontFamily} present (figure_check)`,
    '  · two files, <name>_ru.pdf and <name>_en.pdf, built by the same function',
  ].join('\n')
}

function runPython(args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const child = spawn('python3', args, { cwd: HERE, timeout: timeoutMs })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: String(error) }))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'figure_spec',
    description:
      'Plan a journal figure before writing any plotting code: the exact sheet size in mm and pt for a grid of 1-3 panels (or a column of up to 5), where the legend must go, whether panels get letters, and what to verify after saving. Use it whenever a figure for a paper, report or presentation is about to be created.',
    parameters: {
      type: 'object',
      properties: {
        panels: { type: 'integer', minimum: 1, maximum: 5, description: 'number of panels' },
        arrangement: { type: 'string', enum: ['row', 'col'], description: "row = panels side by side (default), col = stacked" },
        width_mm: { type: 'integer', enum: [90, 190], description: 'sheet width: 90 = one column, 190 = both columns (default)' },
        language: { type: 'string', enum: ['ru', 'en'], description: 'language of the figure, decides the panel letters' },
      },
      required: ['panels'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const plan = planLayout({
        panels: args.panels,
        arrangement: args.arrangement ?? 'row',
        widthMm: args.width_mm ?? 190,
      })
      return renderPlan(plan, args.language ?? 'ru')
    },
  })

  ctx.tools.register({
    name: 'figure_check',
    description:
      'Check a finished figure PDF against the journal rules: sheet width is 90 or 190 mm, height matches the layout, the journal font is embedded, no Type 3 outlines. Reports the measured size in mm and what is wrong; use it after every save_figure and before a figure goes into a paper.',
    parameters: {
      type: 'object',
      properties: {
        pdf: { type: 'string', description: 'path to the PDF, relative to the workspace or absolute' },
        expect_width_mm: { type: 'number', description: 'expected sheet width in mm (90 or 190)' },
        expect_height_mm: { type: 'number', description: 'expected sheet height in mm (50 for one or two panels)' },
        font: { type: 'string', description: 'expected font family, default Linux Libertine O' },
      },
      required: ['pdf'],
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: value?.text ?? '' }],
    },
    async execute(args) {
      const script = join(HERE, 'figurelib', 'check.py')
      const argv = [script, args.pdf]
      if (args.expect_width_mm != null) argv.push('--width', String(args.expect_width_mm))
      if (args.expect_height_mm != null) argv.push('--height', String(args.expect_height_mm))
      if (args.font) argv.push('--font', args.font)
      const result = await runPython(argv)
      let report
      try {
        report = JSON.parse(result.stdout)
      } catch {
        return {
          ok: false,
          warnings: [`figurelib/check.py did not return JSON (exit ${result.code})`],
          text: `figure_check failed (exit ${result.code}).\n${(result.stderr || result.stdout).slice(-1500)}`,
        }
      }
      const size = report.page_size_mm?.map((v) => v.toFixed(1)).join(' × ') ?? '?'
      const lines = [
        `${report.ok ? 'OK' : 'PROBLEMS'} — ${report.file}`,
        `sheet: ${size} mm`,
        `fonts: ${(report.fonts ?? []).join(', ') || 'none embedded'}`,
      ]
      for (const warning of report.warnings ?? []) lines.push(`! ${warning}`)
      return { ...report, text: lines.join('\n') }
    },
  })
}

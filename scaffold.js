/**
 * dsh-research-record — research project scaffold.
 *
 * A bare directory gives the model no reason to behave like a scientist. This
 * module turns a directory into an explicit research project: a folder layout, a
 * brief form, a hypotheses registry, a run protocol, and an `AGENTS.md` that the
 * harness picks up as workspace instructions in every later session.
 *
 * Two entry points, one implementation:
 *   - tool `research_init` — the model calls it when the user says "this is a
 *     research project directory";
 *   - command `/research-init` — the user runs it directly, without a model turn.
 *
 * Both are idempotent: files are created only when missing, so re-running the
 * scaffold after adding folders never overwrites work.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { appendAutoNote, activeWorkspace, sessionWorkspace } from './notebook.js'
import { getService } from './services.js'

export const name = 'research-record-scaffold'
export const inject = ['tools', 'systemPrompt']

const MARKER = '.dsh/research-project.json'
const POLICY = '.dsh/policy.json'
const SCHEMA_VERSION = 1
const IDENTITY_TTL_MS = 5000

/** Folders every research project starts with, with the one-line purpose each. */
export const FOLDERS = [
  ['literature', 'источники: карточки, цитаты, PDF'],
  ['literature/notes', 'одна заметка на источник'],
  ['literature/refs', 'PDF и ссылки как есть'],
  ['hypotheses', 'реестр гипотез и идей, статусы решений'],
  ['models', 'сетапы, геометрия, граничные условия, версии решателя'],
  ['runs', 'прогоны: один каталог = один прогон по протоколу'],
  ['runs/logs', 'сырые логи решателей'],
  ['data/raw', 'исходные данные — только чтение'],
  ['data/derived', 'производные данные, пересобираемые скриптом'],
  ['analysis/scripts', 'код анализа, который можно перезапустить'],
  ['analysis/figures', 'рисунки, собранные скриптом'],
  ['analysis/tables', 'таблицы результатов'],
  ['paper', 'статья: исходники, разделы, рисунки'],
  ['paper/sections', 'по файлу на раздел'],
  ['paper/figures', 'только те рисунки, что вошли в статью'],
  ['talks', 'доклады и презентации'],
  ['admin', 'отчёты, формы, заявки, переписка'],
]

const AGENTS_MD = `# Научный проект: правила работы

Это каталог научного проекта, а не папка с файлами. Агент работает здесь как
исполнитель исследования под руководством владельца проекта: результаты должны
быть проверяемыми, а не правдоподобными.

## Что обязательно

1. **Журнал — часть работы, а не отчёт.** Перед прогоном или расчётом пиши
   \`hypothesis\` (что ожидаем и почему) и \`method\` (как именно проверяем).
   После — \`observation\` с числами, единицами и путём к артефакту. Решение с
   причиной — \`decision\`. Ошибка или тупик — тоже запись, а не тишина.
2. **Ничего не переписывай в \`data/raw/\`.** Исходные данные неизменяемы: работа
   идёт на копиях в \`data/derived/\` или в каталоге прогона.
3. **Каждое число — из файла.** Если в выводе стоит значение, должен быть путь к
   артефакту, из которого оно получено. Пересчёт владельцем должен дать то же.
4. **Один прогон — один каталог** в \`runs/\` по протоколу \`runs/README.md\`:
   конфиг, входные данные, лог, результат, вывод. Без этого прогон не существует.
5. **Графики строит скрипт**, лежащий в \`analysis/scripts/\`, а не «руками».
   Рисунок без скрипта нельзя ни проверить, ни пересобрать.
6. **Гипотеза живёт в \`hypotheses/registry.md\`**, а не только в чате: у неё есть
   ID, статус и запись в журнале, которая её подтверждает или опровергает.
7. **Не выдумывай — проверяй.** Путь проверяется (\`ls\`, \`test -f\`), число берётся
   из файла, а не из памяти. Неоткрытый файл цитировать нельзя, незапущенную
   команду описывать как выполненную — нельзя. Если проверка не удалась, так и
   скажи, а не заполняй пробел правдоподобным ответом.
8. **Считает скрипт.** Любая арифметика — пересчёт единиц, среднее, интеграл,
   разность, подгонка, «на глаз видно, что в 1.5 раза» — выполняется скриптом в
   \`analysis/scripts/\`, а не в голове и не в тексте ответа. Модель читает
   результат скрипта; число без скрипта, который его посчитал, результатом не
   является.

## Проверка вместо догадки

- **Путь** — только после проверки (\`ls\`, \`test -f\`, чтение файла). «Обычно это
  лежит в…» — запрещено; либо путь подтверждён, либо сказано, что не найден.
- **Число** — только из файла, скрипта или лога, с путём к источнику. Значения из
  памяти модели, «примерно», «должно быть порядка» — не результат.
- **Данные** — прежде чем считать, посмотри, что реально в файле: число строк,
  колонки, единицы, пропуски. Ответ, построенный на предполагаемой структуре
  файла, — ошибка, даже если он красивый.
- **Ссылка на источник** — открытый файл. Цитировать по названию, не открыв,
  нельзя; ссылка на несуществующий артефакт — тоже ошибка.
- **Не получилось** — так и напиши: что проверял, что именно не нашлось, что
  нужно от владельца. Пустой пробел честнее правдоподобной выдумки.

## Как двигаться

- Сначала прочитай \`PROJECT.md\` — там вопрос, границы и критерий успеха. Если
  его нет или он пуст, спроси владельца, а не придумывай.
- План на несколько шагов согласуй до запуска дорогих расчётов: перебор
  параметров, сетка, серия прогонов — это отдельное решение с оценкой стоимости.
- Не выдавай предположение за результат. Формулировки «должно быть», «обычно»
  допустимы только с пометкой, что это гипотеза.

## Формы

Готовые анкеты: \`PROJECT.md\` (проект), \`hypotheses/registry.md\` (гипотезы),
\`runs/README.md\` (протокол прогона), \`analysis/README.md\` (анализ),
\`paper/README.md\` (статья). Заполняй их по мере работы, а не в конце.
`

const README_MD = (projectName) => `# ${projectName}

Научный проект. Карта каталога и порядок работы.

## Каталог

| Путь | Что внутри | Правило |
| --- | --- | --- |
| \`PROJECT.md\` | анкета проекта: вопрос, границы, критерий успеха | заполняется первым |
| \`literature/\` | карточки источников, цитаты, PDF | одна заметка на источник |
| \`hypotheses/\` | реестр гипотез и идей | ID, статус, чем проверено |
| \`models/\` | сетапы, геометрия, BC, версии решателя | версия фиксируется |
| \`runs/\` | прогоны по протоколу | один прогон = один каталог |
| \`data/raw/\` | исходные данные | только чтение |
| \`data/derived/\` | производные данные | пересобираются скриптом |
| \`analysis/\` | скрипты, рисунки, таблицы | рисунок = результат скрипта |
| \`paper/\` | статья и её рисунки | раздел = файл |
| \`talks/\` | доклады, презентации | — |
| \`admin/\` | отчёты, формы, заявки | — |
| \`.dsh/\` | журнал и провенанс | не редактировать руками |

## Порядок работы

1. Заполнить \`PROJECT.md\` (или попросить агента задать вопросы).
2. Занести гипотезы в \`hypotheses/registry.md\`.
3. Собрать модель/сетап в \`models/\`, прогон — в \`runs/\`.
4. Разобрать результаты в \`analysis/\`, записав наблюдения в журнал.
5. Собрать статью в \`paper/\`.

## Журнал

\`.dsh/notebook/<sessionId>.jsonl\` — записи с хеш-цепочкой; \`.dsh/provenance/\` —
откуда взялся каждый файл. Агент пишет туда через инструмент \`notebook\`; читать
и проверять — \`notebook_search\` и \`notebook_verify\`.
`

const PROJECT_MD = (projectName) => `# Анкета проекта: ${projectName}

> Заполняется до первых расчётов. Пустые пункты — это открытые вопросы, а не
> мелочи: агент обязан спросить, а не догадаться.

## 1. Вопрос

- **Главный вопрос исследования:**
- **Почему он важен (1–3 предложения):**
- **Что уже известно / что проверили раньше:**

## 2. Границы

- **Что входит в работу:**
- **Что сознательно не входит:**
- **Допущения, которые принимаем без проверки:**

## 3. Гипотезы

| ID | Гипотеза | Как проверим | Что будет означать провал |
| --- | --- | --- | --- |
| H-1 |  |  |  |
| H-2 |  |  |  |

## 4. Данные

- **Что за данные и откуда:**
- **Объём и формат:**
- **Ограничения (шум, пропуски, диапазон применимости):**

## 5. Модель / установка

- **Решатель, версия, геометрия:**
- **Граничные условия и режим:**
- **Параметры, которые будем менять (и почему):**
- **Сетка и проверка сеточной независимости:**

## 6. Результат

- **Что считаем успехом (числовые критерии):**
- **Какой артефакт должен остаться (таблица, рисунок, файл):**
- **Кому и где это будет показано:**

## 7. Ресурсы и сроки

- **Расчётное время и машины:**
- **Дедлайн / контрольные точки:**
- **Бюджет на внешние вычисления (если есть):**
`

const LITERATURE_README = `# Литература

Одна карточка на источник — \`literature/notes/<год>-<первый автор>.md\`.
PDF и ссылки — в \`literature/refs/\` (или Zotero, тогда здесь только citekey).

## Карточка источника

\`\`\`markdown
# <Автор, год> — <короткое название>

- **Полная ссылка / DOI:**
- **Что проверяет:** (одна фраза)
- **Метод:** (установка, решатель, эксперимент)
- **Результаты:** (числа с единицами, диапазоны)
- **Ограничения:** (что не покрывает)
- **Чем полезно нам:** (какой раздел / гипотезу поддерживает)
- **Цитата для статьи:** (если нужна дословная)
\`\`\`

## Реестр

| Источник | Год | Тема | Поддерживает | Спорит с | Citekey |
| --- | --- | --- | --- | --- | --- |
`

const HYPOTHESES_README = `# Реестр гипотез

Гипотеза без ID и статуса — это идея, а не гипотеза. Статус меняется только
вместе с записью в журнале, которая его меняет.

| ID | Гипотеза (утверждение, проверяемое) | Статус | Проверка | Запись в журнале | Дата |
| --- | --- | --- | --- | --- | --- |
| H-1 |  | открыта |  |  |  |

Статусы: \`открыта\` → \`в работе\` → \`подтверждена\` / \`опровергнута\` / \`отложена\`.

## Идеи, ещё не ставшие гипотезой

- (сюда — догадки, аналогии, «а что если»; при повышении статуса переносится в таблицу)
`

const MODELS_README = `# Модели и сетапы

Один сетап — один подкаталог: \`models/<модель-версия>/\`. Версия решателя и
сетки фиксируется в \`setup.md\`, иначе прогоны через месяц несравнимы.

## Что фиксировать в \`setup.md\`

- решатель и версия (\`ANSYS Fluent 2026 R1\`, \`OpenFOAM 14\`, номер сборки);
- геометрия и источник файла, единицы;
- граничные условия и начальные значения;
- модель турбулентности/горения/радиации и её параметры;
- сетка: число ячеек, \`y+\`, проверка сеточной независимости (ссылка на отчёт);
- схема и релаксация/устойчивость;
- известные ограничения и режим применимости.
`

const RUNS_README = `# Протокол прогона

Один прогон — один каталог: \`runs/<дата>-<короткое-имя>/\`. Прогон, у которого
нет конфига или лога, не существует: результат нельзя ни защитить, ни повторить.

## Обязательное содержимое каталога прогона

\`\`\`
runs/2026-11-27-baseline/
  run.md          # что и зачем: гипотеза, изменённые параметры, ожидание
  config/         # конфиги, journal, case-файлы (как есть)
  inputs/         # ссылки на входные данные (не копии сырых данных)
  log             # сырой лог решателя
  results/        # поля, CSV, отчёты
  conclusion.md   # что получилось: числа, совпало ли с ожиданием, что дальше
\`\`\`

## Минимум в \`run.md\`

- **Гипотеза / вопрос прогона:** ссылка на ID из реестра;
- **Что изменилось** относительно предыдущего прогона;
- **Ожидание** (число или направление) — до запуска;
- **Критерий остановки** (сходимость, время, бюджет).

## Минимум в \`conclusion.md\`

- числа с единицами и путями к файлам;
- совпало с ожиданием или нет — и почему;
- что делать дальше: ещё прогон, другой параметр, остановиться.
`

const ANALYSIS_README = `# Анализ

- код — \`analysis/scripts/<тема>.py\` (или \`.m\`, \`.jl\`); запускается одной командой;
- рисунки — \`analysis/figures/\`, имя = что показано + дата, генерируются скриптом;
- таблицы — \`analysis/tables/\`, CSV + markdown-версия для статьи.

## Правила

1. Скрипт читает \`runs/*/results\` или \`data/derived/\` — не \`data/raw/\`.
2. Каждый рисунок воспроизводим: в заголовке скрипта — какие данные и какие
   прогоны он использует.
3. Числа в тексте статьи берутся из таблицы, а не набираются руками.
4. Выброс и отбракованная точка фиксируются в журнале: сколько, почему, что это
   меняет в выводе.
5. Любое число, которое кто-то будет перепроверять, считает скрипт: среднее,
   разность, отношение, пересчёт единиц, интеграл, подгонка. Арифметика «в уме»
   в ответе или в тексте статьи — источник ошибок, которые никто не найдёт.
`

const PAPER_README = (projectName) => `# Статья: ${projectName}

\`main.tex\` + \`sections/*.tex\`. Рисунки для статьи — только из
\`analysis/figures/\`, скопированные в \`paper/figures/\` вместе с именем скрипта,
который их породил.

## План

| Раздел | Файл | Статус | Опора (журнал / прогоны) |
| --- | --- | --- | --- |
| Введение | \`sections/intro.tex\` | нет |  |
| Методика | \`sections/methods.tex\` | нет |  |
| Результаты | \`sections/results.tex\` | нет |  |
| Обсуждение | \`sections/discussion.tex\` | нет |  |
| Заключение | \`sections/conclusion.tex\` | нет |  |

## Правила

- Methods пишутся из журнала и протоколов прогонов, а не по памяти.
- Каждое утверждение в Results опирается на конкретный прогон или таблицу.
- Рисунок попадает в статью только вместе со скриптом, который его строит.
`

const TALKS_README = `# Доклады

Один доклад — один подкаталог: \`talks/<конференция-год>/\` (слайды, заметки,
сборник тезисов). Слайды собираются из тех же рисунков, что и статья: расхождение
чисел между докладом и статьёй — ошибка, а не оформление.
`

/**
 * Create the project infrastructure in `workspace`.
 *
 * Idempotent by contract: an existing file is never rewritten unless `force` is
 * set, so running the scaffold on a live project only reports what is missing.
 *
 * @returns {{ ok: true, workspace: string, project: string, created: string[], skipped: string[], folders: string[], marker: object }}
 */
export async function scaffoldResearchProject(workspace, options = {}) {
  const root = resolve(workspace)
  const markerPath = join(root, MARKER)
  const previous = readMarkerFile(markerPath)
  // A later call without a name must keep the one the project was created with:
  // re-deriving it from the directory name would silently rename the project.
  const givenName = typeof options.name === 'string' ? options.name.trim() : ''
  const projectName = givenName.length > 0 ? givenName : typeof previous?.name === 'string' && previous.name.length > 0 ? previous.name : guessProjectName(root)
  const created = []
  const skipped = []
  const updated = []
  const backedUp = []
  const folders = []

  for (const [relative] of FOLDERS) {
    const target = join(root, relative)
    if (existsSync(target)) {
      folders.push(relative)
      continue
    }
    await mkdir(target, { recursive: true })
    folders.push(relative)
    created.push(`${relative}/`)
  }

  const files = [
    ['AGENTS.md', AGENTS_MD],
    ['README.md', README_MD(projectName)],
    ['PROJECT.md', PROJECT_MD(projectName)],
    ['literature/README.md', LITERATURE_README],
    ['hypotheses/registry.md', HYPOTHESES_README],
    ['models/README.md', MODELS_README],
    ['runs/README.md', RUNS_README],
    ['analysis/README.md', ANALYSIS_README],
    ['paper/README.md', PAPER_README(projectName)],
    ['talks/README.md', TALKS_README],
  ]
  for (const [relative, content] of files) {
    const target = join(root, relative)
    if (existsSync(target) && options.force !== true) {
      skipped.push(relative)
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    // force is destructive to hand edits, so the previous text is kept beside it
    // (the same rule the journal repair follows: back up, then overwrite).
    if (existsSync(target)) {
      const backup = `${target}.bak-${Date.now()}`
      await copyFile(target, backup)
      backedUp.push(relative)
    }
    await writeFile(target, content, 'utf8')
    created.push(relative)
  }

  if (options.brief !== undefined && typeof options.brief === 'string' && options.brief.trim().length > 0) {
    const briefPath = join(root, 'PROJECT.md')
    const existing = existsSync(briefPath) ? readFileSync(briefPath, 'utf8') : ''
    const line = `\n## Вопрос (из запроса)\n\n${options.brief.trim()}\n`
    if (!existing.includes(options.brief.trim())) {
      await writeFile(briefPath, `${existing.trimEnd()}\n${line}`, 'utf8')
      // The report lists real paths only: a label like "PROJECT.md (вопрос)" was
      // turned into a journal artifact and hashed as missing.
      if (existing.trim().length === 0) created.push('PROJECT.md')
      else updated.push('PROJECT.md')
    }
  }

  // Raw data is read-only by default: the guard already denies these paths
  // without a policy file, and writing the policy makes the intent visible.
  const policyPath = join(root, POLICY)
  if (!existsSync(policyPath)) {
    await mkdir(dirname(policyPath), { recursive: true })
    await writeFile(
      policyPath,
      `${JSON.stringify({ protectedPaths: ['data/raw/**', 'data/**'], allowPaths: ['data/derived/**', 'derived/**'], destructiveConfirm: true }, null, 2)}\n`,
      'utf8',
    )
    created.push(POLICY)
  } else {
    skipped.push(POLICY)
  }

  const marker = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'research-project',
    name: projectName,
    phase: typeof options.phase === 'string' ? options.phase : previous?.phase ?? 'setup',
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    brief: 'PROJECT.md',
    registry: 'hypotheses/registry.md',
    journal: '.dsh/notebook',
    provenance: '.dsh/provenance',
    folders: FOLDERS.map(([relative, purpose]) => ({ path: relative, purpose })),
  }
  await mkdir(dirname(markerPath), { recursive: true })
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
  created.push(MARKER)

  return { ok: true, workspace: root, project: projectName, created, skipped, updated, backedUp, folders, marker }
}

function guessProjectName(root) {
  const base = root.split(/[\\/]/).filter((part) => part.length > 0).pop()
  return typeof base === 'string' && base.length > 0 ? base : 'research project'
}

function readMarkerFile(path) {
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** workspace -> { at, marker } so the prompt section does not stat on every step. */
const identityCache = new Map()

function projectIdentity(workspace) {
  if (typeof workspace !== 'string' || workspace.length === 0) return undefined
  const hit = identityCache.get(workspace)
  if (hit !== undefined && Date.now() - hit.at < IDENTITY_TTL_MS) return hit.marker
  const markerPath = join(workspace, MARKER)
  let marker
  try {
    if (existsSync(markerPath) && statSync(markerPath).isFile()) marker = readMarkerFile(markerPath)
  } catch {
    marker = undefined
  }
  identityCache.set(workspace, { at: Date.now(), marker })
  return marker
}

/** One-line map of the project for the prompt. */
function identityText(marker) {
  const lines = [
    `исследовательский проект: ${marker.name ?? 'без названия'} (фаза: ${marker.phase ?? 'setup'})`,
    'это каталог научного проекта: правила работы — в AGENTS.md в корне проекта, анкета — в PROJECT.md; если PROJECT.md пуст, спроси владельца, а не додумывай.',
    'карта: literature/ (источники) hypotheses/ (реестр) models/ (сетапы) runs/ (прогоны по протоколу) data/raw (только чтение) data/derived analysis/ (скрипты, рисунки, таблицы) paper/ talks/ admin/',
    'дисциплина журнала: hypothesis и method до прогона, observation с числами/единицами/путём к артефакту после, decision с причиной; архивные данные не переписывать.',
    'не выдумывать: пути и данные проверять (ls/test/чтение), числа брать из файла или лога; любые вычисления — скриптом в analysis/scripts/, не в уме; чего нет — говорить «не найдено».',
  ]
  return lines.join('\n')
}

export function apply(ctx, config) {
  const workspaceOf = (exec) => activeWorkspace(ctx, exec, config)
  const workspaceOfAgent = async (agent) => {
    const fromHeader = sessionWorkspace(ctx, agent?.id)
    if (fromHeader !== undefined) return fromHeader
    return activeWorkspace(ctx, { agent }, config)
  }

  if (typeof ctx.systemPrompt?.section === 'function') {
    ctx.systemPrompt.section({
      name: 'research-project-identity',
      order: 55,
      text: (context) => {
        const agent = context?.agent ?? context?.scope
        const workspace = agent !== undefined && typeof agent?.id === 'string' ? sessionWorkspace(ctx, agent.id) : undefined
        const marker = projectIdentity(workspace ?? '')
        if (marker === undefined) return ''
        return identityText(marker)
      },
    })
  }

  ctx.tools.register({
    name: 'research_init',
    description:
      'Turn a directory into a research project: creates the folder layout (literature, hypotheses, models, runs, data/raw, data/derived, analysis, paper, talks, admin), the forms (PROJECT.md brief, hypotheses/registry.md, run protocol, analysis and paper rules), AGENTS.md with the project rules, a guard policy protecting raw data, and the .dsh/research-project.json marker that makes every later session treat this directory as a research project. Idempotent: existing files are kept unless force is true.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name (default: directory name).' },
        brief: { type: 'string', description: 'One-line research question to seed PROJECT.md.' },
        path: { type: 'string', description: 'Project directory (default: the session workspace).' },
        force: { type: 'boolean', description: 'Rewrite the forms even when they exist (destructive to edits).' },
      },
    },
    output: {
      schema: { type: 'object' },
      render(args, value) {
        if (value?.ok !== true) return [{ type: 'text', text: `research_init: ${value?.error ?? 'failed'}` }]
        const lines = [`research project ready: ${value.project} (${value.workspace})`]
        lines.push(`folders: ${value.folders.length}`)
        if (value.created.length > 0) lines.push(`created: ${value.created.join(', ')}`)
        if (value.updated.length > 0) lines.push(`updated: ${value.updated.join(', ')}`)
        if (value.backedUp.length > 0) lines.push(`backed up before force: ${value.backedUp.join(', ')}`)
        if (value.skipped.length > 0) lines.push(`kept as-is: ${value.skipped.join(', ')}`)
        lines.push('next: fill PROJECT.md and hypotheses/registry.md, then work through runs/ and analysis/.')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const requested = typeof args?.path === 'string' && args.path.trim().length > 0 ? args.path.trim() : undefined
      const base = await workspaceOf(exec)
      const workspace = requested === undefined ? base : isAbsolute(requested) ? requested : resolve(base, requested)
      // The same rule the survey and the panels follow: this plugin writes inside
      // the project the session works in, never into an arbitrary directory that
      // came in as a tool argument.
      if (workspace !== base && !workspace.startsWith(`${base}${sep}`)) {
        return {
          ok: false,
          error: `research_init builds a project inside the session workspace (${base}); ${workspace} is outside it`,
          workspace,
        }
      }
      const report = await scaffoldResearchProject(workspace, { name: args?.name, brief: args?.brief, force: args?.force === true })
      try {
        await appendAutoNote(workspace, {
          sessionId: exec?.agent?.id ?? 'global',
          toolName: 'research_init',
          stepId: String(exec?.callId ?? 'scaffold'),
          artifacts: report.created.filter((entry) => !entry.endsWith('/')).map((path) => ({ path })),
        })
      } catch {
        /* the journal note is a convenience; the scaffold itself succeeded */
      }
      return report
    },
  })

  const commands = getService(ctx, 'commands')
  if (typeof commands?.register === 'function') commands.register({
    name: 'research-init',
    description: 'Create the research project infrastructure in this directory (folders, forms, AGENTS.md, journal marker)',
    input: { hint: '[название проекта]' },
    async handler(invocation) {
      try {
        const workspace = await workspaceOfAgent(invocation.agent)
        const name = invocation.rawInput.trim()
        const report = await scaffoldResearchProject(workspace, name.length > 0 ? { name } : {})
        try {
          await appendAutoNote(workspace, {
            sessionId: invocation.agent?.id ?? 'global',
            toolName: '/research-init',
            stepId: 'scaffold',
            artifacts: report.created.filter((entry) => !entry.endsWith('/')).slice(0, 40).map((path) => ({ path })),
          })
        } catch {
          /* the journal note is a convenience; the scaffold itself succeeded */
        }
        const parts = [`научный проект «${report.project}» готов: ${report.workspace}`]
        parts.push(`папок: ${report.folders.length}, создано файлов: ${report.created.filter((entry) => !entry.endsWith('/')).length}`)
        if (report.updated.length > 0) parts.push(`дополнено: ${report.updated.join(', ')}`)
        if (report.backedUp.length > 0) parts.push(`бэкап перед перезаписью: ${report.backedUp.join(', ')}`)
        if (report.skipped.length > 0) parts.push(`не тронуто: ${report.skipped.join(', ')}`)
        parts.push('дальше: заполнить PROJECT.md и hypotheses/registry.md, затем работать через runs/ и analysis/.')
        return { kind: 'success', text: parts.join('\n') }
      } catch (error) {
        return { kind: 'error', text: `research-init: ${String(error?.message ?? error)}` }
      }
    },
  })
}

export default { name, inject, apply }

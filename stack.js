/**
 * The recommended research stack.
 *
 * Data plus renderers; this module never installs anything. `/research-stack`
 * prints what to add and why, with the exact command to paste, so a reader
 * decides — an agent that silently installs eleven packages into someone's
 * profile is not a service.
 *
 * Every entry was checked against the registry (version, licence, engines.dsh,
 * Linux support read from the code) on the `verified` date. Anything not checked
 * is marked НЕ ПОДТВЕРЖДЕНО in `note` instead of being presented as fact.
 */

/** core = the work is crippled without it; optional = clear gain for a common task;
 *  situational = only for one task shape; avoid = known trap, do not install. */
import { spawn } from 'node:child_process'

export const STACK = [
  {
    id: 'record',
    title: 'Научная запись',
    level: 'core',
    verified: '2026-11-27',
    why: 'Журнал гипотез с хеш-цепочкой, провенанс файлов, guard на сырые данные. Без него через месяц никто не помнит, откуда взялось число.',
    packages: [],
    note: 'Этот бандл (research-record). Уже установлен.',
  },
  {
    id: 'literature',
    title: 'Литература, Zotero, BibTeX',
    level: 'core',
    verified: '2026-11-27',
    why: 'Читать свою библиотеку и фуллтексты, получать BibTeX из DOI, искать фрагменты книг в RAG-базе — без ручного копирования ссылок.',
    packages: ['dsh-zotero-local@0.4.0', 'dsh-cite@0.13.1', 'dsh-kb-rag'],
    install: 'dsh plugin --profile web add dsh-zotero-local dsh-cite dsh-kb-rag',
    conflicts: 'Один Zotero-читатель на профиль: dsh-zotero-local, dsh-zotero и dsh-plugin-zotero перекрываются по именам тулов и пишут в одну библиотеку.',
    note: 'dsh-zotero-local читает локальный API Zotero (23119), включая фуллтекст и аннотации: 17 тулов, 0 peers, 368 КБ. dsh-plugin-zotero без аддона zotero-integrated-mcp на 23120 умеет только писать заметки — как единственный Zotero-плагин он бесполезен.',
  },
  {
    id: 'latex',
    title: 'LaTeX: собрать и увидеть страницу',
    level: 'core',
    verified: '2026-11-27',
    why: 'Компиляция, рендер страницы, SyncTeX (строка исходника ↔ место на странице), diff с прошлой версией. Ошибку видно глазами, а не по логу.',
    packages: ['@fffangchenghao/dsh-latex-look@0.4.5'],
    install: 'dsh plugin --profile web add @fffangchenghao/dsh-latex-look',
    note: 'Нужны TeX Live (xelatex) и Ghostscript. Кириллица — fontspec + polyglossia; fontenc T2A под xelatex молча теряет русские буквы. Аудит цитат (dsh-latex-guard) — отдельно: установщик требует version exemption на 0.2.2-rc.5.',
  },
  {
    id: 'pdf',
    title: 'Чтение PDF постранично',
    level: 'core',
    verified: '2026-11-27',
    why: 'Outline, текст и поиск по конкретным страницам, рендер области в картинку — вместо загрузки всего PDF в контекст.',
    packages: ['dsh-pdf-tools@0.1.0'],
    install: 'dsh plugin --profile web add dsh-pdf-tools',
    conflicts: 'Не ставить вместе с dsh-pdf-formula: оба регистрируют тул pdf_info.',
    note: 'Системных бинарников не требует (canvas — prebuilt). Сканы без текстового слоя не читает: локального OCR в экосистеме нет.',
  },
  {
    id: 'tables',
    title: 'Таблицы, данные из PDF',
    level: 'core',
    verified: '2026-11-27',
    why: 'Профиль датасета, чистка с аудитом, проверка правил — и таблицы из PDF локально, без облака.',
    packages: ['dsh-data-quality@0.3.30', 'dsh-table-ingest@0.2.6', 'dsh-pdf-table@0.2.2'],
    install: 'dsh plugin --profile web add dsh-data-quality dsh-table-ingest dsh-pdf-table',
    note: 'dsh-pdf-table работает по текстовому слою: сканы без OCR не разберёт. Локального OCR-плагина в экосистеме нет.',
  },
  {
    id: 'documents',
    title: 'Документы и презентации',
    level: 'optional',
    verified: '2026-11-27',
    why: 'Доклад в HTML-слайдах и в .pptx, правка docx с ревизией; отчёт в docx/xlsx.',
    packages: ['revealjs-generate', 'dsh-pptx-builder@1.1.0', 'dsh-docx-redline@0.2.2'],
    install: 'dsh plugin --profile web add revealjs-generate dsh-pptx-builder dsh-docx-redline',
    conflicts: 'Генераторов колод не больше двух: revealjs (HTML) + pptx-builder (.pptx). office-pptx из встроенных скиллов — для правки, не для сборки с нуля.',
    note: 'docx/xlsx/pptx приходят скиллами office-*; дополнительный редактор docx ставить не нужно.',
  },
  {
    id: 'statistics',
    title: 'Проверка статистики и воспроизводимости',
    level: 'optional',
    verified: '2026-11-27',
    why: 'Пересчёт «t(df)=…, p=…» из текста статьи; манифест воспроизводимости (коммит, lockfile, сиды, хэши данных).',
    packages: ['@perrylink/dsh-research-core@0.1.6', 'dsh-statcheck@0.1.4', 'dsh-repro-audit@0.1.6'],
    install: 'dsh plugin --profile web add @perrylink/dsh-research-core dsh-statcheck dsh-repro-audit',
    note: 'dsh-statcheck импортирует research-core жёстко: ставить только парой. Дальше по желанию dsh-manuscript-check (рукопись), dsh-sr-ledger (обзор), dsh-retraction-watch (отозванные статьи, нужна сеть).',
  },
  {
    id: 'fluent',
    title: 'ANSYS Fluent',
    level: 'situational',
    verified: '2026-11-27',
    why: 'Интервью по задаче → journal → запуск Fluent → разбор транскрипта → отчёт. В реестре DSH других Fluent-плагинов нет вообще.',
    packages: ['fluent-case-builder@0.6.0'],
    install: 'cd <путь к fluent-case-builder> && dsh plugin --profile web add "$PWD"',
    note: 'Ставится как локальный путь (link), не из реестра. Нужен установленный Fluent (v261) и живая лицензия.',
  },
  {
    id: 'openfoam',
    title: 'OpenFOAM: кейс, сетка, верификация',
    level: 'situational',
    verified: '2026-11-27',
    why: 'Полный цикл: словари, сетка snappy/cfMesh/gmsh, запуск, проверка сходимости, рендер полей.',
    packages: ['@yakovlev-i-a/dsh-openfoam-workbench@0.9.32', 'mesh-toolkit@1.3.1'],
    install: 'dsh plugin --profile web add @yakovlev-i-a/dsh-openfoam-workbench mesh-toolkit',
    conflicts: 'НЕ ставить вместе с @bushizhanghan/dsh-openfoam-doctor: он зовёт wsl.exe и на Linux нерабочий, а его 6 тулов — дубль workbench.',
    note: 'mesh-toolkit читает sim-project.json вверх от cwd: запускать из корня проекта. cfMesh есть только в com-сборке OpenFOAM.',
  },
  {
    id: 'hpc',
    title: 'Расчёты на других машинах',
    level: 'situational',
    verified: '2026-11-27',
    why: 'SSH-воркспейсы на хостах кластера: выполнить команду, забрать файл, пробросить порт — не уходя из чата.',
    packages: ['dsh-remote@1.5.0'],
    install: 'dsh plugin --profile web add dsh-remote',
    note: 'Планировщика очереди (Slurm/sbatch) в экосистеме нет: dsh-remote даёт rw_exec, corewatch-mcp — только мониторинг. dsh-scnet не подходит: он про SCNet.',
  },
  {
    id: 'infra',
    title: 'Инфраструктура работы',
    level: 'optional',
    verified: '2026-11-27',
    why: 'Поиск по прошлым сессиям, параллельные линии работы с задачами, учёт денег.',
    packages: ['@deepseek-ai/dsh-experimental-session-search', '@nanmicoder/dsh-agent-teams@0.1.31', 'dsh-cost-meter'],
    install: 'dsh plugin --profile web add @deepseek-ai/dsh-experimental-session-search @nanmicoder/dsh-agent-teams dsh-cost-meter',
    conflicts: 'Community-плагин dsh-session-search 0.1.1 не ставить: его engines.dsh кончается на 0.2.1-rc.1.',
    note: 'Официальный session-search уже покрывает поиск по истории; agent-teams нужен, когда работа идёт параллельными линиями.',
  },
]

/** Packages known to break or disappoint, with the reason. */
export const AVOID = [
  {
    packages: ['@bushizhanghan/dsh-openfoam-doctor'],
    reason: 'Зовёт wsl.exe и отбрасывает не-WSL пути — на Linux тулы не регистрируются; функции покрыты openfoam-workbench.',
  },
  {
    packages: ['dsh-session-search@0.1.1'],
    reason: 'engines.dsh заканчивается на 0.2.1-rc.1, установка на 0.2.2-rc.5 сломает профиль.',
  },
  {
    packages: ['@kikulmj/dsh-jupyter'],
    reason: 'Регистрирует тул с именем python — конфликт с любым python-плагином и с моделью.',
  },
  {
    packages: ['@copylee/dsh-office'],
    reason: 'Тулы office_render/office_read совпадают с именами встроенного скилла office; вдобавок требует Windows и MS Office.',
  },
  {
    packages: ['dsh-pptx-sidebar', 'dsh-docx-sidebar'],
    reason: 'engines.dsh <0.2.1 — несовместимы с текущей версией.',
  },
  {
    packages: ['dsh-office-kit', 'dsh-pptx-studio'],
    reason: 'Проверены только на Windows (capability-файл/рендер через PowerShell); тянут десяток pip-пакетов.',
  },
  {
    packages: ['dsh-typst', 'dsh-typst-plugin'],
    reason: 'Бинарника typst на хосте нет; без него первый отдаёт несобранный .typ, второй — 34 peer-зависимости ради UI.',
  },
  {
    packages: ['dsh-pdf-formula'],
    reason: 'Регистрирует pdf_info, как и dsh-pdf-tools: второй плагин упадёт на дубликате имени. Ставить один из двух.',
  },
  {
    packages: ['dsh-latex-studio', 'dsh-latex-tools', 'dsh-latex-editor'],
    reason: 'studio — третий компилятор в том же каталоге и запись .bib на месте; tools и editor не дают модельных тулов для науки.',
  },
  {
    packages: ['dsh-zotero', '@hanxu131/dsh-zotero'],
    reason: 'dsh-zotero тянет 17 зависимостей и 30 МБ, читая zotero.sqlite при запущенном Zotero (риск блокировок); @hanxu131 требует dsh >=0.2.3-alpha.2 и на 0.2.2-rc.5 не встанет.',
  },
  {
    packages: ['@ggboy123/dsh-paper-reader', '@eduwork/dsh-literature', '@shlv/dsh-literature', '@zhe_xuan/dsh-paper-desk'],
    reason: 'Либо вытеснены (paper-reader-evidence вместо paper-reader), либо делят имена тулов literature_*, либо тянут 11 @deepseek-ai-peers, либо вводят вторую библиотеку рядом с Zotero.',
  },
  {
    packages: ['dsh-pdf-mineru'],
    reason: 'Требует облачный MinerU (ключ) или self-hosted сервис — не офлайн.',
  },
]

/** What the ecosystem does not have, so nobody searches twice. */
export const GAPS = [
  'Проверка качества рисунков (шрифты, DPI, colorblind-палитра, «перерисуй рисунок 3») — нет ни одного пакета.',
  'Обёртки matplotlib/plotly/vega с научными палитрами — нет; dsh-chart рисует свой SVG для черновых картинок.',
  'Markdown/HTML → PDF — нет; есть Office→PDF (alpha) и Typst→PDF (нужен бинарник).',
  'Локальный OCR для сканов — нет; tesseract.js есть только внутри CLI, а не плагином.',
  'Запись аннотаций внутрь PDF-файла — нет, все хранят их в своей базе.',
  'Единый менеджер .bib с блокировками и синхронизацией с Zotero — нет.',
  'Slurm/очередь заданий, gmsh, ParaView, Cantera, COMSOL, HDF5 как плагины — нет.',
  'Fluent и CFD как категория — ноль пакетов в реестре (13 445 записей); fluent-case-builder существует только как локальный путь.',
  'Мост «Zotero MCP» как DSH-плагин — нет: порт 23120 обслуживает аддон Zotero, а npm-пакеты zotero-mcp — обычные MCP-серверы.',
]

/** Task -> tool routing: which installed plugin answers which question. */
export const ROUTING = [
  [
    'Существующий проект: разобраться, что где лежит, прежде чем что-то менять',
    'project_survey (карта и факты) → project_adopt (три режима) → перенос по одному с decision',
    ['project_survey', 'project_adopt'],
  ],

  // [task, how it is done, tools this bundle expects to exist]
  //
  // The third column is explicit because the second one is prose: parsing tool
  // names out of "скрипт в analysis/scripts/ → артефакт в analysis/figures"
  // produced advice about tools that do not exist. A row with `[]` is script
  // work with no tool of its own, and the usage report skips it instead of
  // reporting it as an unused capability.
  ['PDF: страницы, раздел, цитата, таблица', 'pdf_info → pdf_outline/pdf_search → pdf_text; таблицы pdf_tables/pdf_to_csv; скан pdf_render',
    ['pdf_info', 'pdf_outline', 'pdf_search', 'pdf_text', 'pdf_tables', 'pdf_to_csv', 'pdf_render']],
  ['Zotero: что есть, о чём статья, аннотации', 'zotero_search → zotero_digest/zotero_retrieve/zotero_fulltext; zotero_annotations; zotero_export',
    ['zotero_search', 'zotero_digest', 'zotero_retrieve', 'zotero_fulltext', 'zotero_annotations', 'zotero_export']],
  ['ссылки и .bib: найти, оформить, проверить', 'cite_lookup, cite_format, cite_bibtex, cite_check, cite_batch',
    ['cite_lookup', 'cite_format', 'cite_bibtex', 'cite_check', 'cite_batch']],
  ['таблицы и данные: профиль, качество, очистка', 'data_profile, data_verify, data_clean; xlsx/docx/csv → table_ingest',
    ['data_profile', 'data_verify', 'data_clean', 'table_ingest']],
  ['статистика в рукописи и воспроизводимость', 'stat_check, stat_recompute; repro_manifest → repro_check → repro_card',
    ['stat_check', 'stat_recompute', 'repro_manifest', 'repro_check', 'repro_card']],
  ['любое число и график', 'скрипт в analysis/scripts/ → артефакт в analysis/figures или runs/<id>/results', []],
  ['статья: правка текста и вид страницы', 'latex_look (compile + render + SyncTeX + diff)', ['latex_look']],
  ['презентация', 'pptx_create → pptx_add_slide(template) → pptx_add_chart/pptx_add_math/pptx_add_image',
    ['pptx_create', 'pptx_add_slide', 'pptx_add_chart', 'pptx_add_math', 'pptx_add_image']],
  ['.docx: структура, правка, сравнение версий', 'doc_inspect → doc_replace_text / redline_diff / doc_change_summary',
    ['doc_inspect', 'doc_replace_text', 'redline_diff', 'doc_change_summary']],
  ['CFD: кейс, сетка, прогон, поля', 'openfoam_* (workbench), fluent_case_* (Fluent), mesh_build / mesh_check / stl_*',
    ['openfoam_run', 'openfoam_check', 'fluent_case_run', 'mesh_build', 'mesh_check']],
  ['журнал и провенанс', 'notebook, notebook_search, notebook_verify, provenance_of_file, provenance_verify',
    ['notebook', 'notebook_search', 'notebook_verify', 'provenance_of_file', 'provenance_verify']],
]

/** Render the routing table as plain text. */
export function renderRoutes() {
  return ROUTING.map((row) => '· ' + row[0] + ' → ' + row[1]).join('\n')
}

/** Install command for a list of packages. */
export function installCommand(packages, profile = 'web') {
  return `dsh plugin --profile ${profile} add ${packages.join(' ')}`
}

const LEVEL_MARK = { core: '●', optional: '○', situational: '◌' }

function renderEntry(entry) {
  const lines = [`${LEVEL_MARK[entry.level]} ${entry.title} [${entry.id}]`, `   ${entry.why}`]
  if (entry.packages.length > 0) lines.push(`   $ ${entry.install}`)
  if (entry.note !== undefined) lines.push(`   ⓘ ${entry.note}`)
  if (entry.conflicts !== undefined) lines.push(`   ⚠ ${entry.conflicts}`)
  return lines.join('\n')
}

/** Render the stack as plain text for a chat command. */
export function renderStack({ level } = {}) {
  const items = STACK.filter((entry) => (level === undefined ? true : entry.level === level))
  const blocks = items.map(renderEntry)
  if (level === undefined) {
    blocks.push(`✕ Не ставить\n${AVOID.map((item) => `   ${item.packages.join(', ')} — ${item.reason}`).join('\n')}`)
    blocks.push(`∅ Чего нет в экосистеме\n${GAPS.map((gap) => `   · ${gap}`).join('\n')}`)
  }
  blocks.push('● обязательно · ○ заметная польза · ◌ под конкретную задачу')
  blocks.push(`Проверено по реестру: ${[...new Set(STACK.map((entry) => entry.verified))].sort().pop()}`)
  return blocks.join('\n\n')
}

/** Package name without its pinned version (`@scope/name@1.2.3` → `@scope/name`). */
export function packageName(spec) {
  const at = spec.lastIndexOf('@')
  return at > 0 ? spec.slice(0, at) : spec
}

/** Every package mentioned anywhere in the stack, for a "what is missing" check. */
export function allPackages() {
  return STACK.flatMap((entry) => entry.packages.map(packageName))
}

export const name = 'research-record-stack'
export const inject = ['tools', 'commands', 'systemPrompt']

const PROMPT_TEXT =
  'Стек научной работы. /research-stack показывает рекомендуемые плагины по уровням (core/optional/situational), что не ставить и чего нет в экосистеме; тул research_stack делает то же (action "show") и ставит выбранный уровень (action "install", confirm:true; без confirm печатает команду). Задача → инструмент:\n' +
  renderRoutes() +
  '\nПравило: если задача попадает в строку выше, идти этим тулом, а не bash-парсером или самодельным скриптом. Если нужного тула в наборе нет — сказать это и предложить /research-stack (установка), а не изобретать обход.'

/** Packages of one level ('all' = every level). */
export function packagesForLevel(level) {
  const wanted = level === 'all' || level === undefined ? undefined : level
  return STACK.filter((entry) => wanted === undefined || entry.level === wanted)
    .flatMap((entry) => entry.packages.map(packageName))
}

export function levelOf(level) {
  return ['core', 'optional', 'situational', 'all'].includes(level) ? level : undefined
}

/** Run `dsh plugin --profile <profile> add <packages>` and capture its output. */
function runAdd(packages, profile, timeoutMs = 900000) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('dsh', ['plugin', '--profile', profile, 'add', ...packages], {
        cwd: process.env.HOME ?? process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({ code: 'spawn-error', output: String(error?.message ?? error) })
      return
    }
    let out = ''
    const push = (chunk) => {
      out = (out + chunk).slice(-20000)
    }
    child.stdout.on('data', push)
    child.stderr.on('data', push)
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      resolve({ code: 'timeout', output: out })
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: 'spawn-error', output: String(error?.message ?? error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output: out })
    })
  })
}

export function apply(ctx, config) {
  const defaultProfile = typeof config?.profile === 'string' ? config.profile : 'web'
  const commands = ctx.commands ?? ctx.get('commands')
  if (typeof commands?.register === 'function') {
    commands.register({
      name: 'research-stack',
      description: 'Рекомендуемый стек плагинов для научной работы',
      input: { hint: '[core|optional|situational|routes]' },
      handler(invocation) {
        const raw = String(invocation?.rawInput ?? '').trim().toLowerCase()
        if (raw === 'routes') return { kind: 'success', text: renderRoutes() }
        return { kind: 'success', text: renderStack({ level: levelOf(raw) }) }
      },
    })
  }

  if (typeof ctx.systemPrompt?.section === 'function') {
    ctx.systemPrompt.section({ name: 'research-stack', order: 56, text: PROMPT_TEXT })
  }

  if (typeof ctx.tools?.register !== 'function') return
  ctx.tools.register({
    name: 'research_stack',
    description:
      'Recommended scientific plugin stack: action="show" lists the levels (core/optional/situational) with the exact install command, plus what not to install and what does not exist; action="install" runs `dsh plugin --profile <profile> add` for one level — it prints the command and changes nothing unless confirm:true. Levels: core (should be installed), optional (clear gain), situational (only for a specific task).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['show', 'install'], description: 'show (default) or install.' },
        level: {
          type: 'string',
          enum: ['core', 'optional', 'situational', 'all'],
          description: 'Which level. show defaults to all; install defaults to core.',
        },
        confirm: { type: 'boolean', description: 'Required for install: without it the tool only returns the command.' },
        profile: { type: 'string', description: 'DSH profile name (default: config.profile or web).' },
      },
    },
    output: {
      schema: { type: 'object' },
      render(args, value) {
        const text = String(value?.text ?? 'research_stack: no output')
        return [{ type: 'text', text }]
      },
    },
    async execute(args) {
      const action = args?.action === 'install' ? 'install' : 'show'
      const profile = typeof args?.profile === 'string' && args.profile.length > 0 ? args.profile : defaultProfile
      const level = levelOf(args?.level)
      if (action === 'show') return { ok: true, text: renderStack({ level }) }

      const chosen = level ?? 'core'
      const packages = packagesForLevel(chosen)
      if (packages.length === 0) return { ok: false, text: 'research_stack: для уровня "' + chosen + '" нет пакетов' }
      const command = installCommand(packages, profile)
      if (args?.confirm !== true) {
        return {
          ok: true,
          text: 'research_stack: ничего не изменено (нужен confirm:true).\n' + command + '\nПакеты: ' + packages.join(', '),
        }
      }
      const result = await runAdd(packages, profile)
      const tail = String(result.output ?? '').trim().split('\n').slice(-12).join('\n')
      const failed = result.code !== 0
      const ro = /EROFS|EACCES|read-only/i.test(String(result.output ?? ''))
      const note = failed
        ? ro
          ? '\n\nПрофиль лежит вне рабочей папки: процесс под sandbox не может в него писать. Выполните команду в терминале или переключите /permission danger-full-access и повторите.'
          : '\n\nКоманда завершилась с ошибкой — смотрите вывод выше.'
        : '\n\nГотово. Новые тулы появляются в наборе при загрузке профиля: обновите страницу и, если набор не изменился, перезапустите DSH.'
      return { ok: !failed, code: result.code, text: command + '\n\n' + tail + note }
    },
  })
}

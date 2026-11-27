# Рекомендуемый стек для научной работы

`research-record` даёт научную запись: журнал гипотез, провенанс файлов, guard на
сырые данные, каркас проекта и два правила (`не выдумывать` и `считать скриптом`).
Всё остальное — чтение литературы, вёрстка статьи, таблицы, расчёты — берётся
отдельными плагинами. Этот файл говорит, какие именно ставить, в каком порядке и
чего избегать. Ничего не устанавливается автоматически: каждая строка — команда,
которую вы запускаете сами.

Проверено по реестру npm и по коду пакетов **2026-11-27** (DSH 0.2.2-rc.5, Debian,
TeX Live 2023, Fluent v261, OpenFOAM com/org, Zotero с локальным API на 23119).
Версии зафиксированы на этот день; установщик сам откажется ставить то, что не
подходит к вашей версии DSH.

Быстрый просмотр из чата: `/research-stack` (все уровни), `/research-stack core`
(только обязательное), `/research-stack optional`, `/research-stack situational`,
`/research-stack routes` (какая задача каким тулом решается).

Установка — тем же путём, без копирования команд из файла: попросите агента
«поставь рекомендованный стек» — он вызовет тул `research_stack` с уровнем.
Тул **ничего не делает без `confirm: true`**: сначала печатает точную команду.
С `confirm: true` он запускает `dsh plugin --profile web add …` и возвращает
вывод; если профиль закрыт sandbox'ом (`EROFS`), он так и скажет и предложит
терминал или `/permission danger-full-access`.

## Уровни

| Знак | Уровень | Что значит |
| --- | --- | --- |
| ● | core | без этого научная работа в DSH неполна: литература, статья, данные |
| ○ | optional | заметная польза для типичной задачи, но можно жить без него |
| ◌ | situational | только если задача именно такая (Fluent, OpenFOAM, кластер) |
| ✕ | не ставить | известно, что сломается или разочарует — и почему |

## ● Обязательное

### Литература, Zotero, BibTeX

```bash
dsh plugin --profile web add dsh-zotero-local dsh-cite dsh-kb-rag
```

- `dsh-zotero-local` 0.4.0 — 17 тулов: коллекции, поиск, фуллтекст PDF, заметки,
  аннотации, экспорт. Работает с локальным API Zotero (порт 23119), аддонов не
  требует, зависимостей нет, 368 КБ.
- `dsh-cite` 0.13.1 — BibTeX из DOI (Crossref), дедупликация, проверка ключей.
  Держит свой store и пишет `.bib` только при экспорте, поэтому не воюет с LaTeX.
- `dsh-kb-rag` — RAG по локальным PDF и книгам: `kb_ingest`, `kb_rag`, `kb_search`.

Один Zotero-читатель на профиль. `dsh-plugin-zotero` (панель + запись заметок)
умеет читать только через аддон `zotero-integrated-mcp` на порту 23120; без
аддона это 5 тулов записи и ноль чтения, поэтому как единственный Zotero-плагин
он не годится.

### LaTeX: собрать и увидеть страницу

```bash
dsh plugin --profile web add @fffangchenghao/dsh-latex-look
```

`latex_look` компилирует (xelatex/lualatex/pdflatex/latexmk), рендерит страницу в
картинку, находит исходную строку по тексту на странице (SyncTeX) и показывает
diff с предыдущей сборкой. Нужны TeX Live и Ghostscript.

Кириллица: `fontspec` + `polyglossia`, а не `fontenc T2A` — под xelatex последний
молча теряет русские буквы (в PDF остаются пустые места, в логе только warning).

`dsh-latex-guard` (аудит `\cite` против `.bib`) — отдельное решение: на 0.2.2-rc.5
установщик требует version exemption, потому что плагин объявляет
`@deepseek-ai/dsh-tools ^0.1.1-rc.1`.

### Таблицы и данные

```bash
dsh plugin --profile web add dsh-data-quality dsh-table-ingest dsh-pdf-table
```

- `dsh-data-quality` — профиль датасета, чистка с аудитом, проверка правил,
  отчёт (`data_profile`, `data_clean`, `data_verify`, `data_report`).
- `dsh-table-ingest` — таблица из docx/xlsx/csv в JSON для проверок.
- `dsh-pdf-table` — таблицы из PDF по текстовому слою, в CSV с sha256.

Сканы без текстового слоя `dsh-pdf-table` не разберёт: локального OCR в
экосистеме нет.

### Чтение PDF постранично

```bash
dsh plugin --profile web add dsh-pdf-tools
```

`pdf_info`, `pdf_outline`, `pdf_text`, `pdf_search`, `pdf_render` — читать нужные
страницы и рендерить область в картинку вместо загрузки всего PDF в контекст.
Системных бинарников не требует. Не ставить вместе с `dsh-pdf-formula`: оба
регистрируют `pdf_info`.

## ○ Заметная польза

### Документы и презентации

```bash
dsh plugin --profile web add revealjs-generate dsh-pptx-builder dsh-docx-redline
```

- `revealjs-generate` — HTML-слайды (темы, фрагменты, заметки докладчика).
- `dsh-pptx-builder` 1.1.0 — .pptx с нуля, свой OOXML, математика без LaTeX, 0
  зависимостей и 0 peers. Чистейший pptx-путь в реестре.
- `dsh-docx-redline` 0.2.2 — по-фракционный SHA-256, 13 структурных счётчиков,
  построчный diff версий docx: ревизия рукописи.

docx/xlsx/pptx создаются и читаются встроенными скиллами `office-*` плюс
LibreOffice (`office_render`, `office_convert`). Второй редактор docx не нужен.

### Проверка статистики и воспроизводимости

```bash
dsh plugin --profile web add @perrylink/dsh-research-core dsh-statcheck dsh-repro-audit
```

- `@perrylink/dsh-research-core` 0.1.6 — REP v1: схема «источник → снапшот →
  доказательство → утверждение → вердикт». База для следующих пакетов.
- `dsh-statcheck` 0.1.4 — пересчитывает `t(df)=…, p=…` из текста статьи и
  показывает точные диапазоны символов; SARIF-отчёт.
- `dsh-repro-audit` 0.1.6 — манифест воспроизводимости: коммит и грязность git,
  lockfiles, пины окружения, хэши данных и рисунков, сиды; проверка дрейфа.

`dsh-statcheck` импортирует `research-core` жёстко (не optional-peer) — ставить
только парой. Дальше по желанию: `dsh-manuscript-check` (разделы рукописи и
чек-листы CONSORT/STROBE/PRISMA), `dsh-sr-ledger` (систематический обзор,
PRISMA-поток), `dsh-retraction-watch` (отозванные статьи; нужна сеть).

### Инфраструктура работы

```bash
dsh plugin --profile web add @deepseek-ai/dsh-experimental-session-search @nanmicoder/dsh-agent-teams dsh-cost-meter
```

Поиск по прошлым сессиям, параллельные линии работы с DAG задач и качественными
гейтами, учёт денег по запросам. Community-плагин `dsh-session-search` 0.1.1 не
ставить: его `engines.dsh` заканчивается на `0.2.1-rc.1`.

## ◌ Под конкретную задачу

### ANSYS Fluent

```bash
cd <путь к fluent-case-builder> && dsh plugin --profile web add "$PWD"
```

`fluent_case_interview` → `fluent_case_plan` → `fluent_case_generate` →
`fluent_case_run` → `fluent_case_status`, плюс база знаний TUI и отчёт
сопровождающему. В реестре DSH других Fluent-плагинов нет вообще (0 совпадений на
13 445 записей) — это локальный пакет, а не реестровый.

### OpenFOAM: кейс, сетка, верификация

```bash
dsh plugin --profile web add @yakovlev-i-a/dsh-openfoam-workbench mesh-toolkit
```

`dsh-openfoam-workbench` 0.9.32 — 65 тулов и 11 скиллов: словари, кейс, запуск,
проверка сходимости, рендер полей, поиск по исходникам, карточки опыта.
`mesh-toolkit` 1.3.1 — STL → сетка (snappy/cfMesh/gmsh) → гейт качества →
доставка в OpenFOAM и Fluent `.msh`.

**Не ставить** `@bushizhanghan/dsh-openfoam-doctor`: он зовёт `wsl.exe` и
отбрасывает не-WSL пути, на Linux тулы вообще не регистрируются, а его шесть
функций полностью покрыты workbench.

`mesh-toolkit` ищет `sim-project.json` вверх от текущего каталога — запускать его
из корня проекта. cfMesh есть только в сборке com2606.

### Расчёты на других машинах

```bash
dsh plugin --profile web add dsh-remote
```

SSH-воркспейсы на хостах кластера: `rw_exec`, чтение и запись файлов, проброс
портов. Планировщика очереди (Slurm/sbatch) в экосистеме нет: `dsh-remote` даёт
выполнение, `corewatch-mcp` — только мониторинг машин. `dsh-scnet` не подходит —
он про китайскую сеть SCNet.

## ✕ Не ставить

| Пакет | Почему |
| --- | --- |
| `@bushizhanghan/dsh-openfoam-doctor` | WSL-only: `spawn('wsl.exe')`, `isWslPath` отбрасывает `/home/...`; на Linux тулы не регистрируются |
| `dsh-session-search` 0.1.1 | `engines.dsh` до `0.2.1-rc.1` — установка на 0.2.2-rc.5 ломает профиль |
| `@kikulmj/dsh-jupyter` | Регистрирует тул с именем `python` — конфликт с любым python-плагином |
| `@copylee/dsh-office` | Тулы `office_render`/`office_read` совпадают со встроенным скиллом `office`; требует Windows и MS Office |
| `dsh-pptx-sidebar`, `dsh-docx-sidebar` | `engines.dsh <0.2.1` |
| `dsh-office-kit`, `dsh-pptx-studio` | Проверены только на Windows (PowerShell-рендер), тянут десяток pip-пакетов |
| `dsh-typst`, `dsh-typst-plugin` | Бинарника `typst` нет: первый отдаёт несобранный `.typ`, второй — 34 peer-зависимости ради UI |
| `dsh-pdf-mineru` | Облачный MinerU или self-hosted сервис, не офлайн |
| `dsh-pdf-formula` | `pdf_info` совпадает с `dsh-pdf-tools` — второй плагин упадёт на дубликате |
| `dsh-latex-studio`, `dsh-latex-tools`, `@salism3/dsh-latex-editor` | Третий компилятор в том же каталоге (общий `.aux`), запись `.bib` на месте; у tools и editor нет модельных тулов |
| `dsh-zotero`, `@hanxu131/dsh-zotero` | Первый: 17 зависимостей, 30 МБ и чтение `zotero.sqlite` при запущенном Zotero (блокировки); второй требует `dsh >=0.2.3-alpha.2` |
| `@ggboy123/dsh-paper-reader`, `@eduwork/dsh-literature`, `@shlv/dsh-literature`, `@zhe_xuan/dsh-paper-desk` | Вытеснены (`-evidence` вместо reader), делят имена `literature_*`, тянут 11 `@deepseek-ai`-peers или вводят вторую библиотеку рядом с Zotero |
| `dsh-carsi-papers`, `dsh-scihub` | Правовые и этические флаги: доступ к платным базам и Sci-Hub |
| `dsh-ustc-latex-agent` | GPL-3.0 и внешний сервис co-editing |

## Чего нет в экосистеме (не искать заново)

- Проверки качества рисунков: шрифты, DPI, colorblind-палитра, «перерисуй рисунок 3».
- Обёрток matplotlib/plotly/vega с научными палитрами: `dsh-chart` рисует свой SVG для черновых картинок, `dsh-chart-ascii` — в терминал.
- Markdown/HTML → PDF: есть только Office→PDF (alpha) и Typst→PDF (нужен бинарник).
- Локального OCR: `tesseract.js` встречается лишь внутри CLI, не плагином.
- Записи аннотаций внутрь PDF-файла: все плагины хранят их в своей базе или в Zotero.
- Единого менеджера `.bib` с блокировками и синхронизацией с Zotero.
- Slurm/очереди заданий, gmsh, ParaView, Cantera, COMSOL, HDF5 как плагинов.
- Fluent и CFD как категории: ноль пакетов в реестре.
- Моста «Zotero MCP» как DSH-плагина: порт 23120 обслуживает аддон Zotero, а npm-пакеты `zotero-mcp*` — обычные MCP-серверы.

## Что уже закрыто установленным

| Категория | Чем закрыто |
| --- | --- |
| Рисунки публикационного качества | `latex_look` + TeX Live + matplotlib на хосте; плагин не нужен |
| Таблицы из офисных файлов | `table_ingest`, `data_profile/clean/verify/report` |
| HTML-слайды | `revealjs_generate` |
| docx/xlsx/pptx | встроенные скиллы `office-*` + LibreOffice |
| Литература | `dsh-zotero-local` (или Zotero-панель), `kb_rag`, экспорт `.bib` |
| Проверка вёрстки глазами | `latex_look` + `modlens_read_image` |

## Порядок установки

1. `dsh plugin --profile web add dsh-zotero-local dsh-cite dsh-kb-rag`
2. `dsh plugin --profile web add dsh-pdf-tools dsh-pdf-table dsh-data-quality dsh-table-ingest`
3. `dsh plugin --profile web add @fffangchenghao/dsh-latex-look` (если ещё нет)
4. по задаче: `dsh-remote`, `fluent-case-builder`, `dsh-openfoam-workbench` + `mesh-toolkit`
5. по желанию: статистика, документы, инфраструктура

После установки перезапустите DSH: каталог тулов фиксируется на сессию, иначе
новые тулы в открытом чате не появятся.

## Карта «задача → тул»

Это не украшение: те же строки стоят в промпте (`research-stack`, order 56),
поэтому агент выбирает инструмент по задаче, а не по тому, что первым попалось
под руку.

| Задача | Чем решается |
| --- | --- |
| PDF: страницы, раздел, цитата, таблица | `pdf_info` → `pdf_outline`/`pdf_search` → `pdf_text`; таблицы `pdf_tables`/`pdf_to_csv`; `pdf_render` только для страниц без текста |
| Zotero: что есть, о чём статья, аннотации | `zotero_search` → `zotero_digest`/`zotero_retrieve`/`zotero_fulltext`, `zotero_annotations`, `zotero_export` |
| Ссылки и `.bib` | `cite_lookup`, `cite_format`, `cite_bibtex`, `cite_check`, `cite_batch` |
| Таблицы и данные | `data_profile`, `data_verify`, `data_clean`; `table_ingest` для xlsx/docx/csv |
| Статистика и воспроизводимость | `stat_check`, `stat_recompute`; `repro_manifest` → `repro_check` → `repro_card` |
| Любое число в ответе или статье | скрипт в `analysis/scripts/`, артефакт в `analysis/figures` или `runs/<id>/results` |
| Вид страницы статьи | `latex_look` (сборка + рендер + SyncTeX + diff) |
| Презентация | `pptx_create` → `pptx_add_slide(template)` → `pptx_add_chart`/`pptx_add_math` |
| `.docx` на вычитку | `doc_inspect` → `doc_replace_text`/`redline_diff`/`doc_change_summary` |
| CFD: кейс, сетка, прогон, поля | `openfoam_*`, `fluent_case_*`, `mesh_build`/`mesh_check`/`stl_*` |
| Журнал и провенанс | `notebook`, `notebook_search`, `notebook_verify`, `provenance_of_file`, `provenance_verify` |

Если нужного тула в сессии нет — это не повод писать парсер на bash: скажите,
чего не хватает, и поставьте бандл из таблицы выше.

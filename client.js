/**
 * dsh-research-record — browser half.
 *
 * Two surfaces, both read-only:
 *   - `sidebar.panellist` + `main` (key `notebook`): the hash-chained journal of
 *     the current workspace, with the chain verdict one click away;
 *   - `sidebar.right.tab.document.actions` (+ the file-list slots): a
 *     `Provenance` button that opens the lineage of the previewed file.
 *
 * The browser cannot read `.dsh/`, so both surfaces go through the two
 * read-only HTTP routes the host halves register (`/notebook`, `/provenance`).
 * A failure to reach them renders as a line of text, never as a thrown error:
 * a broken panel must not take the conversation down.
 */
window.__ModuleLoader__.load({
  id: 'dsh-research-record',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-research-record'

    /** Kept in sync with locale/en.json; the panel also needs a fallback when
     * the locale service is not reachable yet. */
    const DICTS = {
      en: {
        panel: 'Notebook',
        title: 'Research notebook',
        subtitle: 'Hash-chained journal of this workspace',
        empty: 'No records yet. A hypothesis goes in before the run, an observation with its numbers and artifact path after it.',
        filter: 'Type',
        all: 'All',
        verify: 'Verify chain',
        verified: 'Chain intact',
        broken: 'Chain broken',
        refresh: 'Refresh',
        loading: 'Reading the journal…',
        unreachable: 'The notebook route is not reachable from this panel.',
        unverified: 'unverified',
        missing: 'artifact missing',
        superseded: 'superseded',
        artifacts: 'Artifacts',
        evidence: 'Evidence',
        warnings: 'Warnings',
        provenance: 'Provenance',
        provenanceTitle: 'Provenance',
        provenanceEmpty: 'No recorded step produced this file yet.',
        inputs: 'Inputs',
        observed: 'observed',
        inferred: 'inferred',
        previous: 'previous version',
        close: 'Close',
        records: 'records',
        corrupt: 'corrupt lines',
      },
      ru: {
        panel: 'Журнал',
        title: 'Лабораторный журнал',
        subtitle: 'Журнал этого workspace с хеш-цепочкой',
        empty: 'Записей пока нет. Гипотеза пишется до прогона, наблюдение — после, с числами и путём к артефакту.',
        filter: 'Тип',
        all: 'Все',
        verify: 'Проверить цепочку',
        verified: 'Цепочка цела',
        broken: 'Цепочка нарушена',
        refresh: 'Обновить',
        loading: 'Читаю журнал…',
        unreachable: 'Маршрут журнала недоступен из этой панели.',
        unverified: 'не подтверждено',
        missing: 'артефакт отсутствует',
        superseded: 'заменено',
        artifacts: 'Артефакты',
        evidence: 'Свидетельства',
        warnings: 'Предупреждения',
        provenance: 'Происхождение',
        provenanceTitle: 'Происхождение',
        provenanceEmpty: 'Ни один записанный шаг пока не создавал этот файл.',
        inputs: 'Входы',
        observed: 'наблюдено',
        inferred: 'выведено',
        previous: 'предыдущая версия',
        close: 'Закрыть',
        records: 'записей',
        corrupt: 'битых строк',
      },
    }

    const CSS = [
      '.rr-root{display:flex;flex-direction:column;gap:10px;padding:12px;height:100%;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px;min-height:0}',
      '.rr-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}',
      '.rr-title{font-weight:600;font-size:14px}',
      '.rr-muted{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.rr-actions{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap}',
      '.rr-btn{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;padding:3px 9px;font-size:12px;cursor:pointer;line-height:18px}',
      '.rr-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.rr-btn.rr-ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary);padding:2px 6px}',
      '.rr-btn[disabled]{opacity:.5;cursor:default}',
      '.rr-verdict{border-radius:6px;padding:5px 8px;font-size:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
      '.rr-ok{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}',
      '.rr-bad{border-color:#d9534f;color:#d9534f}',
      '.rr-list{display:flex;flex-direction:column;gap:6px;overflow:auto;min-height:0;flex:1;padding-right:2px}',
      '.rr-row{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:7px 9px;cursor:pointer}',
      '.rr-row:hover{border-color:var(--dsw-alias-brand-primary)}',
      '.rr-rowHead{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}',
      '.rr-type{font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:4px;padding:0 5px;line-height:16px}',
      '.rr-rowTitle{font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.rr-badge{font-size:11px;color:#c98a00}',
      '.rr-badge.rr-miss{color:#d9534f}',
      '.rr-badge.rr-sup{color:var(--dsw-alias-label-secondary)}',
      '.rr-hash{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.rr-detail{margin-top:7px;border-top:1px dashed var(--dsw-alias-border-l1);padding-top:7px;display:flex;flex-direction:column;gap:6px;font-size:12px}',
      '.rr-body{white-space:pre-wrap;word-break:break-word;font-size:12px}',
      '.rr-kv{display:flex;gap:6px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary)}',
      '.rr-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}',
      '.rr-warn{color:#c98a00}',
      '.rr-list-inline{display:flex;flex-direction:column;gap:2px}',
      '.rr-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:2000;padding:24px}',
      '.rr-modal{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;max-width:760px;width:100%;max-height:80vh;display:flex;flex-direction:column;gap:8px;padding:14px;box-sizing:border-box}',
      '.rr-modalHead{display:flex;align-items:baseline;gap:8px}',
      '.rr-modalBody{overflow:auto;display:flex;flex-direction:column;gap:8px;font-size:12px;min-height:0}',
      '.rr-node{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 8px;background:var(--dsw-alias-bg-layer-1)}',
      '.rr-icon{display:block}',
    ].join('\n')

    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + NS + '"]') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = NS
      tag.dataset.pluginCss = NS
      tag.textContent = CSS
      document.head.append(tag)
    }

    function localeOf(ctx) {
      try {
        const service = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
        const value = typeof service?.getLocale === 'function' ? service.getLocale() : service?.locale
        return typeof value === 'string' ? value.slice(0, 2) : 'en'
      } catch {
        return 'en'
      }
    }

    function dictFor(locale) {
      return DICTS[locale] ?? DICTS.en
    }

    /** The panel needs the workspace to ask `/notebook` for the right journal;
     * the service shape is versioned, so every hop is optional. */
    function resolveWorkspace(ctx) {
      try {
        const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
        const list = typeof sessions?.list?.getSnapshot === 'function' ? sessions.list.getSnapshot() : undefined
        const byId = list?.byId ?? {}
        const active = typeof sessions?.active?.getSnapshot === 'function' ? sessions.active.getSnapshot() : undefined
        const id = active?.id ?? active?.sessionId ?? sessions?.activeId ?? list?.activeId
        const cwd = (id !== undefined ? byId[id]?.cwd : undefined) ?? Object.values(byId)[0]?.cwd
        return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
      } catch {
        return undefined
      }
    }

    async function fetchJson(url) {
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
      return payload
    }

    function withWorkspace(path, workspace) {
      if (typeof workspace !== 'string' || workspace.length === 0) return path
      return `${path}${path.includes('?') ? '&' : '?'}workspace=${encodeURIComponent(workspace)}`
    }

    function shortHash(hash) {
      return typeof hash === 'string' && hash.length >= 12 ? `${hash.slice(0, 10)}…` : String(hash ?? '')
    }

    function recordBadges(record, dict) {
      const badges = []
      if (record.execution?.state === 'unverified') badges.push(h('span', { className: 'rr-badge', key: 'unv' }, dict.unverified))
      if (Array.isArray(record.artifacts) && record.artifacts.some((a) => a?.status === 'missing')) badges.push(h('span', { className: 'rr-badge rr-miss', key: 'miss' }, dict.missing))
      if (record.supersededBy !== null && record.supersededBy !== undefined) badges.push(h('span', { className: 'rr-badge rr-sup', key: 'sup' }, dict.superseded))
      return badges
    }

    const PanelIcon = (props) =>
      h(
        'svg',
        { className: 'rr-icon', width: props?.size ?? 18, height: props?.size ?? 18, viewBox: '0 0 48 48', 'aria-hidden': 'true', fill: 'none' },
        h('rect', { x: 11, y: 4, width: 26, height: 40, rx: 4, stroke: 'currentColor', strokeWidth: 2.5, opacity: 0.55 }),
        h('rect', { x: 17, y: 11, width: 14, height: 2.5, rx: 1.25, fill: 'currentColor' }),
        h('rect', { x: 17, y: 17, width: 10, height: 2.5, rx: 1.25, fill: 'currentColor', opacity: 0.7 }),
        h('circle', { cx: 17, cy: 32, r: 3, stroke: 'currentColor', strokeWidth: 2 }),
        h('circle', { cx: 25, cy: 32, r: 3, stroke: 'currentColor', strokeWidth: 2 }),
        h('circle', { cx: 33, cy: 32, r: 3, stroke: 'currentColor', strokeWidth: 2 }),
        h('path', { d: 'M20 32h2M28 32h2', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }),
      )

    function RecordRow(props) {
      const { record, dict } = props
      const [open, setOpen] = React.useState(false)
      const artifacts = Array.isArray(record.artifacts) ? record.artifacts : []
      const evidence = Array.isArray(record.evidence) ? record.evidence : []
      return h(
        'div',
        { className: 'rr-row', onClick: () => setOpen(!open), role: 'button', tabIndex: 0, onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(!open) } } },
        h(
          'div',
          { className: 'rr-rowHead' },
          h('span', { className: 'rr-type' }, record.type),
          h('span', { className: 'rr-rowTitle', title: record.title }, record.title ?? ''),
          ...recordBadges(record, dict),
          h('span', { className: 'rr-hash', title: record.hash }, shortHash(record.hash)),
        ),
        open
          ? h(
              'div',
              { className: 'rr-detail' },
              h('div', { className: 'rr-kv' }, h('span', { className: 'rr-mono' }, record.id), h('span', null, record.createdAt ?? '')),
              typeof record.body === 'string' && record.body.length > 0 ? h('div', { className: 'rr-body' }, record.body) : null,
              record.execution !== null && record.execution !== undefined
                ? h('div', { className: 'rr-kv' }, h('span', null, `execution: ${record.execution.state}`), typeof record.execution.evidence === 'string' ? h('span', { className: 'rr-mono' }, record.execution.evidence) : null)
                : null,
              artifacts.length > 0
                ? h(
                    'div',
                    { className: 'rr-list-inline' },
                    h('div', { className: 'rr-muted' }, dict.artifacts),
                    ...artifacts.map((artifact, index) =>
                      h('div', { key: `a${index}`, className: artifact?.status === 'missing' ? 'rr-badge rr-miss' : 'rr-kv' }, h('span', { className: 'rr-mono' }, String(artifact?.path ?? '')), h('span', null, String(artifact?.status ?? ''))),
                    ),
                  )
                : null,
              evidence.length > 0
                ? h(
                    'div',
                    { className: 'rr-list-inline' },
                    h('div', { className: 'rr-muted' }, dict.evidence),
                    ...evidence.map((item, index) => h('div', { key: `e${index}`, className: 'rr-kv' }, h('span', { className: 'rr-mono' }, String(item?.entryId ?? '')), h('span', null, String(item?.relation ?? '')), typeof item?.rationale === 'string' ? h('span', null, item.rationale) : null)),
                  )
                : null,
              Array.isArray(record.warnings) && record.warnings.length > 0 ? h('div', { className: 'rr-warn' }, record.warnings.join(' · ')) : null,
              record.supersededBy ? h('div', { className: 'rr-muted' }, `${dict.superseded}: ${record.supersededBy}`) : null,
            )
          : null,
      )
    }

    function NotebookPanel(props) {
      const dict = dictFor(props.locale)
      const workspace = props.workspace
      const [state, setState] = React.useState({ loading: true, records: [], error: null, corrupt: 0 })
      const [verify, setVerify] = React.useState(null)
      const [filter, setFilter] = React.useState('all')

      const load = React.useCallback(async () => {
        setState((previous) => ({ ...previous, loading: true, error: null }))
        try {
          const payload = await fetchJson(withWorkspace('/notebook', workspace))
          if (payload?.ok !== true) throw new Error(payload?.error ?? 'notebook route failed')
          setState({ loading: false, records: Array.isArray(payload.records) ? payload.records : [], error: null, corrupt: Number(payload.corrupt ?? 0) })
        } catch (error) {
          setState({ loading: false, records: [], error: String(error?.message ?? error), corrupt: 0 })
        }
      }, [workspace])

      React.useEffect(() => {
        load()
      }, [load])

      const runVerify = async () => {
        try {
          const payload = await fetchJson(withWorkspace('/notebook?verify=1', workspace))
          setVerify(payload?.verify ?? { ok: false, brokenAt: { reason: payload?.error ?? 'no verdict' } })
        } catch (error) {
          setVerify({ ok: false, brokenAt: { reason: String(error?.message ?? error) } })
        }
      }

      const types = React.useMemo(() => {
        const seen = new Set()
        for (const record of state.records) if (typeof record?.type === 'string') seen.add(record.type)
        return ['all', ...seen]
      }, [state.records])

      const visible = filter === 'all' ? state.records : state.records.filter((record) => record?.type === filter)

      return h(
        'div',
        { className: 'rr-root' },
        h(
          'div',
          { className: 'rr-head' },
          h('span', { className: 'rr-title' }, dict.title),
          h('span', { className: 'rr-muted' }, `${state.records.length} ${dict.records}${state.corrupt > 0 ? ` · ${state.corrupt} ${dict.corrupt}` : ''}`),
          h(
            'div',
            { className: 'rr-actions' },
            h('button', { className: 'rr-btn', onClick: load, disabled: state.loading }, dict.refresh),
            h('button', { className: 'rr-btn', onClick: runVerify }, dict.verify),
          ),
        ),
        h('div', { className: 'rr-muted' }, dict.subtitle),
        verify !== null
          ? h(
              'div',
              { className: `rr-verdict ${verify.ok === true ? 'rr-ok' : 'rr-bad'}` },
              verify.ok === true ? `${dict.verified} — ${verify.records} ${dict.records}` : `${dict.broken}: ${verify.brokenAt?.file ?? ''}:${verify.brokenAt?.line ?? ''} ${verify.brokenAt?.reason ?? ''}`,
            )
          : null,
        state.error !== null ? h('div', { className: 'rr-verdict rr-bad' }, `${dict.unreachable} ${state.error}`) : null,
        types.length > 1
          ? h(
              'div',
              { className: 'rr-kv' },
              h('span', { className: 'rr-muted' }, dict.filter),
              ...types.map((type) => h('button', { key: type, className: `rr-btn${type === filter ? '' : ' rr-ghost'}`, onClick: () => setFilter(type) }, type === 'all' ? dict.all : type)),
            )
          : null,
        h(
          'div',
          { className: 'rr-list' },
          state.loading ? h('div', { className: 'rr-muted' }, dict.loading) : visible.length === 0 ? h('div', { className: 'rr-muted' }, dict.empty) : visible.map((record) => h(RecordRow, { key: record.id, record, dict })),
        ),
      )
    }

    function ProvenanceModal(props) {
      const { dict, path, workspace, onClose } = props
      const [state, setState] = React.useState({ loading: true, data: null, error: null })

      React.useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const query = `${withWorkspace('/provenance', workspace)}&path=${encodeURIComponent(path)}`
            const payload = await fetchJson(query)
            if (alive) setState({ loading: false, data: payload, error: null })
          } catch (error) {
            if (alive) setState({ loading: false, data: null, error: String(error?.message ?? error) })
          }
        })()
        return () => {
          alive = false
        }
      }, [path, workspace])

      const nodes = Array.isArray(state.data?.nodes) ? state.data.nodes : []
      return h(
        'div',
        { className: 'rr-overlay', onClick: onClose, role: 'presentation' },
        h(
          'div',
          { className: 'rr-modal', onClick: (event) => event.stopPropagation(), role: 'dialog', 'aria-modal': 'true' },
          h(
            'div',
            { className: 'rr-modalHead' },
            h('span', { className: 'rr-title' }, dict.provenanceTitle),
            h('span', { className: 'rr-muted rr-mono' }, path),
            h('div', { className: 'rr-actions' }, h('button', { className: 'rr-btn', onClick: onClose }, dict.close)),
          ),
          h(
            'div',
            { className: 'rr-modalBody' },
            state.loading
              ? h('div', { className: 'rr-muted' }, dict.loading)
              : state.error !== null
                ? h('div', { className: 'rr-verdict rr-bad' }, state.error)
                : nodes.length === 0
                  ? h('div', { className: 'rr-muted' }, dict.provenanceEmpty)
                  : nodes.map((node, index) =>
                      h(
                        'div',
                        { className: 'rr-node', key: `${node.path}-${index}` },
                        h('div', { className: 'rr-kv' }, h('span', { className: 'rr-mono' }, node.path), h('span', { className: 'rr-hash' }, shortHash(node.sha256))),
                        node.producedBy
                          ? h(
                              'div',
                              { className: 'rr-kv' },
                              h('span', null, `${node.producedBy.toolName} @ ${node.producedBy.timestamp}`),
                              h('span', null, node.producedBy.fidelity === 'inferred' ? dict.inferred : dict.observed),
                              h('span', null, `${dict.inputs}: ${Array.isArray(node.inputs) ? node.inputs.length : 0}`),
                            )
                          : h('div', { className: 'rr-muted' }, '—'),
                        node.previousSha256 ? h('div', { className: 'rr-muted rr-mono' }, `${dict.previous} ${shortHash(node.previousSha256)}`) : null,
                      ),
                    ),
          ),
        ),
      )
    }

    function ProvenanceAction(props) {
      const dict = dictFor(props.locale)
      const [open, setOpen] = React.useState(false)
      const path = props.absolutePath ?? props.path ?? props.filePath
      if (typeof path !== 'string' || path.length === 0) return null
      return h(
        React.Fragment,
        null,
        h(
          'button',
          {
            className: 'rr-btn',
            title: dict.provenance,
            onClick: (event) => {
              event.stopPropagation()
              setOpen(true)
            },
          },
          dict.provenance,
        ),
        open ? h(ProvenanceModal, { dict, path, workspace: props.workspace, onClose: () => setOpen(false) }) : null,
      )
    }

    const inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, DICTS), 'dsh-research-record: dictionaries')

      const locale = localeOf(ctx)
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'notebook',
            order: 20,
            locale: NS,
            label: () => dictFor(localeOf(ctx)).panel,
            inject: () => ({ workspace: resolveWorkspace(ctx), locale: localeOf(ctx) }),
          },
          PanelIcon,
        ),
      )
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: 'notebook' }, NotebookPanel),
      )

      // The document action slot appears in more than one build under two
      // spellings; injecting a name that does not exist is a no-op, so both are
      // requested and whichever exists shows the button.
      for (const slot of ['sidebar.right.tab.document.actions', 'sidebar.right.tab.document.action', 'deliverables.file.actions', 'deliverables.review.file.actions']) {
        ctx.slots.inject(slot, () =>
          ctx.slots.register(
            {
              name: slot,
              id: 'dsh-research-record-provenance',
              order: 40,
              locale: NS,
              inject: () => ({ workspace: resolveWorkspace(ctx), locale: localeOf(ctx) }),
            },
            ProvenanceAction,
          ),
        )
      }

      void locale
    }

    const exports = { inject, apply }
    return exports
  },
})

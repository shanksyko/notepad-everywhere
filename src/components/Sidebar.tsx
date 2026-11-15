import { useMemo, useRef, useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight, Command, FileAudio, FileImage, FileText, FileVideo, MoreHorizontal, Network, Paperclip, Plus, Search, Trash2, X, FolderPlus, ArrowUp, ArrowDown, IndentIncrease, IndentDecrease } from 'lucide-react'
import { actions, childrenOf, pageMastery, pathOf, useStore } from '../store'
import type { Mastery, MediaKind, TreeNode } from '../db'
import { MASTERY_COLOR, MASTERY_LABEL } from '../lib/srs'
import { ICONS, TAG_COLORS, stripHtml } from '../lib/util'

const MEDIA: [MediaKind, string, any][] = [
  ['image', 'Imagens', FileImage],
  ['video', 'Vídeos', FileVideo],
  ['audio', 'Áudios', FileAudio],
  ['pdf', 'PDFs', FileText],
  ['other', 'Outros', Paperclip],
]

let dragId: string | null = null

function Row({ node, depth, onMenu }: { node: TreeNode; depth: number; onMenu: (id: string, x: number, y: number) => void }) {
  const nodes = useStore((s) => s.nodes)
  const cards = useStore((s) => s.cards)
  const current = useStore((s) => s.currentId === node.id && s.view === 'page')
  const kids = childrenOf(nodes, node.id)
  const [zone, setZone] = useState<'' | 'before' | 'after' | 'inside'>('')
  const [rename, setRename] = useState(false)
  const m = pageMastery(node, cards)
  const cycle = (e: React.MouseEvent) => {
    e.stopPropagation()
    const order: (Mastery | null)[] = [null, 0, 1, 2]
    actions.patchNode(node.id, { masteryManual: order[(order.indexOf(node.masteryManual) + 1) % 4] })
  }
  return (
    <div>
      <div
        className={`tree-row group flex items-center gap-1 pr-1 h-[30px] rounded-md cursor-pointer select-none ${zone ? 'drop-' + zone : ''} ${current ? 'bg-panel2 text-fg' : 'text-fg/85 hover:bg-panel2/60'}`}
        style={{ paddingLeft: 4 + depth * 14 }}
        role="treeitem"
        tabIndex={0}
        data-node-id={node.id}
        aria-level={depth + 1}
        aria-selected={current}
        aria-expanded={kids.length ? !node.collapsed : undefined}
        aria-label={`${node.title}. Domínio: ${MASTERY_LABEL[m]}`}
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).tagName === 'INPUT') return
          const rows = [...document.querySelectorAll<HTMLElement>('.tree-row')]
          const at = rows.indexOf(e.currentTarget)
          const refocus = () => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`)?.focus())
          const sibs = childrenOf(nodes, node.parentId)
          const si = sibs.findIndex((s) => s.id === node.id)
          let done = true
          if (e.altKey && e.key === 'ArrowUp') sibs[si - 1] && (actions.moveNode(node.id, sibs[si - 1].id, 'before'), refocus())
          else if (e.altKey && e.key === 'ArrowDown') sibs[si + 1] && (actions.moveNode(node.id, sibs[si + 1].id, 'after'), refocus())
          else if (e.altKey && e.key === 'ArrowRight') sibs[si - 1] && (actions.moveNode(node.id, sibs[si - 1].id, 'inside'), refocus())
          else if (e.altKey && e.key === 'ArrowLeft') node.parentId && (actions.moveNode(node.id, node.parentId, 'after'), refocus())
          else if (e.key === 'ArrowDown') rows[at + 1]?.focus()
          else if (e.key === 'ArrowUp') rows[at - 1]?.focus()
          else if (e.key === 'ArrowRight') kids.length && (node.collapsed ? actions.patchNode(node.id, { collapsed: false }) : rows[at + 1]?.focus())
          else if (e.key === 'ArrowLeft') kids.length && !node.collapsed ? actions.patchNode(node.id, { collapsed: true }) : node.parentId && document.querySelector<HTMLElement>(`[data-node-id="${node.parentId}"]`)?.focus()
          else if (e.key === 'Enter' || e.key === ' ') actions.select(node.id)
          else if (e.key === 'F2') setRename(true)
          else if (e.key === 'Delete') confirm(`Mover "${node.title}" e as subpáginas para a lixeira? Dá para restaurar por 30 dias.`) && actions.deleteNode(node.id)
          else done = false
          if (done) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        draggable={!rename}
        onDragStart={(e) => {
          dragId = node.id
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', node.title)
        }}
        onDragEnd={() => (dragId = null)}
        onDragOver={(e) => {
          if (!dragId || dragId === node.id) return
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          const y = (e.clientY - r.top) / r.height
          setZone(y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside')
        }}
        onDragLeave={() => setZone('')}
        onDrop={(e) => {
          e.preventDefault()
          if (dragId && zone) actions.moveNode(dragId, node.id, zone)
          setZone('')
          dragId = null
        }}
        onClick={() => actions.select(node.id)}
        onDoubleClick={() => setRename(true)}
        onContextMenu={(e) => {
          e.preventDefault()
          onMenu(node.id, e.clientX, e.clientY)
        }}
      >
        <button
          className={'w-4 h-4 flex items-center justify-center text-muted shrink-0 ' + (kids.length ? '' : 'invisible')}
          onClick={(e) => {
            e.stopPropagation()
            actions.patchNode(node.id, { collapsed: !node.collapsed })
          }}
        >
          {node.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <span className="text-[14px] w-5 text-center shrink-0">{node.icon}</span>
        {rename ? (
          <input
            autoFocus
            defaultValue={node.title}
            className="flex-1 min-w-0 !py-0 text-[13px]"
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              actions.patchNode(node.id, { title: e.target.value.trim() || node.title })
              setRename(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setRename(false)
            }}
          />
        ) : (
          <span className={'truncate text-[13px] flex-1 ' + (node.kind !== 'page' ? 'font-semibold' : '')}>{node.title}</span>
        )}
        {node.tags.map((t) => (
          <span key={t.label} title={t.label} className="text-[9.5px] px-1.5 rounded-full shrink-0 hidden xl:inline leading-[15px]" style={{ background: t.color + '2e', color: t.color }}>
            {t.label}
          </span>
        ))}
        <button className="hidden group-hover:flex w-5 h-5 items-center justify-center text-muted hover:text-fg shrink-0" title="Nova subpágina" onClick={(e) => (e.stopPropagation(), actions.createNode(node.id))}>
          <Plus size={13} />
        </button>
        <button
          className="hidden group-hover:flex w-5 h-5 items-center justify-center text-muted hover:text-fg shrink-0"
          title="Ícone, tags, excluir…"
          onClick={(e) => {
            e.stopPropagation()
            onMenu(node.id, e.clientX, e.clientY)
          }}
        >
          <MoreHorizontal size={13} />
        </button>
        <button
          className="w-4 h-4 flex items-center justify-center shrink-0"
          title={`Domínio: ${MASTERY_LABEL[m]} (${node.masteryManual == null ? 'automático via SRS' : 'manual'}) — clique para alterar`}
          onClick={cycle}
        >
          <span className="w-2 h-2 rounded-full" style={{ background: MASTERY_COLOR[m], boxShadow: node.masteryManual != null ? `0 0 0 2px var(--panel), 0 0 0 3px ${MASTERY_COLOR[m]}` : `0 0 6px ${MASTERY_COLOR[m]}` }} />
        </button>
      </div>
      {!node.collapsed && kids.map((k) => <Row key={k.id} node={k} depth={depth + 1} onMenu={onMenu} />)}
    </div>
  )
}

function NodeMenu({ id, x, y, onClose }: { id: string; x: number; y: number; onClose: () => void }) {
  const node = useStore((s) => s.nodes[id])
  const [tag, setTag] = useState('')
  const [color, setColor] = useState(TAG_COLORS[4])
  const all = useStore((s) => s.nodes)
  if (!node) return null
  const sibs = childrenOf(all, node.parentId)
  const at = sibs.findIndex((s) => s.id === id)
  const prev = sibs[at - 1]
  const next = sibs[at + 1]
  const addTag = () => {
    if (!tag.trim()) return
    actions.patchNode(id, { tags: [...node.tags.filter((t) => t.label !== tag.trim()), { label: tag.trim(), color }] })
    setTag('')
  }
  return (
    <div className="fixed inset-0 z-[85]" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onContextMenu={(e) => (e.preventDefault(), onClose())}>
      <div className="pop pop-in absolute w-64 p-3 flex flex-col gap-2.5 text-[13px]" style={{ left: Math.min(x, innerWidth - 270), top: Math.max(8, Math.min(y, innerHeight - 500)) }}>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-muted">Nome</span>
          <input
            defaultValue={node.title}
            className="font-semibold"
            onFocus={(e) => e.target.select()}
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== node.title && actions.patchNode(id, { title: e.target.value.trim() })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                ;(e.target as HTMLInputElement).blur()
                onClose()
              }
            }}
          />
        </label>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Ícone</div>
          <div className="grid grid-cols-9 gap-0.5">
            {ICONS.map((ic) => (
              <button key={ic} className={'h-6 rounded hover:bg-panel2 ' + (node.icon === ic ? 'bg-panel2 ring-1 ring-accent' : '')} onClick={() => actions.patchNode(id, { icon: ic })}>
                {ic}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Tags</div>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {node.tags.map((t) => (
              <span key={t.label} className="text-[11px] pl-2 pr-1 rounded-full flex items-center gap-0.5" style={{ background: t.color + '2e', color: t.color }}>
                {t.label}
                <button onClick={() => actions.patchNode(id, { tags: node.tags.filter((x) => x.label !== t.label) })}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <input value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} placeholder="nova tag" className="flex-1 min-w-0 !py-0.5" />
            <button className="btn !px-2" onClick={addTag}>
              <Plus size={12} />
            </button>
          </div>
          <div className="flex gap-1 mt-1.5">
            {TAG_COLORS.map((c) => (
              <button key={c} className="w-4 h-4 rounded-full" style={{ background: c, outline: c === color ? '2px solid var(--fg)' : 'none', outlineOffset: 1 }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <div className="grid grid-cols-2 gap-1">
            <button className="btn !justify-center" disabled={!prev} style={{ opacity: prev ? 1 : 0.4 }} onClick={() => prev && actions.moveNode(id, prev.id, 'before')}>
              <ArrowUp size={13} /> Subir
            </button>
            <button className="btn !justify-center" disabled={!next} style={{ opacity: next ? 1 : 0.4 }} onClick={() => next && actions.moveNode(id, next.id, 'after')}>
              <ArrowDown size={13} /> Descer
            </button>
            <button className="btn !justify-center" title="Tornar subpágina da página de cima" disabled={!prev} style={{ opacity: prev ? 1 : 0.4 }} onClick={() => prev && actions.moveNode(id, prev.id, 'inside')}>
              <IndentIncrease size={13} /> Para dentro
            </button>
            <button className="btn !justify-center" title="Levar para o nível de cima" disabled={!node.parentId} style={{ opacity: node.parentId ? 1 : 0.4 }} onClick={() => node.parentId && actions.moveNode(id, node.parentId, 'after')}>
              <IndentDecrease size={13} /> Para fora
            </button>
          </div>
          <button className="btn !justify-start" onClick={() => (actions.createNode(id), onClose())}>
            <Plus size={13} /> Nova subpágina
          </button>
          <button className="btn !justify-start" onClick={() => (actions.createNode(id, 'section', 'Nova seção'), onClose())}>
            <FolderPlus size={13} /> Nova seção
          </button>
          <button
            className="btn !justify-start !text-red-400"
            onClick={() => {
              if (confirm(`Mover "${node.title}" e as subpáginas para a lixeira? Dá para restaurar por 30 dias.`)) actions.deleteNode(id)
              onClose()
            }}
          >
            <Trash2 size={13} /> Excluir
          </button>
        </div>
      </div>
    </div>
  )
}

function snippet(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return ''
  const s = Math.max(0, i - 28)
  return (s > 0 ? '…' : '') + text.slice(s, i + q.length + 50).replace(/\s+/g, ' ') + '…'
}

export function Sidebar() {
  const nodes = useStore((s) => s.nodes)
  const terms = useStore((s) => s.terms)
  const view = useStore((s) => s.view)
  const filter = useStore((s) => s.mediaFilter)
  const paletteKey = useStore((s) => s.shortcuts.palette)
  const trashCount = useStore((s) => s.trash.length)
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const roots = childrenOf(nodes, null)
  const query = q.trim().toLowerCase()

  const results = useMemo(() => {
    if (!query && !filter.length) return null
    const pages = Object.values(nodes)
      .filter((n) => !filter.length || n.mediaKinds.some((k) => filter.includes(k)))
      .map((n) => {
        if (!query) return { n, score: 1, snip: n.mediaKinds.join(', ') }
        const inTitle = n.title.toLowerCase().includes(query)
        const inTag = n.tags.some((t) => t.label.toLowerCase().includes(query))
        const snip = snippet(n.text, query)
        return { n, score: (inTitle ? 3 : 0) + (inTag ? 2 : 0) + (snip ? 1 : 0), snip: snip || (inTag ? 'tag: ' + n.tags.map((t) => t.label).join(', ') : '') }
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
    const ts = query
      ? Object.values(terms)
          .map((t) => {
            const def = stripHtml(t.html)
            const hit = t.term.toLowerCase().includes(query) || t.aliases.some((a) => a.toLowerCase().includes(query))
            return { t, score: (hit ? 2 : 0) + (def.toLowerCase().includes(query) ? 1 : 0), def }
          })
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
      : []
    return { pages, terms: ts }
  }, [query, filter, nodes, terms])

  const toggleFilter = (k: MediaKind) => useStore.setState({ mediaFilter: filter.includes(k) ? filter.filter((x) => x !== k) : [...filter, k] })

  return (
    <aside className="w-[290px] shrink-0 border-r border-line bg-panel flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 px-3 h-11 border-b border-line shrink-0">
        <img src="./icon.png" alt="" className="w-6 h-6 shrink-0" draggable={false} />
        <span className="font-semibold tracking-tight flex-1 truncate">Notepad Everywhere</span>
        <button className={'icon-btn ' + (view === 'graph' ? 'on' : '')} title="Grafo de conhecimento" onClick={() => useStore.setState({ view: view === 'graph' ? 'page' : 'graph' })}>
          <Network size={16} />
        </button>
        <button className="icon-btn" title="Novo caderno" onClick={() => actions.createNode(null, 'notebook', 'Novo caderno')}>
          <Plus size={16} />
        </button>
      </div>
      <div className="p-2 flex flex-col gap-1.5 border-b border-line shrink-0">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar em títulos, conteúdo, tags, glossário…" className="w-full !pl-7 !pr-7 text-[13px]" onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
          {q ? (
            <button className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted" onClick={() => setQ('')}>
              <X size={13} />
            </button>
          ) : (
            <button className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted" title={'Paleta de comandos' + (paletteKey ? ` (${paletteKey})` : '')} onClick={() => useStore.setState({ palette: { mode: 'commands' } })}>
              <Command size={13} />
            </button>
          )}
        </div>
        <div className="flex gap-1">
          {MEDIA.map(([k, label, Icon]) => (
            <button key={k} title={'Filtrar páginas com: ' + label} className={'flex-1 h-6 rounded-md flex items-center justify-center border ' + (filter.includes(k) ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-fg')} onClick={() => toggleFilter(k)}>
              <Icon size={13} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto p-1.5">
        {results ? (
          <div className="flex flex-col gap-0.5">
            <div className="text-[10px] uppercase tracking-wider text-muted px-2 py-1">Páginas ({results.pages.length})</div>
            {results.pages.map(({ n, snip }) => (
              <button key={n.id} className="text-left px-2 py-1.5 rounded-md hover:bg-panel2" onClick={() => actions.select(n.id)}>
                <div className="text-[13px] truncate">
                  {n.icon} {n.title}
                </div>
                <div className="text-[11px] text-muted truncate">{pathOf(nodes, n.id).slice(0, -1).map((p) => p.title).join(' › ')}</div>
                {snip && <div className="text-[11.5px] text-muted line-clamp-2">{snip}</div>}
              </button>
            ))}
            {query && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-muted px-2 py-1 mt-2">Glossário ({results.terms.length})</div>
                {results.terms.map(({ t, def }) => (
                  <button key={t.id} data-term-id={t.id} className="text-left px-2 py-1.5 rounded-md hover:bg-panel2">
                    <div className="text-[13px] flex items-center gap-1.5">
                      <BookOpen size={12} className="text-gloss" /> {t.term}
                    </div>
                    <div className="text-[11.5px] text-muted line-clamp-2">{def}</div>
                  </button>
                ))}
              </>
            )}
            {!results.pages.length && !results.terms.length && <div className="text-muted text-xs px-2 py-4">Nada encontrado.</div>}
          </div>
        ) : (
          <>
            <div role="tree" aria-label="Cadernos e páginas. Setas navegam, Enter abre, F2 renomeia, Alt+setas movem a página.">
              {roots.map((r) => (
                <Row key={r.id} node={r} depth={0} onMenu={(id, x, y) => setMenu({ id, x, y })} />
              ))}
            </div>
            <div
              className="h-16"
              onDragOver={(e) => dragId && e.preventDefault()}
              onDrop={() => {
                if (dragId && roots.length) actions.moveNode(dragId, roots[roots.length - 1].id, 'after')
                dragId = null
              }}
            />
          </>
        )}
      </div>
      <div className="px-3 py-1.5 border-t border-line text-[11px] text-muted flex items-center gap-3 shrink-0">
        {[0, 1, 2].map((m) => (
          <span key={m} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: MASTERY_COLOR[m] }} />
            {['Novo', 'Aprendendo', 'Dominado'][m]}
          </span>
        ))}
        <button className="ml-auto flex items-center gap-1 hover:text-fg" title="Lixeira: páginas excluídas nos últimos 30 dias" onClick={() => useStore.setState({ trashOpen: true })}>
          <Trash2 size={12} /> {trashCount || ''}
        </button>
      </div>
      {menu && <NodeMenu {...menu} onClose={() => setMenu(null)} />}
    </aside>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { actions, pageMastery, useStore } from '../store'
import { findTerms } from '../lib/matcher'
import { MASTERY_COLOR } from '../lib/srs'
import { stripHtml } from '../lib/util'

interface GNode {
  id: string
  kind: 'page' | 'term'
  label: string
  color: string
  x: number
  y: number
  vx: number
  vy: number
  deg: number
  fixed?: boolean
}
interface GEdge {
  a: string
  b: string
  kind: 'tree' | 'link' | 'term'
}

/** Grafo de conhecimento: páginas ↔ termos do glossário ↔ links. Simulação de forças própria (SVG). */
export function GraphView() {
  const nodes = useStore((s) => s.nodes)
  const terms = useStore((s) => s.terms)
  const cards = useStore((s) => s.cards)
  const currentId = useStore((s) => s.currentId)
  const [, tick] = useState(0)
  const [hover, setHover] = useState<string | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const svgRef = useRef<SVGSVGElement>(null)
  const pos = useRef(new Map<string, GNode>())
  const dragging = useRef<{ id: string | null; moved: boolean; px: number; py: number } | null>(null)
  const alpha = useRef(1)

  const graph = useMemo(() => {
    const edges: GEdge[] = []
    const seen = new Set<string>()
    const add = (a: string, b: string, kind: GEdge['kind']) => {
      if (a === b) return
      const k = [a, b].sort().join('|')
      if (seen.has(k)) return
      seen.add(k)
      edges.push({ a, b, kind })
    }
    for (const n of Object.values(nodes)) {
      for (const l of n.linkIds) if (nodes[l]) add('p:' + n.id, 'p:' + l, 'link')
      const tids = new Set([...n.termIds, ...findTerms(n.text).map((m) => m.termId)])
      tids.forEach((t) => terms[t] && add('p:' + n.id, 't:' + t, 'term'))
    }
    for (const t of Object.values(terms)) {
      if (t.pageId && nodes[t.pageId]) add('t:' + t.id, 'p:' + t.pageId, 'link')
      findTerms(stripHtml(t.html), t.id).forEach((m) => add('t:' + t.id, 't:' + m.termId, 'term'))
    }
    for (const n of Object.values(nodes)) if (n.parentId && nodes[n.parentId]) add('p:' + n.id, 'p:' + n.parentId, 'tree')
    const list: GNode[] = []
    const old = pos.current
    const mk = (id: string, kind: GNode['kind'], label: string, color: string, i: number, total: number) => {
      const o = old.get(id)
      const ang = (i / total) * Math.PI * 2
      list.push({ id, kind, label, color, x: o?.x ?? Math.cos(ang) * 260 + (Math.random() - 0.5) * 40, y: o?.y ?? Math.sin(ang) * 220 + (Math.random() - 0.5) * 40, vx: 0, vy: 0, deg: 0, fixed: o?.fixed })
    }
    const total = Object.keys(nodes).length + Object.keys(terms).length
    let i = 0
    Object.values(nodes).forEach((n) => mk('p:' + n.id, 'page', `${n.icon} ${n.title}`, MASTERY_COLOR[pageMastery(n, cards)], i++, total))
    Object.values(terms).forEach((t) => mk('t:' + t.id, 'term', t.term, 'var(--gloss)', i++, total))
    const map = new Map(list.map((n) => [n.id, n]))
    edges.forEach((e) => {
      map.get(e.a)!.deg++
      map.get(e.b)!.deg++
    })
    pos.current = map
    alpha.current = 1
    return { list, edges }
  }, [nodes, terms, cards])

  useEffect(() => {
    let raf = 0
    const step = () => {
      const a = alpha.current
      if (a > 0.02) {
        const ns = graph.list
        for (let i = 0; i < ns.length; i++)
          for (let j = i + 1; j < ns.length; j++) {
            const p = ns[i], q = ns[j]
            let dx = p.x - q.x, dy = p.y - q.y
            const d2 = dx * dx + dy * dy + 0.01
            const f = (5200 / d2) * a
            const d = Math.sqrt(d2)
            dx /= d
            dy /= d
            p.vx += dx * f
            p.vy += dy * f
            q.vx -= dx * f
            q.vy -= dy * f
          }
        for (const e of graph.edges) {
          const p = pos.current.get(e.a)!, q = pos.current.get(e.b)!
          const dx = q.x - p.x, dy = q.y - p.y
          const d = Math.sqrt(dx * dx + dy * dy) + 0.01
          const rest = e.kind === 'tree' ? 150 : 110
          const f = ((d - rest) / d) * 0.045 * a * (e.kind === 'tree' ? 0.5 : 1)
          p.vx += dx * f
          p.vy += dy * f
          q.vx -= dx * f
          q.vy -= dy * f
        }
        for (const n of ns) {
          n.vx -= n.x * 0.006 * a
          n.vy -= n.y * 0.008 * a
          if (!n.fixed) {
            n.x += Math.max(-30, Math.min(30, n.vx))
            n.y += Math.max(-30, Math.min(30, n.vy))
          }
          n.vx *= 0.82
          n.vy *= 0.82
        }
        alpha.current *= 0.992
        tick((t) => t + 1)
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [graph])

  const neighbors = useMemo(() => {
    if (!hover) return null
    const s = new Set([hover])
    graph.edges.forEach((e) => {
      if (e.a === hover) s.add(e.b)
      if (e.b === hover) s.add(e.a)
    })
    return s
  }, [hover, graph])

  const toWorld = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: (cx - r.left - r.width / 2 - view.x) / view.k, y: (cy - r.top - r.height / 2 - view.y) / view.k }
  }

  return (
    <div className="flex-1 relative overflow-hidden bg-bg">
      <div className="absolute top-3 left-4 z-10 pointer-events-none">
        <div className="font-semibold text-[15px]">Grafo de Conhecimento</div>
        <div className="text-xs text-muted">Arraste os nós · role para zoom · clique em uma página para abrir · passe o mouse sobre um termo para ver o pop-up</div>
        <div className="flex gap-3 text-[11px] text-muted mt-1.5">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-gloss" /> termo do glossário
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: MASTERY_COLOR[0] }} />
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: MASTERY_COLOR[1] }} />
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: MASTERY_COLOR[2] }} /> página (cor = domínio)
          </span>
        </div>
      </div>
      <div className="absolute top-3 right-4 z-10 flex gap-1">
        <button className="btn" title="Diminuir zoom" onClick={() => setView((v) => ({ ...v, k: Math.max(0.3, v.k / 1.25) }))}>
          −
        </button>
        <button className="btn" title="Aumentar zoom" onClick={() => setView((v) => ({ ...v, k: Math.min(3, v.k * 1.25) }))}>
          +
        </button>
        <button className="btn" title="Centralizar e restaurar o zoom" onClick={() => setView({ x: 0, y: 0, k: 1 })}>
          Centralizar
        </button>
        <button className="btn btn-accent" onClick={() => useStore.setState({ view: 'page' })}>
          Voltar para a página
        </button>
      </div>
      <svg
        ref={svgRef}
        className="w-full h-full cursor-grab"
        onWheel={(e) => setView((v) => ({ ...v, k: Math.max(0.3, Math.min(3, v.k * (e.deltaY < 0 ? 1.1 : 0.9))) }))}
        onPointerDown={(e) => {
          if (e.target === svgRef.current) {
            dragging.current = { id: null, moved: false, px: e.clientX, py: e.clientY }
            svgRef.current!.setPointerCapture(e.pointerId)
          }
        }}
        onPointerMove={(e) => {
          const d = dragging.current
          if (!d) return
          if (Math.abs(e.clientX - d.px) + Math.abs(e.clientY - d.py) > 3) d.moved = true
          if (d.id) {
            const n = pos.current.get(d.id)!
            const w = toWorld(e.clientX, e.clientY)
            n.x = w.x
            n.y = w.y
            n.fixed = true
            alpha.current = Math.max(alpha.current, 0.3)
          } else {
            setView((v) => ({ ...v, x: v.x + e.clientX - d.px, y: v.y + e.clientY - d.py }))
            d.px = e.clientX
            d.py = e.clientY
          }
        }}
        onPointerUp={() => {
          const d = dragging.current
          if (d?.id) {
            const n = pos.current.get(d.id)!
            n.fixed = false
            if (!d.moved && n.kind === 'page') actions.select(n.id.slice(2))
            else if (!d.moved) actions.pin({ kind: 'term', id: n.id.slice(2), x: Math.min(d.px + 14, innerWidth - 360), y: Math.min(d.py + 14, innerHeight - 300) })
          }
          dragging.current = null
        }}
      >
        <g style={{ transform: `translate(calc(50% + ${view.x}px), calc(50% + ${view.y}px)) scale(${view.k})` }}>
          {graph.edges.map((e, i) => {
            const p = pos.current.get(e.a)!, q = pos.current.get(e.b)!
            const hot = neighbors && (e.a === hover || e.b === hover)
            return (
              <line
                key={i}
                x1={p.x}
                y1={p.y}
                x2={q.x}
                y2={q.y}
                stroke={hot ? 'var(--accent)' : e.kind === 'term' ? 'var(--gloss)' : 'var(--muted)'}
                strokeOpacity={neighbors ? (hot ? 0.9 : 0.06) : e.kind === 'tree' ? 0.22 : 0.4}
                strokeWidth={hot ? 1.8 : 1}
                strokeDasharray={e.kind === 'tree' ? '4 4' : undefined}
              />
            )
          })}
          {graph.list.map((n) => {
            const r = (n.kind === 'page' ? 9 : 6) + Math.min(8, n.deg * 0.9)
            const dim = neighbors && !neighbors.has(n.id)
            const isCur = n.id === 'p:' + currentId
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                opacity={dim ? 0.15 : 1}
                className="cursor-pointer"
                data-term-id={n.kind === 'term' ? n.id.slice(2) : undefined}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover(null)}
                onPointerDown={(e) => {
                  dragging.current = { id: n.id, moved: false, px: e.clientX, py: e.clientY }
                  svgRef.current!.setPointerCapture(e.pointerId)
                }}
              >
                {n.kind === 'page' ? (
                  <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={5} fill={n.color} fillOpacity={0.85} stroke={isCur ? 'var(--fg)' : 'var(--bg)'} strokeWidth={isCur ? 2.5 : 1.5} />
                ) : (
                  <circle r={r} fill={n.color} fillOpacity={0.9} stroke="var(--bg)" strokeWidth={1.5} />
                )}
                <text y={r + 13} textAnchor="middle" fontSize={n.kind === 'page' ? 11.5 : 10.5} fill="var(--fg)" fillOpacity={n.kind === 'page' ? 0.95 : 0.7} fontWeight={n.kind === 'page' ? 600 : 400} style={{ pointerEvents: 'none' }}>
                  {n.label}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

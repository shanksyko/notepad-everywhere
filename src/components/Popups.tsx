import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUpRight, BookOpen, EyeOff, GripHorizontal, MapPin, Pencil, Pin, Trash2, X } from 'lucide-react'
import { actions, useStore, type PinnedPop } from '../store'
import { RichHtml, RichInput } from './Rich'
import { FilePreview } from './Media'
import { TermForm } from './TermForm'
import { cardLevel, fmtInterval, MASTERY_COLOR, MASTERY_LABEL, nextInterval, type Rating } from '../lib/srs'

/* ---------- peças compartilhadas ---------- */
export function RateButtons({ cardId, onRated }: { cardId: string; onRated?: () => void }) {
  const card = useStore((s) => s.cards[cardId])
  if (!card) return null
  const opts: [Rating, string, string][] = [
    ['hard', 'Difícil', '#ef4444'],
    ['good', 'Bom', '#eab308'],
    ['easy', 'Fácil', '#22c55e'],
  ]
  return (
    <div className="flex gap-1.5">
      {opts.map(([r, label, color]) => (
        <button
          key={r}
          className="flex-1 rounded-md border px-2 py-1 text-xs font-medium hover:brightness-125"
          style={{ borderColor: color, color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
          onClick={() => {
            actions.rateCard(cardId, r)
            onRated?.()
          }}
        >
          {label}
          <span className="block text-[10px] opacity-75">{fmtInterval(nextInterval(card, r))}</span>
        </button>
      ))}
    </div>
  )
}

export function MasteryDot({ level, size = 8, title }: { level: 0 | 1 | 2; size?: number; title?: string }) {
  return <span title={title ?? MASTERY_LABEL[level]} className="inline-block rounded-full shrink-0" style={{ width: size, height: size, background: MASTERY_COLOR[level] }} />
}

function TermBody({ termId, showRate }: { termId: string; showRate?: boolean }) {
  const term = useStore((s) => s.terms[termId])
  const page = useStore((s) => (term?.pageId ? s.nodes[term.pageId] : undefined))
  if (!term) return <div className="text-muted text-xs">Termo removido.</div>
  return (
    <div className="flex flex-col gap-2">
      <RichHtml html={term.html || '<p><i>Sem definição ainda.</i></p>'} exclude={termId} />
      {term.fileId && (
        <div className="rounded-lg border border-line p-2 bg-panel2/50">
          <FilePreview fileId={term.fileId} />
        </div>
      )}
      {page && (
        <a data-page-id={page.id} className="page-link text-xs self-start flex items-center gap-1 !border-0">
          <ArrowUpRight size={12} /> Abrir página: {page.icon} {page.title}
        </a>
      )}
      {showRate && (
        <div className="pt-1 border-t border-line">
          <div className="text-[10px] uppercase tracking-wider text-muted my-1">Como foi a lembrança?</div>
          <RateButtons cardId={'term:' + termId} />
        </div>
      )}
    </div>
  )
}

function TermTitle({ termId }: { termId: string }) {
  const term = useStore((s) => s.terms[termId])
  const card = useStore((s) => s.cards['term:' + termId])
  return (
    <>
      <BookOpen size={13} className="text-gloss shrink-0" />
      <span className="font-semibold truncate">{term?.term ?? '—'}</span>
      <MasteryDot level={cardLevel(card)} />
    </>
  )
}

function HotspotBody({ id }: { id: string }) {
  const h = useStore((s) => s.hotspots[id])
  const term = useStore((s) => (h?.termId ? s.terms[h.termId] : undefined))
  if (!h) return null
  return (
    <div className="flex flex-col gap-2">
      {h.html ? <RichHtml html={h.html} /> : !term && <div className="text-muted text-xs">Clique no pin para adicionar uma explicação.</div>}
      {term && (
        <div className="rounded-lg border border-line p-2 bg-panel2/50">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
            Conceito: <span className="gloss-term normal-case text-fg" data-term-id={term.id}>{term.term}</span>
          </div>
          <RichHtml html={term.html} exclude={term.id} className="text-[13px]" />
        </div>
      )}
    </div>
  )
}

function HotspotEdit({ id, onDone }: { id: string; onDone: () => void }) {
  const h = useStore((s) => s.hotspots[id])
  const terms = useStore((s) => s.terms)
  const [label, setLabel] = useState(h?.label || '')
  const [html, setHtml] = useState(h?.html || '')
  const [termId, setTermId] = useState(h?.termId || '')
  if (!h) return null
  return (
    <div className="flex flex-col gap-2">
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Título do pin" autoFocus onFocus={(e) => e.target.select()} />
      <RichInput html={html} onChange={setHtml} placeholder="Explicação, fórmula $...$, link…" />
      <label className="text-xs text-muted flex flex-col gap-1">
        Vincular a um conceito do glossário
        <select value={termId} onChange={(e) => setTermId(e.target.value)}>
          <option value="">— nenhum —</option>
          {Object.values(terms)
            .sort((a, b) => a.term.localeCompare(b.term))
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.term}
              </option>
            ))}
        </select>
      </label>
      <div className="flex gap-2">
        <button className="btn !text-red-400" onClick={() => actions.deleteHotspot(id)}>
          <Trash2 size={13} /> Excluir pin
        </button>
        <span className="flex-1" />
        <button
          className="btn btn-accent"
          onClick={() => {
            actions.saveHotspot({ ...h, label: label || 'Pin', html, termId: termId || null })
            onDone()
          }}
        >
          Salvar
        </button>
      </div>
    </div>
  )
}

function ClozeBody({ id, onDone }: { id: string; onDone: () => void }) {
  const card = useStore((s) => s.cards[id])
  if (!card) return <div className="text-xs text-muted">Lacuna ainda não salva — aguarde um instante.</div>
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[13px] text-muted">{card.front}</div>
      <div className="text-base font-semibold text-accent">{card.back}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted">Você lembrou?</div>
      <RateButtons cardId={id} onRated={onDone} />
    </div>
  )
}

/* ---------- pop-up fixado: arrastar, redimensionar, editar ---------- */
function Pinned({ p }: { p: PinnedPop }) {
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const term = useStore((s) => (p.kind === 'term' ? s.terms[p.id] : undefined))
  const hot = useStore((s) => (p.kind === 'hotspot' ? s.hotspots[p.id] : undefined))
  const close = () => actions.unpin(p.key)
  return (
    <div
      data-pop-depth="-1"
      className="pop pop-in fixed z-[70] flex flex-col"
      style={{ left: p.x, top: p.y, width: p.edit && p.kind === 'term' ? 420 : 340, minWidth: 250, minHeight: 90, maxHeight: '82vh', maxWidth: '92vw', resize: 'both', overflow: 'hidden' }}
    >
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-line bg-panel2 rounded-t-xl cursor-grab active:cursor-grabbing select-none shrink-0"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          drag.current = { dx: e.clientX - p.x, dy: e.clientY - p.y }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => drag.current && actions.patchPin(p.key, { x: Math.max(0, Math.min(innerWidth - 80, e.clientX - drag.current.dx)), y: Math.max(0, Math.min(innerHeight - 40, e.clientY - drag.current.dy)) })}
        onPointerUp={() => (drag.current = null)}
      >
        <GripHorizontal size={13} className="text-muted shrink-0" />
        {p.kind === 'term' && <TermTitle termId={p.id} />}
        {p.kind === 'hotspot' && (
          <>
            <MapPin size={13} className="text-accent shrink-0" />
            <span className="font-semibold truncate">{hot?.label}</span>
          </>
        )}
        {p.kind === 'cloze' && (
          <>
            <EyeOff size={13} className="text-accent shrink-0" />
            <span className="font-semibold">Lacuna</span>
          </>
        )}
        <span className="flex-1" />
        {p.kind !== 'cloze' && (
          <button className={'icon-btn !w-6 !h-6 ' + (p.edit ? 'on' : '')} title="Editar aqui" onClick={() => actions.patchPin(p.key, { edit: !p.edit })}>
            <Pencil size={12} />
          </button>
        )}
        <button className="icon-btn !w-6 !h-6" title="Fechar" onClick={close}>
          <X size={13} />
        </button>
      </div>
      <div className="p-3 overflow-auto flex-1 text-[13.5px]">
        {p.kind === 'term' && (p.edit && term ? <TermForm compact initial={term} onSaved={() => actions.patchPin(p.key, { edit: false })} onCancel={() => actions.patchPin(p.key, { edit: false })} /> : <TermBody termId={p.id} showRate />)}
        {p.kind === 'hotspot' && (p.edit ? <HotspotEdit id={p.id} onDone={() => actions.patchPin(p.key, { edit: false })} /> : <HotspotBody id={p.id} />)}
        {p.kind === 'cloze' && <ClozeBody id={p.id} onDone={close} />}
      </div>
    </div>
  )
}

/* ---------- pop-ups de hover (pilha em cascata) ---------- */
interface HoverPop {
  key: string
  kind: 'term' | 'hotspot' | 'file'
  id: string
  anchor: Element
  rect: DOMRect
  page?: number | null
  time?: number | null
}

const SEL = '[data-term-id],[data-hotspot-id],[data-file-preview]'

function Hover({ pop, depth }: { pop: HoverPop; depth: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const place = () => {
      const w = el.offsetWidth, h = el.offsetHeight, r = pop.rect
      const left = Math.max(8, Math.min(r.left + r.width / 2 - 40, innerWidth - w - 8))
      let top = r.bottom + 8
      if (top + h > innerHeight - 8) top = r.top - h - 8 > 8 ? r.top - h - 8 : Math.max(8, innerHeight - h - 8)
      el.style.left = left + 'px'
      el.style.top = top + 'px'
      el.style.visibility = 'visible'
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pop])
  const hot = useStore((s) => (pop.kind === 'hotspot' ? s.hotspots[pop.id] : undefined))
  return (
    <div ref={ref} data-pop-depth={depth} className="pop pop-in fixed w-[340px] max-w-[92vw] max-h-[70vh] overflow-auto" style={{ zIndex: 80 + depth, visibility: 'hidden', left: 0, top: 0 }}>
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">
        {pop.kind === 'term' && <TermTitle termId={pop.id} />}
        {pop.kind === 'hotspot' && (
          <>
            <MapPin size={13} className="text-accent shrink-0" />
            <span className="font-semibold truncate">{hot?.label}</span>
          </>
        )}
        {pop.kind === 'file' && <span className="text-[10px] uppercase tracking-wider text-muted">Pré-visualização</span>}
        <span className="flex-1" />
        {pop.kind !== 'file' && (
          <span className="text-[10px] text-muted flex items-center gap-1">
            <Pin size={10} /> clique para fixar
          </span>
        )}
      </div>
      <div className="px-3 pb-3 text-[13.5px]">
        {pop.kind === 'term' && <TermBody termId={pop.id} />}
        {pop.kind === 'hotspot' && <HotspotBody id={pop.id} />}
        {pop.kind === 'file' && <FilePreview fileId={pop.id} page={pop.page} time={pop.time} />}
      </div>
    </div>
  )
}

function describe(anchor: Element): Omit<HoverPop, 'key' | 'rect' | 'anchor'> | null {
  const el = anchor as HTMLElement
  if (el.dataset.termId) return { kind: 'term', id: el.dataset.termId }
  if (el.dataset.hotspotId) return { kind: 'hotspot', id: el.dataset.hotspotId }
  if (el.dataset.filePreview) return { kind: 'file', id: el.dataset.filePreview, page: el.dataset.page ? Number(el.dataset.page) : null, time: el.dataset.time ? Number(el.dataset.time) : null }
  return null
}

export function PopupLayer() {
  const pinned = useStore((s) => s.pinned)
  const [stack, setStack] = useState<HoverPop[]>([])
  const ref = useRef<HoverPop[]>([])
  ref.current = stack

  useEffect(() => {
    let openT: any, closeT: any
    const update = (s: HoverPop[]) => {
      ref.current = s
      setStack(s)
    }
    const depthOf = (el: Element) => {
      const p = el.closest('[data-pop-depth]') as HTMLElement | null
      return p ? Number(p.dataset.popDepth) : -1
    }
    const over = (e: MouseEvent) => {
      if (e.buttons) return
      const el = e.target as Element
      if (!el?.closest) return
      const anchor = el.closest(SEL)
      const d = depthOf(el)
      if (anchor) {
        const nd = d + 1
        clearTimeout(closeT)
        if (ref.current[nd]?.anchor === anchor) {
          clearTimeout(openT)
          return
        }
        clearTimeout(openT)
        openT = setTimeout(
          () => {
            if (!anchor.isConnected) return
            const info = describe(anchor)
            if (!info) return
            update([...ref.current.slice(0, nd), { ...info, key: info.kind + info.id + nd, anchor, rect: anchor.getBoundingClientRect() }])
          },
          nd === 0 ? 200 : 130,
        )
      } else {
        clearTimeout(openT)
        clearTimeout(closeT)
        if (!ref.current.length) return
        if (d >= 0) closeT = setTimeout(() => update(ref.current.slice(0, d + 1)), 450)
        else closeT = setTimeout(() => update([]), 280)
      }
    }
    const click = (e: MouseEvent) => {
      const el = e.target as Element
      if (!el?.closest) return
      const st = useStore.getState()
      const pageA = el.closest('a[data-page-id]') as HTMLElement | null
      if (pageA) {
        e.preventDefault()
        actions.select(pageA.dataset.pageId!)
        update([])
        return
      }
      const mediaA = el.closest('a[data-file-id]') as HTMLElement | null
      if (mediaA) {
        e.preventDefault()
        actions.openMedia(mediaA.dataset.fileId!, { time: mediaA.dataset.time ? Number(mediaA.dataset.time) : undefined, page: mediaA.dataset.page ? Number(mediaA.dataset.page) : undefined })
        update([])
        return
      }
      const ext = el.closest('a[href]') as HTMLAnchorElement | null
      if (ext && /^https?:/.test(ext.href) && (el.closest('[data-pop-depth]') || e.ctrlKey || e.metaKey || !el.closest('.ProseMirror'))) {
        e.preventDefault()
        window.open(ext.href, '_blank', 'noopener')
        return
      }
      // Ignora o clique só quando o usuário está selecionando um trecho maior que o próprio termo/lacuna
      // (logo depois de criar uma lacuna, a palavra continua selecionada — o clique nela deve funcionar).
      const sel = getSelection()
      const selecting = (target: Element) => {
        if (!sel || sel.isCollapsed) return false
        const txt = sel.toString().trim()
        // as bordas da seleção podem cair fora do <span>; compara pelo texto selecionado
        return txt.length > 0 && !(target.textContent || '').includes(txt)
      }
      const cz = el.closest('.cloze[data-cloze-id]') as HTMLElement | null
      if (cz && st.study) {
        if (selecting(cz)) return
        const r = cz.getBoundingClientRect()
        actions.pin({ kind: 'cloze', id: cz.dataset.clozeId!, x: Math.min(r.left, innerWidth - 350), y: Math.min(r.bottom + 8, innerHeight - 220) })
        return
      }
      const anchor = el.closest('[data-term-id],[data-hotspot-id]') as HTMLElement | null
      if (anchor && !el.closest('[data-no-pin]') && !selecting(anchor)) {
        const info = describe(anchor)!
        const r = anchor.getBoundingClientRect()
        const n = st.pinned.length
        actions.pin({ kind: info.kind as 'term' | 'hotspot', id: info.id, x: Math.max(8, Math.min(r.left + n * 14, innerWidth - 360)), y: Math.max(8, Math.min(r.bottom + 8 + n * 10, innerHeight - 300)) })
        clearTimeout(openT)
        update(ref.current.slice(0, depthOf(el) + 1))
      }
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ref.current.length) update([])
    }
    const scroll = (e: Event) => {
      const t = e.target as Element
      if (t?.closest?.('[data-pop-depth]')) return
      if (ref.current.length) update([])
    }
    document.addEventListener('mouseover', over)
    document.addEventListener('click', click)
    document.addEventListener('keydown', key)
    document.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('click', click)
      document.removeEventListener('keydown', key)
      document.removeEventListener('scroll', scroll, true)
      clearTimeout(openT)
      clearTimeout(closeT)
    }
  }, [])

  return (
    <>
      {pinned.map((p) => (
        <Pinned key={p.key} p={p} />
      ))}
      {stack.map((pop, i) => (
        <Hover key={pop.key} pop={pop} depth={i} />
      ))}
    </>
  )
}

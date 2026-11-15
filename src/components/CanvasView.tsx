import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BoxSelect,
  BringToFront,
  SendToBack,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Redo2,
  Undo2,
  CornerDownRight,
  Eraser,
  FileImage,
  FileCode2,
  Grid3x3,
  MousePointer2,
  Paperclip,
  Pencil,
  Tag,
  Trash2,
  Type,
} from 'lucide-react'
import { actions, getFileBlob, useStore } from '../store'
import type { CanvasConnector, CanvasData, CanvasItem, ShapeKind, TreeNode } from '../db'
import { debounce, downloadBlob, mediaKind, TAG_COLORS, uid } from '../lib/util'
import { canvasToSvg, connectorGeom, ptsAttr, shapeMarkup, SHAPES, SIDES } from '../lib/diagram'
import { enrichForExport } from '../lib/matcher'
import type { Side } from '../db'
import { RichHtml } from './Rich'
import { MediaBlock } from './Media'

type Tool = 'select' | 'text' | 'shape' | 'pen' | 'arrow' | 'eraser'
const GRID = 10
/** área de transferência do canvas (vale entre páginas, dentro da mesma sessão) */
let clipboard: { items: CanvasItem[]; connectors: CanvasConnector[] } | null = null

/** Página inteira em modo Canvas. */
export function CanvasView({ node }: { node: TreeNode }) {
  return <CanvasBoard initial={node.canvas} onChange={(d) => actions.saveCanvas(node.id, d)} title={node.title} />
}

/**
 * Quadro livre e de diagramas: caixas de texto, formas de fluxograma, setas (retas ou em ângulo, com rótulo),
 * desenho à mão, mídias, seleção múltipla, alinhamento, grade e exportação em PNG/SVG.
 * Usado como página inteira ou embutido dentro de uma nota (`embedded`).
 */
export function CanvasBoard({ initial, onChange, embedded, height, extra, title }: { initial: CanvasData; onChange: (d: CanvasData) => void; embedded?: boolean; height?: number; extra?: React.ReactNode; title?: string }) {
  const W = embedded ? 1800 : 2600
  const H = embedded ? 1200 : 1700
  const markerId = 'arrow-' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const [data, setData] = useState<CanvasData>(initial)
  const [tool, setTool] = useState<Tool>('select')
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect')
  const [color, setColor] = useState(TAG_COLORS[0])
  const [selIds, setSelIds] = useState<string[]>([])
  const [selConn, setSelConn] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [arrowFrom, setArrowFrom] = useState<string | null>(null)
  const [draft, setDraft] = useState<[number, number][] | null>(null)
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [snap, setSnap] = useState(true)
  const [elbow, setElbow] = useState(false)
  const surface = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dataRef = useRef(data)
  dataRef.current = data
  const draftRef = useRef(draft)
  draftRef.current = draft
  const marqueeRef = useRef(marquee)
  marqueeRef.current = marquee
  const sel = selIds.length === 1 ? selIds[0] : null

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const dirty = useRef(false)
  const save = useMemo(
    () =>
      debounce((d: CanvasData) => {
        dirty.current = false
        onChangeRef.current(d)
      }, 400),
    [],
  )
  useEffect(() => () => void (dirty.current && save.flush(dataRef.current)), [save])
  // ao restaurar uma versão antiga, o que estava pendente de gravação é descartado
  useEffect(() => {
    const drop = () => {
      dirty.current = false
      save.cancel()
    }
    window.addEventListener('ne:discard-pending', drop)
    return () => window.removeEventListener('ne:discard-pending', drop)
  }, [save])
  /* ---------- desfazer / refazer ---------- */
  const undoStack = useRef<CanvasData[]>([])
  const redoStack = useRef<CanvasData[]>([])
  const [, bump] = useState(0) // só para atualizar o estado dos botões
  const apply = (d: CanvasData) => {
    setData(d)
    dataRef.current = d
    dirty.current = true
    save(d)
  }
  /** grava uma mudança; `prev` é o estado para onde o "desfazer" volta (padrão: o estado atual) */
  const commit = (d: CanvasData, prev: CanvasData = dataRef.current) => {
    if (prev !== d) {
      undoStack.current.push(prev)
      if (undoStack.current.length > 100) undoStack.current.shift()
      redoStack.current = []
      bump((n) => n + 1)
    }
    apply(d)
  }
  const stepHistory = (from: React.MutableRefObject<CanvasData[]>, to: React.MutableRefObject<CanvasData[]>) => {
    const d = from.current.pop()
    if (!d) return
    to.current.push(dataRef.current)
    apply(d)
    setEditing(null)
    setSelIds((s) => s.filter((id) => d.items.some((i) => i.id === id)))
    setSelConn(null)
    bump((n) => n + 1)
  }
  const undo = () => stepHistory(undoStack, redoStack)
  const redo = () => stepHistory(redoStack, undoStack)
  const sv = (v: number) => (snap ? Math.round(v / GRID) * GRID : v)
  const pt = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = surface.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const patchItems = (patch: Record<string, Partial<CanvasItem>>, persist = true) => {
    const d = { ...dataRef.current, items: dataRef.current.items.map((i) => (patch[i.id] ? { ...i, ...patch[i.id] } : i)) }
    if (persist) commit(d)
    else {
      setData(d)
      dataRef.current = d
    }
  }
  const patchItem = (id: string, patch: Partial<CanvasItem>, persist = true) => patchItems({ [id]: patch }, persist)
  const removeItems = (ids: string[]) => {
    const d = dataRef.current
    commit({ ...d, items: d.items.filter((i) => !ids.includes(i.id)), connectors: d.connectors.filter((c) => !ids.includes(c.from) && !ids.includes(c.to)) })
    setSelIds((s) => s.filter((x) => !ids.includes(x)))
  }
  const removeItem = (id: string) => removeItems([id])
  const patchConn = (id: string, patch: Partial<CanvasConnector>) => commit({ ...dataRef.current, connectors: dataRef.current.connectors.map((c) => (c.id === id ? { ...c, ...patch } : c)) })

  const addFiles = async (files: File[], x: number, y: number) => {
    const items = [...dataRef.current.items]
    for (const f of files) {
      const fileId = await actions.addFile(f)
      items.push({ id: uid(), type: 'media', x, y, w: 420, h: 320, fileId })
      x += 30
      y += 30
    }
    commit({ ...dataRef.current, items })
  }

  /* ---------- seleção: copiar, duplicar, alinhar, distribuir ---------- */
  const selected = () => dataRef.current.items.filter((i) => selIds.includes(i.id))
  const copySel = () => {
    const its = selected()
    if (!its.length) return
    const ids = new Set(its.map((i) => i.id))
    clipboard = { items: its.map((i) => ({ ...i })), connectors: dataRef.current.connectors.filter((c) => ids.has(c.from) && ids.has(c.to)).map((c) => ({ ...c })) }
  }
  const paste = (src = clipboard, offset = 20) => {
    if (!src?.items.length) return
    const map = new Map<string, string>()
    const items = src.items.map((i) => {
      const id = uid()
      map.set(i.id, id)
      return { ...i, id, x: i.x + offset, y: i.y + offset }
    })
    const connectors = src.connectors.map((c) => ({ ...c, id: uid(), from: map.get(c.from)!, to: map.get(c.to)! }))
    commit({ ...dataRef.current, items: [...dataRef.current.items, ...items], connectors: [...dataRef.current.connectors, ...connectors] })
    setSelIds(items.map((i) => i.id))
    setSelConn(null)
    if (src === clipboard) clipboard = { items, connectors } // colar de novo desloca mais um passo
  }
  const duplicate = () => {
    const its = selected()
    const ids = new Set(its.map((i) => i.id))
    paste({ items: its, connectors: dataRef.current.connectors.filter((c) => ids.has(c.from) && ids.has(c.to)) })
  }
  const nudge = (dx: number, dy: number) => patchItems(Object.fromEntries(selected().map((i) => [i.id, { x: Math.max(0, i.x + dx), y: Math.max(0, i.y + dy) }])))
  const selectAll = () => (setTool('select'), setSelConn(null), setSelIds(dataRef.current.items.map((i) => i.id)), surface.current?.focus({ preventScroll: true }))
  /** ordem de empilhamento: a ordem na lista é a ordem de desenho (o último fica por cima) */
  const reorder = (front: boolean) => {
    const d = dataRef.current
    const picked = d.items.filter((i) => selIds.includes(i.id)), rest = d.items.filter((i) => !selIds.includes(i.id))
    if (picked.length) commit({ ...d, items: front ? [...rest, ...picked] : [...picked, ...rest] })
  }
  const align = (how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => {
    const its = selected()
    if (its.length < 2) return
    const l = Math.min(...its.map((i) => i.x)), r = Math.max(...its.map((i) => i.x + i.w)), t = Math.min(...its.map((i) => i.y)), b = Math.max(...its.map((i) => i.y + i.h))
    const patch: Record<string, Partial<CanvasItem>> = {}
    for (const i of its) {
      if (how === 'left') patch[i.id] = { x: l }
      else if (how === 'right') patch[i.id] = { x: r - i.w }
      else if (how === 'hcenter') patch[i.id] = { x: (l + r) / 2 - i.w / 2 }
      else if (how === 'top') patch[i.id] = { y: t }
      else if (how === 'bottom') patch[i.id] = { y: b - i.h }
      else patch[i.id] = { y: (t + b) / 2 - i.h / 2 }
    }
    patchItems(patch)
  }
  const distribute = (axis: 'h' | 'v') => {
    const its = selected()
    if (its.length < 3) return
    const k = axis === 'h' ? 'x' : 'y', s = axis === 'h' ? 'w' : 'h'
    const sorted = [...its].sort((a, b) => a[k] - b[k])
    const first = sorted[0], last = sorted[sorted.length - 1]
    const free = last[k] + last[s] - first[k] - sorted.reduce((acc, i) => acc + i[s], 0)
    const gap = free / (sorted.length - 1)
    let pos = first[k]
    const patch: Record<string, Partial<CanvasItem>> = {}
    for (const i of sorted) {
      patch[i.id] = { [k]: pos }
      pos += i[s] + gap
    }
    patchItems(patch)
  }

  /* ---------- exportar como imagem ---------- */
  const exportAs = async (fmt: 'png' | 'svg') => {
    const files = useStore.getState().files
    const res = await canvasToSvg(dataRef.current, {
      richHtml: enrichForExport, // negrito, itálico e fórmulas saem formatados
      fileInfo: (id) => (files[id] ? { name: files[id].name, image: mediaKind(files[id].type, files[id].name) === 'image' } : null),
      href: async (id) => {
        const b = await getFileBlob(id)
        if (!b) return ''
        return new Promise<string>((r) => {
          const fr = new FileReader()
          fr.onload = () => r(String(fr.result))
          fr.readAsDataURL(b)
        })
      },
    })
    if (!res) return alert('O canvas está vazio.')
    const name = (title || 'diagrama').replace(/[\\/:*?"<>|]/g, '_')
    if (fmt === 'svg') return downloadBlob(new Blob([res.svg], { type: 'image/svg+xml' }), name + '.svg')
    const img = new Image()
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(res.svg)
    await img.decode()
    const c = document.createElement('canvas')
    c.width = res.w * 2
    c.height = res.h * 2
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    c.toBlob((b) => b && downloadBlob(b, name + '.png'), 'image/png')
  }

  /* ---------- ponteiro na superfície ---------- */
  const onSurface = (e: { target: EventTarget | null }) => e.target === surface.current || !!(e.target as Element).closest?.('svg[data-canvas-svg]')
  const onSurfaceDown = (e: React.PointerEvent) => {
    if (!onSurface(e)) return
    const [x, y] = pt(e)
    if (tool === 'text' || tool === 'shape') return // criados no clique (onSurfaceClick), depois que o mouse solta
    if (tool === 'pen') {
      // texto selecionado sob o cursor faria o navegador iniciar um "arrastar seleção" e cancelar o traço
      getSelection()?.removeAllRanges()
      setDraft([[x, y]])
      surface.current!.setPointerCapture(e.pointerId)
    } else {
      // Sai da edição pelo blur (que grava o texto). Desmontar a caixa direto perderia o que foi digitado.
      const active = document.activeElement as HTMLElement | null
      if (active && surface.current?.contains(active) && active.isContentEditable) active.blur()
      else setEditing(null)
      if (!e.shiftKey) setSelIds([])
      setSelConn(null)
      setArrowFrom(null)
      if (tool === 'select') {
        // arrastar no vazio = retângulo de seleção
        setMarquee({ x0: x, y0: y, x1: x, y1: y })
        surface.current!.setPointerCapture(e.pointerId)
        surface.current!.focus({ preventScroll: true })
      }
    }
  }
  // Criar no "click" (e não no pointerdown) evita que o mousedown tire o foco da caixa recém-criada,
  // o que a apagaria na hora por estar vazia.
  const onSurfaceClick = (e: React.MouseEvent) => {
    if ((tool !== 'text' && tool !== 'shape') || !onSurface(e)) return
    const [x, y] = pt(e)
    const it: CanvasItem =
      tool === 'text'
        ? { id: uid(), type: 'text', x: Math.max(0, x - 10), y: Math.max(0, y - 14), w: 220, h: 64, html: '', color }
        : { id: uid(), type: 'shape', shape: shapeKind, x: Math.max(0, sv(x - 70)), y: Math.max(0, sv(y - 40)), w: 140, h: 80, html: '', color }
    commit({ ...dataRef.current, items: [...dataRef.current.items, it] })
    setSelIds([it.id])
    setEditing(it.id)
    setTool('select')
  }
  const onSurfaceMove = (e: React.PointerEvent) => {
    if (draftRef.current) setDraft([...draftRef.current, pt(e)])
    else if (marqueeRef.current) {
      const [x, y] = pt(e)
      setMarquee({ ...marqueeRef.current, x1: x, y1: y })
    }
  }
  // Também é chamado em pointercancel / perda de captura: se o navegador interromper o gesto,
  // o traço é gravado mesmo assim em vez de ficar preso como rascunho por cima do desenho.
  const onSurfaceUp = () => {
    const d = draftRef.current
    if (d) {
      draftRef.current = null
      if (d.length > 2) commit({ ...dataRef.current, strokes: [...dataRef.current.strokes, { id: uid(), points: d, color, width: 3 }] })
      setDraft(null)
    }
    const m = marqueeRef.current
    if (m) {
      marqueeRef.current = null
      setMarquee(null)
      const l = Math.min(m.x0, m.x1), r = Math.max(m.x0, m.x1), t = Math.min(m.y0, m.y1), b = Math.max(m.y0, m.y1)
      if (r - l > 4 || b - t > 4) {
        const hit = dataRef.current.items.filter((i) => i.x < r && i.x + i.w > l && i.y < b && i.y + i.h > t).map((i) => i.id)
        setSelIds((cur) => [...new Set([...cur, ...hit])])
      }
    }
  }
  const onItemDown = (e: React.PointerEvent, it: CanvasItem, mode: 'move' | 'resize' = 'move') => {
    if (tool === 'arrow') {
      e.stopPropagation()
      if (!arrowFrom) setArrowFrom(it.id)
      else if (arrowFrom !== it.id) {
        commit({ ...dataRef.current, connectors: [...dataRef.current.connectors, { id: uid(), from: arrowFrom, to: it.id, kind: elbow ? 'elbow' : 'straight' }] })
        setArrowFrom(null)
      }
      return
    }
    if (tool !== 'select' || editing === it.id) return
    if (mode === 'move' && (e.target as Element).closest('button,input,select,video,audio,canvas,a,.textLayer,[data-hotspot-id]')) return
    e.stopPropagation()
    surface.current?.focus({ preventScroll: true })
    setSelConn(null)
    if (e.shiftKey && mode === 'move') {
      // Shift+clique soma ou tira da seleção
      setSelIds((s) => (s.includes(it.id) ? s.filter((x) => x !== it.id) : [...s, it.id]))
      return
    }
    const group = mode === 'move' && selIds.includes(it.id) ? dataRef.current.items.filter((i) => selIds.includes(i.id)) : [it]
    if (!selIds.includes(it.id) || mode === 'resize') setSelIds([it.id])
    const [ox, oy] = pt(e)
    const startData = dataRef.current // para o "desfazer" voltar ao estado de antes do arraste
    let moved = false
    // listeners na janela (sem pointer capture) para não quebrar o duplo clique
    const move = (ev: PointerEvent) => {
      const [mx, my] = pt(ev)
      moved = true
      if (mode === 'move') {
        // o item agarrado encaixa na grade; os outros do grupo mantêm a distância relativa
        const dx = Math.max(0, sv(it.x + mx - ox)) - it.x, dy = Math.max(0, sv(it.y + my - oy)) - it.y
        patchItems(Object.fromEntries(group.map((g) => [g.id, { x: Math.max(0, g.x + dx), y: Math.max(0, g.y + dy) }])), false)
      } else patchItem(it.id, { w: Math.max(it.type === 'text' ? 90 : 50, sv(it.w + mx - ox)), h: Math.max(40, sv(it.h + my - oy)) }, false)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      if (moved) commit(dataRef.current, startData)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || (e.target as HTMLElement).isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selConn) (commit({ ...dataRef.current, connectors: dataRef.current.connectors.filter((c) => c.id !== selConn) }), setSelConn(null))
      else if (selIds.length) removeItems(selIds)
      else return
    } else if (mod && k === 'z' && !e.shiftKey) undo()
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) redo()
    else if (mod && k === 'c') copySel()
    else if (mod && k === 'v') paste()
    else if (mod && k === 'd') duplicate()
    else if (mod && k === 'a') selectAll()
    else if (e.key.startsWith('Arrow') && selIds.length) {
      const step = e.shiftKey ? GRID * 5 : GRID
      nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0)
    } else if (e.key === 'Escape') (setSelIds([]), setSelConn(null), setArrowFrom(null), setTool('select'))
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const path = (pts: [number, number][]) => pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const byId = new Map(data.items.map((i) => [i.id, i]))
  const one = sel ? byId.get(sel) : undefined
  const conn = selConn ? data.connectors.find((c) => c.id === selConn) : undefined
  const tools: [Tool, string, any][] = [
    ['select', 'Selecionar / mover (arraste no vazio para selecionar várias; Shift+clique soma)', MousePointer2],
    ['text', 'Caixa de texto (clique em qualquer lugar)', Type],
    ['pen', 'Desenho livre', Pencil],
    ['arrow', 'Conectar duas caixas com seta', ArrowUpRight],
    ['eraser', 'Apagar traços e setas', Eraser],
  ]
  const vis = (on: boolean): React.CSSProperties => ({ visibility: on ? 'visible' : 'hidden' })
  const dis = (on: boolean) => ({ disabled: !on, style: { opacity: on ? 1 : 0.35 } as React.CSSProperties })
  const sep = <span className="w-px h-5 bg-line mx-1 shrink-0" />
  const editText = (it: CanvasItem) => (
    <div
      className={'rich outline-none cursor-text whitespace-pre-wrap ' + (it.type === 'shape' ? 'min-w-[30px] text-center' : 'p-2.5 min-h-[40px]')}
      style={{ tabSize: 4 }}
      contentEditable
      suppressContentEditableWarning
      ref={(el) => {
        if (el && !el.dataset.init) {
          el.dataset.init = '1'
          el.innerHTML = it.html || ''
          el.focus()
          getSelection()?.selectAllChildren(el)
          getSelection()?.collapseToEnd()
        }
      }}
      onBlur={(e) => {
        const html = e.currentTarget.innerHTML
        setEditing(null)
        // caixa de texto vazia é descartada; forma vazia continua existindo
        if (it.type === 'text' && !e.currentTarget.textContent?.trim() && !html.includes('<img')) removeItem(it.id)
        else patchItem(it.id, { html })
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') (e.target as HTMLElement).blur()
        else if (e.key === 'Tab') {
          // Tab escreve um recuo em vez de pular para o próximo botão
          e.preventDefault()
          document.execCommand('insertText', false, '\t')
        }
        e.stopPropagation()
      }}
    />
  )

  return (
    <div className={embedded ? 'flex flex-col' : 'flex-1 flex flex-col min-h-0'}>
      <div className="flex items-center gap-1 px-3 py-1 border-b border-line bg-panel shrink-0 flex-wrap">
        {tools.map(([t, tip, Icon]) => (
          <button key={t} title={tip} className={'icon-btn ' + (tool === t ? 'on' : '')} onClick={() => (setTool(t), setArrowFrom(null))}>
            <Icon size={15} />
          </button>
        ))}
        {sep}
        {SHAPES.map(([k, label]) => (
          <button key={k} title={'Forma: ' + label + ' — clique no canvas para criar'} className={'icon-btn ' + (tool === 'shape' && shapeKind === k ? 'on' : '')} onClick={() => (setShapeKind(k), setTool('shape'), setArrowFrom(null))}>
            <svg width="18" height="14" viewBox="0 0 18 14" dangerouslySetInnerHTML={{ __html: shapeMarkup(k, 18, 14, 'currentColor', 'none', 1.5) }} />
          </button>
        ))}
        {sep}
        {TAG_COLORS.map((c) => (
          <button
            key={c}
            title="Cor"
            className="w-4 h-4 rounded-full"
            style={{ background: c, outline: c === color ? '2px solid var(--fg)' : 'none', outlineOffset: 1 }}
            onClick={() => {
              setColor(c)
              const ids = selIds.filter((id) => byId.get(id)?.type !== 'media')
              if (ids.length) patchItems(Object.fromEntries(ids.map((id) => [id, { color: c }])))
            }}
          />
        ))}
        {sep}
        <button className="icon-btn" title="Adicionar arquivo (ou arraste para o canvas)" onClick={() => fileRef.current?.click()}>
          <Paperclip size={15} />
        </button>
        {/* Sempre ocupam espaço (só ficam invisíveis): se aparecessem e sumissem, a barra mudaria de altura
            e o canvas inteiro pularia a cada seleção — a borracha e os cliques errariam o alvo. */}
        <button className="btn" style={vis(!!one && one.type !== 'media' && editing !== sel)} tabIndex={one ? 0 : -1} onClick={() => sel && (setTool('select'), setEditing(sel))}>
          <Pencil size={13} /> Editar texto
        </button>
        <button className="btn !text-red-400" style={vis(selIds.length > 0)} tabIndex={selIds.length ? 0 : -1} onClick={() => removeItems(selIds)}>
          <Trash2 size={13} /> Excluir caixa
        </button>
        {/* largura fixa: a dica muda de texto conforme a ferramenta e não pode empurrar/quebrar a barra */}
        <span className={'text-xs text-muted ml-auto truncate text-right ' + (embedded ? 'w-[230px]' : 'w-[330px]')}>
          {tool === 'text' && 'Clique em qualquer lugar para criar uma caixa de texto'}
          {tool === 'shape' && 'Clique no canvas para criar a forma'}
          {tool === 'pen' && 'Arraste para desenhar'}
          {tool === 'arrow' && (arrowFrom ? 'Agora clique na caixa de destino' : 'Clique na caixa de origem')}
          {tool === 'eraser' && 'Clique em um traço ou seta para apagar'}
          {tool === 'select' && (selIds.length > 1 ? `${selIds.length} selecionadas` : embedded ? 'Arraste para mover · duplo clique edita' : 'Duplo clique edita · arraste move')}
        </span>
        {extra}
      </div>
      {/* segunda barra: organizar o diagrama e exportar */}
      <div className="flex items-center gap-0.5 px-3 py-1 border-b border-line bg-panel shrink-0 flex-wrap">
        <button className="icon-btn" title="Desfazer no canvas (Ctrl+Z)" {...dis(undoStack.current.length > 0)} onClick={undo}>
          <Undo2 size={15} />
        </button>
        <button className="icon-btn" title="Refazer no canvas (Ctrl+Y)" {...dis(redoStack.current.length > 0)} onClick={redo}>
          <Redo2 size={15} />
        </button>
        {sep}
        <button className="icon-btn" title="Selecionar tudo (Ctrl+A)" {...dis(data.items.length > 0)} onClick={selectAll}>
          <BoxSelect size={15} />
        </button>
        <button className="icon-btn" title="Copiar a seleção (Ctrl+C)" {...dis(selIds.length > 0)} onClick={() => (copySel(), bump((n) => n + 1))}>
          <Copy size={15} />
        </button>
        <button className="icon-btn" title="Colar (Ctrl+V)" {...dis(!!clipboard?.items.length)} onClick={() => paste()}>
          <ClipboardPaste size={15} />
        </button>
        <button className="icon-btn" title="Duplicar a seleção (Ctrl+D)" {...dis(selIds.length > 0)} onClick={duplicate}>
          <CopyPlus size={15} />
        </button>
        {sep}
        {(
          [
            ['Mover a seleção para a esquerda (←)', -GRID, 0, ArrowLeft],
            ['Mover a seleção para cima (↑)', 0, -GRID, ArrowUp],
            ['Mover a seleção para baixo (↓)', 0, GRID, ArrowDown],
            ['Mover a seleção para a direita (→)', GRID, 0, ArrowRight],
          ] as const
        ).map(([tip, dx, dy, Icon]) => (
          <button key={tip} className="icon-btn" title={tip} {...dis(selIds.length > 0)} onClick={() => nudge(dx, dy)}>
            <Icon size={15} />
          </button>
        ))}
        {sep}
        {(
          [
            ['left', 'Alinhar à esquerda', AlignStartVertical],
            ['hcenter', 'Centralizar na horizontal', AlignCenterVertical],
            ['right', 'Alinhar à direita', AlignEndVertical],
            ['top', 'Alinhar ao topo', AlignStartHorizontal],
            ['vcenter', 'Centralizar na vertical', AlignCenterHorizontal],
            ['bottom', 'Alinhar à base', AlignEndHorizontal],
          ] as const
        ).map(([how, tip, Icon]) => (
          <button key={how} className="icon-btn" title={tip + ' (selecione 2 ou mais)'} {...dis(selIds.length > 1)} onClick={() => align(how)}>
            <Icon size={15} />
          </button>
        ))}
        <button className="icon-btn" title="Distribuir na horizontal (selecione 3 ou mais)" {...dis(selIds.length > 2)} onClick={() => distribute('h')}>
          <AlignHorizontalSpaceAround size={15} />
        </button>
        <button className="icon-btn" title="Distribuir na vertical (selecione 3 ou mais)" {...dis(selIds.length > 2)} onClick={() => distribute('v')}>
          <AlignVerticalSpaceAround size={15} />
        </button>
        {sep}
        <button className="icon-btn" title="Trazer para a frente" {...dis(selIds.length > 0)} onClick={() => reorder(true)}>
          <BringToFront size={15} />
        </button>
        <button className="icon-btn" title="Enviar para trás" {...dis(selIds.length > 0)} onClick={() => reorder(false)}>
          <SendToBack size={15} />
        </button>
        {sep}
        <button className={'icon-btn ' + (snap ? 'on' : '')} title={snap ? 'Encaixe na grade ligado' : 'Encaixe na grade desligado'} onClick={() => setSnap(!snap)}>
          <Grid3x3 size={15} />
        </button>
        <button className={'icon-btn ' + (elbow ? 'on' : '')} title={elbow ? 'Novas setas: em ângulo reto' : 'Novas setas: retas (clique para ângulo reto)'} onClick={() => setElbow(!elbow)}>
          <CornerDownRight size={15} />
        </button>
        {sep}
        <button className="btn" title="Escrever um rótulo na seta selecionada" {...dis(!!conn)} onClick={() => { if (!conn) return; const l = prompt('Rótulo da seta (vazio para remover):', conn.label || ''); if (l !== null) patchConn(conn.id, { label: l.trim() || undefined }) }}>
          <Tag size={13} /> Rótulo
        </button>
        <button className="btn" title="Trocar a seta selecionada entre reta e ângulo reto" {...dis(!!conn)} onClick={() => conn && patchConn(conn.id, { kind: conn.kind === 'elbow' ? 'straight' : 'elbow' })}>
          <CornerDownRight size={13} /> {conn?.kind === 'elbow' ? 'Deixar reta' : 'Em ângulo'}
        </button>
        {(['fromSide', 'toSide'] as const).map((k) => (
          <select
            key={k}
            title={k === 'fromSide' ? 'De que lado da forma a seta selecionada sai' : 'Por que lado a seta selecionada chega'}
            className="!py-0.5 !text-xs w-[112px]"
            disabled={!conn}
            style={{ opacity: conn ? 1 : 0.35 }}
            value={conn?.[k] || ''}
            onChange={(e) => conn && patchConn(conn.id, { [k]: (e.target.value || undefined) as Side | undefined })}
          >
            <option value="">{k === 'fromSide' ? 'Sai: automático' : 'Chega: automático'}</option>
            {SIDES.map(([s, label]) => (
              <option key={s} value={s}>
                {(k === 'fromSide' ? 'Sai: ' : 'Chega: ') + label}
              </option>
            ))}
          </select>
        ))}
        <button className="btn !text-red-400" title="Excluir a seta selecionada" {...dis(!!conn)} onClick={() => conn && (commit({ ...dataRef.current, connectors: dataRef.current.connectors.filter((c) => c.id !== conn.id) }), setSelConn(null))}>
          <Trash2 size={13} /> Excluir seta
        </button>
        <span className="flex-1" />
        <button className="btn" title="Salvar o diagrama como imagem PNG" onClick={() => exportAs('png')}>
          <FileImage size={13} /> PNG
        </button>
        <button className="btn" title="Salvar o diagrama como SVG (vetorial)" onClick={() => exportAs('svg')}>
          <FileCode2 size={13} /> SVG
        </button>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => (addFiles(Array.from(e.target.files || []), 80 + Math.random() * 200, 80 + Math.random() * 120), (e.target.value = ''))} />
      </div>
      <div className={embedded ? 'overflow-auto bg-bg' : 'flex-1 overflow-auto bg-bg'} style={embedded ? { height: height ?? 420 } : undefined}>
        <div
          ref={surface}
          tabIndex={0}
          className="relative outline-none"
          style={{ width: W, height: H, backgroundImage: 'radial-gradient(var(--line) 1px, transparent 1px)', backgroundSize: '20px 20px', cursor: tool === 'text' ? 'text' : tool === 'pen' || tool === 'shape' ? 'crosshair' : 'default', touchAction: 'none' }}
          onPointerDown={onSurfaceDown}
          onPointerMove={onSurfaceMove}
          onPointerUp={onSurfaceUp}
          onPointerCancel={onSurfaceUp}
          onLostPointerCapture={onSurfaceUp}
          onDragStart={(e) => e.preventDefault()}
          onClick={onSurfaceClick}
          onKeyDown={onKeyDown}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const files = Array.from(e.dataTransfer.files)
            if (files.length) addFiles(files, ...pt(e))
          }}
        >
          <svg data-canvas-svg width={W} height={H} className="absolute inset-0" style={{ pointerEvents: tool === 'eraser' ? 'auto' : 'none' }}>
            <defs>
              <marker id={markerId} markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
                <path d="M0 0 L10 4 L0 8 z" fill="context-stroke" />
              </marker>
            </defs>
            {data.connectors.map((c) => {
              const a = byId.get(c.from), b = byId.get(c.to)
              if (!a || !b) return null
              const g = connectorGeom(a, b, c, data.items)
              const stroke = selConn === c.id ? 'var(--accent)' : 'var(--muted)'
              const hit = {
                // linha larga e invisível: facilita clicar na seta (selecionar, apagar, rotular)
                stroke: 'transparent',
                strokeWidth: 14,
                fill: 'none',
                style: { pointerEvents: 'stroke' as const, cursor: 'pointer' },
                onPointerDown: (e: React.PointerEvent) => {
                  if (tool !== 'select') return
                  e.stopPropagation()
                  surface.current?.focus({ preventScroll: true })
                  setSelConn(c.id)
                  setSelIds([])
                },
                onClick: () => tool === 'eraser' && commit({ ...dataRef.current, connectors: dataRef.current.connectors.filter((x) => x.id !== c.id) }),
                onDoubleClick: () => {
                  const l = prompt('Rótulo da seta (vazio para remover):', c.label || '')
                  if (l !== null) patchConn(c.id, { label: l.trim() || undefined })
                },
              }
              return (
                <g key={c.id} data-connector={c.kind || 'straight'}>
                  {c.kind === 'elbow' ? (
                    <polyline points={ptsAttr(g.pts)} fill="none" stroke={stroke} strokeWidth={2} markerEnd={`url(#${markerId})`} />
                  ) : (
                    <line x1={g.pts[0][0]} y1={g.pts[0][1]} x2={g.pts[1][0]} y2={g.pts[1][1]} stroke={stroke} strokeWidth={2} markerEnd={`url(#${markerId})`} />
                  )}
                  <polyline points={ptsAttr(g.pts)} {...hit} />
                  {c.label && (
                    <text x={g.mid[0]} y={g.mid[1] - 5} textAnchor="middle" fontSize={12} fill="var(--fg)" stroke="var(--bg)" strokeWidth={4} paintOrder="stroke" style={{ pointerEvents: 'none' }}>
                      {c.label}
                    </text>
                  )}
                </g>
              )
            })}
            {data.strokes.map((s) => (
              <path key={s.id} d={path(s.points)} stroke={s.color} strokeWidth={s.width} fill="none" strokeLinecap="round" strokeLinejoin="round" className={tool === 'eraser' ? 'cursor-pointer hover:opacity-40' : ''} style={{ pointerEvents: tool === 'eraser' ? 'stroke' : 'none' }} onClick={() => tool === 'eraser' && commit({ ...dataRef.current, strokes: dataRef.current.strokes.filter((x) => x.id !== s.id) })} />
            ))}
            {draft && <path data-draft d={path(draft)} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }} />}
            {marquee && <rect x={Math.min(marquee.x0, marquee.x1)} y={Math.min(marquee.y0, marquee.y1)} width={Math.abs(marquee.x1 - marquee.x0)} height={Math.abs(marquee.y1 - marquee.y0)} fill="var(--accent)" fillOpacity={0.1} stroke="var(--accent)" strokeDasharray="4 3" />}
          </svg>
          {data.items.map((it) => {
            const selected = selIds.includes(it.id)
            const hot = selected || arrowFrom === it.id
            const cursor = tool === 'arrow' ? ' cursor-pointer' : tool === 'select' && editing !== it.id ? ' cursor-move' : ''
            const common = {
              onPointerDown: (e: React.PointerEvent) => onItemDown(e, it),
              onDoubleClick: () => it.type !== 'media' && tool === 'select' && (setEditing(it.id), setSelIds([it.id])),
            }
            const passThrough = tool === 'pen' || tool === 'eraser' || tool === 'text' || tool === 'shape' ? 'none' : 'auto'
            const handle = selected && selIds.length === 1 && tool === 'select' && <div className="absolute -right-1.5 -bottom-1.5 w-3.5 h-3.5 rounded-sm bg-accent cursor-nwse-resize" onPointerDown={(e) => onItemDown(e, it, 'resize')} />
            if (it.type === 'shape')
              return (
                <div
                  key={it.id}
                  data-shape={it.shape || 'rect'}
                  className={'absolute' + cursor + (editing === it.id ? '' : ' select-none')}
                  style={{ left: it.x, top: it.y, width: it.w, height: it.h, pointerEvents: passThrough, outline: hot ? '2px dashed var(--accent)' : 'none', outlineOffset: 3 }}
                  {...common}
                >
                  <svg className="absolute inset-0" width={it.w} height={it.h} style={{ color: it.color || 'var(--muted)', overflow: 'visible' }} dangerouslySetInnerHTML={{ __html: shapeMarkup(it.shape || 'rect', it.w, it.h, 'currentColor', 'var(--panel)') }} />
                  <div className="absolute inset-0 flex items-center justify-center text-center px-3 py-1.5 text-[13.5px] overflow-hidden">{editing === it.id ? editText(it) : <RichHtml html={it.html || ''} />}</div>
                  {handle}
                </div>
              )
            return (
              <div
                key={it.id}
                className={'absolute rounded-xl bg-panel border shadow-lg ' + (hot ? 'ring-2 ring-accent' : '') + cursor + (editing === it.id ? '' : ' select-none')}
                style={{ left: it.x, top: it.y, width: it.w, minHeight: it.type === 'text' ? it.h : undefined, height: it.type === 'media' ? it.h : undefined, borderColor: it.type === 'text' ? it.color || 'var(--line)' : 'var(--line)', borderLeftWidth: it.type === 'text' ? 4 : 1, pointerEvents: passThrough }}
                {...common}
              >
                {it.type === 'text' ? (
                  editing === it.id ? (
                    editText(it)
                  ) : (
                    <RichHtml html={it.html || '<span style="opacity:.5">Duplo clique para escrever…</span>'} className="p-2.5 text-[13.5px] whitespace-pre-wrap [tab-size:4]" />
                  )
                ) : (
                  <div className="w-full h-full overflow-auto rounded-xl">{it.fileId && <MediaBlock fileId={it.fileId} onRemove={() => removeItem(it.id)} />}</div>
                )}
                {handle}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

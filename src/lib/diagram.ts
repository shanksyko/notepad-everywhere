import type { CanvasConnector, CanvasData, CanvasItem, ShapeKind, Side } from '../db'
import { escapeHtml, stripHtml } from './util'

/* Geometria dos diagramas (formas e conectores) e conversão do canvas em SVG (impressão / exportação). */

export const SHAPES: [ShapeKind, string][] = [
  ['rect', 'Retângulo (processo)'],
  ['round', 'Arredondado (início / fim)'],
  ['diamond', 'Losango (decisão)'],
  ['ellipse', 'Elipse'],
  ['parallelogram', 'Paralelogramo (entrada / saída)'],
  ['hexagon', 'Hexágono (preparação)'],
  ['document', 'Documento'],
  ['cylinder', 'Cilindro (banco de dados)'],
  ['cloud', 'Nuvem'],
  ['person', 'Pessoa (ator)'],
]
export const SIDES: [Side, string][] = [
  ['top', 'cima'],
  ['right', 'direita'],
  ['bottom', 'baixo'],
  ['left', 'esquerda'],
]

/** Conteúdo SVG de uma forma que ocupa a caixa 0,0 – w,h. */
export function shapeMarkup(kind: ShapeKind, w: number, h: number, stroke: string, fill: string, sw = 2): string {
  const i = sw / 2
  const a = `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"`
  const n = (v: number) => +v.toFixed(2)
  switch (kind) {
    case 'round':
      return `<rect x="${i}" y="${i}" width="${w - sw}" height="${h - sw}" rx="${Math.min(h / 2, 26)}" ${a}/>`
    case 'diamond':
      return `<polygon points="${w / 2},${i} ${w - i},${h / 2} ${w / 2},${h - i} ${i},${h / 2}" ${a}/>`
    case 'ellipse':
      return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - i}" ry="${h / 2 - i}" ${a}/>`
    case 'parallelogram': {
      const k = Math.min(w * 0.18, 28)
      return `<polygon points="${k},${i} ${w - i},${i} ${w - k},${h - i} ${i},${h - i}" ${a}/>`
    }
    case 'hexagon': {
      const k = Math.min(w * 0.2, h / 2)
      return `<polygon points="${n(k)},${i} ${n(w - k)},${i} ${w - i},${h / 2} ${n(w - k)},${h - i} ${n(k)},${h - i} ${i},${h / 2}" ${a}/>`
    }
    case 'document': {
      // retângulo com a base ondulada
      const d = Math.min(h * 0.18, 14)
      return `<path d="M${i} ${i} H${w - i} V${n(h - d)} C${n(w * 0.75)} ${n(h - d * 2.4)} ${n(w * 0.6)} ${n(h + d * 0.5)} ${n(w / 2)} ${n(h - d)} C${n(w * 0.38)} ${n(h - d * 2.2)} ${n(w * 0.2)} ${n(h + d * 0.4)} ${i} ${n(h - d * 0.6)} Z" ${a}/>`
    }
    case 'cylinder': {
      const r = Math.min(h * 0.16, 16)
      return `<path d="M${i} ${r} A${w / 2 - i} ${r - i} 0 0 1 ${w - i} ${r} V${h - r} A${w / 2 - i} ${r - i} 0 0 1 ${i} ${h - r} Z" ${a}/><path d="M${i} ${r} A${w / 2 - i} ${r - i} 0 0 0 ${w - i} ${r}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`
    }
    case 'cloud': {
      const x = (f: number) => n(i + (w - sw) * f), y = (f: number) => n(i + (h - sw) * f)
      return `<path d="M${x(0.25)} ${y(0.85)} C${x(0.02)} ${y(0.88)} ${x(-0.02)} ${y(0.45)} ${x(0.18)} ${y(0.42)} C${x(0.14)} ${y(0.12)} ${x(0.42)} ${y(0.02)} ${x(0.52)} ${y(0.22)} C${x(0.62)} ${y(-0.02)} ${x(0.9)} ${y(0.1)} ${x(0.84)} ${y(0.4)} C${x(1.04)} ${y(0.44)} ${x(1.02)} ${y(0.88)} ${x(0.78)} ${y(0.85)} Z" ${a}/>`
    }
    case 'person': {
      // cabeça + ombros (ator de caso de uso)
      const r = Math.min(w, h) * 0.2
      const top = i + r * 2 + 3
      return `<circle cx="${w / 2}" cy="${n(i + r)}" r="${n(r)}" ${a}/><path d="M${i} ${h - i} V${n(top + (h - top) * 0.45)} C${i} ${n(top)} ${w - i} ${n(top)} ${w - i} ${n(top + (h - top) * 0.45)} V${h - i} Z" ${a}/>`
    }
    default:
      return `<rect x="${i}" y="${i}" width="${w - sw}" height="${h - sw}" rx="3" ${a}/>`
  }
}

type Pt = [number, number]
const center = (it: CanvasItem): Pt => [it.x + it.w / 2, it.y + it.h / 2]
const sidePoint = (it: CanvasItem, s: Side): Pt => (s === 'top' ? [it.x + it.w / 2, it.y] : s === 'bottom' ? [it.x + it.w / 2, it.y + it.h] : s === 'left' ? [it.x, it.y + it.h / 2] : [it.x + it.w, it.y + it.h / 2])
const sideDir = (s: Side): Pt => (s === 'top' ? [0, -1] : s === 'bottom' ? [0, 1] : s === 'left' ? [-1, 0] : [1, 0])

/** Ponto na borda de `a` na direção de um ponto (respeita elipse e losango). */
function edgeToward(a: CanvasItem, [bx, by]: Pt): Pt {
  const [ax, ay] = center(a)
  const dx = bx - ax, dy = by - ay
  if (!dx && !dy) return [ax, ay]
  const hw = a.w / 2, hh = a.h / 2
  let t: number
  const kind = a.type === 'shape' ? a.shape : 'rect'
  if (kind === 'ellipse') t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2)
  else if (kind === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
  else t = Math.min(Math.abs(hw / (dx || 1e-6)), Math.abs(hh / (dy || 1e-6)))
  return [ax + dx * t, ay + dy * t]
}
export const edgePoint = (a: CanvasItem, b: CanvasItem): Pt => edgeToward(a, center(b))

/** remove pontos repetidos ou no meio de um trecho reto */
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const q = out[out.length - 1]
    if (q && Math.abs(q[0] - p[0]) < 0.5 && Math.abs(q[1] - p[1]) < 0.5) continue
    const r = out[out.length - 2]
    if (r && q && ((Math.abs(r[0] - q[0]) < 0.5 && Math.abs(q[0] - p[0]) < 0.5) || (Math.abs(r[1] - q[1]) < 0.5 && Math.abs(q[1] - p[1]) < 0.5))) out[out.length - 1] = p
    else out.push(p)
  }
  return out
}

/** Caminho em ângulos retos saindo de `sa` e chegando por `sb`. */
function elbowRoute(a: CanvasItem, sa: Side, b: CanvasItem, sb: Side): Pt[] {
  const STUB = 18
  const p0 = sidePoint(a, sa), p3 = sidePoint(b, sb)
  const d0 = sideDir(sa), d3 = sideDir(sb)
  const s0: Pt = [p0[0] + d0[0] * STUB, p0[1] + d0[1] * STUB]
  const s3: Pt = [p3[0] + d3[0] * STUB, p3[1] + d3[1] * STUB]
  const h0 = d0[0] !== 0, h3 = d3[0] !== 0
  let mid: Pt[]
  if (h0 && h3) {
    // os dois horizontais: desce/sobe numa coluna intermediária
    const facing = d0[0] !== d3[0] && (p3[0] - p0[0]) * d0[0] > STUB * 2
    const mx = facing ? (p0[0] + p3[0]) / 2 : d0[0] > 0 ? Math.max(s0[0], s3[0]) : Math.min(s0[0], s3[0])
    mid = [[mx, s0[1]], [mx, s3[1]]]
  } else if (!h0 && !h3) {
    const facing = d0[1] !== d3[1] && (p3[1] - p0[1]) * d0[1] > STUB * 2
    const my = facing ? (p0[1] + p3[1]) / 2 : d0[1] > 0 ? Math.max(s0[1], s3[1]) : Math.min(s0[1], s3[1])
    mid = [[s0[0], my], [s3[0], my]]
  } else if (h0) mid = [[s3[0], s0[1]]]
  else mid = [[s0[0], s3[1]]]
  return simplify([p0, s0, ...mid, s3, p3])
}

/** o trecho p–q (horizontal ou vertical) atravessa o retângulo do item? */
function segHits(p: Pt, q: Pt, it: CanvasItem, pad: number): boolean {
  const l = it.x - pad, r = it.x + it.w + pad, t = it.y - pad, b = it.y + it.h + pad
  const x0 = Math.min(p[0], q[0]), x1 = Math.max(p[0], q[0]), y0 = Math.min(p[1], q[1]), y1 = Math.max(p[1], q[1])
  return x1 > l && x0 < r && y1 > t && y0 < b
}
const pathLen = (pts: Pt[]) => pts.slice(1).reduce((s, p, i) => s + Math.abs(p[0] - pts[i][0]) + Math.abs(p[1] - pts[i][1]), 0)

type ConnLike = Pick<CanvasConnector, 'kind' | 'fromSide' | 'toSide'>

/**
 * Pontos de um conector e onde fica o rótulo.
 * Em ângulo reto: usa os lados escolhidos pelo usuário; para os lados "automáticos" testa as combinações
 * e fica com o caminho que cruza menos formas (`items`) e, no empate, o mais curto.
 */
export function connectorGeom(a: CanvasItem, b: CanvasItem, c: ConnLike = {}, items: CanvasItem[] = []): { pts: Pt[]; mid: Pt } {
  if (c.kind !== 'elbow') {
    const p = c.fromSide ? sidePoint(a, c.fromSide) : c.toSide ? edgeToward(a, sidePoint(b, c.toSide)) : edgePoint(a, b)
    const q = c.toSide ? sidePoint(b, c.toSide) : edgeToward(b, p)
    return { pts: [p, q], mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] }
  }
  const all: Side[] = ['right', 'left', 'bottom', 'top']
  const others = items.filter((i) => i.id !== a.id && i.id !== b.id && i.type !== 'text')
  let best: Pt[] | null = null
  let bestScore = Infinity
  for (const sa of c.fromSide ? [c.fromSide] : all)
    for (const sb of c.toSide ? [c.toSide] : all) {
      const pts = elbowRoute(a, sa, b, sb)
      let hits = 0
      for (let i = 0; i < pts.length - 1; i++) {
        for (const o of others) if (segHits(pts[i], pts[i + 1], o, 6)) hits++
        // não pode cortar por dentro das próprias formas de origem e destino (só encostar nelas nas pontas)
        if (i > 0 && segHits(pts[i], pts[i + 1], a, -2)) hits += 2
        if (i < pts.length - 2 && segHits(pts[i], pts[i + 1], b, -2)) hits += 2
      }
      const score = hits * 100000 + pathLen(pts) + pts.length * 12
      if (score < bestScore) {
        bestScore = score
        best = pts
      }
    }
  const pts = best!
  // rótulo no meio do trecho mais longo
  let k = 0, len = -1
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1])
    if (l > len) (len = l), (k = i)
  }
  return { pts, mid: [(pts[k][0] + pts[k + 1][0]) / 2, (pts[k][1] + pts[k + 1][1]) / 2] }
}

export const ptsAttr = (pts: Pt[]) => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')

/* ---------- canvas → SVG ---------- */

export interface SvgOptions {
  /** URL (ou data URL) de um arquivo de imagem */
  href: (fileId: string) => Promise<string>
  /** nome e se é imagem */
  fileInfo: (fileId: string) => { name: string; image: boolean } | null
  /**
   * Se informado, o texto sai formatado (negrito, fórmulas…) dentro de foreignObject, com o texto simples
   * como alternativa para programas que não entendem foreignObject. Precisa devolver XML bem-formado.
   */
  richHtml?: (html: string) => string
  colors?: { bg: string; panel: string; fg: string; line: string }
}

let measureCtx: CanvasRenderingContext2D | null = null
function wrap(text: string, maxW: number, font = '13px "Segoe UI", Arial, sans-serif'): string[] {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  const ctx = measureCtx!
  ctx.font = font
  const out: string[] = []
  for (const para of text.split(/\n/)) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? line + ' ' + word : word
      if (ctx.measureText(t).width > maxW && line) {
        out.push(line)
        line = word
      } else line = t
    }
    out.push(line)
  }
  return out.filter((l, i, arr) => l || i < arr.length - 1)
}

/** Altura estimada de uma caixa de texto (a altura real não é guardada). */
export function textBoxHeight(it: CanvasItem): number {
  if (it.type !== 'text') return it.h
  const lines = wrap(stripHtml((it.html || '').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')), Math.max(40, it.w - 26)).length
  return Math.max(it.h, lines * 19 + 22)
}

export async function canvasToSvg(data: CanvasData, opts: SvgOptions): Promise<{ svg: string; w: number; h: number } | null> {
  if (!data || (!data.items?.length && !data.strokes?.length)) return null
  const c = opts.colors || { bg: '#ffffff', panel: '#ffffff', fg: '#111111', line: '#8a909b' }
  const items = (data.items || []).map((it) => ({ ...it, h: textBoxHeight(it) }))
  const byId = new Map(items.map((i) => [i.id, i]))
  const geoms = (data.connectors || []).flatMap((cn) => {
    const a = byId.get(cn.from), b = byId.get(cn.to)
    return a && b ? [{ cn, g: connectorGeom(a, b, cn, items) }] : []
  })
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const grow = (x: number, y: number) => ((x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y)))
  items.forEach((i) => (grow(i.x, i.y), grow(i.x + i.w, i.y + i.h)))
  ;(data.strokes || []).forEach((s) => s.points.forEach((p) => grow(p[0], p[1])))
  geoms.forEach(({ g }) => g.pts.forEach((p) => grow(p[0], p[1])))
  const pad = 16
  x0 -= pad
  y0 -= pad
  const W = Math.ceil(x1 - x0 + pad), H = Math.ceil(y1 - y0 + pad)
  let out = ''

  for (const { cn, g } of geoms) {
    const pts = g.pts.map((p) => [p[0] - x0, p[1] - y0] as Pt)
    const q = pts[pts.length - 1], p = pts[pts.length - 2]
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0])
    const tip = (d: number, off: number) => `${(q[0] - Math.cos(ang + off) * d).toFixed(1)},${(q[1] - Math.sin(ang + off) * d).toFixed(1)}`
    out += `<g data-connector="${cn.kind || 'straight'}"><polyline points="${ptsAttr(pts)}" fill="none" stroke="#555" stroke-width="2"/><polygon points="${q[0].toFixed(1)},${q[1].toFixed(1)} ${tip(11, 0.42)} ${tip(11, -0.42)}" fill="#555"/>`
    if (cn.label) out += `<text x="${(g.mid[0] - x0).toFixed(1)}" y="${(g.mid[1] - y0 - 5).toFixed(1)}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="${c.fg}" stroke="${c.bg}" stroke-width="4" paint-order="stroke">${escapeHtml(cn.label)}</text>`
    out += '</g>'
  }
  for (const s of data.strokes || []) out += `<path data-stroke="1" d="${s.points.map((p, i) => (i ? 'L' : 'M') + (p[0] - x0).toFixed(1) + ' ' + (p[1] - y0).toFixed(1)).join(' ')}" stroke="${s.color}" stroke-width="${s.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`

  const textOf = (it: CanvasItem, centerText: boolean) => {
    const html = it.html || ''
    if (!stripHtml(html).trim()) return ''
    const lines = wrap(stripHtml(html.replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')), Math.max(30, it.w - 26))
    const lh = 19
    const top = centerText ? it.h / 2 - ((lines.length - 1) * lh) / 2 + 4.5 : 22
    const plain = lines.map((l, i) => `<text x="${centerText ? it.w / 2 : 12}" y="${(top + i * lh).toFixed(1)}" text-anchor="${centerText ? 'middle' : 'start'}" font-family="Segoe UI, Arial, sans-serif" font-size="13" fill="${c.fg}">${escapeHtml(l)}</text>`).join('')
    if (!opts.richHtml) return plain
    const rich = `<foreignObject x="0" y="0" width="${it.w}" height="${it.h}"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:${it.w}px;height:${it.h}px;padding:6px 10px;font:13px/1.45 'Segoe UI',Arial,sans-serif;color:${c.fg};overflow:hidden;${centerText ? 'display:flex;align-items:center;justify-content:center;text-align:center;' : ''}"><div>${opts.richHtml(html)}</div></div></foreignObject>`
    // <switch>: quem entende foreignObject mostra o texto formatado; os demais caem no texto simples
    return `<switch>${rich}<g>${plain}</g></switch>`
  }

  for (const it of items) {
    out += `<g data-item="${it.type}" transform="translate(${it.x - x0},${it.y - y0})">`
    if (it.type === 'shape') out += shapeMarkup(it.shape || 'rect', it.w, it.h, it.color || c.line, c.panel) + textOf(it, true)
    else if (it.type === 'text') out += `<rect x="1" y="1" width="${it.w - 2}" height="${it.h - 2}" rx="8" fill="${c.panel}" stroke="${c.line}"/><rect x="1" y="1" width="4" height="${it.h - 2}" rx="2" fill="${it.color || c.line}"/>` + textOf(it, false)
    else {
      const f = it.fileId ? opts.fileInfo(it.fileId) : null
      out += `<rect x="1" y="1" width="${it.w - 2}" height="${it.h - 2}" rx="8" fill="${c.panel}" stroke="${c.line}"/>`
      if (f?.image) out += `<image href="${await opts.href(it.fileId!)}" x="4" y="4" width="${it.w - 8}" height="${it.h - 8}" preserveAspectRatio="xMidYMid meet"/>`
      else out += `<text x="12" y="24" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="${c.fg}">📎 ${escapeHtml(f?.name || 'arquivo')}</text>`
    }
    out += '</g>'
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${c.bg}"/>${out}</svg>`
  return { svg, w: W, h: H }
}

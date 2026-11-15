import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Crop, Download, ExternalLink, FileText, MapPin, Quote, Repeat, RotateCw, Subtitles, Timer, Trash2, X, ZoomIn, ZoomOut, Check } from 'lucide-react'
import { actions, getFileBlob, useFileUrl, useStore } from '../store'
import type { Cue, Hotspot } from '../db'
import { downloadBlob, fmtDate, fmtSize, fmtTime, isTexty, mediaKind, uid, clamp } from '../lib/util'
import { getPdfjs, loadPdf, renderPdfPage, type PDFDocumentProxy } from '../lib/pdf'

export interface MediaProps {
  fileId: string
  attrs?: { zoom?: number; rotation?: number }
  setAttrs?: (a: Record<string, any>) => void
  onInsert?: (content: any) => void
  onRemove?: () => void
  initial?: { time?: number; page?: number }
}

function useMediaEvent(fileId: string, fn: (d: { time?: number; page?: number }) => void) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail
      if (d.fileId === fileId) ref.current(d)
    }
    window.addEventListener('ne:media', h)
    return () => window.removeEventListener('ne:media', h)
  }, [fileId])
}

function Header({ fileId, onRemove, children }: { fileId: string; onRemove?: () => void; children?: React.ReactNode }) {
  const f = useStore((s) => s.files[fileId])
  return (
    <div data-media-header title="Arraste por esta barra para mover o bloco" className="flex items-center gap-1 px-2 py-1 border-b border-line bg-panel2 text-xs text-muted flex-wrap cursor-grab" contentEditable={false}>
      <span className="truncate max-w-[220px] mr-auto font-medium text-fg" data-file-preview={fileId}>
        {f?.name}
      </span>
      {children}
      {onRemove && (
        <button className="icon-btn !w-6 !h-6" title="Remover da nota" onClick={onRemove}>
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )
}

/* ============================================================
   Imagem com hotspots (pins), zoom, rotação e recorte
   ============================================================ */
function ImageBlock({ fileId, attrs, setAttrs, onRemove }: MediaProps) {
  const url = useFileUrl(fileId)
  const all = useStore((s) => s.hotspots)
  const pins = Object.values(all).filter((h) => h.fileId === fileId)
  const [mode, setMode] = useState<'view' | 'pin' | 'crop'>('view')
  const [localZoom, setLocalZoom] = useState(100)
  const [localRot, setLocalRot] = useState(0)
  const zoom = attrs?.zoom ?? localZoom
  const rot = attrs?.rotation ?? localRot
  const set = (a: { zoom?: number; rotation?: number }) => {
    if (setAttrs) setAttrs(a)
    else {
      if (a.zoom != null) setLocalZoom(a.zoom)
      if (a.rotation != null) setLocalRot(a.rotation)
    }
  }
  const imgRef = useRef<HTMLImageElement>(null)
  const [aspect, setAspect] = useState(1.6)
  const [crop, setCrop] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const drag = useRef(false)

  const addPin = (e: React.MouseEvent) => {
    if (mode !== 'pin' || e.target !== imgRef.current) return
    const img = imgRef.current!
    const h: Hotspot = { id: uid(), fileId, x: e.nativeEvent.offsetX / img.clientWidth, y: e.nativeEvent.offsetY / img.clientHeight, label: 'Novo pin', html: '', termId: null }
    actions.saveHotspot(h)
    actions.pin({ kind: 'hotspot', id: h.id, x: Math.min(e.clientX + 14, innerWidth - 360), y: Math.min(e.clientY + 14, innerHeight - 320), edit: true })
    setMode('view')
  }

  const applyCrop = async () => {
    const img = imgRef.current
    if (!img || !crop) return
    const x0 = Math.min(crop.x0, crop.x1), x1 = Math.max(crop.x0, crop.x1), y0 = Math.min(crop.y0, crop.y1), y1 = Math.max(crop.y0, crop.y1)
    if (x1 - x0 < 0.03 || y1 - y0 < 0.03) return
    const nw = img.naturalWidth || 1200
    const nh = img.naturalHeight || Math.round(1200 / aspect)
    const c = document.createElement('canvas')
    c.width = Math.round((x1 - x0) * nw)
    c.height = Math.round((y1 - y0) * nh)
    c.getContext('2d')!.drawImage(img, x0 * nw, y0 * nh, c.width, c.height, 0, 0, c.width, c.height)
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/png'))
    if (!blob) return
    const remapped = pins
      .filter((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)
      .map((p) => ({ ...p, x: (p.x - x0) / (x1 - x0), y: (p.y - y0) / (y1 - y0) }))
    await actions.replaceBlob(fileId, blob)
    actions.replaceHotspots(fileId, remapped)
    setCrop(null)
    setMode('view')
  }

  const quarter = rot % 180 !== 0
  const cropBox = crop && { left: Math.min(crop.x0, crop.x1) * 100 + '%', top: Math.min(crop.y0, crop.y1) * 100 + '%', width: Math.abs(crop.x1 - crop.x0) * 100 + '%', height: Math.abs(crop.y1 - crop.y0) * 100 + '%' }

  return (
    <div className="rounded-xl border border-line overflow-hidden bg-panel" data-media-host={fileId}>
      <Header fileId={fileId} onRemove={onRemove}>
        <button className="icon-btn !w-6 !h-6" title="Diminuir zoom" onClick={() => set({ zoom: clamp(zoom - 20, 20, 300) })}>
          <ZoomOut size={13} />
        </button>
        <span className="w-9 text-center tabular-nums">{zoom}%</span>
        <button className="icon-btn !w-6 !h-6" title="Aumentar zoom" onClick={() => set({ zoom: clamp(zoom + 20, 20, 300) })}>
          <ZoomIn size={13} />
        </button>
        <button className="icon-btn !w-6 !h-6" title="Girar 90°" onClick={() => set({ rotation: (rot + 90) % 360 })}>
          <RotateCw size={13} />
        </button>
        <button
          className={'icon-btn !w-6 !h-6 ' + (mode === 'crop' ? 'on' : '')}
          title="Recortar"
          onClick={() => {
            set({ rotation: 0 })
            setCrop(null)
            setMode(mode === 'crop' ? 'view' : 'crop')
          }}
        >
          <Crop size={13} />
        </button>
        <button className={'btn !py-0.5 ' + (mode === 'pin' ? 'btn-on' : '')} title="Clique na imagem para criar um alfinete interativo" onClick={() => setMode(mode === 'pin' ? 'view' : 'pin')}>
          <MapPin size={13} /> {mode === 'pin' ? 'Clique na imagem…' : 'Novo pin'}
        </button>
        {mode === 'crop' && (
          <>
            <button className="btn btn-accent !py-0.5" disabled={!crop} onClick={applyCrop}>
              <Check size={13} /> Aplicar recorte
            </button>
            <button className="btn !py-0.5" onClick={() => (setMode('view'), setCrop(null))}>
              Cancelar
            </button>
          </>
        )}
      </Header>
      <div className="overflow-auto p-2" contentEditable={false}>
        <div
          className="relative mx-auto"
          style={{ width: zoom + '%', transform: `rotate(${rot}deg)`, margin: quarter ? `${Math.max(0, (zoom * (1 - 1 / aspect)) / 2)}% auto` : undefined, cursor: mode === 'pin' ? 'crosshair' : undefined, transition: 'transform .2s' }}
          onClick={addPin}
        >
          {url && <img ref={imgRef} src={url} draggable={false} className="block w-full select-none rounded-lg" onLoad={(e) => setAspect(e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight) || 1.6)} />}
          {mode !== 'crop' &&
            pins.map((p, i) => (
              <button
                key={p.id}
                data-hotspot-id={p.id}
                className="absolute w-6 h-6 -ml-3 -mt-3 rounded-full bg-accent text-white text-[11px] font-bold ring-2 ring-white shadow-lg hover:scale-125 transition-transform"
                style={{ left: p.x * 100 + '%', top: p.y * 100 + '%', transform: `rotate(${-rot}deg)` }}
              >
                {i + 1}
              </button>
            ))}
          {mode === 'crop' && (
            <div
              className="absolute inset-0 cursor-crosshair bg-black/30"
              onPointerDown={(e) => {
                const r = e.currentTarget
                drag.current = true
                r.setPointerCapture(e.pointerId)
                const x = e.nativeEvent.offsetX / r.clientWidth, y = e.nativeEvent.offsetY / r.clientHeight
                setCrop({ x0: x, y0: y, x1: x, y1: y })
              }}
              onPointerMove={(e) => {
                if (!drag.current) return
                const r = e.currentTarget.getBoundingClientRect()
                const x = clamp((e.clientX - r.left) / r.width, 0, 1), y = clamp((e.clientY - r.top) / r.height, 0, 1)
                setCrop((c) => c && { ...c, x1: x, y1: y })
              }}
              onPointerUp={() => (drag.current = false)}
            >
              {cropBox && <div className="absolute border-2 border-white bg-white/20 pointer-events-none" style={cropBox} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   Áudio / Vídeo: velocidade, loop A–B, transcrição e timestamps
   ============================================================ */
function parseCues(text: string): Cue[] {
  const cues: Cue[] = []
  const toSec = (s: string) => {
    const p = s.replace(',', '.').split(':').map(Number)
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]
  }
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n')
    const idx = lines.findIndex((l) => l.includes('-->'))
    if (idx < 0) continue
    const m = lines[idx].match(/([\d:.,]+)\s*-->/)
    if (!m) continue
    const body = lines.slice(idx + 1).join(' ').replace(/<[^>]+>/g, '').trim()
    if (body) cues.push({ t: toSec(m[1]), text: body })
  }
  return cues
}

function AvBlock({ fileId, onInsert, onRemove, initial }: MediaProps) {
  const url = useFileUrl(fileId)
  const file = useStore((s) => s.files[fileId])
  const isVideo = file.type.startsWith('video/')
  const ref = useRef<HTMLMediaElement>(null)
  const [rate, setRate] = useState(1)
  const [a, setA] = useState<number | null>(null)
  const [b, setB] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const subRef = useRef<HTMLInputElement>(null)
  const loop = useRef({ a, b })
  loop.current = { a, b }

  const seek = (t: number, play = true) => {
    const el = ref.current
    if (!el) return
    el.currentTime = t
    if (play) el.play().catch(() => {})
  }
  useMediaEvent(fileId, (d) => d.time != null && seek(d.time))
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate
  }, [rate, url])

  const cues = file.transcript || []
  const active = cues.reduce((acc, c, i) => (c.t <= now + 0.05 ? i : acc), -1)
  const common = {
    src: url || undefined,
    controls: true,
    onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => {
      const el = e.currentTarget
      const { a, b } = loop.current
      if (a != null && b != null && b > a && el.currentTime >= b) el.currentTime = a
      setNow(el.currentTime)
    },
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => {
      e.currentTarget.playbackRate = rate
      if (initial?.time != null) seek(initial.time)
    },
  }
  return (
    <div className="rounded-xl border border-line overflow-hidden bg-panel" data-media-host={fileId} contentEditable={false}>
      <Header fileId={fileId} onRemove={onRemove} />
      <div className="p-2">
        {isVideo ? <video ref={ref as any} {...common} className="w-full max-h-[420px] rounded-lg bg-black" /> : <audio ref={ref as any} {...common} className="w-full" />}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap text-xs">
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))} title="Velocidade" className="!py-0.5">
            {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
          <button className={'btn !py-0.5 ' + (a != null ? 'btn-on' : '')} title="Início do loop" onClick={() => setA(ref.current?.currentTime ?? 0)}>
            A {a != null && fmtTime(a)}
          </button>
          <button className={'btn !py-0.5 ' + (b != null ? 'btn-on' : '')} title="Fim do loop" onClick={() => setB(ref.current?.currentTime ?? 0)}>
            B {b != null && fmtTime(b)}
          </button>
          {(a != null || b != null) && (
            <button className="btn !py-0.5" title="Limpar loop A–B" onClick={() => (setA(null), setB(null))}>
              <Repeat size={12} /> limpar
            </button>
          )}
          <span className="flex-1" />
          <button className="btn !py-0.5" title="Carregar legendas (.vtt / .srt)" onClick={() => subRef.current?.click()}>
            <Subtitles size={13} /> Legendas
          </button>
          {onInsert && (
            <button
              className="btn btn-accent !py-0.5"
              title="Cria um link no texto que pula para este instante"
              onClick={() => {
                const t = Math.floor(ref.current?.currentTime ?? 0)
                onInsert({
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: `⏱ ${fmtTime(t)} — ${file.name}`, marks: [{ type: 'mediaLink', attrs: { fileId, time: t, page: null } }] },
                    { type: 'text', text: ' ' },
                  ],
                })
              }}
            >
              <Timer size={13} /> Marcar Timestamp
            </button>
          )}
          <input
            ref={subRef}
            type="file"
            accept=".vtt,.srt,text/vtt"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) actions.setTranscript(fileId, parseCues(await f.text()))
              e.target.value = ''
            }}
          />
        </div>
        {cues.length > 0 && (
          <div className="mt-2 max-h-36 overflow-auto rounded-lg border border-line divide-y divide-line">
            {cues.map((c, i) => (
              <button key={i} className={'flex gap-2 w-full text-left px-2 py-1 text-[13px] hover:bg-panel2 ' + (i === active ? 'bg-panel2 text-accent' : '')} onClick={() => seek(c.t)}>
                <span className="tabular-nums text-muted w-9 shrink-0">{fmtTime(c.t)}</span>
                <span>{c.text}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ============================================================
   PDF paginado com seleção de texto e "Extrair para Nota"
   ============================================================ */
function PdfBlock({ fileId, onInsert, onRemove, initial }: MediaProps) {
  const file = useStore((s) => s.files[fileId])
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const pageBox = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [err, setErr] = useState('')
  const [page, setPage] = useState(initial?.page ?? 1)
  const [zoom, setZoom] = useState(1)
  const [boxW, setBoxW] = useState(0)
  const [sel, setSel] = useState('')
  const run = useRef(0)
  const chain = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    loadPdf(fileId).then(setDoc, (e) => setErr(String(e?.message || e)))
  }, [fileId, file.rev])
  useEffect(() => {
    if (!wrap.current) return
    const ro = new ResizeObserver(() => setBoxW(wrap.current?.clientWidth || 0))
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])
  useMediaEvent(fileId, (d) => d.page != null && setPage(d.page))

  useEffect(() => {
    if (!doc || !boxW || !canvas.current) return
    const id = ++run.current
    const width = Math.round(Math.min(boxW - 16, 780) * zoom)
    // renderizações em fila: o pdf.js não aceita dois render() simultâneos no mesmo canvas
    chain.current = chain.current.then(async () => {
      if (id !== run.current || !canvas.current) return
      try {
        const r = await renderPdfPage(doc, page, canvas.current, width)
        if (id !== run.current || !textRef.current || !pageBox.current) return
        pageBox.current.style.width = r.width + 'px'
        pageBox.current.style.height = r.height + 'px'
        pageBox.current.style.setProperty('--scale-factor', String(r.scale))
        pageBox.current.style.setProperty('--total-scale-factor', String(r.scale))
        pageBox.current.style.setProperty('--user-unit', '1')
        textRef.current.replaceChildren()
        const tl = new (await getPdfjs()).TextLayer({ textContentSource: await r.page.getTextContent(), container: textRef.current, viewport: r.page.getViewport({ scale: r.scale }) })
        await tl.render()
      } catch (e: any) {
        if (e?.name !== 'RenderingCancelledException') console.warn(e)
      }
    })
  }, [doc, page, zoom, boxW])

  const n = doc?.numPages ?? 0
  return (
    <div className="rounded-xl border border-line overflow-hidden bg-panel" data-media-host={fileId} contentEditable={false}>
      <Header fileId={fileId} onRemove={onRemove}>
        <button className="icon-btn !w-6 !h-6" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          <ChevronLeft size={14} />
        </button>
        <span className="tabular-nums">
          {page} / {n || '…'}
        </span>
        <button className="icon-btn !w-6 !h-6" disabled={page >= n} onClick={() => setPage((p) => Math.min(n, p + 1))}>
          <ChevronRight size={14} />
        </button>
        <button className="icon-btn !w-6 !h-6" onClick={() => setZoom((z) => clamp(z - 0.15, 0.4, 2.5))}>
          <ZoomOut size={13} />
        </button>
        <button className="icon-btn !w-6 !h-6" onClick={() => setZoom((z) => clamp(z + 0.15, 0.4, 2.5))}>
          <ZoomIn size={13} />
        </button>
        {onInsert && (
          <button
            className={'btn !py-0.5 ' + (sel ? 'btn-accent' : 'opacity-50')}
            disabled={!sel}
            title="Selecione um trecho do PDF e clique aqui"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onInsert({
                type: 'blockquote',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: sel }] },
                  { type: 'paragraph', content: [{ type: 'text', text: `📄 ${file.name} — p. ${page}`, marks: [{ type: 'mediaLink', attrs: { fileId, page, time: null } }] }] },
                ],
              })
              setSel('')
              getSelection()?.removeAllRanges()
            }}
          >
            <Quote size={13} /> Extrair para Nota
          </button>
        )}
      </Header>
      <div ref={wrap} className="overflow-auto max-h-[640px] p-2 bg-panel2">
        {err && <div className="p-4 text-sm text-red-400">Não foi possível abrir o PDF: {err}</div>}
        <div
          ref={pageBox}
          className="pdf-page"
          onMouseUp={() =>
            setTimeout(() => {
              const s = getSelection()
              const txt = s && textRef.current && s.anchorNode && textRef.current.contains(s.anchorNode) ? s.toString().replace(/\s+/g, ' ').trim() : ''
              setSel(txt)
            }, 0)
          }
        >
          <canvas ref={canvas} className="block" />
          <div ref={textRef} className="textLayer" />
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   Cartão inteligente para arquivos genéricos
   ============================================================ */
function useTextPreview(fileId: string, enabled: boolean, max = 2400) {
  const [text, setText] = useState('')
  useEffect(() => {
    if (!enabled) return
    let ok = true
    getFileBlob(fileId).then(async (b) => b && ok && setText((await b.slice(0, max).text()) + (b.size > max ? '\n…' : '')))
    return () => {
      ok = false
    }
  }, [fileId, enabled, max])
  return text
}

async function download(fileId: string, name: string) {
  const b = await getFileBlob(fileId)
  if (b) downloadBlob(b, name)
}

function GenericCard({ fileId, onRemove }: MediaProps) {
  const file = useStore((s) => s.files[fileId])
  const url = useFileUrl(fileId)
  const texty = isTexty(file.type, file.name)
  const text = useTextPreview(fileId, texty)
  const ext = (file.name.split('.').pop() || '?').toUpperCase().slice(0, 4)
  return (
    <div className="rounded-xl border border-line bg-panel overflow-hidden" data-media-host={fileId} contentEditable={false}>
      <div className="flex items-center gap-3 p-3">
        <div className="w-11 h-12 rounded-lg bg-panel2 border border-line flex flex-col items-center justify-center shrink-0">
          <FileText size={16} className="text-accent" />
          <span className="text-[9px] font-bold text-muted">{ext}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate" data-file-preview={fileId}>
            {file.name}
          </div>
          <div className="text-xs text-muted">
            {file.type || 'tipo desconhecido'} · {fmtSize(file.size)} · {fmtDate(file.createdAt)}
          </div>
        </div>
        <button className="btn" onClick={() => download(fileId, file.name)}>
          <Download size={13} /> Baixar
        </button>
        <button className="btn" onClick={() => url && window.open(url, '_blank')}>
          <ExternalLink size={13} /> Abrir
        </button>
        {onRemove && (
          <button className="icon-btn" title="Remover da nota" onClick={onRemove}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {texty && text && <pre className="text-xs font-mono px-3 py-2 border-t border-line bg-panel2 max-h-48 overflow-auto whitespace-pre-wrap">{text}</pre>}
    </div>
  )
}

export function MediaBlock(props: MediaProps) {
  const file = useStore((s) => s.files[props.fileId])
  if (!file)
    return (
      <div className="rounded-xl border border-dashed border-line p-4 text-muted text-sm flex items-center gap-2" contentEditable={false}>
        Arquivo não encontrado.
        {props.onRemove && (
          <button className="btn" onClick={props.onRemove}>
            <X size={12} /> remover
          </button>
        )}
      </div>
    )
  const kind = mediaKind(file.type, file.name)
  if (kind === 'image') return <ImageBlock {...props} />
  if (kind === 'audio' || kind === 'video') return <AvBlock {...props} />
  if (kind === 'pdf') return <PdfBlock {...props} />
  return <GenericCard {...props} />
}

/* ============================================================
   Pré-visualização compacta (usada nos pop-ups)
   ============================================================ */
function PdfThumb({ fileId, page = 1, width = 300 }: { fileId: string; page?: number; width?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let ok = true
    loadPdf(fileId)
      .then((d) => {
        if (ok && ref.current) return renderPdfPage(d, page, ref.current, width).then(() => {})
      })
      .catch(() => {})
    return () => {
      ok = false
    }
  }, [fileId, page, width])
  return <canvas ref={ref} className="rounded-md bg-white mx-auto block" />
}

export function FilePreview({ fileId, page, time }: { fileId: string; page?: number | null; time?: number | null }) {
  const file = useStore((s) => s.files[fileId])
  const url = useFileUrl(fileId)
  const kind = file ? mediaKind(file.type, file.name) : 'other'
  const texty = !!file && kind === 'other' && isTexty(file.type, file.name)
  const text = useTextPreview(fileId, texty, 700)
  if (!file) return <div className="text-muted text-xs">Arquivo não encontrado.</div>
  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-muted mb-1.5">
        <FileText size={12} className="text-accent shrink-0" />
        <span className="truncate text-fg font-medium">{file.name}</span>
        <span className="shrink-0">{fmtSize(file.size)}</span>
        {page != null && <span className="shrink-0">· p. {page}</span>}
        {time != null && <span className="shrink-0">· {fmtTime(time)}</span>}
      </div>
      {kind === 'image' && url && <img src={url} className="max-h-48 rounded-md mx-auto" />}
      {kind === 'pdf' && <PdfThumb fileId={fileId} page={page ?? 1} />}
      {kind === 'audio' && url && <audio src={url + (time ? `#t=${time}` : '')} controls className="w-full h-9" />}
      {kind === 'video' && url && <video src={url + (time ? `#t=${time}` : '')} controls className="w-full max-h-44 rounded-md bg-black" />}
      {texty && <pre className="text-[11px] font-mono bg-panel2 rounded-md p-2 max-h-40 overflow-auto whitespace-pre-wrap">{text}</pre>}
      {kind === 'other' && !texty && <div className="text-xs text-muted">{file.type} · adicionado em {fmtDate(file.createdAt)}</div>}
    </div>
  )
}

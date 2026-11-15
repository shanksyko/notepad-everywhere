import { generateHTML } from '@tiptap/core'
import { extensions } from '../editor/extensions'
import { childrenOf, getFileUrl, pathOf, useStore } from '../store'
import type { CanvasData, TreeNode } from '../db'
import { canvasToSvg } from './diagram'
import { enrich, findTerms, renderLatex } from './matcher'
import { loadPdf, renderPdfPage } from './pdf'
import { escapeHtml, fmtSize, mediaKind, stripHtml } from './util'

/* Impressão / PDF: monta uma versão "papel" das páginas em #print-root e chama a impressão do sistema. */

export type PrintScope = 'page' | 'subtree' | 'notebook'
export interface PrintOptions {
  scope: PrintScope
  hideCloze: boolean
  glossary: boolean
  pageBreaks: boolean
}

/** Páginas que entram na impressão, na ordem da árvore. */
export function collectPages(startId: string, scope: PrintScope): TreeNode[] {
  const nodes = useStore.getState().nodes
  let root = nodes[startId]
  if (!root) return []
  if (scope === 'page') return [root]
  if (scope === 'notebook') root = pathOf(nodes, startId)[0]
  const out: TreeNode[] = []
  const walk = (n: TreeNode) => {
    out.push(n)
    childrenOf(nodes, n.id).forEach(walk)
  }
  walk(root)
  return out
}

/** Definição em uma linha: renderiza $LaTeX$, sem parágrafos nem links de glossário. */
function inlineRich(html: string) {
  const d = document.createElement('div')
  d.innerHTML = enrich(html)
  d.querySelectorAll('.gloss-auto').forEach((el) => el.replaceWith(...Array.from(el.childNodes)))
  d.querySelectorAll('p,div').forEach((el) => el.replaceWith(...Array.from(el.childNodes), ' '))
  return d.innerHTML
}

/** Desenha o canvas (caixas, formas, setas e traços) em escala para caber na largura da folha. */
async function canvasDrawHtml(data: CanvasData | null | undefined): Promise<string> {
  if (!data) return ''
  const st = useStore.getState()
  const res = await canvasToSvg(data, {
    richHtml: inlineRich,
    href: (id) => getFileUrl(id),
    fileInfo: (id) => (st.files[id] ? { name: st.files[id].name, image: mediaKind(st.files[id].type, st.files[id].name) === 'image' } : null),
  })
  if (!res) return ''
  const scale = Math.min(1, 660 / res.w)
  return `<div class="print-draw" style="height:${Math.ceil(res.h * scale)}px"><div style="width:${res.w}px;height:${res.h}px;transform:scale(${scale.toFixed(4)});transform-origin:0 0">${res.svg}</div></div>`
}

async function mediaHtml(fileId: string): Promise<string> {
  const st = useStore.getState()
  const f = st.files[fileId]
  if (!f) return ''
  const kind = mediaKind(f.type, f.name)
  if (kind === 'image') {
    const url = await getFileUrl(fileId)
    const pins = Object.values(st.hotspots).filter((h) => h.fileId === fileId)
    const dots = pins.map((p, i) => `<span class="print-pin" style="left:${p.x * 100}%;top:${p.y * 100}%">${i + 1}</span>`).join('')
    const legend = pins.length ? `<ol class="print-legend">${pins.map((p) => `<li><b>${escapeHtml(p.label)}</b>${p.html ? ' — ' + inlineRich(p.html) : ''}</li>`).join('')}</ol>` : ''
    return `<figure class="print-media"><div class="print-img"><img src="${url}">${dots}</div>${legend}</figure>`
  }
  if (kind === 'pdf') {
    try {
      const doc = await loadPdf(fileId)
      const canvas = document.createElement('canvas')
      await renderPdfPage(doc, 1, canvas, 620)
      return `<figure class="print-media"><img src="${canvas.toDataURL('image/png')}" class="print-pdf"><figcaption>📄 ${escapeHtml(f.name)} — página 1 de ${doc.numPages}</figcaption></figure>`
    } catch {
      /* cai no cartão genérico */
    }
  }
  const label = kind === 'audio' ? '🎧 Áudio' : kind === 'video' ? '🎬 Vídeo' : kind === 'pdf' ? '📄 PDF' : '📎 Arquivo'
  const cues = f.transcript?.length ? `<div class="print-cues">${f.transcript.map((c) => escapeHtml(c.text)).join(' · ')}</div>` : ''
  return `<div class="print-file">${label}: <b>${escapeHtml(f.name)}</b> <span>(${fmtSize(f.size)})</span>${cues}</div>`
}

async function pageSection(node: TreeNode, opts: PrintOptions, usedTerms: Set<string>): Promise<HTMLElement> {
  const st = useStore.getState()
  const sec = document.createElement('section')
  sec.className = 'print-page ProseMirror'
  const body = document.createElement('div')
  body.innerHTML = generateHTML(node.content, extensions)

  body.querySelectorAll<HTMLElement>('[data-latex]').forEach((el) => {
    el.innerHTML = renderLatex(el.dataset.latex || '', el.tagName === 'DIV')
    if (el.tagName === 'DIV') el.style.textAlign = 'center'
  })
  for (const el of Array.from(body.querySelectorAll<HTMLElement>('div[data-media-id]'))) el.outerHTML = await mediaHtml(el.dataset.mediaId || '')
  for (const el of Array.from(body.querySelectorAll<HTMLElement>('div[data-canvas]'))) {
    let html = ''
    try {
      html = await canvasDrawHtml(JSON.parse(el.dataset.canvas || '{}'))
    } catch {}
    el.outerHTML = html
  }
  body.querySelectorAll<HTMLElement>('[data-term-id]').forEach((el) => usedTerms.add(el.dataset.termId || ''))
  findTerms(node.text).forEach((m) => usedTerms.add(m.termId))
  if (opts.hideCloze)
    body.querySelectorAll<HTMLElement>('[data-cloze-id]').forEach((el) => {
      el.textContent = ' '.repeat(Math.max(8, Math.round((el.textContent || '').length * 1.6)))
      el.classList.add('print-blank')
    })

  const path = pathOf(st.nodes, node.id).slice(0, -1).map((p) => p.title).join(' › ')
  const first = node.content?.content?.[0]
  const hasOwnTitle = first?.type === 'heading' && first.attrs?.level === 1
  sec.innerHTML = (path ? `<div class="print-path">${escapeHtml(path)}</div>` : '') + (hasOwnTitle ? '' : `<h1>${escapeHtml(node.icon + ' ' + node.title)}</h1>`)
  sec.appendChild(body)

  if (node.mode === 'canvas' && node.canvas.items.length) {
    const box = document.createElement('div')
    box.innerHTML = await canvasDrawHtml(node.canvas)
    sec.appendChild(box)
  }
  return sec
}

/** Monta o conteúdo de impressão; devolve uma função que o remove. */
export async function preparePrint(startId: string, opts: PrintOptions): Promise<() => void> {
  document.getElementById('print-root')?.remove()
  const root = document.createElement('div')
  root.id = 'print-root'
  if (opts.pageBreaks) root.classList.add('breaks')
  const used = new Set<string>()
  for (const n of collectPages(startId, opts.scope)) root.appendChild(await pageSection(n, opts, used))

  if (opts.glossary) {
    const terms = useStore.getState().terms
    const list = [...used].map((id) => terms[id]).filter(Boolean).sort((a, b) => a.term.localeCompare(b.term))
    if (list.length) {
      const sec = document.createElement('section')
      sec.className = 'print-page ProseMirror'
      const tpl = document.createElement('div')
      tpl.innerHTML = '<h1>Glossário</h1>' + list.map((t) => `<div class="print-term"><b>${escapeHtml(t.term)}</b>${enrich(t.html, t.id)}</div>`).join('')
      tpl.querySelectorAll('.gloss-auto').forEach((el) => el.replaceWith(...Array.from(el.childNodes)))
      sec.appendChild(tpl)
      root.appendChild(sec)
    }
  }
  document.body.appendChild(root)
  await Promise.all(Array.from(root.querySelectorAll('img')).map((i) => i.decode().catch(() => {})))
  return () => root.remove()
}

export interface AppConfig {
  background: boolean
  startup: boolean
  version: string
}
export interface UpdateState {
  status: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error' | 'unconfigured' | 'unavailable'
  version: string | null
  message: string
}
export const nativeApp:
  | {
      savePdf(name: string): Promise<{ ok: boolean; path?: string; reason?: string }>
      getConfig(): Promise<AppConfig>
      setConfig(patch: Partial<AppConfig>): Promise<AppConfig>
      show(): Promise<void>
      checkUpdate(): Promise<UpdateState>
      updateState(): Promise<UpdateState>
      installUpdate(): Promise<void>
      onUpdateState(cb: (s: UpdateState) => void): void
    }
  | undefined = (window as any).nativeApp

/** Abre a janela de impressão do sistema (impressora ou "Salvar como PDF"). */
export async function printPages(startId: string, opts: PrintOptions) {
  const cleanup = await preparePrint(startId, opts)
  const done = () => {
    window.removeEventListener('afterprint', done)
    cleanup()
  }
  window.addEventListener('afterprint', done)
  window.print()
}

/** Só no app instalado: grava um PDF direto, sem passar pela janela de impressão. */
export async function savePdf(startId: string, opts: PrintOptions) {
  if (!nativeApp) return printPages(startId, opts)
  const cleanup = await preparePrint(startId, opts)
  try {
    const nodes = useStore.getState().nodes
    const base = opts.scope === 'notebook' ? pathOf(nodes, startId)[0] : nodes[startId]
    return await nativeApp.savePdf((base?.title || 'notas').replace(/[\\/:*?"<>|]/g, '_'))
  } finally {
    cleanup()
  }
}

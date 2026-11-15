import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { getFileBlob, useStore } from '../store'

/* O PDF.js (≈400 kB) só é carregado quando o primeiro PDF aparece na tela. */
type PdfJs = typeof import('pdfjs-dist')
let lib: Promise<PdfJs> | null = null
export function getPdfjs(): Promise<PdfJs> {
  if (!lib)
    lib = import('pdfjs-dist').then((m) => {
      m.GlobalWorkerOptions.workerSrc = workerUrl
      return m
    })
  return lib
}

const cache = new Map<string, Promise<PDFDocumentProxy>>()

export function loadPdf(fileId: string) {
  const key = fileId + ':' + (useStore.getState().files[fileId]?.rev ?? 0)
  if (!cache.has(key)) {
    cache.set(
      key,
      (async () => {
        const blob = await getFileBlob(fileId)
        if (!blob) throw new Error('Arquivo não encontrado')
        const data = new Uint8Array(await blob.arrayBuffer())
        return (await getPdfjs()).getDocument({ data }).promise
      })(),
    )
  }
  return cache.get(key)!
}

export async function renderPdfPage(doc: PDFDocumentProxy, pageNo: number, canvas: HTMLCanvasElement, cssWidth: number) {
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages))
  const base = page.getViewport({ scale: 1 })
  const scale = cssWidth / base.width
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const viewport = page.getViewport({ scale: scale * dpr })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  canvas.style.width = cssWidth + 'px'
  canvas.style.height = Math.floor(base.height * scale) + 'px'
  const task = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport } as any)
  await task.promise
  return { page, scale, width: cssWidth, height: Math.floor(base.height * scale) }
}

export type { PDFDocumentProxy }

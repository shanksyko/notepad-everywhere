import katex from 'katex'
import type { Term } from '../db'
import { escapeHtml } from './util'

/* Auto-reconhecimento global de termos do glossário. */

let re: RegExp | null = null
let map = new Map<string, string>()
export let matcherVersion = 0

export function setMatcherTerms(terms: Term[]) {
  map = new Map()
  const words: string[] = []
  for (const t of terms) {
    for (const raw of [t.term, ...(t.aliases || [])]) {
      const w = raw.trim()
      if (w.length < 2) continue
      const k = w.toLowerCase()
      if (!map.has(k)) {
        map.set(k, t.id)
        words.push(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      }
    }
  }
  words.sort((a, b) => b.length - a.length)
  re = words.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(${words.join('|')})(?![\\p{L}\\p{N}_])`, 'giu') : null
  matcherVersion++
}

export interface TermMatch {
  index: number
  length: number
  termId: string
}

export function findTerms(text: string, exclude?: string): TermMatch[] {
  if (!re || !text) return []
  const out: TermMatch[] = []
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const id = map.get(m[0].toLowerCase())
    if (id && id !== exclude) out.push({ index: m.index, length: m[0].length, termId: id })
    if (m[0].length === 0) re.lastIndex++
  }
  return out
}

export function renderLatex(latex: string, display = false) {
  try {
    return katex.renderToString(latex, { displayMode: display, throwOnError: false })
  } catch {
    return `<code>${escapeHtml(latex)}</code>`
  }
}

/**
 * Versão para exportar em imagem (SVG/PNG): mantém negrito, itálico etc., converte $LaTeX$ em MathML
 * (que o navegador desenha sem precisar de folha de estilo) e devolve XML bem-formado.
 */
export function enrichForExport(html: string): string {
  const d = document.createElement('div')
  d.innerHTML = html
  d.querySelectorAll('script,style,iframe,object,embed').forEach((n) => n.remove())
  const walker = document.createTreeWalker(d, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    const parts = node.data.split(/(\$\$[^$]+\$\$|\$[^$\n]+\$)/g)
    if (parts.length < 2) continue
    const span = document.createElement('span')
    span.innerHTML = parts
      .map((p) => {
        const m = /^\$\$([^$]+)\$\$$/.exec(p) || /^\$([^$\n]+)\$$/.exec(p)
        if (!m) return escapeHtml(p)
        try {
          return katex.renderToString(m[1], { output: 'mathml', throwOnError: false })
        } catch {
          return escapeHtml(p)
        }
      })
      .join('')
    node.replaceWith(...Array.from(span.childNodes))
  }
  const xs = new XMLSerializer()
  return Array.from(d.childNodes)
    .map((n) => xs.serializeToString(n))
    .join('')
}

/**
 * Enriquece um HTML de definição: remove scripts, renderiza $LaTeX$ e
 * envolve automaticamente termos do glossário em spans que abrem pop-ups (cascata).
 */
export function enrich(html: string, excludeTermId?: string): string {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  tpl.content.querySelectorAll('script,style,iframe,object,embed').forEach((n) => n.remove())
  tpl.content.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) if (a.name.startsWith('on')) el.removeAttribute(a.name)
  })
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    const parent = node.parentElement
    if (parent && parent.closest('a,code,pre,.katex,[data-term-id]')) continue
    const text = node.data
    if (!text.trim()) continue
    let out = ''
    let changed = false
    const parts = text.split(/(\$\$[^$]+\$\$|\$[^$\n]+\$)/g)
    for (const part of parts) {
      if (/^\$\$[^$]+\$\$$/.test(part)) {
        out += renderLatex(part.slice(2, -2), true)
        changed = true
      } else if (/^\$[^$\n]+\$$/.test(part)) {
        out += renderLatex(part.slice(1, -1))
        changed = true
      } else {
        const ms = findTerms(part, excludeTermId)
        let last = 0
        for (const m of ms) {
          out += escapeHtml(part.slice(last, m.index))
          out += `<span class="gloss-auto" data-term-id="${m.termId}">${escapeHtml(part.substr(m.index, m.length))}</span>`
          last = m.index + m.length
          changed = true
        }
        out += escapeHtml(part.slice(last))
      }
    }
    if (changed) {
      const span = document.createElement('span')
      span.innerHTML = out
      node.replaceWith(...Array.from(span.childNodes))
    }
  }
  return tpl.innerHTML
}

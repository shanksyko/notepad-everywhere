import { useEffect, useRef, useState } from 'react'
import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { createLowlight } from 'lowlight'
// Só as linguagens oferecidas no seletor do bloco de código (o pacote "common" traz 37 e pesa bem mais).
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import { ChevronsDownUp, ChevronsUpDown, Loader2, Play, Trash2 } from 'lucide-react'
import { FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { CanvasBoard } from '../components/CanvasView'
import type { CanvasData } from '../db'
import { findTerms, renderLatex } from '../lib/matcher'
import { canRun, runCode, type RunResult } from '../lib/runner'
import { MediaBlock } from '../components/Media'

const lowlight = createLowlight({ bash, c, cpp, css, go, java, javascript, json, markdown, plaintext, python, rust, sql, typescript, xml })

const attr = (name: string, data: string, def: any = null) => ({
  [name]: {
    default: def,
    parseHTML: (el: HTMLElement) => el.getAttribute(data),
    renderHTML: (a: Record<string, any>) => (a[name] == null ? {} : { [data]: a[name] }),
  },
})

/* ---------- Marks ---------- */
export const GlossTerm = Mark.create({
  name: 'glossTerm',
  inclusive: false,
  addAttributes() {
    return attr('termId', 'data-term-id')
  },
  parseHTML() {
    return [{ tag: 'span[data-term-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'gloss-term' }, HTMLAttributes), 0]
  },
})

export const Cloze = Mark.create({
  name: 'cloze',
  inclusive: false,
  addAttributes() {
    return attr('clozeId', 'data-cloze-id')
  },
  parseHTML() {
    return [{ tag: 'span[data-cloze-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'cloze' }, HTMLAttributes), 0]
  },
})

export const PageLink = Mark.create({
  name: 'pageLink',
  inclusive: false,
  addAttributes() {
    return attr('pageId', 'data-page-id')
  },
  parseHTML() {
    return [{ tag: 'a[data-page-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes({ class: 'page-link' }, HTMLAttributes), 0]
  },
})

export const MediaLink = Mark.create({
  name: 'mediaLink',
  inclusive: false,
  addAttributes() {
    return { ...attr('fileId', 'data-file-id'), ...attr('time', 'data-time'), ...attr('page', 'data-page') }
  },
  parseHTML() {
    return [{ tag: 'a[data-file-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes({ class: 'media-link', 'data-file-preview': HTMLAttributes['data-file-id'] }, HTMLAttributes), 0]
  },
})

/* ---------- Callout ---------- */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return attr('kind', 'data-callout', 'info')
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['div', mergeAttributes({ class: `callout callout-${node.attrs.kind}` }, HTMLAttributes), 0]
  },
})

/* ---------- LaTeX ---------- */
function MathView({ node, updateAttributes, selected }: NodeViewProps) {
  const inline = node.type.name === 'mathInline'
  const [edit, setEdit] = useState(!node.attrs.latex)
  const [val, setVal] = useState<string>(node.attrs.latex || '')
  const commit = () => {
    updateAttributes({ latex: val })
    setEdit(false)
  }
  return (
    <NodeViewWrapper as={inline ? 'span' : 'div'} className={inline ? 'inline-block align-middle mx-0.5' : 'my-2 text-center'} contentEditable={false}>
      {edit ? (
        <input
          autoFocus
          value={val}
          placeholder="LaTeX, ex.: e^{i\pi}+1=0"
          className={'font-mono text-[13px] ' + (inline ? 'w-48' : 'w-full max-w-xl')}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault()
              commit()
            }
            e.stopPropagation()
          }}
        />
      ) : (
        <span
          title="Clique para editar a fórmula"
          className={'cursor-pointer rounded px-1 ' + (selected ? 'ring-2 ring-accent' : 'hover:bg-panel2')}
          onClick={() => (setVal(node.attrs.latex || ''), setEdit(true))}
          dangerouslySetInnerHTML={{ __html: renderLatex(node.attrs.latex || '\\square', !inline) }}
        />
      )}
    </NodeViewWrapper>
  )
}

const mathNode = (name: string, inline: boolean) =>
  Node.create({
    name,
    group: inline ? 'inline' : 'block',
    inline,
    atom: true,
    addAttributes() {
      return attr('latex', 'data-latex', '')
    },
    parseHTML() {
      return [{ tag: `${inline ? 'span' : 'div'}[data-latex]` }]
    },
    renderHTML({ HTMLAttributes }) {
      return [inline ? 'span' : 'div', HTMLAttributes]
    },
    addNodeView() {
      return ReactNodeViewRenderer(MathView)
    },
  })
export const MathInline = mathNode('mathInline', true)
export const MathBlock = mathNode('mathBlock', false)

/* ---------- Mídia ---------- */
function MediaView({ node, updateAttributes, editor, getPos, deleteNode }: NodeViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  // O bloco só pode ser arrastado pela barra de título. Sem isto, arrastar DENTRO da mídia
  // (recortar a imagem, selecionar texto do PDF) iniciava o arraste do bloco e cancelava o gesto.
  useEffect(() => {
    const outer = hostRef.current?.closest('.react-renderer') ?? hostRef.current
    if (!outer) return
    let fromHeader = false
    const down = (e: Event) => (fromHeader = !!(e.target as Element).closest?.('[data-media-header]'))
    const drag = (e: Event) => !fromHeader && e.preventDefault()
    outer.addEventListener('pointerdown', down, true)
    outer.addEventListener('dragstart', drag)
    return () => {
      outer.removeEventListener('pointerdown', down, true)
      outer.removeEventListener('dragstart', drag)
    }
  }, [])
  return (
    <NodeViewWrapper ref={hostRef} className="my-3" data-drag-handle>
      <MediaBlock
        fileId={node.attrs.fileId}
        attrs={{ zoom: Number(node.attrs.zoom) || 100, rotation: Number(node.attrs.rotation) || 0 }}
        setAttrs={updateAttributes}
        onRemove={deleteNode}
        onInsert={(content) => {
          const pos = getPos()
          if (pos == null) return
          editor.chain().insertContentAt(pos + node.nodeSize, content).run()
        }}
      />
    </NodeViewWrapper>
  )
}

export const MediaNode = Node.create({
  name: 'mediaBlock',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { ...attr('fileId', 'data-media-id'), ...attr('zoom', 'data-zoom', 100), ...attr('rotation', 'data-rotation', 0) }
  },
  parseHTML() {
    return [{ tag: 'div[data-media-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', HTMLAttributes]
  },
  addNodeView() {
    return ReactNodeViewRenderer(MediaView)
  },
})

/* ---------- Canvas embutido na nota ---------- */
const parseCanvas = (s: string): CanvasData => {
  try {
    const d = JSON.parse(s || '{}')
    return { items: d.items || [], strokes: d.strokes || [], connectors: d.connectors || [] }
  } catch {
    return { items: [], strokes: [], connectors: [] }
  }
}

function CanvasBlockView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const h = Number(node.attrs.height) || 420
  const hostRef = useRef<HTMLDivElement>(null)
  // O editor marca o bloco selecionado como "arrastável" (no contêiner externo .react-renderer).
  // Sem cancelar, esse arraste nativo interrompe o movimento das caixas dentro do canvas.
  useEffect(() => {
    const outer = hostRef.current?.closest('.react-renderer') ?? hostRef.current
    if (!outer) return
    const stop = (e: Event) => e.preventDefault()
    outer.addEventListener('dragstart', stop)
    return () => outer.removeEventListener('dragstart', stop)
  }, [])
  return (
    <NodeViewWrapper ref={hostRef} className="my-3 rounded-xl border border-line overflow-hidden bg-panel" contentEditable={false}>
      <CanvasBoard
        embedded
        height={h}
        initial={parseCanvas(node.attrs.data)}
        onChange={(d) => updateAttributes({ data: JSON.stringify(d) })}
        extra={
          <>
            <button className="icon-btn" title="Diminuir a altura do canvas" onClick={() => updateAttributes({ height: Math.max(220, h - 120) })}>
              <ChevronsDownUp size={15} />
            </button>
            <button className="icon-btn" title="Aumentar a altura do canvas" onClick={() => updateAttributes({ height: Math.min(1200, h + 120) })}>
              <ChevronsUpDown size={15} />
            </button>
            <button className="icon-btn" title="Remover este canvas da nota" onClick={() => confirm('Remover este canvas e tudo o que está nele?') && deleteNode()}>
              <Trash2 size={15} />
            </button>
          </>
        }
      />
    </NodeViewWrapper>
  )
}

export const CanvasNode = Node.create({
  name: 'canvasBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { ...attr('data', 'data-canvas', ''), ...attr('height', 'data-height', 420) }
  },
  parseHTML() {
    return [{ tag: 'div[data-canvas]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', HTMLAttributes]
  },
  addNodeView() {
    // o canvas trata os próprios cliques, teclas e arrastes
    // (inclusive a seleção de texto dentro das caixas — sem isso o editor puxa o cursor de volta e sobrescreve o bloco)
    return ReactNodeViewRenderer(CanvasBlockView, { stopEvent: () => true, ignoreMutation: () => true })
  },
})

/* ---------- Bloco de código com execução ---------- */
const LANGS = ['javascript', 'python', 'typescript', 'json', 'bash', 'css', 'xml', 'sql', 'c', 'cpp', 'java', 'rust', 'go', 'markdown', 'plaintext']

function CodeView({ node, updateAttributes }: NodeViewProps) {
  const lang: string = node.attrs.language || 'plaintext'
  const [res, setRes] = useState<RunResult | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    setRes(await runCode(lang, node.textContent))
    setBusy(false)
  }
  return (
    <NodeViewWrapper className="code-block my-3 rounded-xl border border-line overflow-hidden bg-panel">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-line bg-panel2" contentEditable={false}>
        <select value={lang} onChange={(e) => updateAttributes({ language: e.target.value })} className="!py-0 !text-xs !bg-transparent !border-0">
          {LANGS.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <span className="flex-1" />
        {canRun(lang) && (
          <button className="btn btn-accent !py-0.5" onClick={run} disabled={busy}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Executar
          </button>
        )}
      </div>
      <pre>
        <NodeViewContent as={'code' as any} />
      </pre>
      {(res || busy) && (
        <div className="border-t border-line bg-bg px-3 py-2 text-[12.5px] font-mono whitespace-pre-wrap" contentEditable={false}>
          <div className="text-[10px] uppercase tracking-wider text-muted mb-1 flex">
            Saída
            <button className="ml-auto hover:text-fg" onClick={() => setRes(null)}>
              limpar
            </button>
          </div>
          {busy && <span className="text-muted">executando{lang.startsWith('py') ? ' (carregando Python na primeira vez…)' : '…'}</span>}
          {res?.output}
          {res?.error && <div className="text-red-400">{res.error}</div>}
          {res && !res.output && !res.error && <span className="text-muted">(sem saída)</span>}
        </div>
      )}
    </NodeViewWrapper>
  )
}

const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeView)
  },
}).configure({ lowlight, defaultLanguage: 'javascript' })

/* ---------- Auto-reconhecimento de termos + Spotlight (decorations) ---------- */
export const glossKey = new PluginKey('glossAuto')

const Decorations = Extension.create({
  name: 'neDecorations',
  addProseMirrorPlugins() {
    const build = (doc: any) => {
      const decos: Decoration[] = []
      doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'codeBlock') return false
        if (node.isText && node.text) {
          if (node.marks.some((m: any) => ['glossTerm', 'code', 'cloze', 'pageLink', 'mediaLink', 'link'].includes(m.type.name))) return
          for (const m of findTerms(node.text)) decos.push(Decoration.inline(pos + m.index, pos + m.index + m.length, { class: 'gloss-auto', 'data-term-id': m.termId }))
        }
        return true
      })
      return DecorationSet.create(doc, decos)
    }
    return [
      new Plugin({
        key: glossKey,
        state: {
          init: (_, { doc }) => build(doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(glossKey) ? build(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return glossKey.getState(state)
          },
        },
      }),
      new Plugin({
        props: {
          decorations(state) {
            const { $from } = state.selection
            if ($from.depth < 1) return null
            return DecorationSet.create(state.doc, [Decoration.node($from.before(1), $from.after(1), { class: 'is-current' })])
          },
        },
      }),
    ]
  },
})

/* ---------- Buscar nesta página (Ctrl+F) ---------- */
export interface FindState {
  query: string
  index: number
  matches: { from: number; to: number }[]
  decos: DecorationSet
}
export const findKey = new PluginKey<FindState>('findInPage')

function findMatches(doc: any, query: string) {
  const out: { from: number; to: number }[] = []
  const q = query.toLowerCase()
  if (!q) return out
  doc.descendants((node: any, pos: number) => {
    if (!node.isTextblock) return true
    // cada caractere de texto e cada nó inline (fórmula, quebra) ocupa 1 posição: o índice no texto vira posição direto
    const text: string = node.textBetween(0, node.content.size, undefined, '￼').toLowerCase()
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) out.push({ from: pos + 1 + i, to: pos + 1 + i + q.length })
    return false
  })
  return out
}

const FindInPage = Extension.create({
  name: 'findInPage',
  addProseMirrorPlugins() {
    const compute = (doc: any, query: string, index: number): FindState => {
      const matches = findMatches(doc, query)
      const i = matches.length ? ((index % matches.length) + matches.length) % matches.length : 0
      return { query, index: i, matches, decos: DecorationSet.create(doc, matches.map((m, k) => Decoration.inline(m.from, m.to, { class: k === i ? 'find-hit find-hit-current' : 'find-hit' }))) }
    }
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: (_, { doc }) => compute(doc, '', 0),
          apply(tr, prev) {
            const meta = tr.getMeta(findKey) as Partial<Pick<FindState, 'query' | 'index'>> | undefined
            if (!meta && !tr.docChanged) return prev
            if (!meta && !prev.query) return prev
            return compute(tr.doc, meta?.query ?? prev.query, meta?.index ?? prev.index)
          },
        },
        props: {
          decorations(state) {
            return findKey.getState(state)?.decos
          },
        },
      }),
    ]
  },
})

/* ---------- Tab indenta (em vez de tirar o foco do editor) ---------- */
const INDENT = '    '
const TabIndent = Extension.create({
  name: 'tabIndent',
  priority: 10, // roda depois das listas e tabelas, que têm o próprio Tab (subnível / próxima célula)
  addKeyboardShortcuts() {
    /** aplica `fn` ao início de cada linha do bloco de código coberta pela seleção */
    const codeLines = (fn: (tr: any, lineStart: number, line: string) => void) =>
      this.editor.commands.command(({ tr, state }) => {
        const { $from, from, to } = state.selection
        const start = $from.start()
        const text: string = $from.parent.textContent
        const starts: number[] = []
        let pos = 0
        for (const line of text.split('\n')) {
          if (start + pos + line.length >= from && start + pos <= to) starts.push(pos)
          pos += line.length + 1
        }
        // de trás para a frente, para as posições anteriores não mudarem
        for (const s of starts.reverse()) fn(tr, start + s, text.slice(s).split('\n')[0])
        return true
      })
    return {
      Tab: () => {
        const { editor } = this
        if (editor.isActive('codeBlock')) {
          if (editor.state.selection.empty) return editor.commands.command(({ tr }) => (tr.insertText(INDENT), true))
          return codeLines((tr, at) => tr.insertText(INDENT, at))
        }
        // em lista ou tabela que não conseguiu tratar o Tab: não faz nada, mas mantém o foco no texto
        if (editor.isActive('listItem') || editor.isActive('taskItem') || editor.isActive('table')) return true
        return editor.commands.command(({ tr }) => (tr.insertText('\t'), true))
      },
      'Shift-Tab': () => {
        const { editor } = this
        if (editor.isActive('codeBlock'))
          return codeLines((tr, at, line) => {
            const n = line.match(/^ {1,4}|^\t/)?.[0].length || 0
            if (n) tr.delete(at, at + n)
          })
        if (editor.isActive('listItem') || editor.isActive('taskItem') || editor.isActive('table')) return true
        // parágrafo: remove um Tab imediatamente antes do cursor, se houver
        return editor.commands.command(({ tr, state }) => {
          const { from, empty } = state.selection
          if (empty && from > 0 && state.doc.textBetween(from - 1, from) === '\t') tr.delete(from - 1, from)
          return true
        })
      },
    }
  },
})

export const extensions = [
  TabIndent,
  FindInPage,
  StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: true } }),
  CodeBlock,
  TableKit.configure({ table: { resizable: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Placeholder.configure({ placeholder: 'Escreva aqui… selecione um texto para criar significados e lacunas, ou arraste arquivos para a nota.' }),
  GlossTerm,
  Cloze,
  PageLink,
  MediaLink,
  Callout,
  MathInline,
  MathBlock,
  MediaNode,
  CanvasNode,
  TextStyle,
  FontFamily,
  FontSize,
  Decorations,
]

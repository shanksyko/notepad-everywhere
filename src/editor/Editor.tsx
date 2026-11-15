import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor as TEditor } from '@tiptap/react'
import { Bold, BookPlus, Code, Code2, EyeOff, Heading1, Heading2, Heading3, Italic, Link2, List, ListChecks, ListOrdered, MessageSquareWarning, Minus, Paperclip, Quote, Sigma, Strikethrough, Table, Redo2, Undo2, Shapes, ArrowUp, ArrowDown, GripVertical, Search, ChevronUp, ChevronDown, X } from 'lucide-react'
import { NodeSelection, Selection } from '@tiptap/pm/state'
import { extensions, findKey, glossKey } from './extensions'
import { actions, useStore } from '../store'
import type { TreeNode } from '../db'
import { debounce, uid } from '../lib/util'

async function insertFiles(editor: TEditor, files: File[], pos?: number) {
  const nodes = []
  for (const f of files) {
    const id = await actions.addFile(f)
    nodes.push({ type: 'mediaBlock', attrs: { fileId: id, zoom: 100, rotation: 0 } })
  }
  if (pos != null) editor.chain().focus().insertContentAt(pos, nodes).run()
  else editor.chain().focus().insertContent(nodes).run()
}

const FONTS: [string, string][] = [
  ['Fonte padrão', ''],
  ['Segoe UI', '"Segoe UI", sans-serif'],
  ['Arial', 'Arial, sans-serif'],
  ['Calibri', 'Calibri, sans-serif'],
  ['Verdana', 'Verdana, sans-serif'],
  ['Tahoma', 'Tahoma, sans-serif'],
  ['Times New Roman', '"Times New Roman", serif'],
  ['Georgia', 'Georgia, serif'],
  ['Cambria', 'Cambria, serif'],
  ['Courier New', '"Courier New", monospace'],
  ['Consolas', 'Consolas, monospace'],
  ['Comic Sans', '"Comic Sans MS", cursive'],
]
const SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48]

/** Move o bloco de nível superior onde está o cursor (ou o bloco selecionado) uma posição para cima/baixo. */
function moveBlock(editor: TEditor, dir: -1 | 1) {
  const { state, view } = editor
  const { $from } = state.selection
  const idx = $from.index(0)
  const doc = state.doc
  const target = idx + dir
  if (target < 0 || target >= doc.childCount) return
  const pos = $from.depth >= 1 ? $from.before(1) : $from.pos
  const node = doc.child(idx)
  const other = doc.child(target)
  const offset = state.selection.from - pos
  const tr = state.tr.delete(pos, pos + node.nodeSize)
  const newPos = dir < 0 ? pos - other.nodeSize : pos + other.nodeSize
  tr.insert(newPos, node)
  try {
    tr.setSelection(node.isAtom ? NodeSelection.create(tr.doc, newPos) : Selection.near(tr.doc.resolve(Math.min(newPos + Math.max(1, offset), newPos + node.nodeSize - 1))))
  } catch {}
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

/** Alça ⋮⋮ à esquerda de cada bloco: arraste para reordenar. */
function DragHandle({ editor, host }: { editor: TEditor; host: React.RefObject<HTMLDivElement | null> }) {
  const [at, setAt] = useState<{ top: number; pos: number } | null>(null)
  useEffect(() => {
    const el = host.current
    if (!el) return
    const move = (e: MouseEvent) => {
      if (e.buttons) return
      const view = editor.view
      let b = e.target as HTMLElement | null
      if (b?.closest('[data-block-handle]')) return
      while (b && b.parentElement !== view.dom) b = b.parentElement
      if (!b) return
      try {
        const p = view.posAtDOM(b, 0)
        const $p = view.state.doc.resolve(p)
        const pos = $p.depth >= 1 ? $p.before(1) : p
        if (!view.state.doc.nodeAt(pos)) return
        setAt({ top: b.offsetTop + (view.dom as HTMLElement).offsetTop, pos })
      } catch {}
    }
    const leave = () => setAt(null)
    el.addEventListener('mousemove', move)
    el.addEventListener('mouseleave', leave)
    return () => {
      el.removeEventListener('mousemove', move)
      el.removeEventListener('mouseleave', leave)
    }
  }, [editor, host])
  if (!at) return null
  return (
    <div
      data-block-handle
      draggable
      title="Arraste para mover este bloco"
      className="absolute left-1 w-5 h-6 flex items-center justify-center rounded text-muted hover:text-fg hover:bg-panel2 cursor-grab active:cursor-grabbing"
      style={{ top: at.top + 2 }}
      onMouseDown={() => {
        const view = editor.view
        try {
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at.pos)))
        } catch {}
      }}
      onDragStart={(e) => {
        const view = editor.view as any
        const sel = view.state.selection
        if (!(sel instanceof NodeSelection)) return e.preventDefault()
        const slice = sel.content()
        const ser = view.serializeForClipboard ? view.serializeForClipboard(slice) : null
        e.dataTransfer.clearData()
        if (ser) {
          e.dataTransfer.setData('text/html', ser.dom.innerHTML)
          e.dataTransfer.setData('text/plain', ser.text)
        } else e.dataTransfer.setData('text/plain', sel.node.textContent || ' ')
        e.dataTransfer.effectAllowed = 'copyMove'
        const dom = view.nodeDOM(at.pos) as HTMLElement | null
        if (dom) e.dataTransfer.setDragImage(dom, 0, 0)
        view.dragging = { slice, move: true }
      }}
      onDragEnd={() => setAt(null)}
    >
      <GripVertical size={14} />
    </div>
  )
}

function Toolbar({ editor, onFind }: { editor: TEditor; onFind: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force((x) => x + 1)
    editor.on('transaction', f)
    return () => void editor.off('transaction', f)
  }, [editor])
  const B = ({ on, title, onClick, children }: { on?: boolean; title: string; onClick: () => void; children: React.ReactNode }) => (
    <button className={'icon-btn ' + (on ? 'on' : '')} title={title} onMouseDown={(e) => (e.preventDefault(), onClick())}>
      {children}
    </button>
  )
  const c = () => editor.chain().focus()
  const sep = <span className="w-px h-5 bg-line mx-1 shrink-0" />
  return (
    <div role="toolbar" aria-label="Formatação" className="flex items-center gap-0.5 px-3 py-1 border-b border-line bg-panel flex-wrap shrink-0">
      <B title="Desfazer (Ctrl+Z)" onClick={() => c().undo().run()}>
        <Undo2 size={15} />
      </B>
      <B title="Refazer (Ctrl+Y)" onClick={() => c().redo().run()}>
        <Redo2 size={15} />
      </B>
      <B title={'Buscar nesta página' + (useStore.getState().shortcuts.find ? ` (${useStore.getState().shortcuts.find})` : '')} onClick={onFind}>
        <Search size={15} />
      </B>
      {sep}
      <select
        title="Fonte do texto selecionado"
        className="!py-0.5 !text-xs w-[118px] shrink-0"
        value={editor.getAttributes('textStyle').fontFamily || ''}
        onChange={(e) => (e.target.value ? c().setFontFamily(e.target.value).run() : c().unsetFontFamily().run())}
      >
        {FONTS.map(([label, value]) => (
          <option key={label} value={value} style={{ fontFamily: value || undefined }}>
            {label}
          </option>
        ))}
      </select>
      <select
        title="Tamanho do texto selecionado"
        className="!py-0.5 !text-xs w-[70px] shrink-0"
        value={editor.getAttributes('textStyle').fontSize || ''}
        onChange={(e) => (e.target.value ? c().setFontSize(e.target.value).run() : c().unsetFontSize().run())}
      >
        <option value="">Tam.</option>
        {SIZES.map((s) => (
          <option key={s} value={s + 'px'}>
            {s}
          </option>
        ))}
      </select>
      {sep}
      <B title="Título 1" on={editor.isActive('heading', { level: 1 })} onClick={() => c().toggleHeading({ level: 1 }).run()}>
        <Heading1 size={16} />
      </B>
      <B title="Título 2" on={editor.isActive('heading', { level: 2 })} onClick={() => c().toggleHeading({ level: 2 }).run()}>
        <Heading2 size={16} />
      </B>
      <B title="Título 3" on={editor.isActive('heading', { level: 3 })} onClick={() => c().toggleHeading({ level: 3 }).run()}>
        <Heading3 size={16} />
      </B>
      {sep}
      <B title="Negrito" on={editor.isActive('bold')} onClick={() => c().toggleBold().run()}>
        <Bold size={15} />
      </B>
      <B title="Itálico" on={editor.isActive('italic')} onClick={() => c().toggleItalic().run()}>
        <Italic size={15} />
      </B>
      <B title="Tachado" on={editor.isActive('strike')} onClick={() => c().toggleStrike().run()}>
        <Strikethrough size={15} />
      </B>
      <B title="Código inline" on={editor.isActive('code')} onClick={() => c().toggleCode().run()}>
        <Code size={15} />
      </B>
      {sep}
      <B title="Lista" on={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()}>
        <List size={15} />
      </B>
      <B title="Lista numerada" on={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered size={15} />
      </B>
      <B title="Checklist" on={editor.isActive('taskList')} onClick={() => c().toggleTaskList().run()}>
        <ListChecks size={15} />
      </B>
      <B title="Citação" on={editor.isActive('blockquote')} onClick={() => c().toggleBlockquote().run()}>
        <Quote size={15} />
      </B>
      {sep}
      <B title="Bloco de código (executável: JS / Python)" on={editor.isActive('codeBlock')} onClick={() => c().toggleCodeBlock().run()}>
        <Code2 size={15} />
      </B>
      <B title="Equação LaTeX (bloco)" onClick={() => c().insertContent({ type: 'mathBlock', attrs: { latex: '' } }).run()}>
        <Sigma size={15} />
      </B>
      <B title="Equação LaTeX (inline)" onClick={() => c().insertContent({ type: 'mathInline', attrs: { latex: '' } }).run()}>
        <span className="text-[12px] font-serif italic">fx</span>
      </B>
      <B title="Tabela" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <Table size={15} />
      </B>
      <B
        title="Callout (clique novamente para trocar o tipo)"
        on={editor.isActive('callout')}
        onClick={() => {
          if (editor.isActive('callout')) {
            const kinds = ['info', 'tip', 'warn', 'danger']
            const cur = editor.getAttributes('callout').kind
            c().updateAttributes('callout', { kind: kinds[(kinds.indexOf(cur) + 1) % kinds.length] }).run()
          } else c().wrapIn('callout', { kind: 'info' }).run()
        }}
      >
        <MessageSquareWarning size={15} />
      </B>
      <B title="Linha divisória" onClick={() => c().setHorizontalRule().run()}>
        <Minus size={15} />
      </B>
      {sep}
      <B
        title="Link para outra página"
        onClick={() => {
          const { from, to, empty } = editor.state.selection
          useStore.setState({
            palette: {
              mode: 'pickPage',
              onPick: (pageId) => {
                const title = useStore.getState().nodes[pageId]?.title || 'página'
                if (empty) editor.chain().focus().insertContent([{ type: 'text', text: title, marks: [{ type: 'pageLink', attrs: { pageId } }] }, { type: 'text', text: ' ' }]).run()
                else editor.chain().focus().setTextSelection({ from, to }).setMark('pageLink', { pageId }).run()
              },
            },
          })
        }}
      >
        <Link2 size={15} />
      </B>
      <B title="Anexar arquivo (ou arraste / cole na nota)" onClick={() => fileRef.current?.click()}>
        <Paperclip size={15} />
      </B>
      <B title="Inserir um canvas livre aqui na nota (caixas, desenho, setas)" onClick={() => c().insertContent([{ type: 'canvasBlock', attrs: { data: '', height: 420 } }, { type: 'paragraph' }]).run()}>
        <Shapes size={15} />
      </B>
      {sep}
      <B title="Mover o bloco atual para cima" onClick={() => moveBlock(editor, -1)}>
        <ArrowUp size={15} />
      </B>
      <B title="Mover o bloco atual para baixo" onClick={() => moveBlock(editor, 1)}>
        <ArrowDown size={15} />
      </B>
      {sep}
      <B
        title="Adicionar significado / linkar conceito ao texto selecionado (sem seleção: novo termo no glossário)"
        on={editor.isActive('glossTerm')}
        onClick={() => {
          const { from, to, empty } = editor.state.selection
          if (empty) return useStore.setState({ termDialog: { text: '' } })
          const text = editor.state.doc.textBetween(from, to, ' ').trim()
          useStore.setState({
            termDialog: { text, termId: editor.getAttributes('glossTerm').termId, onDone: (termId) => editor.chain().focus().setTextSelection({ from, to }).setMark('glossTerm', { termId }).run() },
          })
        }}
      >
        <BookPlus size={15} />
      </B>
      <B
        title={'Ocultar lacuna (cloze) no texto selecionado' + (useStore.getState().shortcuts.cloze ? ' — ' + useStore.getState().shortcuts.cloze : '')}
        on={editor.isActive('cloze')}
        onClick={() => {
          if (editor.isActive('cloze')) c().unsetMark('cloze').run()
          else if (!editor.state.selection.empty) c().setMark('cloze', { clozeId: uid() }).run()
          else alert('Selecione primeiro o trecho que deve virar lacuna.')
        }}
      >
        <EyeOff size={15} />
      </B>
      {editor.isActive('table') && (
        <>
          {sep}
          <button className="btn !py-0.5" onMouseDown={(e) => (e.preventDefault(), c().addRowAfter().run())}>
            + linha
          </button>
          <button className="btn !py-0.5" onMouseDown={(e) => (e.preventDefault(), c().addColumnAfter().run())}>
            + coluna
          </button>
          <button className="btn !py-0.5" onMouseDown={(e) => (e.preventDefault(), c().deleteRow().run())}>
            − linha
          </button>
          <button className="btn !py-0.5" onMouseDown={(e) => (e.preventDefault(), c().deleteColumn().run())}>
            − coluna
          </button>
          <button className="btn !py-0.5" onMouseDown={(e) => (e.preventDefault(), c().deleteTable().run())}>
            excluir tabela
          </button>
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const fs = Array.from(e.target.files || [])
          if (fs.length) insertFiles(editor, fs)
          e.target.value = ''
        }}
      />
    </div>
  )
}

/** Barra "Buscar nesta página": destaca as ocorrências e pula entre elas. */
function FindBar({ editor, onClose }: { editor: TEditor; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [, force] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const f = () => force((x) => x + 1)
    editor.on('transaction', f)
    input.current?.focus()
    input.current?.select()
    return () => {
      editor.off('transaction', f)
      // ao fechar, some o destaque
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(findKey, { query: '', index: 0 }))
    }
  }, [editor])
  const st = findKey.getState(editor.state)
  const go = (patch: { query?: string; index?: number }) => {
    editor.view.dispatch(editor.state.tr.setMeta(findKey, patch))
    requestAnimationFrame(() => document.querySelector('.ProseMirror .find-hit-current')?.scrollIntoView({ block: 'center' }))
  }
  const n = st?.matches.length ?? 0
  return (
    <div className="pop absolute right-5 top-2 z-30 flex items-center gap-1 p-1.5" role="search">
      <Search size={14} className="text-muted ml-1" />
      <input
        ref={input}
        value={q}
        placeholder="Buscar nesta página…"
        aria-label="Buscar nesta página"
        className="w-52 text-[13px] !py-0.5"
        onChange={(e) => (setQ(e.target.value), go({ query: e.target.value, index: 0 }))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.preventDefault(), go({ index: (st?.index ?? 0) + (e.shiftKey ? -1 : 1) }))
          else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), onClose())
        }}
      />
      <span className="text-xs text-muted tabular-nums w-14 text-center" data-find-count>
        {q ? (n ? `${(st?.index ?? 0) + 1} de ${n}` : 'nenhum') : ''}
      </span>
      <button className="icon-btn !w-6 !h-6" title="Ocorrência anterior (Shift+Enter)" disabled={!n} onClick={() => go({ index: (st?.index ?? 0) - 1 })}>
        <ChevronUp size={14} />
      </button>
      <button className="icon-btn !w-6 !h-6" title="Próxima ocorrência (Enter)" disabled={!n} onClick={() => go({ index: (st?.index ?? 0) + 1 })}>
        <ChevronDown size={14} />
      </button>
      <button className="icon-btn !w-6 !h-6" title="Fechar a busca (Esc)" onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  )
}

/** Menu flutuante de seleção: + Significado, Lacuna (Cloze), formatação. */
function SelectionMenu({ editor }: { editor: TEditor }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const update = () => {
      const { state, view } = editor
      const { from, to, empty } = state.selection
      const isText = (state.selection as any).node == null
      if (empty || !isText || !view.hasFocus() || !state.doc.textBetween(from, to, ' ').trim()) return setPos(null)
      try {
        const a = view.coordsAtPos(from)
        const b = view.coordsAtPos(to)
        setPos({ x: (a.left + b.right) / 2, y: Math.min(a.top, b.top) })
      } catch {
        setPos(null)
      }
    }
    const hide = () => setTimeout(() => !editor.isDestroyed && !editor.view.hasFocus() && setPos(null), 150)
    editor.on('selectionUpdate', update)
    editor.on('blur', hide)
    window.addEventListener('scroll', update, true)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('blur', hide)
      window.removeEventListener('scroll', update, true)
    }
  }, [editor])
  if (!pos) return null
  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault()
    fn()
  }
  const addMeaning = () => {
    const { from, to } = editor.state.selection
    const text = editor.state.doc.textBetween(from, to, ' ').trim()
    const existing = editor.getAttributes('glossTerm').termId as string | undefined
    useStore.setState({
      termDialog: {
        text,
        termId: existing,
        onDone: (termId) => editor.chain().focus().setTextSelection({ from, to }).setMark('glossTerm', { termId }).run(),
      },
    })
    setPos(null)
  }
  const cloze = () => {
    if (editor.isActive('cloze')) editor.chain().focus().unsetMark('cloze').run()
    else editor.chain().focus().setMark('cloze', { clozeId: uid() }).run()
  }
  return (
    <div
      className="pop pop-in fixed z-50 flex items-center gap-0.5 p-1 -translate-x-1/2 -translate-y-full"
      style={{ left: Math.max(190, Math.min(pos.x, innerWidth - 190)), top: Math.max(48, pos.y - 8) }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button className="btn btn-accent" onMouseDown={act(addMeaning)}>
        <BookPlus size={14} /> {editor.isActive('glossTerm') ? 'Editar significado' : '+ Adicionar Significado / Linkar Conceito'}
      </button>
      <button className={'btn ' + (editor.isActive('cloze') ? 'btn-on' : '')} onMouseDown={act(cloze)} title={useStore.getState().shortcuts.cloze || undefined}>
        <EyeOff size={14} /> {editor.isActive('cloze') ? 'Remover lacuna' : 'Ocultar Lacuna (Cloze)'}
      </button>
      {editor.isActive('glossTerm') && (
        <button className="btn" onMouseDown={act(() => editor.chain().focus().unsetMark('glossTerm').run())}>
          Deslinkar
        </button>
      )}
      <span className="w-px h-5 bg-line mx-0.5" />
      <button className={'icon-btn ' + (editor.isActive('bold') ? 'on' : '')} onMouseDown={act(() => editor.chain().focus().toggleBold().run())}>
        <Bold size={14} />
      </button>
      <button className={'icon-btn ' + (editor.isActive('italic') ? 'on' : '')} onMouseDown={act(() => editor.chain().focus().toggleItalic().run())}>
        <Italic size={14} />
      </button>
    </div>
  )
}

export function Editor({ node, footer }: { node: TreeNode; footer?: React.ReactNode }) {
  const termsVersion = useStore((s) => s.termsVersion)
  const latest = useRef<{ dirty: boolean; json: any }>({ dirty: false, json: null })
  const save = useMemo(
    () =>
      debounce(() => {
        if (latest.current.dirty) {
          latest.current.dirty = false
          actions.saveDoc(node.id, latest.current.json)
        }
      }, 450),
    [node.id],
  )
  const editor = useEditor({
    extensions,
    content: node.content,
    editorProps: {
      attributes: { spellcheck: 'false' },
      handleDrop(view, event) {
        const files = Array.from(event.dataTransfer?.files || [])
        if (!files.length) return false
        event.preventDefault()
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        insertFiles(editorRef.current!, files, at)
        return true
      },
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files || [])
        if (!files.length) return false
        event.preventDefault()
        insertFiles(editorRef.current!, files)
        return true
      },
    },
    onUpdate({ editor }) {
      latest.current = { dirty: true, json: editor.getJSON() }
      save()
    },
  })
  const hostRef = useRef<HTMLDivElement>(null)
  const [finding, setFinding] = useState(false)
  const editorRef = useRef<TEditor | null>(null)
  editorRef.current = editor

  // comandos vindos dos atalhos configuráveis (lacuna / significado)
  useEffect(() => {
    if (!editor) return
    const h = (e: Event) => {
      const cmd = (e as CustomEvent).detail
      const { from, to, empty } = editor.state.selection
      if (cmd === 'find') return setFinding(true)
      if (cmd === 'cloze') {
        if (editor.isActive('cloze')) editor.chain().focus().unsetMark('cloze').run()
        else if (!empty) editor.chain().focus().setMark('cloze', { clozeId: uid() }).run()
      } else if (cmd === 'meaning') {
        if (empty) return useStore.setState({ termDialog: { text: '' } })
        useStore.setState({
          termDialog: {
            text: editor.state.doc.textBetween(from, to, ' ').trim(),
            termId: editor.getAttributes('glossTerm').termId,
            onDone: (termId) => editor.chain().focus().setTextSelection({ from, to }).setMark('glossTerm', { termId }).run(),
          },
        })
      }
    }
    window.addEventListener('ne:cmd', h)
    return () => window.removeEventListener('ne:cmd', h)
  }, [editor])

  // salva pendências ao sair da página
  useEffect(() => () => save.flush(), [save])
  // ...exceto quando uma versão antiga está sendo restaurada: aí o pendente é descartado
  useEffect(() => {
    const drop = () => {
      latest.current.dirty = false
      save.cancel()
    }
    window.addEventListener('ne:discard-pending', drop)
    return () => window.removeEventListener('ne:discard-pending', drop)
  }, [save])
  // re-decora quando o glossário muda (auto-reconhecimento global)
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(glossKey, true))
  }, [termsVersion, editor])

  if (!editor) return null
  return (
    <div className="flex flex-col flex-1 min-h-0 relative">
      <Toolbar editor={editor} onFind={() => setFinding(true)} />
      <div className="relative">{finding && <FindBar editor={editor} onClose={() => (setFinding(false), editor.commands.focus())} />}</div>
      <div className="flex-1 overflow-auto" id="editor-scroll">
        <div ref={hostRef} className="max-w-[820px] mx-auto px-8 py-6 relative">
          <DragHandle editor={editor} host={hostRef} />
          <EditorContent editor={editor} />
        </div>
        <div className="max-w-[820px] mx-auto px-8 pb-16">{footer}</div>
      </div>
      <StatusBar node={node} />
      <SelectionMenu editor={editor} />
    </div>
  )
}

/** Rodapé: contagem de palavras, caracteres e tempo de leitura (200 palavras por minuto). */
function StatusBar({ node }: { node: TreeNode }) {
  const words = useMemo(() => node.text.trim().split(/\s+/).filter(Boolean).length, [node.text])
  const chars = node.text.replace(/\s/g, '').length
  const fmt = (n: number) => n.toLocaleString('pt-BR')
  return (
    <div className="flex items-center gap-3 px-4 h-6 border-t border-line bg-panel text-[11px] text-muted shrink-0" data-status-bar>
      <span>
        {fmt(words)} palavra{words === 1 ? '' : 's'}
      </span>
      <span>{fmt(chars)} caracteres</span>
      <span>{words ? `~${Math.max(1, Math.round(words / 200))} min de leitura` : 'página vazia'}</span>
    </div>
  )
}

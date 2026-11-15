import { useMemo, useRef, useState } from 'react'
import { BookPlus, Link2, Paperclip, Trash2, X } from 'lucide-react'
import { actions, useStore } from '../store'
import type { Term } from '../db'
import { RichInput } from './Rich'
import { stripHtml } from '../lib/util'

/** Formulário de termo do glossário (usado no diálogo e nos pop-ups fixados). */
export function TermForm({ initial, onSaved, onCancel, compact }: { initial: Partial<Term> & { term: string }; onSaved: (id: string) => void; onCancel?: () => void; compact?: boolean }) {
  const nodes = useStore((s) => s.nodes)
  const files = useStore((s) => s.files)
  const [term, setTerm] = useState(initial.term)
  const [aliases, setAliases] = useState((initial.aliases || []).join(', '))
  const [html, setHtml] = useState(initial.html || '')
  const [pageId, setPageId] = useState(initial.pageId || '')
  const [fileId, setFileId] = useState(initial.fileId || '')
  const fileRef = useRef<HTMLInputElement>(null)
  const pages = useMemo(() => Object.values(nodes).sort((a, b) => a.title.localeCompare(b.title)), [nodes])
  const save = () => {
    if (!term.trim()) return
    const id = actions.saveTerm({
      id: initial.id,
      term: term.trim(),
      aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean),
      html,
      pageId: pageId || null,
      fileId: fileId || null,
    })
    onSaved(id)
  }
  return (
    <div className="flex flex-col gap-2.5">
      <div className={compact ? 'flex flex-col gap-2' : 'grid grid-cols-2 gap-2'}>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Termo / conceito
          <input value={term} onChange={(e) => setTerm(e.target.value)} className="text-sm !text-fg" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Sinônimos (separados por vírgula)
          <input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="plural, sigla…" className="text-sm" />
        </label>
      </div>
      <div className="text-xs text-muted -mb-1.5">Significado</div>
      <RichInput html={html} onChange={setHtml} placeholder="Escreva a definição: texto, links, fórmulas $E=mc^2$, imagens…" autoFocus />
      <div className={compact ? 'flex flex-col gap-2' : 'grid grid-cols-2 gap-2'}>
        <label className="flex flex-col gap-1 text-xs text-muted">
          <span className="flex items-center gap-1">
            <Link2 size={11} /> Página correspondente na árvore
          </span>
          <select value={pageId} onChange={(e) => setPageId(e.target.value)} className="text-sm">
            <option value="">— nenhuma —</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.icon} {p.title}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-xs text-muted">
          <span className="flex items-center gap-1">
            <Paperclip size={11} /> Arquivo de referência
          </span>
          <div className="flex gap-1">
            <button type="button" className="btn flex-1 !justify-start truncate" onClick={() => fileRef.current?.click()}>
              {fileId && files[fileId] ? files[fileId].name : 'Anexar arquivo…'}
            </button>
            {fileId && (
              <button type="button" className="icon-btn" onClick={() => setFileId('')}>
                <X size={13} />
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) setFileId(await actions.addFile(f))
              e.target.value = ''
            }}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        {initial.id && (
          <button
            className="btn !text-red-400"
            onClick={() => {
              if (confirm(`Excluir o termo "${initial.term}" do glossário?`)) {
                actions.deleteTerm(initial.id!)
                onCancel?.()
              }
            }}
          >
            <Trash2 size={13} /> Excluir
          </button>
        )}
        <span className="flex-1" />
        {onCancel && (
          <button className="btn" onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button className="btn btn-accent" onClick={save}>
          <BookPlus size={13} /> Salvar significado
        </button>
      </div>
    </div>
  )
}

/** Diálogo "+ Adicionar Significado / Linkar Conceito". */
export function TermDialog() {
  const dlg = useStore((s) => s.termDialog)
  const terms = useStore((s) => s.terms)
  const [q, setQ] = useState('')
  if (!dlg) return null
  const close = () => useStore.setState({ termDialog: null })
  const editing = dlg.termId ? terms[dlg.termId] : undefined
  const exact = Object.values(terms).find((t) => [t.term, ...t.aliases].some((a) => a.toLowerCase() === dlg.text.toLowerCase()))
  const base = editing || exact
  const query = (q || '').toLowerCase()
  const matches = Object.values(terms)
    .filter((t) => !query || t.term.toLowerCase().includes(query) || t.aliases.some((a) => a.toLowerCase().includes(query)))
    .slice(0, 6)
  const done = (id: string) => {
    dlg.onDone?.(id)
    close()
  }
  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-start justify-center pt-[9vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="pop w-[640px] max-w-[94vw] max-h-[84vh] overflow-auto p-4">
        <div className="flex items-center gap-2 mb-3">
          <BookPlus size={17} className="text-accent" />
          <div className="font-semibold text-[15px]">{base ? 'Editar significado' : 'Adicionar significado'}</div>
          <span className="text-muted truncate">“{dlg.text}”</span>
          <button className="icon-btn ml-auto" onClick={close}>
            <X size={15} />
          </button>
        </div>
        <TermForm key={base?.id || 'new'} initial={base ? base : { term: dlg.text }} onSaved={done} onCancel={close} />
        {dlg.onDone && (
          <div className="mt-4 pt-3 border-t border-line">
            <div className="text-xs text-muted mb-1.5">…ou linkar a um conceito já existente no glossário</div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar conceito…" className="w-full mb-1.5" />
            <div className="flex flex-col">
              {matches.map((t) => (
                <button key={t.id} className="text-left px-2 py-1 rounded-md hover:bg-panel2 flex gap-2 items-baseline" onClick={() => done(t.id)}>
                  <span className="font-medium shrink-0">{t.term}</span>
                  <span className="text-xs text-muted truncate">{stripHtml(t.html)}</span>
                </button>
              ))}
              {!matches.length && <div className="text-xs text-muted px-2">Nenhum conceito encontrado.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

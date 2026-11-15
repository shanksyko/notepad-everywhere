import { useEffect, useState } from 'react'
import { FileDown, Loader2, Printer, X } from 'lucide-react'
import { pathOf, useStore } from '../store'
import { collectPages, nativeApp, printPages, savePdf, type PrintScope } from '../lib/print'

/** Imprimir / salvar em PDF: página atual, página + subpáginas ou caderno inteiro. */
export function PrintDialog() {
  const open = useStore((s) => s.printOpen)
  const currentId = useStore((s) => s.currentId)
  const nodes = useStore((s) => s.nodes)
  const study = useStore((s) => s.study)
  const [scope, setScope] = useState<PrintScope>('page')
  const [hideCloze, setHideCloze] = useState(false)
  const [glossary, setGlossary] = useState(false)
  const [pageBreaks, setPageBreaks] = useState(true)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (open) {
      setHideCloze(study)
      setMsg('')
      setBusy('')
    }
  }, [open, study])
  if (!open || !currentId || !nodes[currentId]) return null
  const close = () => useStore.setState({ printOpen: false })
  const node = nodes[currentId]
  const notebook = pathOf(nodes, currentId)[0]
  const count = (s: PrintScope) => collectPages(currentId, s).length
  const opts = { scope, hideCloze, glossary, pageBreaks }
  const scopes: [PrintScope, string, string][] = [
    ['page', 'Só esta página', `${node.icon} ${node.title}`],
    ['subtree', 'Esta página e as subpáginas', `${count('subtree')} página(s)`],
    ['notebook', 'Caderno inteiro', `${notebook.icon} ${notebook.title} — ${count('notebook')} página(s)`],
  ]
  const run = async (kind: 'print' | 'pdf') => {
    setMsg('')
    setBusy(kind)
    try {
      if (kind === 'print') {
        await printPages(currentId, opts)
        close()
      } else {
        const r = await savePdf(currentId, opts)
        if (r && r.ok) setMsg('PDF salvo em: ' + r.path)
        else if (r && r.reason !== 'canceled') setMsg('Não foi possível salvar o PDF: ' + r.reason)
      }
    } catch (e: any) {
      setMsg('Falha ao preparar a impressão: ' + (e?.message || e))
    }
    setBusy('')
  }
  const Check = ({ v, set, label, hint }: { v: boolean; set: (b: boolean) => void; label: string; hint?: string }) => (
    <label className="flex items-start gap-2 text-[13px] cursor-pointer">
      <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
      <span>
        {label}
        {hint && <span className="block text-[11.5px] text-muted">{hint}</span>}
      </span>
    </label>
  )
  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-start justify-center pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="pop w-[520px] max-w-[94vw] p-4 flex flex-col gap-3.5">
        <div className="flex items-center gap-2">
          <Printer size={18} className="text-accent" />
          <div className="font-semibold text-[15px]">Imprimir / salvar em PDF</div>
          <button className="icon-btn ml-auto" onClick={close}>
            <X size={15} />
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted">O que imprimir</div>
          {scopes.map(([s, label, hint]) => (
            <button key={s} className={'text-left rounded-lg border px-3 py-2 ' + (scope === s ? 'border-accent bg-accent/10' : 'border-line hover:border-muted')} onClick={() => setScope(s)}>
              <div className="text-[13px] font-medium">{label}</div>
              <div className="text-[11.5px] text-muted truncate">{hint}</div>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-[10px] uppercase tracking-wider text-muted">Opções</div>
          <Check v={hideCloze} set={setHideCloze} label="Ocultar as lacunas (folha de exercício)" hint="As lacunas saem como espaços em branco para preencher à mão." />
          <Check v={glossary} set={setGlossary} label="Incluir glossário no final" hint="Lista as definições dos termos que aparecem nas páginas impressas." />
          {scope !== 'page' && <Check v={pageBreaks} set={setPageBreaks} label="Começar cada página do caderno em uma folha nova" />}
        </div>
        <div className="text-[11.5px] text-muted">Sai em preto sobre branco, em qualquer tema. Áudios, vídeos e arquivos aparecem como uma linha com o nome; de um PDF anexado sai a primeira página.</div>
        {msg && <div className="text-[12.5px] rounded-md px-3 py-2 bg-panel2 border border-line break-all">{msg}</div>}
        <div className="flex items-center gap-2">
          <span className="flex-1" />
          {nativeApp && (
            <button className="btn !py-2" disabled={!!busy} onClick={() => run('pdf')}>
              {busy === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} Salvar como PDF…
            </button>
          )}
          <button className="btn btn-accent !py-2" disabled={!!busy} onClick={() => run('print')}>
            {busy === 'print' ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} {nativeApp ? 'Imprimir…' : 'Imprimir / PDF…'}
          </button>
        </div>
      </div>
    </div>
  )
}

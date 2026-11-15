import { useEffect, useState } from 'react'
import { Keyboard, RotateCcw, X } from 'lucide-react'
import { actions, useStore } from '../store'
import { comboOf, comboProblem, defaultShortcuts, SHORTCUTS } from '../lib/shortcuts'

/** Tela "Atalhos": clique em um atalho e pressione a nova combinação. */
export function ShortcutsDialog() {
  const open = useStore((s) => s.shortcutsOpen)
  const shortcuts = useStore((s) => s.shortcuts)
  const [recording, setRecording] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!open) {
      setRecording(null)
      setMsg('')
    }
  }, [open])

  // captura a próxima combinação pressionada
  useEffect(() => {
    if (!recording) return
    const h = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setRecording(null)
      const combo = comboOf(e)
      if (!combo) return
      const problem = comboProblem(combo)
      if (problem) return setMsg(problem)
      const next = { ...shortcuts }
      const clash = SHORTCUTS.find((s) => s.id !== recording && next[s.id] === combo)
      if (clash) next[clash.id] = ''
      next[recording] = combo
      actions.setShortcuts(next)
      setMsg(clash ? `${combo} estava em “${clash.label}”, que ficou sem atalho.` : '')
      setRecording(null)
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [recording, shortcuts])

  if (!open) return null
  const close = () => useStore.setState({ shortcutsOpen: false })
  const defs = defaultShortcuts()
  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-start justify-center pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="pop w-[560px] max-w-[94vw] max-h-[86vh] overflow-auto p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Keyboard size={18} className="text-accent" />
          <div className="font-semibold text-[15px]">Atalhos de teclado</div>
          <button className="icon-btn ml-auto" onClick={close}>
            <X size={15} />
          </button>
        </div>
        <div className="text-[12.5px] text-muted">Clique em um atalho e pressione a nova combinação. Toda ação também tem botão na interface — os atalhos são opcionais.</div>
        {msg && <div className="text-[12.5px] rounded-md px-3 py-2 bg-amber-500/10 border border-amber-500/40">{msg}</div>}
        <div className="flex flex-col">
          {SHORTCUTS.map((s) => {
            const cur = shortcuts[s.id] || ''
            const rec = recording === s.id
            return (
              <div key={s.id} className="flex items-center gap-2 py-1.5 border-b border-line last:border-0">
                <span className="flex-1 text-[13px]">{s.label}</span>
                <button
                  className={'btn min-w-[150px] !justify-center font-mono ' + (rec ? 'btn-on animate-pulse' : '')}
                  title="Clique e pressione a nova combinação"
                  onClick={() => {
                    setMsg('')
                    setRecording(rec ? null : s.id)
                  }}
                >
                  {rec ? 'pressione as teclas…' : cur || '— sem atalho —'}
                </button>
                <button className="icon-btn" title="Remover atalho" disabled={!cur} style={{ opacity: cur ? 1 : 0.3 }} onClick={() => actions.setShortcuts({ ...shortcuts, [s.id]: '' })}>
                  <X size={14} />
                </button>
                <button className="icon-btn" title={`Voltar ao padrão (${defs[s.id] || 'sem atalho'})`} disabled={cur === defs[s.id]} style={{ opacity: cur === defs[s.id] ? 0.3 : 1 }} onClick={() => actions.setShortcuts({ ...shortcuts, [s.id]: defs[s.id] })}>
                  <RotateCcw size={13} />
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button
            className="btn"
            onClick={() => {
              actions.setShortcuts(defs)
              setMsg('Atalhos restaurados para o padrão.')
            }}
          >
            <RotateCcw size={13} /> Restaurar todos
          </button>
          <span className="flex-1" />
          <button className="btn btn-accent" onClick={close}>
            Concluído
          </button>
        </div>
      </div>
    </div>
  )
}

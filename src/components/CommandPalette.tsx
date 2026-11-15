import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, CornerDownLeft, FileText, Zap } from 'lucide-react'
import { actions, loadDemoNotebook, pathOf, THEMES, useStore } from '../store'
import { exportZip, importZip, resetDatabase } from '../lib/exporter'
import { stripHtml } from '../lib/util'

interface Item {
  id: string
  icon: React.ReactNode
  label: string
  hint?: string
  group: string
  run: () => void
}

function pickBackup() {
  const i = document.createElement('input')
  i.type = 'file'
  i.accept = '.zip'
  i.onchange = () => i.files?.[0] && importZip(i.files[0]).catch((e) => alert(e.message))
  i.click()
}

/** Paleta de comandos universal (Ctrl+K). */
export function CommandPalette() {
  const pal = useStore((s) => s.palette)
  const nodes = useStore((s) => s.nodes)
  const terms = useStore((s) => s.terms)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const close = () => useStore.setState({ palette: null })

  useEffect(() => {
    setQ('')
    setIdx(0)
  }, [pal])

  const items = useMemo<Item[]>(() => {
    if (!pal) return []
    const st = useStore.getState()
    const set = useStore.setState
    const cmd = (id: string, label: string, run: () => void, hint?: string): Item => ({ id, icon: <Zap size={14} className="text-accent" />, label, hint, group: 'Comandos', run })
    const pick = pal.mode === 'pickPage'
    const pages: Item[] = Object.values(nodes).map((n) => ({
      id: 'p' + n.id,
      icon: <span className="text-sm">{n.icon}</span>,
      label: n.title,
      hint: pathOf(nodes, n.id).slice(0, -1).map((p) => p.title).join(' › '),
      group: pick ? 'Escolha a página para linkar' : 'Páginas',
      run: () => (pick ? pal.onPick?.(n.id) : actions.select(n.id)),
    }))
    if (pick) return pages
    const cmds: Item[] = [
      cmd('new', 'Nova nota (subpágina da atual)', () => actions.createNode(st.currentId), 'criar'),
      cmd('newnb', 'Novo caderno', () => actions.createNode(null, 'notebook', 'Novo caderno')),
      cmd('newterm', 'Novo termo no glossário', () => set({ termDialog: { text: '' } })),
      cmd('pomo', st.pomo.running ? 'Pausar Pomodoro' : 'Iniciar Pomodoro', () => (st.pomo.running ? actions.pomoPause() : actions.pomoStart(), set({ rightTab: 'pomodoro', rightOpen: true }))),
      cmd('review', 'Abrir revisão (Glossário & SRS)', () => set({ rightTab: 'glossary', rightOpen: true, zen: false })),
      cmd('zen', st.zen ? 'Sair do Modo Zen' : 'Modo Zen / Foco Total', () => set({ zen: !st.zen }), st.shortcuts.zen),
      cmd('spot', st.spotlight ? 'Desligar Spotlight' : 'Ligar Spotlight (ilumina o bloco atual)', () => set({ spotlight: !st.spotlight })),
      cmd('ruler', st.ruler ? 'Desligar régua de leitura' : 'Ligar régua de leitura', () => set({ ruler: !st.ruler })),
      cmd('study', st.study ? 'Desligar Modo Estudo (mostrar lacunas)' : 'Ligar Modo Estudo (ocultar lacunas)', () => set({ study: !st.study })),
      cmd('graph', 'Alternar Grafo de Conhecimento', () => set({ view: st.view === 'graph' ? 'page' : 'graph', zen: false })),
      ...THEMES.map((t) => cmd('t-' + t.id, 'Tema: ' + t.label, () => actions.setTheme(t.id))),
      cmd('notify', 'Notificações na área de trabalho', () => set({ notifyOpen: true })),
      cmd('s-brown', st.sound.brown > 0 ? 'Som: desligar ruído marrom' : 'Som: ruído marrom', () => actions.setSound('brown', st.sound.brown > 0 ? 0 : 0.35)),
      cmd('s-rain', st.sound.rain > 0 ? 'Som: desligar chuva' : 'Som: chuva', () => actions.setSound('rain', st.sound.rain > 0 ? 0 : 0.35)),
      cmd('s-bin', st.sound.binaural > 0 ? 'Som: desligar binaural 40 Hz' : 'Som: ondas binaurais 40 Hz', () => actions.setSound('binaural', st.sound.binaural > 0 ? 0 : 0.3)),
      cmd('print', 'Imprimir / salvar em PDF (página ou caderno inteiro)', () => set({ printOpen: true }), st.shortcuts.print),
      cmd('keys', 'Trocar teclas de atalho', () => set({ shortcutsOpen: true })),
      cmd('history', 'Histórico de versões desta página', () => set({ historyOpen: true })),
      cmd('trash', 'Lixeira (restaurar páginas excluídas)', () => set({ trashOpen: true })),
      cmd('welcome', 'Boas-vindas / como usar', () => set({ welcomeOpen: true })),
      cmd('backup', 'Backup automático (conectar OneDrive / Google Drive, restaurar)', () => set({ backupOpen: true })),
      cmd('export', 'Exportar backup completo (.zip com mídias + Markdown)', () => exportZip()),
      cmd('import', 'Importar backup (.zip)', pickBackup),
      cmd('demo', 'Carregar caderno de exemplo (demonstração dos recursos)', () => loadDemoNotebook()),
      cmd('reset', 'Apagar tudo e começar do zero', () => confirm('Apagar TODAS as notas, o glossário e as mídias deste app? Isso não pode ser desfeito (os backups já feitos continuam na pasta).') && resetDatabase()),
    ]
    const ts: Item[] = Object.values(terms).map((t) => ({
      id: 't' + t.id,
      icon: <BookOpen size={14} className="text-gloss" />,
      label: t.term,
      hint: stripHtml(t.html).slice(0, 70),
      group: 'Glossário',
      run: () => actions.pin({ kind: 'term', id: t.id, x: innerWidth / 2 - 170, y: 130 }),
    }))
    return [...cmds, ...pages, ...ts]
  }, [pal, nodes, terms])

  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return items.filter((i) => i.group !== 'Glossário').slice(0, 40)
    return items.filter((i) => words.every((w) => (i.label + ' ' + (i.hint || '')).toLowerCase().includes(w))).slice(0, 40)
  }, [items, q])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  if (!pal) return null
  const run = (it?: Item) => {
    if (!it) return
    close()
    it.run()
  }
  let lastGroup = ''
  return (
    <div className="fixed inset-0 z-[95] bg-black/50 flex items-start justify-center pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="pop w-[600px] max-w-[94vw] overflow-hidden">
        <input
          autoFocus
          value={q}
          onChange={(e) => (setQ(e.target.value), setIdx(0))}
          placeholder={pal.mode === 'pickPage' ? 'Linkar para qual página?' : 'Digite um comando, página ou termo do glossário…'}
          className="w-full !border-0 !border-b !border-line !rounded-none !bg-transparent !px-4 !py-3 text-[15px]"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setIdx((i) => Math.min(filtered.length - 1, i + 1)))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setIdx((i) => Math.max(0, i - 1)))
            else if (e.key === 'Enter') run(filtered[idx])
            else if (e.key === 'Escape') close()
          }}
        />
        <div ref={listRef} className="max-h-[52vh] overflow-auto p-1.5">
          {filtered.map((it, i) => {
            const head = it.group !== lastGroup
            lastGroup = it.group
            return (
              <div key={it.id}>
                {head && <div className="text-[10px] uppercase tracking-wider text-muted px-2.5 pt-2 pb-1">{it.group}</div>}
                <button data-active={i === idx} className={'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-left ' + (i === idx ? 'bg-panel2' : '')} onMouseEnter={() => setIdx(i)} onClick={() => run(it)}>
                  <span className="w-5 flex justify-center shrink-0">{it.icon}</span>
                  <span className="truncate text-[13.5px]">{it.label}</span>
                  <span className="text-xs text-muted truncate ml-auto pl-3 max-w-[45%]">{it.hint}</span>
                  {i === idx && <CornerDownLeft size={12} className="text-muted shrink-0" />}
                </button>
              </div>
            )
          })}
          {!filtered.length && (
            <div className="text-muted text-sm px-3 py-6 text-center flex flex-col items-center gap-1">
              <FileText size={18} /> Nada encontrado para “{q}”.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

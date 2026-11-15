import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { BookOpen, ChevronRight, Command, Download, EyeOff, FileText, Focus, Link2, Maximize2, Minimize2, Moon, PanelLeft, PanelRight, Pause, Play, Ruler, Shapes, Sun, Coffee, X, MoreVertical, FilePlus2, BookPlus, GraduationCap, Volume2, Network, Sparkles, Trash2, Printer, Keyboard, Expand, Palette, Bell, History, HelpCircle, RefreshCw } from 'lucide-react'
import { nativeApp, type UpdateState } from './lib/print'
import { actions, loadDemoNotebook, pathOf, pomoRemaining, useStore, PHASE_LABEL, THEMES, type Theme } from './store'
import { HistoryDialog, TrashDialog, WelcomeDialog } from './components/Dialogs'
import { initNotifications } from './lib/notify'
import { resetDatabase } from './lib/exporter'
import { comboOf } from './lib/shortcuts'
import { Sidebar } from './components/Sidebar'
import { Inspector } from './components/Inspector'
import { Editor } from './editor/Editor'
import { CanvasView } from './components/CanvasView'
import { PopupLayer } from './components/Popups'
import { TermDialog } from './components/TermForm'
import { CommandPalette } from './components/CommandPalette'
import { MediaBlock } from './components/Media'
import { initAutoBackup } from './lib/backup'
import { findTerms } from './lib/matcher'
import { fmtTime, stripHtml } from './lib/util'
import type { TreeNode } from './db'

// Telas abertas de vez em quando são carregadas só no primeiro uso, para o app abrir mais leve.
const lazyNamed = <T extends Record<string, any>>(load: () => Promise<T>, name: keyof T) => lazy(() => load().then((m) => ({ default: m[name] as React.ComponentType })))
const GraphView = lazyNamed(() => import('./components/GraphView'), 'GraphView')
const BackupDialog = lazyNamed(() => import('./components/BackupDialog'), 'BackupDialog')
const ShortcutsDialog = lazyNamed(() => import('./components/ShortcutsDialog'), 'ShortcutsDialog')
const NotifyDialog = lazyNamed(() => import('./components/NotifyDialog'), 'NotifyDialog')
const PrintDialog = lazyNamed(() => import('./components/PrintDialog'), 'PrintDialog')

/* ---------- Ações acionáveis por atalho (todas também têm botão) ---------- */
const editorCmd = (name: string) => window.dispatchEvent(new CustomEvent('ne:cmd', { detail: name }))
export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen().catch(() => {})
}
const COMMANDS: Record<string, () => void> = {
  palette: () => useStore.setState((s) => ({ palette: s.palette ? null : { mode: 'commands' } })),
  newPage: () => actions.createNode(useStore.getState().currentId),
  find: () => editorCmd('find'),
  meaning: () => editorCmd('meaning'),
  cloze: () => editorCmd('cloze'),
  study: () => useStore.setState((s) => ({ study: !s.study })),
  review: () => useStore.setState({ rightTab: 'glossary', rightOpen: true, zen: false }),
  pomodoro: () => (useStore.getState().pomo.running ? actions.pomoPause() : actions.pomoStart()),
  zen: () => useStore.setState((s) => ({ zen: !s.zen })),
  fullscreen: toggleFullscreen,
  spotlight: () => useStore.setState((s) => ({ spotlight: !s.spotlight })),
  ruler: () => useStore.setState((s) => ({ ruler: !s.ruler })),
  graph: () => useStore.setState((s) => ({ view: s.view === 'graph' ? 'page' : 'graph', zen: false })),
  print: () => useStore.setState({ printOpen: true }),
  backup: () => useStore.setState({ backupOpen: true }),
}
/** Texto do atalho atual de uma ação, para mostrar nas dicas dos botões. */
function useHint(id: string) {
  const c = useStore((s) => s.shortcuts[id])
  return c ? ` (${c})` : ''
}

/* ---------- Rodapé de backlinks ---------- */
function Backlinks({ node }: { node: TreeNode }) {
  const nodes = useStore((s) => s.nodes)
  const terms = useStore((s) => s.terms)
  const termsVersion = useStore((s) => s.termsVersion)
  const links = useMemo(() => {
    const myTerms = Object.values(terms).filter((t) => t.pageId === node.id)
    const myTermIds = new Set(myTerms.map((t) => t.id))
    const out: { node: TreeNode; why: string }[] = []
    for (const n of Object.values(nodes)) {
      if (n.id === node.id) continue
      const reasons: string[] = []
      if (n.linkIds.includes(node.id)) reasons.push('link direto')
      const used = new Set([...n.termIds, ...findTerms(n.text).map((m) => m.termId)])
      const via = [...used].filter((t) => myTermIds.has(t)).map((t) => terms[t].term)
      if (via.length) reasons.push('menciona ' + via.slice(0, 3).join(', '))
      if (!reasons.length && node.title.length >= 5 && n.text.toLowerCase().includes(node.title.toLowerCase())) reasons.push('menção ao título')
      if (reasons.length) out.push({ node: n, why: reasons.join(' · ') })
    }
    const inTerms = Object.values(terms).filter((t) => !myTermIds.has(t.id) && (t.html.includes(`data-page-id="${node.id}"`) || findTerms(stripHtml(t.html), t.id).some((m) => myTermIds.has(m.termId))))
    return { pages: out, myTerms, inTerms }
    // eslint-disable-next-line
  }, [nodes, terms, node.id, node.title, termsVersion])
  const total = links.pages.length + links.myTerms.length + links.inTerms.length
  return (
    <div className="border-t border-line pt-4 mt-2">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted mb-2">
        <Link2 size={12} /> Backlinks ({total})
      </div>
      {!total && <div className="text-xs text-muted">Nenhuma outra página ou termo menciona esta nota ainda.</div>}
      <div className="grid sm:grid-cols-2 gap-1.5">
        {links.pages.map(({ node: n, why }) => (
          <a key={n.id} data-page-id={n.id} className="rounded-lg border border-line bg-panel2/40 hover:border-accent px-3 py-2 cursor-pointer block">
            <div className="text-[13px] truncate">
              {n.icon} {n.title}
            </div>
            <div className="text-[11px] text-muted truncate">{why}</div>
          </a>
        ))}
        {links.myTerms.map((t) => (
          <div key={t.id} data-term-id={t.id} className="rounded-lg border border-line bg-panel2/40 hover:border-gloss px-3 py-2 cursor-help">
            <div className="text-[13px] truncate flex items-center gap-1.5">
              <BookOpen size={12} className="text-gloss" /> {t.term}
            </div>
            <div className="text-[11px] text-muted truncate">termo do glossário que aponta para esta página</div>
          </div>
        ))}
        {links.inTerms.map((t) => (
          <div key={t.id} data-term-id={t.id} className="rounded-lg border border-line bg-panel2/40 hover:border-gloss px-3 py-2 cursor-help">
            <div className="text-[13px] truncate flex items-center gap-1.5">
              <BookOpen size={12} className="text-gloss" /> {t.term}
            </div>
            <div className="text-[11px] text-muted truncate">definição menciona um conceito desta página</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- Cabeçalho da página ---------- */
function PageHeader({ node }: { node: TreeNode }) {
  const nodes = useStore((s) => s.nodes)
  const { zen, spotlight, ruler, study, theme, leftOpen, rightOpen } = useStore()
  const set = useStore.setState
  const path = pathOf(nodes, node.id).slice(0, -1)
  const themes: Theme[] = THEMES.map((t) => t.id)
  const themeLabel = THEMES.find((t) => t.id === theme)?.label
  const ThemeIcon = Palette
  const zenHint = useHint('zen')
  const printHint = useHint('print')
  const palHint = useHint('palette')
  return (
    <div className="flex items-center gap-1 px-3 h-11 border-b border-line bg-panel shrink-0">
      {!zen && (
        <button className={'icon-btn ' + (leftOpen ? '' : 'on')} title="Mostrar/ocultar árvore" onClick={() => set({ leftOpen: !leftOpen })}>
          <PanelLeft size={16} />
        </button>
      )}
      <div className="flex items-center gap-1 min-w-0 flex-1 text-[13px]">
        {path.map((p) => (
          <span key={p.id} className="flex items-center gap-1 text-muted shrink min-w-0">
            <button className="truncate hover:text-fg max-w-[140px]" onClick={() => actions.select(p.id)}>
              {p.title}
            </button>
            <ChevronRight size={12} className="shrink-0" />
          </span>
        ))}
        <span className="shrink-0">{node.icon}</span>
        <input key={node.id} defaultValue={node.title} className="flex-1 min-w-[80px] !bg-transparent !border-0 !px-1 font-semibold text-[14px]" onBlur={(e) => e.target.value.trim() && e.target.value !== node.title && actions.patchNode(node.id, { title: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </div>
      <div className="flex rounded-md border border-line overflow-hidden text-xs shrink-0">
        <button className={'px-2 py-1 flex items-center gap-1 ' + (node.mode === 'doc' ? 'bg-panel2 text-fg' : 'text-muted')} onClick={() => actions.patchNode(node.id, { mode: 'doc' })} title="Modo Documento Rico">
          <FileText size={12} /> Documento
        </button>
        <button className={'px-2 py-1 flex items-center gap-1 ' + (node.mode === 'canvas' ? 'bg-panel2 text-fg' : 'text-muted')} onClick={() => actions.patchNode(node.id, { mode: 'canvas' })} title="Modo Canvas Livre">
          <Shapes size={12} /> Canvas
        </button>
      </div>
      <button className={'btn ml-1 ' + (study ? 'btn-on' : '')} title="Modo Estudo: oculta as lacunas (cloze). Passe o mouse para espiar, clique para avaliar." onClick={() => set({ study: !study })}>
        <EyeOff size={13} /> Estudo
      </button>
      <button className={'icon-btn ' + (spotlight ? 'on' : '')} title="Spotlight: ilumina só o bloco atual" onClick={() => set({ spotlight: !spotlight })}>
        <Focus size={16} />
      </button>
      <button className={'icon-btn ' + (ruler ? 'on' : '')} title="Régua de leitura" onClick={() => set({ ruler: !ruler })}>
        <Ruler size={16} />
      </button>
      <button className={'icon-btn ' + (zen ? 'on' : '')} title={'Modo Zen / Foco Total' + zenHint} onClick={() => set({ zen: !zen })}>
        {zen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>
      <button className="icon-btn" title={`Tema: ${themeLabel} (clique para o próximo; todos em Mais opções)`} onClick={() => actions.setTheme(themes[(themes.indexOf(theme) + 1) % themes.length])}>
        <ThemeIcon size={16} />
      </button>
      <button className="icon-btn" title="Histórico de versões desta página" onClick={() => set({ historyOpen: true })}>
        <History size={16} />
      </button>
      <button className="icon-btn" title={'Imprimir / salvar em PDF' + printHint} onClick={() => set({ printOpen: true })}>
        <Printer size={16} />
      </button>
      <BackupButton />
      <button className="icon-btn" title={'Paleta de comandos' + palHint} onClick={() => set({ palette: { mode: 'commands' } })}>
        <Command size={16} />
      </button>
      <MoreMenu />
      {!zen && (
        <button className={'icon-btn ' + (rightOpen ? '' : 'on')} title="Mostrar/ocultar inspetor" onClick={() => set({ rightOpen: !rightOpen })}>
          <PanelRight size={16} />
        </button>
      )}
    </div>
  )
}

/** Menu "Mais opções": tudo o que a paleta Ctrl+K faz também tem um botão aqui. */
function MoreMenu() {
  const [open, setOpen] = useState(false)
  const st = useStore()
  const set = useStore.setState
  const Item = ({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) => (
    <button
      className={'flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 rounded-md hover:bg-panel2 text-[13px] ' + (danger ? 'text-red-400' : '')}
      onClick={() => {
        setOpen(false)
        onClick()
      }}
    >
      <span className="w-4 flex justify-center shrink-0 text-muted">{icon}</span>
      {label}
    </button>
  )
  const Head = ({ children }: { children: React.ReactNode }) => <div className="text-[10px] uppercase tracking-wider text-muted px-2.5 pt-2 pb-1">{children}</div>
  return (
    <>
      <button className={'icon-btn ' + (open ? 'on' : '')} title="Mais opções" onClick={() => setOpen(!open)}>
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="fixed inset-0 z-[85]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="pop pop-in absolute right-3 top-11 w-72 p-1.5 max-h-[85vh] overflow-auto">
            <Head>Criar</Head>
            <Item icon={<FilePlus2 size={14} />} label="Nova página (dentro da atual)" onClick={() => actions.createNode(st.currentId)} />
            <Item icon={<BookPlus size={14} />} label="Novo caderno" onClick={() => actions.createNode(null, 'notebook', 'Novo caderno')} />
            <Item icon={<BookOpen size={14} />} label="Novo termo no glossário" onClick={() => set({ termDialog: { text: '' } })} />
            <Head>Estudo e foco</Head>
            <Item icon={<GraduationCap size={14} />} label="Revisão (Glossário & SRS)" onClick={() => set({ rightTab: 'glossary', rightOpen: true, zen: false })} />
            <Item icon={st.pomo.running ? <Pause size={14} /> : <Play size={14} />} label={st.pomo.running ? 'Pausar Pomodoro' : 'Iniciar Pomodoro'} onClick={() => (st.pomo.running ? actions.pomoPause() : actions.pomoStart(), set({ rightTab: 'pomodoro', rightOpen: true }))} />
            <Item icon={<Volume2 size={14} />} label="Sons de foco (ruído marrom, chuva, binaural)" onClick={() => set({ rightTab: 'pomodoro', rightOpen: true, zen: false })} />
            <Item icon={<EyeOff size={14} />} label={st.study ? 'Desligar Modo Estudo' : 'Modo Estudo (ocultar lacunas)'} onClick={() => set({ study: !st.study })} />
            <Item icon={<Focus size={14} />} label={st.spotlight ? 'Desligar Spotlight' : 'Spotlight (ilumina o bloco atual)'} onClick={() => set({ spotlight: !st.spotlight })} />
            <Item icon={<Ruler size={14} />} label={st.ruler ? 'Desligar régua de leitura' : 'Régua de leitura'} onClick={() => set({ ruler: !st.ruler })} />
            <Item icon={<Maximize2 size={14} />} label={st.zen ? 'Sair do Modo Zen' : 'Modo Zen / Foco Total'} onClick={() => set({ zen: !st.zen })} />
            <Item icon={<Network size={14} />} label={st.view === 'graph' ? 'Voltar para a página' : 'Grafo de Conhecimento'} onClick={() => set({ view: st.view === 'graph' ? 'page' : 'graph', zen: false })} />
            <Head>Tema</Head>
            <div className="grid grid-cols-2 gap-1 px-2 pb-1">
              {THEMES.map((t) => (
                <button key={t.id} className={'btn !justify-start ' + (st.theme === t.id ? 'btn-on' : '')} onClick={() => actions.setTheme(t.id)}>
                  <span className="w-4 h-4 rounded-full border border-line shrink-0" style={{ background: `linear-gradient(135deg, ${t.bg} 50%, ${t.accent} 50%)` }} />
                  {t.label}
                </button>
              ))}
            </div>
            <Head>Avisos</Head>
            <Item icon={<Bell size={14} />} label="Notificações na área de trabalho…" onClick={() => set({ notifyOpen: true })} />
            <Head>Dados</Head>
            <Item icon={<Download size={14} />} label="Backup automático, exportar e importar…" onClick={() => set({ backupOpen: true })} />
            <Item icon={<History size={14} />} label="Histórico de versões desta página…" onClick={() => set({ historyOpen: true })} />
            <Item icon={<Trash2 size={14} />} label={`Lixeira${st.trash.length ? ` (${st.trash.length})` : ''}…`} onClick={() => set({ trashOpen: true })} />
            <Item icon={<Sparkles size={14} />} label="Carregar caderno de exemplo" onClick={() => loadDemoNotebook()} />
            <Item icon={<HelpCircle size={14} />} label="Boas-vindas / como usar" onClick={() => set({ welcomeOpen: true })} />
            <Item icon={<Trash2 size={14} />} danger label="Apagar tudo e começar do zero" onClick={() => confirm('Apagar TODAS as notas, o glossário e as mídias deste app? Isso não pode ser desfeito (os backups já feitos continuam na pasta).') && resetDatabase()} />
            <Item icon={<Printer size={14} />} label="Imprimir / salvar em PDF…" onClick={() => set({ printOpen: true })} />
            <Head>Atalhos e janela</Head>
            <Item icon={<Keyboard size={14} />} label="Trocar teclas de atalho…" onClick={() => set({ shortcutsOpen: true })} />
            <Item icon={<Command size={14} />} label={'Paleta de comandos' + (st.shortcuts.palette ? ` (${st.shortcuts.palette})` : '')} onClick={() => set({ palette: { mode: 'commands' } })} />
            <Item icon={<Expand size={14} />} label="Tela cheia" onClick={toggleFullscreen} />
            <Item icon={<RefreshCw size={14} />} label="Procurar atualizações" onClick={checkUpdates} />
          </div>
        </div>
      )}
    </>
  )
}

/** Aviso de versão nova baixada + resultado de "Procurar atualizações". */
function UpdateBanner() {
  const [st, setSt] = useState<UpdateState | null>(null)
  const toast = useStore((s) => s.toast)
  useEffect(() => {
    nativeApp?.updateState().then(setSt)
    nativeApp?.onUpdateState(setSt)
  }, [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => useStore.setState({ toast: null }), 6000)
    return () => clearTimeout(t)
  }, [toast])
  return (
    <div className="fixed bottom-4 left-4 z-[60] flex flex-col gap-2 items-start" role="status" aria-live="polite">
      {toast && <div className="pop px-3 py-2 text-[13px] max-w-[380px]">{toast}</div>}
      {st?.status === 'ready' && (
        <div className="pop px-3 py-2 text-[13px] flex items-center gap-2">
          <Sparkles size={14} className="text-accent" /> Versão {st.version} pronta.
          <button className="btn btn-accent" onClick={() => nativeApp?.installUpdate()}>
            Reiniciar e atualizar
          </button>
        </div>
      )}
    </div>
  )
}

async function checkUpdates() {
  const toast = (t: string) => useStore.setState({ toast: t })
  if (!nativeApp) return toast('A atualização automática só existe no app instalado.')
  toast('Procurando atualizações…')
  const cfg = await nativeApp.getConfig()
  const r = await nativeApp.checkUpdate()
  const msg: Record<string, string> = {
    none: `Você já está na versão mais recente (${cfg.version}).`,
    checking: 'Procurando atualizações…',
    downloading: `Baixando a versão ${r.version}… aviso quando estiver pronta.`,
    ready: `A versão ${r.version} está pronta para instalar.`,
    unconfigured: `Versão ${cfg.version}. A atualização automática ainda não foi ligada a um repositório do GitHub.`,
    unavailable: r.message || 'Atualização indisponível neste ambiente.',
    error: /No published versions/i.test(r.message) ? `Versão ${cfg.version}. Ainda não há nenhuma versão publicada no GitHub.` : 'Não foi possível procurar atualizações: ' + r.message,
    idle: `Versão ${cfg.version}.`,
  }
  toast(msg[r.status] || `Versão ${cfg.version}.`)
}

function BackupButton() {
  const status = useStore((s) => s.backupStatus)
  const last = useStore((s) => s.lastBackup)
  const color = status === 'ok' ? '#22c55e' : status === 'error' ? '#ef4444' : status === 'saving' ? '#eab308' : undefined
  const title = status === 'off' ? 'Backup (conectar OneDrive / Google Drive)' : status === 'saving' ? 'Salvando backup…' : status === 'error' ? 'Backup com problema — clique para ver' : `Backup automático ligado${last ? ' · último: ' + new Date(last).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''}`
  return (
    <button className="icon-btn relative" title={title} onClick={() => useStore.setState({ backupOpen: true })}>
      <Download size={16} />
      {color && <span className={'absolute right-1 top-1 w-2 h-2 rounded-full ' + (status === 'saving' ? 'animate-pulse' : '')} style={{ background: color }} />}
    </button>
  )
}

function MiniPomodoro() {
  const p = useStore((s) => s.pomo)
  return (
    <div className="pop fixed bottom-4 right-4 z-[60] flex items-center gap-2 pl-3 pr-1.5 py-1.5 !rounded-full">
      <span className="w-2 h-2 rounded-full" style={{ background: p.phase === 'focus' ? 'var(--accent)' : '#22c55e' }} />
      <span className="tabular-nums font-semibold">{fmtTime(Math.ceil(pomoRemaining(p) / 1000))}</span>
      <span className="text-xs text-muted">{PHASE_LABEL[p.phase]}</span>
      <button className="icon-btn" onClick={p.running ? actions.pomoPause : actions.pomoStart}>
        {p.running ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <button className="icon-btn" title="Sair do Modo Zen" onClick={() => useStore.setState({ zen: false })}>
        <Minimize2 size={14} />
      </button>
    </div>
  )
}

function ReadingRuler() {
  const [y, setY] = useState(-100)
  useEffect(() => {
    const h = (e: MouseEvent) => setY(e.clientY)
    window.addEventListener('mousemove', h)
    return () => window.removeEventListener('mousemove', h)
  }, [])
  return <div className="reading-ruler" style={{ top: y - 17 }} />
}

function MediaModal() {
  const m = useStore((s) => s.mediaModal)
  if (!m) return null
  const close = () => useStore.setState({ mediaModal: null })
  return (
    <div className="fixed inset-0 z-[75] bg-black/60 flex items-center justify-center p-6" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="w-[860px] max-w-full max-h-full overflow-auto relative">
        <button className="icon-btn absolute right-1 top-0.5 z-10 !bg-panel2" onClick={close}>
          <X size={15} />
        </button>
        <MediaBlock key={m.fileId + (m.page ?? '') + (m.time ?? '')} fileId={m.fileId} initial={{ time: m.time, page: m.page }} />
      </div>
    </div>
  )
}

export function App() {
  const ready = useStore((s) => s.ready)
  const node = useStore((s) => (s.currentId ? s.nodes[s.currentId] : null))
  const { view, zen, spotlight, ruler, study, leftOpen, rightOpen, contentRev, backupOpen, shortcutsOpen, notifyOpen, printOpen } = useStore()

  useEffect(() => {
    // acessibilidade: todo botão só com ícone ganha um nome legível a partir da dica (title)
    const label = (root: ParentNode) => root.querySelectorAll('button[title]:not([aria-label])').forEach((b) => b.setAttribute('aria-label', b.getAttribute('title') || ''))
    label(document)
    // diálogos e menus: papel de diálogo, foco entra ao abrir, Tab fica preso dentro e o foco volta ao fechar
    const FOCUSABLE = 'input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]):not([tabindex="-1"]),[contenteditable=true],a[href]'
    const open: { el: HTMLElement; prev: HTMLElement | null }[] = []
    const visible = (e: HTMLElement) => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden'
    const syncDialogs = () => {
      while (open.length && !open[open.length - 1].el.isConnected) {
        const { prev } = open.pop()!
        if (prev?.isConnected && !open.length) prev.focus({ preventScroll: true })
      }
      document.querySelectorAll<HTMLElement>('.fixed.inset-0 > .pop').forEach((el) => {
        if (open.some((o) => o.el === el)) return
        if (!el.hasAttribute('role')) el.setAttribute('role', 'dialog')
        el.setAttribute('aria-modal', 'true')
        open.push({ el, prev: document.activeElement as HTMLElement | null })
        // dá um instante para campos com foco automático; se nenhum pegou o foco, vai para o primeiro controle
        setTimeout(() => {
          if (!el.isConnected || el.contains(document.activeElement)) return
          ;[...el.querySelectorAll<HTMLElement>(FOCUSABLE)].find(visible)?.focus({ preventScroll: true })
        }, 60)
      })
    }
    const trapTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !open.length) return
      const el = open[open.length - 1].el
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible)
      if (!items.length) return
      const first = items[0], last = items[items.length - 1], a = document.activeElement
      if (!el.contains(a)) (e.preventDefault(), first.focus())
      else if (e.shiftKey && a === first) (e.preventDefault(), last.focus())
      else if (!e.shiftKey && a === last) (e.preventDefault(), first.focus())
    }
    window.addEventListener('keydown', trapTab, true)
    const mo = new MutationObserver(() => (label(document), syncDialogs()))
    mo.observe(document.body, { childList: true, subtree: true })
    actions.init().then(() => {
      initAutoBackup()
      initNotifications()
    })
    const iv = setInterval(actions.pomoTick, 500)
    const key = (e: KeyboardEvent) => {
      const st = useStore.getState()
      if (st.shortcutsOpen) return // a tela de atalhos captura as teclas
      if (e.key === 'Escape') {
        if (st.palette) useStore.setState({ palette: null })
        else if (st.termDialog) useStore.setState({ termDialog: null })
        else if (st.printOpen) useStore.setState({ printOpen: false })
        else if (st.trashOpen) useStore.setState({ trashOpen: false })
        else if (st.historyOpen) useStore.setState({ historyOpen: false })
        else if (st.notifyOpen) useStore.setState({ notifyOpen: false })
        else if (st.welcomeOpen) actions.closeWelcome()
        else if (st.backupOpen) useStore.setState({ backupOpen: false })
        else if (st.mediaModal) useStore.setState({ mediaModal: null })
        return
      }
      const combo = comboOf(e)
      if (!combo) return
      const id = Object.keys(st.shortcuts).find((k) => st.shortcuts[k] === combo)
      if (id && COMMANDS[id]) {
        e.preventDefault()
        e.stopPropagation()
        COMMANDS[id]()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => {
      clearInterval(iv)
      window.removeEventListener('keydown', key, true)
    }
  }, [])

  // título da aba mostra o timer em andamento
  const running = useStore((s) => s.pomo.running)
  const remSec = useStore((s) => Math.ceil(pomoRemaining(s.pomo) / 1000))
  useEffect(() => {
    document.title = running ? `${fmtTime(remSec)} · Notepad Everywhere` : 'Notepad Everywhere'
  }, [running, remSec])

  if (!ready) return <div className="h-full flex items-center justify-center text-muted">Carregando seu caderno…</div>

  return (
    <div className={'h-full flex ' + (study ? 'study ' : '') + (spotlight ? 'spotlight' : '')}>
      {!zen && leftOpen && <Sidebar />}
      <main className="flex-1 min-w-0 flex flex-col">
        {view === 'graph' && !zen ? (
          <Suspense fallback={<div className="flex-1" />}>
            <GraphView />
          </Suspense>
        ) : node ? (
          <>
            <PageHeader node={node} />
            {node.mode === 'canvas' ? <CanvasView key={node.id + ':' + contentRev} node={node} /> : <Editor key={node.id + ':' + contentRev} node={node} footer={<Backlinks node={node} />} />}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted">
            <div className="text-4xl">🍒</div>
            Nenhuma página. Crie um caderno para começar.
            <button className="btn btn-accent" onClick={() => actions.createNode(null, 'notebook', 'Meu caderno')}>
              Novo caderno
            </button>
          </div>
        )}
      </main>
      {!zen && rightOpen && <Inspector />}
      {zen && <MiniPomodoro />}
      {ruler && <ReadingRuler />}
      <MediaModal />
      <PopupLayer />
      <TermDialog />
      <Suspense fallback={null}>
        {backupOpen && <BackupDialog />}
        {shortcutsOpen && <ShortcutsDialog />}
        {notifyOpen && <NotifyDialog />}
        {printOpen && <PrintDialog />}
      </Suspense>
      <UpdateBanner />
      <TrashDialog />
      <HistoryDialog />
      <WelcomeDialog />
      <CommandPalette />
    </div>
  )
}

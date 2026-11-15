import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Brain, CloudRain, Eye, EyeOff, GraduationCap, Pause, Pencil, Play, Plus, RotateCcw, Settings2, SkipForward, Timer, Waves, AudioLines } from 'lucide-react'
import { actions, PHASE_LABEL, phaseMs, pomoRemaining, useStore, type Phase } from '../store'
import { findTerms } from '../lib/matcher'
import { cardLevel, MASTERY_COLOR, MASTERY_LABEL } from '../lib/srs'
import { fmtDate, fmtTime, stripHtml } from '../lib/util'
import { RichHtml } from './Rich'
import { MasteryDot, RateButtons } from './Popups'
import type { SoundId } from '../lib/audio'

/* ============================================================
   Aba Glossário & Revisão
   ============================================================ */
function ReviewSession({ ids, onExit }: { ids: string[]; onExit: () => void }) {
  const cards = useStore((s) => s.cards)
  const nodes = useStore((s) => s.nodes)
  const [queue, setQueue] = useState(ids)
  const [show, setShow] = useState(false)
  const [done, setDone] = useState(0)
  const card = cards[queue[0]]
  if (!card)
    return (
      <div className="text-center py-8 px-4">
        <div className="text-3xl mb-2">🎉</div>
        <div className="font-semibold">Revisão concluída</div>
        <div className="text-muted text-xs mt-1">{done} cartões avaliados. O mapa de calor da árvore foi atualizado.</div>
        <button className="btn btn-accent mt-4" onClick={onExit}>
          Voltar ao glossário
        </button>
      </div>
    )
  const page = card.pageId ? nodes[card.pageId] : null
  return (
    <div className="p-3 flex flex-col gap-3">
      <div className="flex items-center text-xs text-muted">
        <span>
          Cartão {done + 1} de {done + queue.length}
        </span>
        <button className="ml-auto hover:text-fg" onClick={onExit}>
          encerrar
        </button>
      </div>
      <div className="h-1 rounded bg-panel2 overflow-hidden">
        <div className="h-full bg-accent transition-all" style={{ width: `${(done / (done + queue.length)) * 100}%` }} />
      </div>
      <div className="rounded-xl border border-line bg-panel2/50 p-4 min-h-[150px] flex flex-col gap-3">
        <div className="text-[10px] uppercase tracking-wider text-muted flex items-center gap-1.5">
          {card.type === 'term' ? <BookOpen size={11} /> : <EyeOff size={11} />}
          {card.type === 'term' ? 'Defina o conceito' : 'Complete a lacuna'}
          {page && (
            <a data-page-id={page.id} className="page-link ml-auto normal-case tracking-normal">
              {page.icon} {page.title}
            </a>
          )}
        </div>
        <div className={card.type === 'term' ? 'text-lg font-semibold' : 'text-[14px] leading-relaxed'}>{card.front}</div>
        {show ? (
          <div className="border-t border-line pt-3">{card.type === 'term' ? <RichHtml html={card.back} exclude={card.refId} className="text-[13.5px]" /> : <div className="text-base font-semibold text-accent">{card.back}</div>}</div>
        ) : (
          <button className="btn btn-accent self-center mt-auto" onClick={() => setShow(true)}>
            <Eye size={13} /> Mostrar resposta
          </button>
        )}
      </div>
      {show && (
        <RateButtons
          cardId={card.id}
          onRated={() => {
            setShow(false)
            setDone((d) => d + 1)
            setQueue((q) => q.slice(1))
          }}
        />
      )}
    </div>
  )
}

function GlossaryTab() {
  const node = useStore((s) => (s.currentId ? s.nodes[s.currentId] : null))
  const terms = useStore((s) => s.terms)
  const cards = useStore((s) => s.cards)
  const termsVersion = useStore((s) => s.termsVersion)
  const [recall, setRecall] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [review, setReview] = useState<string[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [q, setQ] = useState('')
  // uma notificação clicada pede para revisar cartões específicos agora
  const reviewRequest = useStore((s) => s.reviewRequest)
  useEffect(() => {
    if (reviewRequest?.length) {
      setReview(reviewRequest.filter((id) => useStore.getState().cards[id]))
      useStore.setState({ reviewRequest: null })
    }
  }, [reviewRequest])

  const pageTermIds = useMemo(() => {
    if (!node) return []
    const ids = new Set(node.termIds)
    findTerms(node.text).forEach((m) => ids.add(m.termId))
    return [...ids].filter((id) => terms[id])
    // eslint-disable-next-line
  }, [node?.text, node?.termIds, termsVersion])

  const now = Date.now()
  const all = Object.values(cards)
  const dueAll = all.filter((c) => c.due <= now).sort((a, b) => a.due - b.due)
  const duePage = node ? dueAll.filter((c) => (c.type === 'cloze' && c.pageId === node.id) || (c.type === 'term' && pageTermIds.includes(c.refId))) : []
  const counts = [0, 1, 2].map((l) => all.filter((c) => cardLevel(c) === l).length)

  if (review) return <ReviewSession ids={review} onExit={() => setReview(null)} />

  const list = showAll ? Object.values(terms).filter((t) => !q || t.term.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.term.localeCompare(b.term)) : pageTermIds.map((id) => terms[id])

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="p-3 border-b border-line flex flex-col gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <GraduationCap size={15} className="text-accent" />
          <span className="font-semibold text-[13px]">Fila de Repetição Espaçada</span>
        </div>
        <div className="flex h-2 rounded-full overflow-hidden bg-panel2" title="Distribuição de domínio de todos os cartões">
          {counts.map((c, i) => (
            <div key={i} style={{ width: `${(c / Math.max(1, all.length)) * 100}%`, background: MASTERY_COLOR[i] }} title={`${MASTERY_LABEL[i]}: ${c}`} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button className={'btn !justify-center ' + (duePage.length ? 'btn-accent' : 'opacity-60')} disabled={!duePage.length} onClick={() => setReview(duePage.map((c) => c.id))}>
            Esta página ({duePage.length})
          </button>
          <button className={'btn !justify-center ' + (dueAll.length ? '' : 'opacity-60')} disabled={!dueAll.length} onClick={() => setReview(dueAll.map((c) => c.id))}>
            Tudo ({dueAll.length})
          </button>
        </div>
        <div className="text-[11px] text-muted">
          {all.length} cartões · {all.filter((c) => c.type === 'cloze').length} lacunas · {all.filter((c) => c.type === 'term').length} termos
        </div>
      </div>
      <div className="px-3 pt-2.5 pb-1.5 flex items-center gap-1.5 shrink-0">
        <div className="flex rounded-md border border-line overflow-hidden text-xs">
          <button className={'px-2 py-1 ' + (!showAll ? 'bg-panel2 text-fg' : 'text-muted')} onClick={() => setShowAll(false)}>
            Nesta página ({pageTermIds.length})
          </button>
          <button className={'px-2 py-1 ' + (showAll ? 'bg-panel2 text-fg' : 'text-muted')} onClick={() => setShowAll(true)}>
            Global ({Object.keys(terms).length})
          </button>
        </div>
        <span className="flex-1" />
        <button className={'icon-btn ' + (recall ? 'on' : '')} title="Active Recall: oculta as definições para testar a memória" onClick={() => (setRecall(!recall), setRevealed({}))}>
          <Brain size={15} />
        </button>
        <button className="icon-btn" title="Novo termo" onClick={() => useStore.setState({ termDialog: { text: '' } })}>
          <Plus size={15} />
        </button>
      </div>
      {showAll && (
        <div className="px-3 pb-1.5 shrink-0">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar glossário…" className="w-full text-[13px]" />
        </div>
      )}
      {recall && <div className="mx-3 mb-1.5 text-[11px] text-accent bg-accent/10 rounded-md px-2 py-1 shrink-0">Active Recall ligado: tente lembrar e clique para revelar.</div>}
      <div className="flex-1 overflow-auto px-3 pb-3 flex flex-col gap-1.5">
        {!list.length && <div className="text-muted text-xs py-6 text-center">Nenhum termo {showAll ? 'no glossário' : 'nesta página'} ainda. Selecione um texto na nota e clique em “+ Adicionar Significado”.</div>}
        {list.map((t) => {
          const hidden = recall && !revealed[t.id]
          return (
            <div key={t.id} className="rounded-lg border border-line bg-panel2/40 p-2.5 group">
              <div className="flex items-center gap-1.5">
                <MasteryDot level={cardLevel(cards['term:' + t.id])} />
                <span className="font-semibold text-[13px] gloss-auto" data-term-id={hidden ? undefined : t.id}>
                  {t.term}
                </span>
                <span className="flex-1" />
                <button className="icon-btn !w-6 !h-6 opacity-0 group-hover:opacity-100" title="Editar" onClick={() => useStore.setState({ termDialog: { text: t.term, termId: t.id } })}>
                  <Pencil size={12} />
                </button>
              </div>
              {hidden ? (
                <button className="mt-1.5 w-full rounded-md border border-dashed border-line py-2 text-xs text-muted hover:text-fg hover:border-accent" onClick={() => setRevealed({ ...revealed, [t.id]: true })}>
                  <EyeOff size={12} className="inline mr-1" /> definição oculta — clique para revelar
                </button>
              ) : (
                <>
                  <div className="text-[12.5px] text-fg/80 mt-1 line-clamp-3">{stripHtml(t.html)}</div>
                  {recall && (
                    <div className="mt-2">
                      <RateButtons cardId={'term:' + t.id} onRated={() => setRevealed({ ...revealed, [t.id]: false })} />
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ============================================================
   Aba Pomodoro & Foco
   ============================================================ */
export function PomoRing({ size = 170 }: { size?: number }) {
  const p = useStore((s) => s.pomo)
  const rem = pomoRemaining(p)
  const frac = 1 - rem / phaseMs(p, p.phase)
  const r = size / 2 - 8
  const c = 2 * Math.PI * r
  const color = p.phase === 'focus' ? 'var(--accent)' : '#22c55e'
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel2)" strokeWidth={7} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} style={{ transition: 'stroke-dashoffset .5s linear' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[34px] font-semibold tabular-nums leading-none">{fmtTime(Math.ceil(rem / 1000))}</div>
        <div className="text-xs mt-1" style={{ color }}>
          {PHASE_LABEL[p.phase]}
        </div>
      </div>
    </div>
  )
}

const SOUNDS: [SoundId, string, string, any][] = [
  ['brown', 'Ruído marrom', 'grave e constante, mascara distrações', Waves],
  ['rain', 'Chuva', 'ruído filtrado com rajadas suaves', CloudRain],
  ['binaural', 'Binaural 40 Hz', 'use fones de ouvido (200 Hz / 240 Hz)', AudioLines],
]

function PomodoroTab() {
  const p = useStore((s) => s.pomo)
  const sessions = useStore((s) => s.sessions)
  const sound = useStore((s) => s.sound)
  const page = useStore((s) => (s.currentId ? s.nodes[s.currentId] : null))
  const [cfg, setCfg] = useState(false)
  const today = new Date().toDateString()
  const todayFocus = sessions.filter((s) => s.kind === 'focus' && new Date(s.start).toDateString() === today)
  const minutes = Math.round(todayFocus.reduce((a, s) => a + s.seconds, 0) / 60)
  const num = (label: string, key: 'focusMin' | 'shortMin' | 'longMin' | 'longEvery', unit = 'min') => (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="flex-1">{label}</span>
      <input type="number" min={1} max={180} value={p[key]} onChange={(e) => actions.pomoConfig({ [key]: Math.max(1, Number(e.target.value) || 1) })} className="w-16 text-right !text-fg" />
      <span className="w-6">{unit}</span>
    </label>
  )
  return (
    <div className="flex-1 overflow-auto p-3 flex flex-col gap-4">
      <div className="flex flex-col items-center gap-3">
        <div className="flex rounded-md border border-line overflow-hidden text-xs">
          {(['focus', 'short', 'long'] as Phase[]).map((ph) => (
            <button key={ph} className={'px-2.5 py-1 ' + (p.phase === ph ? 'bg-panel2 text-fg' : 'text-muted')} onClick={() => actions.pomoSetPhase(ph)}>
              {PHASE_LABEL[ph]}
            </button>
          ))}
        </div>
        <PomoRing />
        <div className="flex items-center gap-2">
          <button className="icon-btn" title="Reiniciar" onClick={actions.pomoReset}>
            <RotateCcw size={16} />
          </button>
          <button className="btn btn-accent !px-5 !py-2 !text-sm" onClick={p.running ? actions.pomoPause : actions.pomoStart}>
            {p.running ? <Pause size={15} /> : <Play size={15} />} {p.running ? 'Pausar' : 'Iniciar'}
          </button>
          <button className="icon-btn" title="Pular para a próxima fase" onClick={() => actions.pomoFinish(false)}>
            <SkipForward size={16} />
          </button>
          <button className={'icon-btn ' + (cfg ? 'on' : '')} title="Configurar durações" onClick={() => setCfg(!cfg)}>
            <Settings2 size={16} />
          </button>
        </div>
        <div className="flex items-center gap-1.5" title="Ciclos de foco concluídos hoje">
          {Array.from({ length: p.longEvery }, (_, i) => (
            <span key={i} className="w-3 h-3 rounded-full border border-accent" style={{ background: i < (p.cycles % p.longEvery || (p.cycles && p.phase === 'long' ? p.longEvery : 0)) ? 'var(--accent)' : 'transparent' }} />
          ))}
          <span className="text-xs text-muted ml-1.5">
            {p.cycles} ciclo{p.cycles === 1 ? '' : 's'} hoje · {minutes} min de foco
          </span>
        </div>
        <div className="text-xs text-muted text-center">
          Estudando: <span className="text-fg">{page ? `${page.icon} ${page.title}` : '—'}</span>
        </div>
      </div>
      {cfg && (
        <div className="rounded-lg border border-line p-3 flex flex-col gap-2">
          {num('Foco', 'focusMin')}
          {num('Pausa curta', 'shortMin')}
          {num('Pausa longa', 'longMin')}
          {num('Pausa longa a cada', 'longEvery', 'cic.')}
        </div>
      )}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted mb-2">Soundscapes (Web Audio)</div>
        <div className="flex flex-col gap-2">
          {SOUNDS.map(([id, label, hint, Icon]) => {
            const v = sound[id]
            return (
              <div key={id} className="flex items-center gap-2">
                <button className={'icon-btn ' + (v > 0 ? 'on' : '')} title={v > 0 ? 'Desligar' : 'Ligar'} onClick={() => actions.setSound(id, v > 0 ? 0 : 0.35)}>
                  <Icon size={16} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] leading-tight">{label}</div>
                  <div className="text-[10.5px] text-muted truncate">{hint}</div>
                </div>
                <input type="range" min={0} max={1} step={0.01} value={v} onChange={(e) => actions.setSound(id, Number(e.target.value))} className="w-24" />
              </div>
            )
          })}
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted mb-2">Sessões registradas</div>
        <div className="flex flex-col gap-1">
          {!sessions.length && <div className="text-xs text-muted">Nenhuma sessão ainda.</div>}
          {[...sessions]
            .reverse()
            .slice(0, 30)
            .map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-xs rounded-md px-2 py-1.5 bg-panel2/50">
                <span className="w-1.5 h-6 rounded-full shrink-0" style={{ background: s.kind === 'focus' ? 'var(--accent)' : '#22c55e', opacity: s.completed ? 1 : 0.4 }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{s.pageId ? <a data-page-id={s.pageId} className="page-link !border-0 !text-fg">{s.pageTitle}</a> : s.pageTitle}</div>
                  <div className="text-muted text-[10.5px]">
                    {PHASE_LABEL[s.kind]} · {fmtDate(s.start)}
                    {!s.completed && ' · interrompida'}
                  </div>
                </div>
                <span className="tabular-nums text-muted">{Math.max(1, Math.round(s.seconds / 60))} min</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

export function Inspector() {
  const tab = useStore((s) => s.rightTab)
  const running = useStore((s) => s.pomo.running)
  const rem = useStore((s) => pomoRemaining(s.pomo))
  const T = ({ id, icon, label }: { id: 'glossary' | 'pomodoro'; icon: React.ReactNode; label: string }) => (
    <button className={'flex-1 h-11 flex items-center justify-center gap-1.5 text-[12.5px] border-b-2 ' + (tab === id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')} onClick={() => useStore.setState({ rightTab: id })}>
      {icon} {label}
    </button>
  )
  return (
    <aside className="w-[320px] shrink-0 border-l border-line bg-panel flex flex-col min-h-0">
      <div className="flex border-b border-line shrink-0">
        <T id="glossary" icon={<BookOpen size={14} />} label="Glossário & Revisão" />
        <T id="pomodoro" icon={<Timer size={14} />} label={running && tab !== 'pomodoro' ? fmtTime(Math.ceil(rem / 1000)) : 'Pomodoro & Foco'} />
      </div>
      {tab === 'glossary' ? <GlossaryTab /> : <PomodoroTab />}
    </aside>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { nativeApp, type AppConfig } from '../lib/print'
import { Bell, BellRing, Brain, Plus, Trash2, X } from 'lucide-react'
import { actions, useStore, type Reminder } from '../store'
import { fireReminder, notify, notifySupported, pickQuizCard, quizText, sendQuiz } from '../lib/notify'
import { uid } from '../lib/util'

const REPEAT_LABEL: Record<Reminder['repeat'], string> = { daily: 'Todo dia', weekdays: 'Dias úteis', once: 'Uma vez' }

/** Notificações: lembretes próprios, perguntas baseadas no estudo e avisos automáticos. */
export function NotifyDialog() {
  const open = useStore((s) => s.notifyOpen)
  const prefs = useStore((s) => s.notify)
  const reminders = useStore((s) => s.reminders)
  const nodes = useStore((s) => s.nodes)
  const cards = useStore((s) => s.cards)
  const [msg, setMsg] = useState('')
  const [text, setText] = useState('')
  const [time, setTime] = useState('19:00')
  const [repeat, setRepeat] = useState<Reminder['repeat']>('daily')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [pageId, setPageId] = useState('')
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  useEffect(() => {
    if (open) nativeApp?.getConfig().then(setCfg)
  }, [open])
  const pages = useMemo(() => Object.values(nodes).sort((a, b) => a.title.localeCompare(b.title)), [nodes])
  if (!open) return null
  const close = () => useStore.setState({ notifyOpen: false })
  const total = Object.keys(cards).length
  const due = Object.values(cards).filter((c) => c.due <= Date.now()).length

  const add = () => {
    if (!text.trim()) return setMsg('Escreva o texto do lembrete.')
    actions.setReminders([...reminders, { id: uid(), text: text.trim(), time, repeat, date: repeat === 'once' ? date : undefined, pageId: pageId || null, enabled: true }])
    setText('')
    setMsg('Lembrete criado.')
  }
  const patch = (id: string, p: Partial<Reminder>) => actions.setReminders(reminders.map((r) => (r.id === id ? { ...r, ...p } : r)))
  const Toggle = ({ k, label, hint }: { k: 'pomo' | 'review' | 'backup'; label: string; hint: string }) => (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input type="checkbox" checked={prefs[k]} onChange={(e) => actions.setNotify({ [k]: e.target.checked })} className="mt-0.5 accent-[var(--accent)]" />
      <span className="text-[13px]">
        {label}
        <span className="block text-[11.5px] text-muted">{hint}</span>
      </span>
    </label>
  )
  const Head = ({ children }: { children: React.ReactNode }) => <div className="text-[10px] uppercase tracking-wider text-muted">{children}</div>
  const preview = pickQuizCard()

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-start justify-center pt-[6vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="pop w-[600px] max-w-[94vw] max-h-[90vh] overflow-auto p-4 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Bell size={18} className="text-accent" />
          <div className="font-semibold text-[15px]">Notificações na área de trabalho</div>
          <button className="icon-btn ml-auto" onClick={close}>
            <X size={15} />
          </button>
        </div>
        {!notifySupported() && <div className="text-[12.5px] rounded-md px-3 py-2 bg-amber-500/10 border border-amber-500/40">Este ambiente não oferece notificações do sistema.</div>}

        {/* ---------- Meus lembretes ---------- */}
        <div className="flex flex-col gap-2">
          <Head>Meus lembretes</Head>
          {!reminders.length && <div className="text-xs text-muted">Nenhum lembrete ainda. Crie um abaixo — por exemplo “Revisar anatomia” todo dia às 19:00.</div>}
          {reminders.map((r) => (
            <div key={r.id} className={'flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 ' + (r.enabled ? '' : 'opacity-50')}>
              <input type="checkbox" checked={r.enabled} title="Ligar / desligar" onChange={(e) => patch(r.id, { enabled: e.target.checked, lastFired: undefined })} className="accent-[var(--accent)]" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] truncate">{r.text}</div>
                <div className="text-[11px] text-muted truncate">
                  {r.time} · {REPEAT_LABEL[r.repeat]}
                  {r.repeat === 'once' && r.date ? ` (${r.date.split('-').reverse().join('/')})` : ''}
                  {r.pageId && nodes[r.pageId] ? ` · abre ${nodes[r.pageId].icon} ${nodes[r.pageId].title}` : ''}
                </div>
              </div>
              <input type="time" value={r.time} title="Mudar o horário" onChange={(e) => patch(r.id, { time: e.target.value, lastFired: undefined })} className="!py-0.5 text-xs" />
              <button className="icon-btn" title="Testar este lembrete agora" onClick={() => fireReminder(r)}>
                <BellRing size={14} />
              </button>
              <button className="icon-btn" title="Excluir lembrete" onClick={() => actions.setReminders(reminders.filter((x) => x.id !== r.id))}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <div className="rounded-lg border border-dashed border-line p-2.5 flex flex-col gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Texto do lembrete (ex.: Revisar o capítulo 3)" className="text-[13px]" />
            <div className="flex items-center gap-2 flex-wrap">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="text-xs" />
              <select value={repeat} onChange={(e) => setRepeat(e.target.value as Reminder['repeat'])} className="text-xs">
                <option value="daily">Todo dia</option>
                <option value="weekdays">Dias úteis</option>
                <option value="once">Uma vez</option>
              </select>
              {repeat === 'once' && <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="text-xs" />}
              <select value={pageId} onChange={(e) => setPageId(e.target.value)} className="text-xs flex-1 min-w-[140px]" title="Página que abre ao clicar na notificação">
                <option value="">Sem página vinculada</option>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.icon} {p.title}
                  </option>
                ))}
              </select>
              <button className="btn btn-accent" onClick={add}>
                <Plus size={13} /> Criar lembrete
              </button>
            </div>
          </div>
        </div>

        {/* ---------- Com base no que estou aprendendo ---------- */}
        <div className="flex flex-col gap-2">
          <Head>Com base no que estou aprendendo</Head>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={prefs.quiz} onChange={(e) => actions.setNotify({ quiz: e.target.checked })} className="mt-0.5 accent-[var(--accent)]" />
            <span className="text-[13px]">
              Perguntas de revisão
              <span className="block text-[11.5px] text-muted">De tempos em tempos chega uma pergunta tirada do seu glossário e das suas lacunas. Clicar na notificação abre o cartão para conferir e avaliar.</span>
            </span>
          </label>
          <div className={'flex items-center gap-2 flex-wrap pl-6 text-[13px] ' + (prefs.quiz ? '' : 'opacity-50')}>
            <span>A cada</span>
            <select value={prefs.quizEvery} onChange={(e) => actions.setNotify({ quizEvery: Number(e.target.value) })} className="text-xs">
              {[
                [15, '15 min'],
                [30, '30 min'],
                [60, '1 hora'],
                [120, '2 horas'],
                [240, '4 horas'],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <span>usando</span>
            <select value={prefs.quizSource} onChange={(e) => actions.setNotify({ quizSource: e.target.value as 'due' | 'all' })} className="text-xs">
              <option value="due">só o que está vencido para revisão</option>
              <option value="all">os vencidos e, na falta, qualquer cartão</option>
            </select>
            <button
              className="btn"
              onClick={async () => {
                const ok = await sendQuiz()
                setMsg(ok ? 'Pergunta enviada — clique na notificação para abrir o cartão.' : total ? 'Não há cartões vencidos agora. Troque para “qualquer cartão” ou espere a próxima revisão.' : 'Você ainda não tem termos nem lacunas. Crie alguns nas notas primeiro.')
              }}
            >
              <Brain size={13} /> Enviar uma agora
            </button>
          </div>
          <div className="pl-6 text-[11.5px] text-muted">
            {total} cartões no total · {due} vencidos agora
            {preview && (
              <>
                {' '}
                · exemplo: <span className="text-fg">{quizText(preview).body.split('\n')[0]}</span>
              </>
            )}
          </div>
        </div>

        {/* ---------- Avisos automáticos ---------- */}
        <div className="flex flex-col gap-2">
          <Head>Avisos automáticos</Head>
          <Toggle k="pomo" label="Pomodoro" hint="Avisa quando o tempo de foco ou a pausa terminam." />
          <Toggle k="review" label="Resumo de revisão" hint="Avisa ao abrir o app (e a cada 2 horas) quantos cartões estão vencidos." />
          <Toggle k="backup" label="Falha de backup" hint="Avisa se o backup automático não conseguir gravar na pasta conectada." />
        </div>

        {/* ---------- Segundo plano ---------- */}
        {nativeApp && cfg && (
          <div className="flex flex-col gap-2">
            <Head>Com a janela fechada</Head>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={cfg.background} onChange={async (e) => setCfg(await nativeApp!.setConfig({ background: e.target.checked }))} className="mt-0.5 accent-[var(--accent)]" />
              <span className="text-[13px]">
                Continuar em segundo plano ao fechar a janela
                <span className="block text-[11.5px] text-muted">O app fica num ícone ao lado do relógio e os lembretes e o Pomodoro continuam avisando. Para encerrar de vez: botão direito no ícone → Sair.</span>
              </span>
            </label>
            <label className={'flex items-start gap-2.5 cursor-pointer ' + (cfg.background ? '' : 'opacity-50')}>
              <input type="checkbox" checked={cfg.startup} disabled={!cfg.background} onChange={async (e) => setCfg(await nativeApp!.setConfig({ startup: e.target.checked }))} className="mt-0.5 accent-[var(--accent)]" />
              <span className="text-[13px]">
                Iniciar junto com o Windows (direto na bandeja)
                <span className="block text-[11.5px] text-muted">Assim os lembretes funcionam mesmo sem você abrir o app.</span>
              </span>
            </label>
          </div>
        )}
        <div className="text-[11.5px] text-muted">
          {cfg?.background ? 'Com o segundo plano ligado, as notificações chegam mesmo com a janela fechada.' : 'Sem o segundo plano, as notificações só chegam com o app aberto (pode estar minimizado).'} Um lembrete cujo horário passou com o app encerrado aparece assim que você abrir, no mesmo dia.
        </div>
        {msg && <div className="text-[12.5px] rounded-md px-3 py-2 bg-panel2 border border-line">{msg}</div>}
        <div className="flex items-center gap-2">
          <button
            className="btn"
            onClick={async () => {
              const ok = await notify('Notepad Everywhere', 'As notificações estão funcionando. 🔔')
              setMsg(ok ? 'Notificação de teste enviada. Se não apareceu, veja se o “Não incomodar” do Windows está ligado.' : 'O sistema bloqueou as notificações deste app. Libere em Configurações do Windows → Sistema → Notificações.')
            }}
          >
            <BellRing size={13} /> Testar notificação
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

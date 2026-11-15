import { actions, useStore, type Reminder } from '../store'
import type { Card } from '../db'
import { stripHtml } from './util'

/* Notificações na área de trabalho (API Notification — no app instalado viram avisos do Windows). */

export function notifySupported() {
  return typeof Notification !== 'undefined'
}

export async function ensurePermission(): Promise<boolean> {
  if (!notifySupported()) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  return (await Notification.requestPermission()) === 'granted'
}

export async function notify(title: string, body: string, onClick?: () => void): Promise<boolean> {
  if (!(await ensurePermission())) return false
  try {
    const n = new Notification(title, { body, icon: './icon.png', silent: false })
    n.onclick = () => {
      ;(window as any).nativeApp?.show?.() // traz a janela de volta se estiver na bandeja
      window.focus()
      onClick?.()
      n.close()
    }
    return true
  } catch {
    return false
  }
}

const dueCards = () => {
  const now = Date.now()
  return Object.values(useStore.getState().cards).filter((c) => c.due <= now)
}
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ---------- Lembretes criados pelo usuário ---------- */

/** Um lembrete deve disparar agora? (dispara atrasado se o app foi aberto depois do horário, no mesmo dia) */
export function reminderDue(r: Reminder, now = new Date()): boolean {
  if (!r.enabled || !r.text.trim()) return false
  const day = today()
  if (r.lastFired === day) return false
  if (r.repeat === 'once' && r.date !== day) return false
  if (r.repeat === 'weekdays' && (now.getDay() === 0 || now.getDay() === 6)) return false
  const [h, m] = r.time.split(':').map(Number)
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m
}

export function fireReminder(r: Reminder) {
  const page = r.pageId ? useStore.getState().nodes[r.pageId] : null
  return notify('Lembrete', r.text + (page ? `\n${page.icon} ${page.title}` : ''), () => page && actions.select(page.id))
}

function checkReminders() {
  const list = useStore.getState().reminders
  let changed = false
  const next = list.map((r) => {
    if (!reminderDue(r)) return r
    fireReminder(r)
    changed = true
    return { ...r, lastFired: today(), enabled: r.repeat === 'once' ? false : r.enabled }
  })
  if (changed) actions.setReminders(next)
}

/* ---------- Perguntas tiradas do que o usuário está aprendendo ---------- */

/** Escolhe um cartão para perguntar: primeiro os vencidos; se não houver (e a fonte for "all"), qualquer um. */
export function pickQuizCard(): Card | null {
  const { cards, notify: prefs } = useStore.getState()
  let pool = dueCards()
  if (!pool.length && prefs.quizSource === 'all') pool = Object.values(cards)
  if (!pool.length) return null
  return pool[Math.floor(Math.random() * pool.length)]
}

export function quizText(c: Card): { title: string; body: string } {
  if (c.type === 'term') return { title: 'Você lembra?', body: `O que é “${c.front}”?\nClique para conferir a resposta.` }
  return { title: 'Complete a lacuna', body: stripHtml(c.front).slice(0, 180) + '\nClique para conferir.' }
}

export function sendQuiz(): Promise<boolean> | false {
  const c = pickQuizCard()
  if (!c) return false
  const { title, body } = quizText(c)
  return notify(title, body, () => useStore.setState({ rightTab: 'glossary', rightOpen: true, zen: false, reviewRequest: [c.id] }))
}

export function initNotifications() {
  // 1) Pomodoro: fim de cada fase (quando o timer chega a zero)
  useStore.subscribe((s, p) => {
    if (!s.notify.pomo || !p.pomo.running || s.pomo.running) return
    if (s.pomo.phase === p.pomo.phase) return // pausa manual
    if (p.pomo.endsAt - Date.now() > 1500) return // fase pulada à mão
    const open = () => useStore.setState({ rightTab: 'pomodoro', rightOpen: true, zen: false })
    if (p.pomo.phase === 'focus') notify('Foco concluído 🎉', s.pomo.phase === 'long' ? `Hora da pausa longa (${s.pomo.longMin} min).` : `Hora de uma pausa curta (${s.pomo.shortMin} min).`, open)
    else notify('Pausa encerrada', `Pronto para mais ${s.pomo.focusMin} min de foco?`, open)
  })

  // 2) Backup: avisa quando falha
  useStore.subscribe((s, p) => {
    if (s.notify.backup && s.backupStatus === 'error' && p.backupStatus !== 'error') notify('Backup não foi salvo', 'Abra o Notepad Everywhere e confira a pasta de backup.', () => useStore.setState({ backupOpen: true }))
  })

  // 3) Revisões: lembra quando há cartões vencidos (ao abrir e depois a cada 2 h, só se o número aumentou)
  let lastNotified = 0
  const checkDue = () => {
    if (!useStore.getState().notify.review) return
    const n = dueCards().length
    if (n > 0 && n > lastNotified) notify('Revisão pendente', `${n} ${n > 1 ? 'cartões' : 'cartão'} para revisar hoje.`, () => useStore.setState({ rightTab: 'glossary', rightOpen: true, zen: false, reviewRequest: dueCards().map((c) => c.id) }))
    lastNotified = n
  }
  setTimeout(checkDue, 8000)
  setInterval(checkDue, 2 * 3600 * 1000)

  // 4) Lembretes do usuário: confere a cada 20 s
  setTimeout(checkReminders, 5000)
  setInterval(checkReminders, 20000)

  // 5) Perguntas de revisão no intervalo escolhido
  let lastQuiz = Date.now()
  setInterval(() => {
    const p = useStore.getState().notify
    if (!p.quiz || Date.now() - lastQuiz < p.quizEvery * 60000) return
    lastQuiz = Date.now()
    sendQuiz()
  }, 30000)
}

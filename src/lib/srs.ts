import type { Card, Mastery } from '../db'

export type Rating = 'hard' | 'good' | 'easy'
const DAY = 86400000

export function newCard(partial: Pick<Card, 'id' | 'type' | 'refId' | 'pageId' | 'front' | 'back'>): Card {
  return { ...partial, due: Date.now(), interval: 0, ease: 2.5, reps: 0, lapses: 0, last: 0 }
}

/** Próximo intervalo (dias) para cada avaliação — SM-2 simplificado. */
export function nextInterval(c: Card, r: Rating): number {
  if (r === 'hard') return c.reps === 0 ? 0.007 /* ~10 min */ : Math.max(1, Math.round(c.interval * 1.2))
  if (r === 'good') return c.reps === 0 ? 1 : c.reps === 1 ? 3 : Math.round(c.interval * c.ease)
  return c.reps === 0 ? 4 : Math.round(Math.max(c.interval, 1) * c.ease * 1.3)
}

export function rate(c: Card, r: Rating): Card {
  const interval = nextInterval(c, r)
  const ease = Math.max(1.3, c.ease + (r === 'hard' ? -0.15 : r === 'easy' ? 0.15 : 0))
  return {
    ...c,
    interval,
    ease,
    reps: r === 'hard' && c.reps === 0 ? 0 : c.reps + 1,
    lapses: c.lapses + (r === 'hard' ? 1 : 0),
    last: Date.now(),
    due: Date.now() + interval * DAY,
  }
}

export function cardLevel(c: Card | undefined): Mastery {
  if (!c || (c.reps === 0 && c.last === 0)) return 0
  if (c.interval >= 21) return 2
  return 1
}

export function fmtInterval(days: number) {
  if (days < 1) return `${Math.max(1, Math.round(days * 1440))} min`
  if (days < 30) return `${Math.round(days)} d`
  if (days < 365) return `${(days / 30).toFixed(1)} m`
  return `${(days / 365).toFixed(1)} a`
}

export const MASTERY_COLOR = ['#ef4444', '#eab308', '#22c55e']
export const MASTERY_LABEL = ['Novo / não revisado', 'Em aprendizagem', 'Dominado']

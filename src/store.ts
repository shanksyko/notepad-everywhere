import { create } from 'zustand'
import { useEffect, useState } from 'react'
import { db, type Card, type CanvasData, type Cue, type FileMeta, type Hotspot, type Mastery, type MediaKind, type Session, type Snapshot, type Term, type TrashEntry, type TreeNode } from './db'
import { analyzeDoc } from './lib/doc'
import { setMatcherTerms } from './lib/matcher'
import { cardLevel, newCard, rate, type Rating } from './lib/srs'
import { mediaKind, stripHtml, uid } from './lib/util'
import { soundscapes, type SoundId } from './lib/audio'
import { seedDatabase } from './seed'
import { defaultShortcuts } from './lib/shortcuts'

/* ============================================================
   Estado global (Zustand) — espelho em memória do IndexedDB
   ============================================================ */

export const THEMES = [
  { id: 'dark', label: 'Escuro', bg: '#0a0c11', accent: '#f0556e' },
  { id: 'midnight', label: 'Meia-noite', bg: '#070b18', accent: '#5b8cff' },
  { id: 'nord', label: 'Nórdico', bg: '#2e3440', accent: '#88c0d0' },
  { id: 'violet', label: 'Violeta', bg: '#1b1a26', accent: '#bd93f9' },
  { id: 'forest', label: 'Floresta', bg: '#0d1512', accent: '#4ade80' },
  { id: 'contrast', label: 'Alto contraste', bg: '#000000', accent: '#ffd400' },
  { id: 'light', label: 'Claro', bg: '#f6f7f9', accent: '#d6336c' },
  { id: 'sky', label: 'Céu', bg: '#f1f6fc', accent: '#1d6fe0' },
  { id: 'rose', label: 'Rosa', bg: '#fdf4f6', accent: '#e0457b' },
  { id: 'sepia', label: 'Sépia', bg: '#f3ead6', accent: '#b4532a' },
  { id: 'solarized', label: 'Solarizado', bg: '#fdf6e3', accent: '#cb4b16' },
] as const
export type Theme = (typeof THEMES)[number]['id']
export interface NotifyPrefs {
  pomo: boolean
  review: boolean
  backup: boolean
  /** perguntas de revisão tiradas do que o usuário está estudando */
  quiz: boolean
  quizEvery: number // minutos
  quizSource: 'due' | 'all'
}
export const defaultNotify: NotifyPrefs = { pomo: true, review: true, backup: true, quiz: false, quizEvery: 60, quizSource: 'due' }
/** Lembrete criado pelo usuário. */
export interface Reminder {
  id: string
  text: string
  time: string // "HH:MM"
  repeat: 'daily' | 'weekdays' | 'once'
  date?: string // "AAAA-MM-DD" (só para repeat = once)
  pageId?: string | null
  enabled: boolean
  lastFired?: string // "AAAA-MM-DD"
}
export type Phase = 'focus' | 'short' | 'long'

export interface PinnedPop {
  key: string
  kind: 'term' | 'hotspot' | 'cloze'
  id: string
  x: number
  y: number
  edit?: boolean
}

export interface Pomo {
  focusMin: number
  shortMin: number
  longMin: number
  longEvery: number
  phase: Phase
  running: boolean
  endsAt: number
  remainingMs: number
  cycles: number
  startedAt: number
  now: number
}

export interface TermDialogState {
  text: string
  termId?: string
  onDone?: (termId: string) => void
}

export interface PaletteState {
  mode: 'commands' | 'pickPage'
  onPick?: (pageId: string) => void
}

export interface State {
  ready: boolean
  nodes: Record<string, TreeNode>
  terms: Record<string, Term>
  cards: Record<string, Card>
  hotspots: Record<string, Hotspot>
  files: Record<string, FileMeta>
  sessions: Session[]
  currentId: string | null
  view: 'page' | 'graph'
  theme: Theme
  zen: boolean
  spotlight: boolean
  ruler: boolean
  study: boolean
  leftOpen: boolean
  rightOpen: boolean
  rightTab: 'glossary' | 'pomodoro'
  palette: PaletteState | null
  termDialog: TermDialogState | null
  pinned: PinnedPop[]
  mediaFilter: MediaKind[]
  mediaModal: { fileId: string; time?: number; page?: number } | null
  pomo: Pomo
  sound: Record<SoundId, number>
  termsVersion: number
  notify: NotifyPrefs
  notifyOpen: boolean
  toast: string | null
  trash: TrashEntry[]
  trashOpen: boolean
  historyOpen: boolean
  welcomeOpen: boolean
  /** muda quando o conteúdo é trocado por fora do editor (restaurar versão) — força o editor a recarregar */
  contentRev: number
  reminders: Reminder[]
  /** cartões que uma notificação pediu para revisar agora */
  reviewRequest: string[] | null
  shortcuts: Record<string, string>
  shortcutsOpen: boolean
  printOpen: boolean
  backupOpen: boolean
  backupStatus: 'off' | 'ok' | 'saving' | 'error'
  lastBackup: number
}

const defaultPomo: Pomo = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  longEvery: 4,
  phase: 'focus',
  running: false,
  endsAt: 0,
  remainingMs: 25 * 60000,
  cycles: 0,
  startedAt: 0,
  now: Date.now(),
}

export const useStore = create<State>(() => ({
  ready: false,
  nodes: {},
  terms: {},
  cards: {},
  hotspots: {},
  files: {},
  sessions: [],
  currentId: null,
  view: 'page',
  theme: 'dark',
  zen: false,
  spotlight: false,
  ruler: false,
  study: false,
  leftOpen: true,
  rightOpen: true,
  rightTab: 'glossary',
  palette: null,
  termDialog: null,
  pinned: [],
  mediaFilter: [],
  mediaModal: null,
  pomo: defaultPomo,
  sound: { brown: 0, rain: 0, binaural: 0 },
  termsVersion: 0,
  notify: defaultNotify,
  notifyOpen: false,
  toast: null,
  trash: [],
  trashOpen: false,
  historyOpen: false,
  welcomeOpen: false,
  contentRev: 0,
  reminders: [],
  reviewRequest: null,
  shortcuts: defaultShortcuts(),
  shortcutsOpen: false,
  printOpen: false,
  backupOpen: false,
  backupStatus: 'off',
  lastBackup: 0,
}))

/** quando foi guardada a última versão de cada página (nesta sessão) */
const lastSnapAt = new Map<string, number>()
const get = useStore.getState
const set = useStore.setState
const byId = <T extends { id: string }>(arr: T[]) => Object.fromEntries(arr.map((x) => [x.id, x])) as Record<string, T>
const saveSetting = (key: string, value: any) => db.settings.put({ key, value })

/* ---------- Arquivos / blobs ---------- */
const urlCache = new Map<string, string>()
export async function getFileBlob(id: string) {
  return (await db.blobs.get(id))?.blob ?? null
}
export async function getFileUrl(id: string) {
  const key = id + ':' + (get().files[id]?.rev ?? 0)
  if (urlCache.has(key)) return urlCache.get(key)!
  const blob = await getFileBlob(id)
  if (!blob) return ''
  const u = URL.createObjectURL(blob)
  urlCache.set(key, u)
  return u
}
export function useFileUrl(id: string | null | undefined) {
  const rev = useStore((s) => (id ? s.files[id]?.rev : 0))
  const [u, setU] = useState('')
  useEffect(() => {
    let ok = true
    if (id) getFileUrl(id).then((x) => ok && setU(x))
    else setU('')
    return () => {
      ok = false
    }
  }, [id, rev])
  return u
}

/* ---------- Seletores auxiliares ---------- */
export function childrenOf(nodes: Record<string, TreeNode>, parentId: string | null) {
  return Object.values(nodes)
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.order - b.order)
}
export function pathOf(nodes: Record<string, TreeNode>, id: string) {
  const out: TreeNode[] = []
  let n: TreeNode | undefined = nodes[id]
  while (n) {
    out.unshift(n)
    n = n.parentId ? nodes[n.parentId] : undefined
  }
  return out
}
export function pageCards(node: TreeNode, cards: Record<string, Card>) {
  return Object.values(cards).filter((c) => (c.type === 'cloze' && c.pageId === node.id) || (c.type === 'term' && node.termIds.includes(c.refId)))
}
export function pageMastery(node: TreeNode, cards: Record<string, Card>): Mastery {
  if (node.masteryManual != null) return node.masteryManual
  const cs = pageCards(node, cards)
  if (!cs.length) return 0
  if (cs.every((c) => cardLevel(c) === 2)) return 2
  if (cs.some((c) => cardLevel(c) > 0)) return 1
  return 0
}

function refreshMatcher() {
  setMatcherTerms(Object.values(get().terms))
  set((s) => ({ termsVersion: s.termsVersion + 1 }))
}

/* ============================================================
   Ações
   ============================================================ */
export const actions = {
  async init() {
    // primeira execução: começa limpo, só com um caderno vazio (o caderno de exemplo é opcional, via Ctrl+K)
    if ((await db.nodes.count()) === 0) {
      const now = Date.now()
      await db.nodes.put({
        id: uid(),
        parentId: null,
        order: 0,
        kind: 'notebook',
        title: 'Meu caderno',
        icon: '📓',
        tags: [],
        collapsed: false,
        mode: 'doc',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        canvas: { items: [], strokes: [], connectors: [] },
        text: '',
        termIds: [],
        linkIds: [],
        fileIds: [],
        mediaKinds: [],
        masteryManual: null,
        createdAt: now,
        updatedAt: now,
      })
    }
    const [nodes, terms, cards, hotspots, files, sessions, settings] = await Promise.all([
      db.nodes.toArray(),
      db.terms.toArray(),
      db.cards.toArray(),
      db.hotspots.toArray(),
      db.files.toArray(),
      db.sessions.orderBy('start').toArray(),
      db.settings.toArray(),
    ])
    const cfg = Object.fromEntries(settings.map((s) => [s.key, s.value]))
    // lixeira: itens com mais de 30 dias são removidos de vez
    const limit = Date.now() - 30 * 86400000
    const allTrash = await db.trash.toArray()
    const old = allTrash.filter((t) => t.deletedAt < limit).map((t) => t.id)
    if (old.length) db.trash.bulkDelete(old)
    const trash = allTrash.filter((t) => t.deletedAt >= limit).sort((a, b) => b.deletedAt - a.deletedAt)
    const pomoCfg = cfg.pomo || {}
    const pomo = { ...defaultPomo, ...pomoCfg }
    pomo.remainingMs = pomo.focusMin * 60000
    const today = new Date().toDateString()
    pomo.cycles = sessions.filter((s) => s.kind === 'focus' && s.completed && new Date(s.start).toDateString() === today).length
    const nodeMap = byId(nodes)
    const currentId = cfg.currentId && nodeMap[cfg.currentId] ? cfg.currentId : (nodes.find((n) => !n.parentId)?.id ?? null)
    set({
      nodes: nodeMap,
      terms: byId(terms),
      cards: byId(cards),
      hotspots: byId(hotspots),
      files: byId(files),
      sessions,
      theme: cfg.theme || 'dark',
      shortcuts: { ...defaultShortcuts(), ...(cfg.shortcuts || {}) },
      notify: { ...defaultNotify, ...(cfg.notify || {}) },
      reminders: cfg.reminders || [],
      trash,
      welcomeOpen: !cfg.welcomed,
      currentId,
      pomo,
      ready: true,
    })
    document.documentElement.dataset.theme = cfg.theme || 'dark'
    refreshMatcher()
  },

  select(id: string) {
    if (!get().nodes[id]) return
    set({ currentId: id, view: 'page' })
    saveSetting('currentId', id)
    // expande ancestrais
    const nodes = { ...get().nodes }
    let p = nodes[id].parentId
    let changed = false
    while (p) {
      if (nodes[p].collapsed) {
        nodes[p] = { ...nodes[p], collapsed: false }
        db.nodes.put(nodes[p])
        changed = true
      }
      p = nodes[p].parentId
    }
    if (changed) set({ nodes })
  },

  setNotify(patch: Partial<NotifyPrefs>) {
    const notify = { ...get().notify, ...patch }
    set({ notify })
    saveSetting('notify', notify)
  },

  closeWelcome() {
    set({ welcomeOpen: false })
    saveSetting('welcomed', true)
  },

  setReminders(reminders: Reminder[]) {
    set({ reminders })
    saveSetting('reminders', reminders)
  },

  setShortcuts(shortcuts: Record<string, string>) {
    set({ shortcuts })
    saveSetting('shortcuts', shortcuts)
  },

  setTheme(theme: Theme) {
    set({ theme })
    document.documentElement.dataset.theme = theme
    saveSetting('theme', theme)
  },

  /* ---------- Árvore ---------- */
  createNode(parentId: string | null, kind: TreeNode['kind'] = 'page', title = 'Nova página') {
    const sibs = childrenOf(get().nodes, parentId)
    const node: TreeNode = {
      id: uid(),
      parentId,
      order: sibs.length ? sibs[sibs.length - 1].order + 1 : 0,
      kind,
      title,
      icon: kind === 'notebook' ? '📓' : kind === 'section' ? '📁' : '📄',
      tags: [],
      collapsed: false,
      mode: 'doc',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      canvas: { items: [], strokes: [], connectors: [] },
      text: '',
      termIds: [],
      linkIds: [],
      fileIds: [],
      mediaKinds: [],
      masteryManual: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const nodes = { ...get().nodes, [node.id]: node }
    if (parentId && nodes[parentId].collapsed) {
      nodes[parentId] = { ...nodes[parentId], collapsed: false }
      db.nodes.put(nodes[parentId])
    }
    set({ nodes })
    db.nodes.put(node)
    actions.select(node.id)
    return node.id
  },

  patchNode(id: string, patch: Partial<TreeNode>) {
    const cur = get().nodes[id]
    if (!cur) return
    const node = { ...cur, ...patch, updatedAt: Date.now() }
    set((s) => ({ nodes: { ...s.nodes, [id]: node } }))
    db.nodes.put(node)
  },

  deleteNode(id: string) {
    const nodes = { ...get().nodes }
    const cards = { ...get().cards }
    const kill: string[] = []
    const rec = (nid: string) => {
      kill.push(nid)
      childrenOf(nodes, nid).forEach((c) => rec(c.id))
    }
    rec(id)
    const parent = nodes[id]?.parentId ?? null
    const cardKill = Object.values(cards)
      .filter((c) => c.type === 'cloze' && c.pageId && kill.includes(c.pageId))
      .map((c) => c.id)
    // vai para a lixeira (com subpáginas e cartões) em vez de sumir de vez
    const root = nodes[id]
    if (root) {
      const entry: TrashEntry = { id, deletedAt: Date.now(), title: root.title, icon: root.icon, nodes: kill.map((k) => nodes[k]), cards: cardKill.map((k) => cards[k]) }
      db.trash.put(entry)
      set((s) => ({ trash: [entry, ...s.trash.filter((t) => t.id !== id)] }))
    }
    kill.forEach((k) => delete nodes[k])
    cardKill.forEach((k) => delete cards[k])
    db.nodes.bulkDelete(kill)
    db.cards.bulkDelete(cardKill)
    let currentId = get().currentId
    if (currentId && kill.includes(currentId)) currentId = parent ?? Object.values(nodes)[0]?.id ?? null
    set({ nodes, cards, currentId })
  },

  /** Devolve uma página da lixeira para a árvore (no lugar antigo, se o pai ainda existir). */
  restoreTrash(id: string) {
    const entry = get().trash.find((t) => t.id === id)
    if (!entry) return
    const nodes = { ...get().nodes }
    const cards = { ...get().cards }
    const restored = entry.nodes.map((n) => (n.id === id && n.parentId && !nodes[n.parentId] ? { ...n, parentId: null } : n))
    restored.forEach((n) => (nodes[n.id] = n))
    entry.cards.forEach((c) => (cards[c.id] = c))
    db.nodes.bulkPut(restored)
    db.cards.bulkPut(entry.cards)
    db.trash.delete(id)
    set({ nodes, cards, trash: get().trash.filter((t) => t.id !== id) })
    actions.select(id)
  },
  purgeTrash(id: string) {
    db.trash.delete(id)
    db.history.where('pageId').anyOf(get().trash.find((t) => t.id === id)?.nodes.map((n) => n.id) || []).delete()
    set({ trash: get().trash.filter((t) => t.id !== id) })
  },
  emptyTrash() {
    db.trash.clear()
    set({ trash: [] })
  },

  /* ---------- Histórico de versões ---------- */
  async snapshot(pageId: string, content: any, title: string, canvas?: CanvasData) {
    const canvasText = canvas?.items?.length ? '\n[Canvas] ' + canvas.items.map((i) => (i.html ? stripHtml(i.html) : i.type === 'media' ? '(arquivo)' : '(forma)')).join(' · ') : ''
    const snap: Snapshot = { id: uid(), pageId, at: Date.now(), title, content, canvas, text: (analyzeDoc(content).text + canvasText).slice(0, 4000) }
    await db.history.put(snap)
    // mantém só as 40 versões mais recentes de cada página
    const all = await db.history.where('pageId').equals(pageId).sortBy('at')
    if (all.length > 40) await db.history.bulkDelete(all.slice(0, all.length - 40).map((s) => s.id))
  },
  async listHistory(pageId: string) {
    return (await db.history.where('pageId').equals(pageId).sortBy('at')).reverse()
  },
  async restoreSnapshot(snapId: string) {
    const snap = await db.history.get(snapId)
    const cur = snap && get().nodes[snap.pageId]
    if (!snap || !cur) return
    // Descarta gravações pendentes do editor/canvas (digitação dos últimos instantes):
    // sem isso elas seriam gravadas DEPOIS da restauração e a sobrescreveriam.
    window.dispatchEvent(new Event('ne:discard-pending'))
    await actions.snapshot(cur.id, cur.content, cur.title, cur.canvas) // guarda o estado atual antes de voltar
    lastSnapAt.set(cur.id, Date.now())
    actions.saveDoc(cur.id, snap.content, true)
    if (snap.canvas) actions.saveCanvas(cur.id, snap.canvas, true)
    set((s) => ({ contentRev: s.contentRev + 1 }))
  },

  moveNode(id: string, targetId: string, zone: 'before' | 'after' | 'inside') {
    const nodes = { ...get().nodes }
    if (id === targetId) return
    // impede mover para dentro de um descendente
    let p: string | null = targetId
    while (p) {
      if (p === id) return
      p = nodes[p].parentId
    }
    const target = nodes[targetId]
    const newParent = zone === 'inside' ? targetId : target.parentId
    const sibs = childrenOf(nodes, newParent).filter((n) => n.id !== id)
    let idx = zone === 'inside' ? sibs.length : sibs.findIndex((n) => n.id === targetId) + (zone === 'after' ? 1 : 0)
    sibs.splice(idx, 0, { ...nodes[id], parentId: newParent })
    sibs.forEach((n, i) => {
      nodes[n.id] = { ...n, order: i }
    })
    if (zone === 'inside') nodes[targetId] = { ...nodes[targetId], collapsed: false }
    set({ nodes })
    db.nodes.bulkPut([...sibs.map((n) => nodes[n.id]), nodes[targetId]])
  },

  /* ---------- Conteúdo ---------- */
  saveDoc(id: string, content: any, skipHistory = false) {
    const cur = get().nodes[id]
    if (!cur) return
    if (!skipHistory) {
      // Histórico: guarda a versão ANTERIOR na primeira edição da sessão e depois a cada 10 min de edição.
      const last = lastSnapAt.get(id)
      if (last === undefined || Date.now() - last > 10 * 60000) {
        lastSnapAt.set(id, Date.now())
        if (cur.text.trim() || cur.fileIds.length) actions.snapshot(id, cur.content, cur.title, cur.canvas)
      }
    }
    const info = analyzeDoc(content)
    const files = get().files
    const mediaKinds = [...new Set(info.fileIds.map((f) => (files[f] ? mediaKind(files[f].type, files[f].name) : 'other')))] as MediaKind[]
    const node: TreeNode = { ...cur, content, text: info.text, termIds: info.termIds, linkIds: info.linkIds, fileIds: info.fileIds, mediaKinds, updatedAt: Date.now() }
    // sincroniza cartões de lacunas (cloze)
    const cards = { ...get().cards }
    const existing = Object.values(cards).filter((c) => c.type === 'cloze' && c.pageId === id)
    const seen = new Set<string>()
    const puts: Card[] = []
    for (const cz of info.clozes) {
      seen.add(cz.id)
      const old = cards[cz.id]
      if (!old) {
        cards[cz.id] = newCard({ id: cz.id, type: 'cloze', refId: cz.id, pageId: id, front: cz.context, back: cz.text })
        puts.push(cards[cz.id])
      } else if (old.front !== cz.context || old.back !== cz.text) {
        cards[cz.id] = { ...old, front: cz.context, back: cz.text }
        puts.push(cards[cz.id])
      }
    }
    const dels = existing.filter((c) => !seen.has(c.id)).map((c) => c.id)
    dels.forEach((d) => delete cards[d])
    set((s) => ({ nodes: { ...s.nodes, [id]: node }, cards }))
    db.nodes.put(node)
    if (puts.length) db.cards.bulkPut(puts)
    if (dels.length) db.cards.bulkDelete(dels)
  },

  saveCanvas(id: string, canvas: CanvasData, skipHistory = false) {
    const cur = get().nodes[id]
    if (!cur) return
    if (!skipHistory) {
      // mesmo critério do texto: guarda a versão anterior na primeira edição da sessão e a cada 10 min
      const last = lastSnapAt.get(id)
      if (last === undefined || Date.now() - last > 10 * 60000) {
        lastSnapAt.set(id, Date.now())
        if (cur.canvas.items.length || cur.canvas.strokes.length || cur.text.trim()) actions.snapshot(id, cur.content, cur.title, cur.canvas)
      }
    }
    const files = get().files
    const fileIds = canvas.items.filter((i) => i.type === 'media' && i.fileId).map((i) => i.fileId!)
    const docInfo = analyzeDoc(cur.content)
    const allFiles = [...new Set([...docInfo.fileIds, ...fileIds])]
    const text = docInfo.text + '\n' + canvas.items.map((i) => (i.html ? stripHtml(i.html) : '')).join('\n')
    const mediaKinds = [...new Set(allFiles.map((f) => (files[f] ? mediaKind(files[f].type, files[f].name) : 'other')))] as MediaKind[]
    actions.patchNode(id, { canvas, text, fileIds: allFiles, mediaKinds })
  },

  /* ---------- Glossário ---------- */
  saveTerm(data: Partial<Term> & { term: string; html: string }) {
    const old = data.id ? get().terms[data.id] : undefined
    const term: Term = {
      id: old?.id ?? uid(),
      aliases: [],
      pageId: null,
      fileId: null,
      createdAt: Date.now(),
      ...old,
      ...data,
      updatedAt: Date.now(),
    } as Term
    // `data.id` vem undefined ao criar um termo novo e sobrescreveria o id gerado acima —
    // sem isso o termo nunca era gravado no banco (sumia ao reabrir o app).
    term.id = old?.id ?? data.id ?? uid()
    const cardId = 'term:' + term.id
    const oldCard = get().cards[cardId]
    const card: Card = oldCard ? { ...oldCard, front: term.term, back: term.html } : newCard({ id: cardId, type: 'term', refId: term.id, pageId: null, front: term.term, back: term.html })
    set((s) => ({ terms: { ...s.terms, [term.id]: term }, cards: { ...s.cards, [cardId]: card } }))
    db.terms.put(term)
    db.cards.put(card)
    refreshMatcher()
    return term.id
  },

  deleteTerm(id: string) {
    const terms = { ...get().terms }
    const cards = { ...get().cards }
    delete terms[id]
    delete cards['term:' + id]
    set({ terms, cards, pinned: get().pinned.filter((p) => !(p.kind === 'term' && p.id === id)) })
    db.terms.delete(id)
    db.cards.delete('term:' + id)
    refreshMatcher()
  },

  rateCard(id: string, r: Rating) {
    const c = get().cards[id]
    if (!c) return
    const next = rate(c, r)
    set((s) => ({ cards: { ...s.cards, [id]: next } }))
    db.cards.put(next)
  },

  /* ---------- Arquivos ---------- */
  async addFile(file: Blob, name?: string, transcript?: Cue[]) {
    const meta: FileMeta = {
      id: uid(),
      name: name || (file as File).name || 'arquivo',
      type: file.type || 'application/octet-stream',
      size: file.size,
      createdAt: Date.now(),
      transcript,
      rev: 0,
    }
    await db.blobs.put({ id: meta.id, blob: file })
    await db.files.put(meta)
    set((s) => ({ files: { ...s.files, [meta.id]: meta } }))
    return meta.id
  },

  async replaceBlob(id: string, blob: Blob) {
    const cur = get().files[id]
    if (!cur) return
    const meta = { ...cur, size: blob.size, type: blob.type || cur.type, rev: cur.rev + 1 }
    await db.blobs.put({ id, blob })
    await db.files.put(meta)
    set((s) => ({ files: { ...s.files, [id]: meta } }))
  },

  setTranscript(id: string, transcript: Cue[]) {
    const cur = get().files[id]
    if (!cur) return
    const meta = { ...cur, transcript }
    db.files.put(meta)
    set((s) => ({ files: { ...s.files, [id]: meta } }))
  },

  /* ---------- Hotspots ---------- */
  saveHotspot(h: Hotspot) {
    set((s) => ({ hotspots: { ...s.hotspots, [h.id]: h } }))
    db.hotspots.put(h)
  },
  deleteHotspot(id: string) {
    const hotspots = { ...get().hotspots }
    delete hotspots[id]
    set({ hotspots, pinned: get().pinned.filter((p) => !(p.kind === 'hotspot' && p.id === id)) })
    db.hotspots.delete(id)
  },
  replaceHotspots(fileId: string, list: Hotspot[]) {
    const hotspots = { ...get().hotspots }
    const old = Object.values(hotspots).filter((h) => h.fileId === fileId)
    old.forEach((h) => delete hotspots[h.id])
    list.forEach((h) => (hotspots[h.id] = h))
    set({ hotspots })
    db.hotspots.bulkDelete(old.map((h) => h.id)).then(() => db.hotspots.bulkPut(list))
  },

  /* ---------- Pop-ups fixados ---------- */
  pin(p: Omit<PinnedPop, 'key'>) {
    const exist = get().pinned.find((x) => x.kind === p.kind && x.id === p.id)
    if (exist) {
      set((s) => ({ pinned: s.pinned.map((x) => (x.key === exist.key ? { ...x, edit: p.edit ?? x.edit } : x)) }))
      return
    }
    set((s) => ({ pinned: [...s.pinned, { ...p, key: uid() }] }))
  },
  unpin(key: string) {
    set((s) => ({ pinned: s.pinned.filter((p) => p.key !== key) }))
  },
  patchPin(key: string, patch: Partial<PinnedPop>) {
    set((s) => ({ pinned: s.pinned.map((p) => (p.key === key ? { ...p, ...patch } : p)) }))
  },

  /** Abre uma mídia: se o player/visualizador estiver na página atual, pula até o ponto; senão abre em modal. */
  openMedia(fileId: string, opts: { time?: number; page?: number } = {}) {
    const host = document.querySelector(`[data-media-host="${fileId}"]`)
    if (host) {
      host.scrollIntoView({ behavior: 'smooth', block: 'center' })
      window.dispatchEvent(new CustomEvent('ne:media', { detail: { fileId, ...opts } }))
    } else set({ mediaModal: { fileId, ...opts } })
  },

  /* ---------- Pomodoro ---------- */
  pomoStart() {
    const p = get().pomo
    if (p.running) return
    const full = phaseMs(p, p.phase)
    set({ pomo: { ...p, running: true, endsAt: Date.now() + p.remainingMs, startedAt: p.remainingMs >= full ? Date.now() : p.startedAt || Date.now(), now: Date.now() } })
  },
  pomoPause() {
    const p = get().pomo
    if (!p.running) return
    set({ pomo: { ...p, running: false, remainingMs: Math.max(0, p.endsAt - Date.now()) } })
  },
  pomoReset() {
    const p = get().pomo
    set({ pomo: { ...p, running: false, remainingMs: phaseMs(p, p.phase), startedAt: 0 } })
  },
  pomoSetPhase(phase: Phase) {
    const p = get().pomo
    set({ pomo: { ...p, phase, running: false, remainingMs: phaseMs(p, phase), startedAt: 0 } })
  },
  pomoFinish(completed: boolean) {
    const s = get()
    const p = s.pomo
    const elapsed = Math.round((phaseMs(p, p.phase) - (p.running ? Math.max(0, p.endsAt - Date.now()) : p.remainingMs)) / 1000)
    const page = s.currentId ? s.nodes[s.currentId] : null
    let sessions = s.sessions
    if (elapsed > 5) {
      const sess: Session = { id: uid(), pageId: page?.id ?? null, pageTitle: page?.title ?? '—', kind: p.phase, start: p.startedAt || Date.now() - elapsed * 1000, seconds: elapsed, completed }
      sessions = [...sessions, sess]
      db.sessions.put(sess)
    }
    let cycles = p.cycles
    let next: Phase = 'focus'
    if (p.phase === 'focus') {
      if (completed) cycles++
      next = cycles > 0 && cycles % p.longEvery === 0 ? 'long' : 'short'
    }
    if (completed) soundscapes.beep()
    set({ sessions, pomo: { ...p, phase: next, cycles, running: false, remainingMs: phaseMs(p, next), startedAt: 0 } })
  },
  pomoTick() {
    const p = get().pomo
    if (!p.running) return
    if (Date.now() >= p.endsAt) actions.pomoFinish(true)
    else set({ pomo: { ...p, now: Date.now() } })
  },
  pomoConfig(patch: Partial<Pick<Pomo, 'focusMin' | 'shortMin' | 'longMin' | 'longEvery'>>) {
    const p = { ...get().pomo, ...patch }
    if (!p.running) p.remainingMs = phaseMs(p, p.phase)
    set({ pomo: p })
    saveSetting('pomo', { focusMin: p.focusMin, shortMin: p.shortMin, longMin: p.longMin, longEvery: p.longEvery })
  },

  setSound(id: SoundId, volume: number) {
    soundscapes.set(id, volume)
    set((s) => ({ sound: { ...s.sound, [id]: volume } }))
  },
}

/** Adiciona o caderno de demonstração (sem apagar o que já existe) e recarrega. */
export async function loadDemoNotebook() {
  await seedDatabase()
  location.reload()
}

export function phaseMs(p: Pomo, phase: Phase) {
  return (phase === 'focus' ? p.focusMin : phase === 'short' ? p.shortMin : p.longMin) * 60000
}
export function pomoRemaining(p: Pomo) {
  return p.running ? Math.max(0, p.endsAt - p.now) : p.remainingMs
}
export const PHASE_LABEL: Record<Phase, string> = { focus: 'Foco', short: 'Pausa curta', long: 'Pausa longa' }

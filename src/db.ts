import Dexie, { type Table } from 'dexie'

/* ============================================================
   Schema do banco (IndexedDB via Dexie)
   ============================================================ */

export type Mastery = 0 | 1 | 2 // 0 = novo (vermelho), 1 = aprendendo (amarelo), 2 = dominado (verde)
export type MediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'other'

export interface Tag {
  label: string
  color: string
}

/* ---- Canvas livre ---- */
export type ShapeKind = 'rect' | 'round' | 'diamond' | 'ellipse' | 'parallelogram' | 'cylinder' | 'hexagon' | 'document' | 'cloud' | 'person'
export type Side = 'top' | 'right' | 'bottom' | 'left'
export interface CanvasItem {
  id: string
  type: 'text' | 'media' | 'shape'
  /** forma do diagrama (só para type = 'shape') */
  shape?: ShapeKind
  x: number
  y: number
  w: number
  h: number
  html?: string
  fileId?: string
  color?: string
}
export interface CanvasStroke {
  id: string
  points: [number, number][]
  color: string
  width: number
}
export interface CanvasConnector {
  id: string
  from: string
  to: string
  /** reta (padrão) ou em ângulo reto */
  kind?: 'straight' | 'elbow'
  label?: string
  /** lado da forma de onde a seta sai / onde chega (vazio = automático) */
  fromSide?: Side
  toSide?: Side
}
export interface CanvasData {
  items: CanvasItem[]
  strokes: CanvasStroke[]
  connectors: CanvasConnector[]
}

/* ---- Árvore hierárquica: todo nó é também uma página (estilo CherryTree) ---- */
export interface TreeNode {
  id: string
  parentId: string | null
  order: number
  kind: 'notebook' | 'section' | 'page'
  title: string
  icon: string
  tags: Tag[]
  collapsed: boolean
  mode: 'doc' | 'canvas'
  content: any // documento TipTap (JSON)
  canvas: CanvasData
  // índices derivados (recalculados a cada salvamento)
  text: string
  termIds: string[]
  linkIds: string[]
  fileIds: string[]
  mediaKinds: MediaKind[]
  masteryManual: Mastery | null
  createdAt: number
  updatedAt: number
}

/* ---- Glossário vivo ---- */
export interface Term {
  id: string
  term: string
  aliases: string[]
  html: string // definição rica (HTML; $...$ = LaTeX)
  pageId: string | null // página correspondente na árvore
  fileId: string | null // arquivo de referência
  createdAt: number
  updatedAt: number
}

/* ---- Repetição espaçada ---- */
export interface Card {
  id: string // "term:<id>" ou id da lacuna
  type: 'term' | 'cloze'
  refId: string
  pageId: string | null
  front: string
  back: string
  due: number
  interval: number // dias
  ease: number
  reps: number
  lapses: number
  last: number
}

/* ---- Hotspots (pins) de imagem ---- */
export interface Hotspot {
  id: string
  fileId: string
  x: number // 0..1
  y: number // 0..1
  label: string
  html: string
  termId: string | null
}

/* ---- Mídia ---- */
export interface Cue {
  t: number
  text: string
}
export interface FileMeta {
  id: string
  name: string
  type: string
  size: number
  createdAt: number
  transcript?: Cue[]
  rev: number
}
export interface BlobRec {
  id: string
  blob: Blob
}

/* ---- Pomodoro ---- */
export interface Session {
  id: string
  pageId: string | null
  pageTitle: string
  kind: 'focus' | 'short' | 'long'
  start: number
  seconds: number
  completed: boolean
}

/* ---- Lixeira: uma página excluída vai para cá com as subpáginas e os cartões ---- */
export interface TrashEntry {
  id: string // id da página raiz excluída
  deletedAt: number
  title: string
  icon: string
  nodes: TreeNode[]
  cards: Card[]
}

/* ---- Histórico de versões de uma página ---- */
export interface Snapshot {
  id: string
  pageId: string
  at: number
  title: string
  content: any
  /** canvas da página naquele momento (versões antigas não têm) */
  canvas?: CanvasData
  text: string
}

export interface Setting {
  key: string
  value: any
}

class NotepadDB extends Dexie {
  nodes!: Table<TreeNode, string>
  terms!: Table<Term, string>
  cards!: Table<Card, string>
  hotspots!: Table<Hotspot, string>
  files!: Table<FileMeta, string>
  blobs!: Table<BlobRec, string>
  sessions!: Table<Session, string>
  settings!: Table<Setting, string>
  trash!: Table<TrashEntry, string>
  history!: Table<Snapshot, string>

  constructor() {
    super('notepad-everywhere')
    this.version(1).stores({
      nodes: 'id, parentId',
      terms: 'id, term',
      cards: 'id, due, pageId',
      hotspots: 'id, fileId',
      files: 'id',
      blobs: 'id',
      sessions: 'id, start',
      settings: 'key',
    })
    // v2: lixeira e histórico de versões (as tabelas antigas não mudam)
    this.version(2).stores({
      trash: 'id, deletedAt',
      history: 'id, pageId, at',
    })
  }
}

export const db = new NotepadDB()

export const TABLES = ['nodes', 'terms', 'cards', 'hotspots', 'files', 'sessions', 'settings', 'trash', 'history'] as const

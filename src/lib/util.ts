import type { MediaKind } from '../db'

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export function mediaKind(type: string, name = ''): MediaKind {
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (type === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return 'pdf'
  return 'other'
}

export function isTexty(type: string, name: string) {
  return (
    type.startsWith('text/') ||
    /json|xml|javascript|typescript|x-sh|x-python/.test(type) ||
    /\.(txt|md|js|ts|tsx|jsx|py|json|css|html|xml|yml|yaml|sh|bat|ps1|c|cpp|h|java|rs|go|sql|csv|ini|toml|log)$/i.test(name)
  )
}

export function fmtSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function fmtTime(sec: number) {
  sec = Math.max(0, Math.floor(sec))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function fmtDate(ts: number) {
  return new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function stripHtml(html: string) {
  const d = document.createElement('div')
  d.innerHTML = html
  return d.textContent || ''
}

export function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v))
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let t: any
  const d = (...a: Parameters<T>) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }
  d.flush = (...a: Parameters<T>) => {
    clearTimeout(t)
    fn(...a)
  }
  d.cancel = () => clearTimeout(t)
  return d
}

export const TAG_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899', '#94a3b8']
export const ICONS = ['📓', '📚', '📁', '📄', '📝', '🧠', '⏳', '🔬', '🧪', '📐', '💡', '⭐', '🎯', '🗺️', '📎', '💻', '🎧', '🎬', '🖼️', '📊', '🔖', '🧩', '🌱', '⚙️', '❤️', '🍒', '🔥', '🗂️']

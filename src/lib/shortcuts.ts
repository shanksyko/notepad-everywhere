/* Atalhos de teclado configuráveis. Cada ação também tem botão na interface. */

export interface ShortcutDef {
  id: string
  label: string
  def: string
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'palette', label: 'Paleta de comandos', def: 'Ctrl+K' },
  { id: 'newPage', label: 'Nova página (dentro da atual)', def: 'Alt+N' },
  { id: 'find', label: 'Buscar nesta página', def: 'Ctrl+F' },
  { id: 'meaning', label: 'Adicionar significado ao texto selecionado', def: 'Ctrl+Shift+M' },
  { id: 'cloze', label: 'Ocultar lacuna (cloze) no texto selecionado', def: 'Ctrl+Shift+C' },
  { id: 'study', label: 'Modo Estudo (ocultar lacunas)', def: 'Alt+E' },
  { id: 'review', label: 'Abrir revisão (Glossário & SRS)', def: '' },
  { id: 'pomodoro', label: 'Iniciar / pausar Pomodoro', def: 'Alt+P' },
  { id: 'zen', label: 'Modo Zen / Foco Total', def: 'F11' },
  { id: 'fullscreen', label: 'Tela cheia', def: 'Alt+Enter' },
  { id: 'spotlight', label: 'Spotlight', def: '' },
  { id: 'ruler', label: 'Régua de leitura', def: '' },
  { id: 'graph', label: 'Grafo de Conhecimento', def: 'Alt+G' },
  { id: 'print', label: 'Imprimir / salvar em PDF', def: 'Ctrl+P' },
  { id: 'backup', label: 'Backup', def: '' },
]

export const defaultShortcuts = () => Object.fromEntries(SHORTCUTS.map((s) => [s.id, s.def])) as Record<string, string>

const MODS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'])

/** Converte um evento de teclado em texto ("Ctrl+Shift+C"). Retorna '' se for só um modificador. */
export function comboOf(e: KeyboardEvent): string {
  if (MODS.has(e.key)) return ''
  let key = e.key
  if (e.code.startsWith('Key')) key = e.code.slice(3)
  else if (e.code.startsWith('Digit')) key = e.code.slice(5)
  else if (key === ' ') key = 'Espaço'
  else if (key.length === 1) key = key.toUpperCase()
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

// combinações que o editor de texto precisa — não podem virar atalho
const RESERVED = new Set(['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+A', 'Ctrl+Shift+Z'])

/** Diz por que uma combinação não serve (ou '' se serve). */
export function comboProblem(combo: string): string {
  if (!combo) return 'Pressione uma tecla junto com Ctrl ou Alt.'
  if (RESERVED.has(combo)) return `${combo} é usado pelo editor (copiar, colar, desfazer…).`
  const hasMod = combo.includes('Ctrl+') || combo.includes('Alt+')
  const isF = /(^|\+)F\d{1,2}$/.test(combo)
  if (!hasMod && !isF) return 'Use Ctrl ou Alt na combinação (ou uma tecla F1–F12), para não atrapalhar a digitação.'
  return ''
}

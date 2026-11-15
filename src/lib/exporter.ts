// JSZip é carregado sob demanda (só ao exportar/importar), para o app abrir mais leve.
const loadJSZip = async () => (await import('jszip')).default
import { db, TABLES } from '../db'
import { toMarkdown } from './doc'
import { downloadBlob, stripHtml } from './util'

const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'sem-titulo'

/** Exporta TODO o banco: data.json (árvore, glossário, SRS, hotspots, sessões), mídias e Markdown estruturado. */
export async function exportZip() {
  downloadBlob(await buildZip(), `notepad-everywhere-${new Date().toISOString().slice(0, 10)}.zip`)
}

export async function buildZip(): Promise<Blob> {
  const zip = new (await loadJSZip())()
  const data: Record<string, any[]> = {}
  for (const t of TABLES) data[t] = await (db as any)[t].toArray()
  zip.file('data.json', JSON.stringify({ app: 'notepad-everywhere', version: 1, exportedAt: new Date().toISOString(), ...data }, null, 1))

  const files = data.files as { id: string; name: string }[]
  const nameOf = (id: string) => {
    const f = files.find((x) => x.id === id)
    return f ? `${f.id}-${safe(f.name)}` : id
  }
  for (const f of files) {
    const b = await db.blobs.get(f.id)
    if (b) zip.file(`media/${nameOf(f.id)}`, b.blob)
  }

  // Markdown estruturado seguindo a hierarquia da árvore
  const nodes = data.nodes as any[]
  const pathOf = (n: any): string => {
    const parent = nodes.find((x) => x.id === n.parentId)
    return (parent ? pathOf(parent) + '/' : '') + safe(n.title)
  }
  for (const n of nodes) {
    const hasKids = nodes.some((x) => x.parentId === n.id)
    const p = pathOf(n)
    const front = `---\ntitle: ${n.title}\nicon: ${n.icon}\ntags: [${n.tags.map((t: any) => t.label).join(', ')}]\n---\n\n`
    let md = front + toMarkdown(n.content, nameOf)
    if (n.mode === 'canvas' && n.canvas?.items?.length) md += '\n\n## Canvas\n\n' + n.canvas.items.map((i: any) => (i.html ? '- ' + stripHtml(i.html) : `- ![](../media/${nameOf(i.fileId)})`)).join('\n')
    zip.file(`markdown/${hasKids ? p + '/_index' : p}.md`, md)
  }
  const gloss = (data.terms as any[])
    .sort((a, b) => a.term.localeCompare(b.term))
    .map((t) => `## ${t.term}\n${t.aliases?.length ? `*Sinônimos: ${t.aliases.join(', ')}*\n\n` : '\n'}${stripHtml(t.html)}\n`)
    .join('\n')
  zip.file('markdown/_glossario.md', '# Glossário\n\n' + gloss)

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } })
}

/** Restaura um backup .zip gerado por exportZip (substitui o banco atual). */
export async function importZip(file: Blob | ArrayBuffer | Uint8Array) {
  const zip = await (await loadJSZip()).loadAsync(file)
  const entry = zip.file('data.json')
  if (!entry) throw new Error('Este .zip não contém data.json — não é um backup do Notepad Everywhere.')
  const data = JSON.parse(await entry.async('string'))
  if (data.app !== 'notepad-everywhere') throw new Error('Backup inválido.')
  const blobs: { id: string; blob: Blob }[] = []
  for (const f of data.files || []) {
    const path = Object.keys(zip.files).find((k) => k.startsWith(`media/${f.id}-`))
    if (path) blobs.push({ id: f.id, blob: new Blob([await zip.files[path].async('arraybuffer')], { type: f.type }) })
  }
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear()
    for (const t of TABLES) if (data[t]) await (db as any)[t].bulkPut(data[t])
    await db.blobs.bulkPut(blobs)
  })
  location.reload()
}

/**
 * Mescla um backup com o que já está no app (para usar o mesmo caderno em dois PCs):
 * em cada página/termo vence a versão editada por último; o que só existe de um lado é mantido.
 * Nada é apagado.
 */
export async function mergeZip(file: Blob | ArrayBuffer | Uint8Array): Promise<Record<string, number>> {
  const zip = await (await loadJSZip()).loadAsync(file)
  const entry = zip.file('data.json')
  if (!entry) throw new Error('Este .zip não contém data.json — não é um backup do Notepad Everywhere.')
  const data = JSON.parse(await entry.async('string'))
  if (data.app !== 'notepad-everywhere') throw new Error('Backup inválido.')
  const stats = { paginas: 0, termos: 0, cartoes: 0, arquivos: 0, pins: 0, sessoes: 0 }

  // mais recente vence, por um carimbo de data de cada tabela
  const newer = async (table: any, rows: any[], stamp: (r: any) => number) => {
    const puts: any[] = []
    for (const r of rows || []) {
      const cur = await table.get(r.id)
      if (!cur || stamp(r) > stamp(cur)) puts.push(r)
    }
    if (puts.length) await table.bulkPut(puts)
    return puts.length
  }
  // páginas cujo pai não veio no backup nem existe aqui viram raiz
  const localIds = new Set((await db.nodes.toCollection().primaryKeys()) as string[])
  const incomingIds = new Set((data.nodes || []).map((n: any) => n.id))
  const nodes = (data.nodes || []).map((n: any) => (n.parentId && !localIds.has(n.parentId) && !incomingIds.has(n.parentId) ? { ...n, parentId: null } : n))
  stats.paginas = await newer(db.nodes, nodes, (r) => r.updatedAt || 0)
  stats.termos = await newer(db.terms, data.terms, (r) => r.updatedAt || 0)
  stats.cartoes = await newer(db.cards, data.cards, (r) => r.last || 0)
  // arquivos, pins e sessões: só entra o que ainda não existe aqui
  const onlyNew = async (table: any, rows: any[]) => {
    const puts: any[] = []
    for (const r of rows || []) if (!(await table.get(r.id))) puts.push(r)
    if (puts.length) await table.bulkPut(puts)
    return puts
  }
  stats.pins = (await onlyNew(db.hotspots, data.hotspots)).length
  stats.sessoes = (await onlyNew(db.sessions, data.sessions)).length
  const newFiles = await onlyNew(db.files, data.files)
  for (const f of newFiles) {
    const p = Object.keys(zip.files).find((k) => k.startsWith(`media/${f.id}-`))
    if (p) await db.blobs.put({ id: f.id, blob: new Blob([await zip.files[p].async('arraybuffer')], { type: f.type }) })
  }
  stats.arquivos = newFiles.length
  return stats
}

export async function resetDatabase() {
  await db.delete()
  location.reload()
}

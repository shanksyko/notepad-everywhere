/* Análise do documento TipTap: texto puro, termos, links, arquivos e lacunas (cloze). */

export interface DocInfo {
  text: string
  termIds: string[]
  linkIds: string[]
  fileIds: string[]
  clozes: { id: string; text: string; context: string }[]
}

const INLINE = new Set(['text', 'mathInline', 'hardBreak'])

export function analyzeDoc(doc: any): DocInfo {
  const termIds = new Set<string>()
  const linkIds = new Set<string>()
  const fileIds = new Set<string>()
  const clozes = new Map<string, { text: string; context: string }>()
  const texts: string[] = []

  const walk = (n: any) => {
    if (!n) return
    if (n.type === 'mediaBlock' && n.attrs?.fileId) fileIds.add(n.attrs.fileId)
    if (n.type === 'mathBlock' && n.attrs?.latex) texts.push(n.attrs.latex)
    if (n.type === 'canvasBlock' && n.attrs?.data) {
      // canvas embutido: indexa o texto das caixas e os arquivos
      try {
        for (const it of JSON.parse(n.attrs.data).items || []) {
          if (it.fileId) fileIds.add(it.fileId)
          if (it.html) texts.push(String(it.html).replace(/<[^>]+>/g, ' '))
        }
      } catch {}
    }
    const kids: any[] = n.content || []
    if (kids.length && kids.every((k) => INLINE.has(k.type))) {
      let ctx = ''
      let plain = ''
      const local = new Map<string, string>()
      for (const k of kids) {
        if (k.type === 'mathInline') {
          plain += ` ${k.attrs?.latex || ''} `
          ctx += `$${k.attrs?.latex || ''}$`
          continue
        }
        if (k.type === 'hardBreak') {
          plain += '\n'
          ctx += ' '
          continue
        }
        const t: string = k.text || ''
        plain += t
        let cz: string | null = null
        for (const m of k.marks || []) {
          if (m.type === 'glossTerm' && m.attrs?.termId) termIds.add(m.attrs.termId)
          if (m.type === 'pageLink' && m.attrs?.pageId) linkIds.add(m.attrs.pageId)
          if (m.type === 'mediaLink' && m.attrs?.fileId) fileIds.add(m.attrs.fileId)
          if (m.type === 'cloze' && m.attrs?.clozeId) cz = m.attrs.clozeId
        }
        if (cz) {
          if (!local.has(cz)) ctx += '[ ... ]'
          local.set(cz, (local.get(cz) || '') + t)
        } else ctx += t
      }
      texts.push(plain)
      local.forEach((text, id) => clozes.set(id, { text, context: ctx }))
    } else kids.forEach(walk)
  }
  walk(doc)
  return {
    text: texts.join('\n'),
    termIds: [...termIds],
    linkIds: [...linkIds],
    fileIds: [...fileIds],
    clozes: [...clozes].map(([id, v]) => ({ id, ...v })),
  }
}

/* ---------- TipTap JSON → Markdown (para exportação) ---------- */

function inlineMd(nodes: any[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n'
      if (n.type === 'mathInline') return `$${n.attrs?.latex || ''}$`
      let t: string = n.text || ''
      for (const m of n.marks || []) {
        if (m.type === 'bold') t = `**${t}**`
        else if (m.type === 'italic') t = `*${t}*`
        else if (m.type === 'strike') t = `~~${t}~~`
        else if (m.type === 'code') t = `\`${t}\``
        else if (m.type === 'link') t = `[${t}](${m.attrs?.href || ''})`
        else if (m.type === 'glossTerm') t = `[[${t}]]`
        else if (m.type === 'pageLink') t = `[[${t}]]`
        else if (m.type === 'cloze') t = `{{c1::${t}}}`
      }
      return t
    })
    .join('')
}

export function toMarkdown(doc: any, fileName: (id: string) => string): string {
  const block = (n: any, indent = ''): string => {
    const kids: any[] = n.content || []
    switch (n.type) {
      case 'doc':
        return kids.map((k) => block(k)).join('\n\n')
      case 'paragraph':
        return indent + inlineMd(kids)
      case 'heading':
        return '#'.repeat(n.attrs?.level || 1) + ' ' + inlineMd(kids)
      case 'bulletList':
        return kids.map((li) => `${indent}- ${block(li, indent + '  ').trimStart()}`).join('\n')
      case 'orderedList':
        return kids.map((li, i) => `${indent}${i + 1}. ${block(li, indent + '   ').trimStart()}`).join('\n')
      case 'taskList':
        return kids.map((li) => `${indent}- [${li.attrs?.checked ? 'x' : ' '}] ${block(li, indent + '  ').trimStart()}`).join('\n')
      case 'listItem':
      case 'taskItem':
        return kids.map((k) => block(k, indent)).join('\n')
      case 'codeBlock':
        return '```' + (n.attrs?.language || '') + '\n' + kids.map((k) => k.text || '').join('') + '\n```'
      case 'blockquote':
        return kids.map((k) => block(k).split('\n').map((l) => '> ' + l).join('\n')).join('\n>\n')
      case 'callout':
        return `> **${(n.attrs?.kind || 'info').toUpperCase()}**\n` + kids.map((k) => block(k).split('\n').map((l) => '> ' + l).join('\n')).join('\n>\n')
      case 'mathBlock':
        return `$$\n${n.attrs?.latex || ''}\n$$`
      case 'mediaBlock':
        return `![${fileName(n.attrs?.fileId)}](../media/${fileName(n.attrs?.fileId)})`
      case 'canvasBlock':
        try {
          return (JSON.parse(n.attrs?.data || '{}').items || []).map((it: any) => (it.html ? '- ' + String(it.html).replace(/<[^>]+>/g, ' ').trim() : `- ![](../media/${fileName(it.fileId)})`)).join('\n')
        } catch {
          return ''
        }
      case 'horizontalRule':
        return '---'
      case 'table': {
        const rows = kids.map((r) => '| ' + (r.content || []).map((c: any) => (c.content || []).map((p: any) => inlineMd(p.content)).join(' ')).join(' | ') + ' |')
        if (rows.length) rows.splice(1, 0, '| ' + (kids[0].content || []).map(() => '---').join(' | ') + ' |')
        return rows.join('\n')
      }
      default:
        return kids.map((k) => block(k, indent)).join('\n')
    }
  }
  return block(doc)
}

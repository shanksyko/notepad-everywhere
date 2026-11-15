import { db, type Card, type CanvasData, type Cue, type FileMeta, type Hotspot, type MediaKind, type Term, type TreeNode } from './db'
import { analyzeDoc } from './lib/doc'
import { newCard } from './lib/srs'
import { mediaKind } from './lib/util'

/* ============================================================
   Dados de exemplo — criados na primeira inicialização
   ============================================================ */

const DAY = 86400000

/* ---------- construtores de documento TipTap ---------- */
type J = any
const t = (text: string, ...marks: J[]): J => ({ type: 'text', text, ...(marks.length ? { marks } : {}) })
const B = { type: 'bold' }
const I = { type: 'italic' }
const b = (text: string) => t(text, B)
const i = (text: string) => t(text, I)
const gt = (text: string, termId: string) => t(text, { type: 'glossTerm', attrs: { termId } })
const cz = (text: string, clozeId: string) => t(text, { type: 'cloze', attrs: { clozeId } })
const pl = (text: string, pageId: string) => t(text, { type: 'pageLink', attrs: { pageId } })
const ml = (text: string, fileId: string, attrs: J) => t(text, { type: 'mediaLink', attrs: { fileId, time: null, page: null, ...attrs } })
const inl = (c: (string | J)[]) => c.map((x) => (typeof x === 'string' ? t(x) : x))
const p = (...c: (string | J)[]): J => ({ type: 'paragraph', content: inl(c) })
const h = (level: number, text: string): J => ({ type: 'heading', attrs: { level }, content: [t(text)] })
const ul = (...items: (string | J)[][]): J => ({ type: 'bulletList', content: items.map((it) => ({ type: 'listItem', content: [p(...it)] })) })
const tasks = (...items: [boolean, ...(string | J)[]][]): J => ({
  type: 'taskList',
  content: items.map(([checked, ...c]) => ({ type: 'taskItem', attrs: { checked }, content: [p(...c)] })),
})
const callout = (kind: string, ...blocks: J[]): J => ({ type: 'callout', attrs: { kind }, content: blocks })
const code = (language: string, text: string): J => ({ type: 'codeBlock', attrs: { language }, content: [t(text)] })
const math = (latex: string): J => ({ type: 'mathBlock', attrs: { latex } })
const mi = (latex: string): J => ({ type: 'mathInline', attrs: { latex } })
const media = (fileId: string): J => ({ type: 'mediaBlock', attrs: { fileId, zoom: 100, rotation: 0 } })
const quote = (...blocks: J[]): J => ({ type: 'blockquote', content: blocks })
const table = (header: string[], ...rows: string[][]): J => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: header.map((c) => ({ type: 'tableHeader', content: [p(c)] })) },
    ...rows.map((r) => ({ type: 'tableRow', content: r.map((c) => ({ type: 'tableCell', content: [p(c)] })) })),
  ],
})
const doc = (...content: J[]): J => ({ type: 'doc', content })

/* ---------- mídias geradas em tempo de execução ---------- */

function neuronSvg(): Blob {
  const myelin = [330, 400, 470, 540, 610]
    .map((x) => `<rect x="${x}" y="196" width="56" height="28" rx="14" fill="#fde68a" stroke="#d97706" stroke-width="2"/>`)
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="420" viewBox="0 0 900 420" font-family="Segoe UI, Arial, sans-serif">
  <defs>
    <radialGradient id="soma" cx="40%" cy="35%"><stop offset="0" stop-color="#fda4af"/><stop offset="1" stop-color="#e11d48"/></radialGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f172a"/><stop offset="1" stop-color="#1e1b4b"/></linearGradient>
  </defs>
  <rect width="900" height="420" rx="18" fill="url(#bg)"/>
  <text x="30" y="44" fill="#e2e8f0" font-size="22" font-weight="700">Anatomia de um neurônio</text>
  <text x="30" y="68" fill="#94a3b8" font-size="13">Passe o mouse sobre os pins numerados</text>
  <g stroke="#fb7185" stroke-width="7" stroke-linecap="round" fill="none">
    <path d="M170 180 C120 140 90 120 50 110"/><path d="M95 127 C80 100 70 90 60 70"/>
    <path d="M165 240 C120 270 90 300 55 330"/><path d="M100 295 C85 320 80 340 85 365"/>
    <path d="M200 165 C200 120 215 100 240 75"/><path d="M215 110 C200 95 190 85 175 78"/>
    <path d="M150 210 C110 210 80 205 40 215"/>
  </g>
  <path d="M250 210 L760 210" stroke="#fb7185" stroke-width="9" stroke-linecap="round"/>
  ${myelin}
  <circle cx="200" cy="210" r="56" fill="url(#soma)" stroke="#fecdd3" stroke-width="3"/>
  <circle cx="192" cy="204" r="19" fill="#881337" opacity=".85"/>
  <g stroke="#fb7185" stroke-width="6" stroke-linecap="round" fill="none">
    <path d="M760 210 C790 190 800 170 815 150"/><path d="M760 210 C795 210 810 210 830 210"/><path d="M760 210 C790 230 800 250 815 270"/>
  </g>
  <g fill="#38bdf8"><circle cx="820" cy="143" r="11"/><circle cx="838" cy="210" r="11"/><circle cx="820" cy="277" r="11"/></g>
  <g fill="#7dd3fc"><circle cx="852" cy="200" r="3"/><circle cx="858" cy="214" r="3"/><circle cx="850" cy="224" r="3"/><circle cx="864" cy="205" r="3"/></g>
  <path d="M872 150 C860 180 860 240 872 270" stroke="#a78bfa" stroke-width="8" fill="none" stroke-linecap="round"/>
  <text x="300" y="262" fill="#94a3b8" font-size="12">impulso nervoso →</text>
</svg>`
  return new Blob([svg], { type: 'image/svg+xml' })
}

function makePdf(pages: string[][]): Blob {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  const objs: string[] = []
  const kids = pages.map((_, k) => `${4 + k * 2} 0 R`).join(' ')
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  pages.forEach((lines, k) => {
    const body = lines
      .map((l) => (l.startsWith('# ') ? `/F1 20 Tf 28 TL (${esc(l.slice(2))}) Tj T* /F1 12 Tf 18 TL` : `(${esc(l)}) Tj T*`))
      .join('\n')
    const content = `BT /F1 12 Tf 18 TL 56 770 Td\n${body}\nET`
    objs[4 + k * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + k * 2} 0 R >>`
    objs[5 + k * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  })
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = out.length
    out += `${n} 0 obj\n${objs[n]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
  for (let n = 1; n < objs.length; n++) out += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  const bytes = new Uint8Array(out.length)
  for (let k = 0; k < out.length; k++) bytes[k] = out.charCodeAt(k) & 0xff
  return new Blob([bytes], { type: 'application/pdf' })
}

function makeWav(): Blob {
  const rate = 11025
  const secs = 16
  const n = rate * secs
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const w = (o: number, s: string) => [...s].forEach((c, k) => v.setUint8(o + k, c.charCodeAt(0)))
  w(0, 'RIFF')
  v.setUint32(4, 36 + n * 2, true)
  w(8, 'WAVEfmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  w(36, 'data')
  v.setUint32(40, n * 2, true)
  // um acorde arpejado diferente a cada 4 s (para perceber os saltos de timestamp)
  const chords = [
    [261.63, 329.63, 392.0],
    [293.66, 369.99, 440.0],
    [329.63, 415.3, 493.88],
    [349.23, 440.0, 523.25],
  ]
  for (let k = 0; k < n; k++) {
    const time = k / rate
    const chord = chords[Math.min(3, Math.floor(time / 4))]
    const step = Math.floor(time / 0.5)
    const f = chord[step % 3] * (step % 6 >= 3 ? 2 : 1)
    const local = time % 0.5
    const env = Math.exp(-local * 5) * Math.min(1, local * 80)
    const s = (Math.sin(2 * Math.PI * f * time) * 0.6 + Math.sin(2 * Math.PI * f * 2 * time) * 0.15) * env
    v.setInt16(44 + k * 2, Math.max(-1, Math.min(1, s)) * 0x6fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

const PY_SCRIPT = `# ebbinghaus.py — simula a curva do esquecimento
import math

def retencao(t_dias, estabilidade):
    """R = e^(-t/S)"""
    return math.exp(-t_dias / estabilidade)

for s in (1, 3, 10):
    linha = [f"{retencao(t, s):.0%}" for t in (0, 1, 2, 7, 30)]
    print(f"S={s:>2}:", "  ".join(linha))
`

/* ---------- IDs fixos ---------- */
const N = {
  root: 'n-root',
  neuro: 'n-neuro',
  neuronio: 'n-neuronio',
  ltp: 'n-ltp',
  mem: 'n-mem',
  curva: 'n-curva',
  srs: 'n-srs',
  lib: 'n-lib',
  pdf: 'n-pdf',
  mapa: 'n-mapa',
  fluxo: 'n-fluxo',
}
const T = {
  neuronio: 't-neuronio',
  sinapse: 't-sinapse',
  nt: 't-neurotransmissor',
  dopa: 't-dopamina',
  glu: 't-glutamato',
  hipo: 't-hipocampo',
  cons: 't-consolidacao',
  plast: 't-plasticidade',
  ltp: 't-ltp',
  mielina: 't-mielina',
  axonio: 't-axonio',
  curva: 't-curva',
  srs: 't-srs',
  recall: 't-recall',
}
const F = { img: 'f-neuronio', pdf: 'f-artigo', wav: 'f-aula', py: 'f-script' }

export async function seedDatabase() {
  const now = Date.now()

  /* ----- arquivos ----- */
  const transcript: Cue[] = [
    { t: 0, text: 'Introdução: por que esquecemos o que estudamos?' },
    { t: 4, text: 'A curva do esquecimento de Ebbinghaus.' },
    { t: 8, text: 'Revisar no momento certo: a repetição espaçada.' },
    { t: 12, text: 'Recuperação ativa: testar a memória em vez de reler.' },
  ]
  const blobs: [string, string, Blob, Cue[]?][] = [
    [F.img, 'neuronio.svg', neuronSvg()],
    [
      F.pdf,
      'ebbinghaus-memoria.pdf',
      makePdf([
        [
          '# Sobre a Memória (resumo de estudo)',
          'Hermann Ebbinghaus, 1885 - notas de demonstração',
          '',
          'A retenção de uma informação recém-aprendida cai rapidamente nas',
          'primeiras horas e depois se estabiliza. Esse padrão ficou conhecido',
          'como curva do esquecimento.',
          '',
          'A retenção pode ser aproximada por R = exp(-t / S), em que t é o',
          'tempo desde o estudo e S é a estabilidade da memória.',
          '',
          'Selecione qualquer trecho deste texto e clique em "Extrair para Nota".',
        ],
        [
          '# Como achatar a curva',
          '',
          '1. Repetição espaçada: revisar em intervalos crescentes.',
          '2. Recuperação ativa: tentar lembrar antes de consultar a resposta.',
          '3. Sono: a consolidação depende do hipocampo durante o sono.',
          '',
          'Cada revisão bem-sucedida aumenta a estabilidade S, de modo que a',
          'próxima revisão pode acontecer mais tarde.',
        ],
        ['# Referências', '', 'Ebbinghaus, H. (1885). Über das Gedächtnis.', 'Bliss & Lømo (1973). Potenciação de longo prazo no hipocampo.'],
      ]),
    ],
    [F.wav, 'aula-memoria.wav', makeWav(), transcript],
    [F.py, 'ebbinghaus.py', new Blob([PY_SCRIPT], { type: 'text/x-python' })],
  ]
  const files: FileMeta[] = blobs.map(([id, name, blob, tr]) => ({ id, name, type: blob.type, size: blob.size, createdAt: now, transcript: tr, rev: 0 }))
  await db.blobs.bulkPut(blobs.map(([id, , blob]) => ({ id, blob })))
  await db.files.bulkPut(files)
  const fileMap = Object.fromEntries(files.map((f) => [f.id, f]))

  /* ----- glossário ----- */
  const term = (id: string, name: string, aliases: string[], html: string, pageId: string | null = null, fileId: string | null = null): Term => ({
    id,
    term: name,
    aliases,
    html,
    pageId,
    fileId,
    createdAt: now,
    updatedAt: now,
  })
  const terms: Term[] = [
    term(T.neuronio, 'neurônio', ['neurônios'], '<p>Célula do sistema nervoso especializada em receber, integrar e transmitir sinais. Recebe pelos dendritos, conduz pelo axônio e comunica-se com outras células através da sinapse.</p>', N.neuronio, F.img),
    term(T.sinapse, 'sinapse', ['sinapses'], '<p>Junção entre dois neurônios onde o sinal é transmitido, em geral pela liberação de um neurotransmissor na fenda sináptica.</p><p>É o principal palco da plasticidade sináptica.</p>'),
    term(T.nt, 'neurotransmissor', ['neurotransmissores'], '<p>Molécula mensageira liberada na sinapse. Exemplos: glutamato (excitatório) e dopamina (motivação e recompensa).</p>'),
    term(T.dopa, 'dopamina', [], '<p>Neurotransmissor ligado à motivação, recompensa e ao <i>erro de predição</i>. Modula o quanto o hipocampo prioriza uma memória.</p>'),
    term(T.glu, 'glutamato', [], '<p>Principal neurotransmissor excitatório do cérebro. Ativa os receptores AMPA e NMDA, essenciais para a potenciação de longo prazo.</p>'),
    term(T.hipo, 'hipocampo', [], '<p>Estrutura do lobo temporal essencial para formar novas memórias declarativas e para a consolidação.</p>'),
    term(T.cons, 'consolidação', [], '<p>Processo pelo qual memórias recentes e frágeis tornam-se estáveis — em boa parte durante o sono. Depende do hipocampo.</p>'),
    term(T.plast, 'plasticidade sináptica', [], '<p>Capacidade da sinapse de se fortalecer ou enfraquecer com o uso. Sua forma mais estudada é a potenciação de longo prazo.</p>'),
    term(T.ltp, 'potenciação de longo prazo', ['LTP'], '<p>Fortalecimento duradouro de uma sinapse após estimulação repetida — <b>“neurônios que disparam juntos, conectam-se juntos”</b>.</p><p>É a provável base celular da memória.</p>', N.ltp),
    term(T.mielina, 'mielina', ['bainha de mielina'], '<p>Camada lipídica que envolve o axônio e acelera a condução do impulso (condução saltatória).</p>'),
    term(T.axonio, 'axônio', ['axônios'], '<p>Prolongamento do neurônio que conduz o potencial de ação do corpo celular até os terminais. Pode ser recoberto por mielina.</p>'),
    term(T.curva, 'curva do esquecimento', [], '<p>Modelo de Ebbinghaus para a queda da retenção ao longo do tempo:</p><p>$R = e^{-t/S}$</p><p>onde $t$ é o tempo e $S$ a estabilidade da memória. A repetição espaçada aumenta $S$.</p>', N.curva, F.pdf),
    term(T.srs, 'repetição espaçada', ['SRS'], '<p>Técnica de revisar a informação em intervalos crescentes, pouco antes de esquecê-la. Rende mais quando combinada com a recuperação ativa.</p>', N.srs),
    term(T.recall, 'recuperação ativa', ['active recall'], '<p>Testar a própria memória em vez de reler. O esforço de lembrar fortalece o traço de memória (<i>efeito de teste</i>) e favorece a consolidação.</p>', N.srs),
  ]
  await db.terms.bulkPut(terms)

  /* ----- hotspots da imagem ----- */
  const hotspots: Hotspot[] = [
    { id: 'h1', fileId: F.img, x: 0.222, y: 0.5, label: 'Corpo celular (soma)', html: '<p>Contém o núcleo e integra os sinais recebidos. Se a soma dos estímulos ultrapassar o limiar, o neurônio dispara um potencial de ação.</p>', termId: T.neuronio },
    { id: 'h2', fileId: F.img, x: 0.075, y: 0.27, label: 'Dendritos', html: '<p>Ramificações que <b>recebem</b> sinais de outros neurônios. Cada espinha dendrítica abriga uma sinapse.</p>', termId: null },
    { id: 'h3', fileId: F.img, x: 0.555, y: 0.44, label: 'Axônio mielinizado', html: '<p>O axônio conduz o impulso; a mielina faz o sinal “saltar” entre os nós, chegando a $v \\approx 120\\ \\text{m/s}$.</p>', termId: T.mielina },
    { id: 'h4', fileId: F.img, x: 0.945, y: 0.5, label: 'Terminal sináptico', html: '<p>Aqui o sinal elétrico vira químico: vesículas liberam o neurotransmissor na fenda.</p>', termId: T.sinapse },
  ]
  await db.hotspots.bulkPut(hotspots)

  /* ----- páginas ----- */
  const canvas: CanvasData = {
    items: [
      { id: 'c1', type: 'text', x: 420, y: 60, w: 240, h: 70, html: '<b>Aprender a aprender</b><br>mapa mental (canvas livre)', color: '#f43f5e' },
      { id: 'c2', type: 'text', x: 120, y: 250, w: 230, h: 90, html: 'Codificar: atenção + dopamina marcam o que importa', color: '#f59e0b' },
      { id: 'c3', type: 'text', x: 430, y: 270, w: 230, h: 90, html: 'Consolidar: hipocampo e sono → consolidação', color: '#22c55e' },
      { id: 'c4', type: 'text', x: 740, y: 250, w: 240, h: 90, html: 'Recuperar: recuperação ativa + repetição espaçada', color: '#3b82f6' },
      { id: 'c5', type: 'text', x: 430, y: 470, w: 250, h: 80, html: 'Dica: dê duplo clique para editar, use a caneta para desenhar e a seta para conectar caixas.', color: '#a855f7' },
    ],
    strokes: [
      {
        id: 's1',
        color: '#f43f5e',
        width: 3,
        points: Array.from({ length: 40 }, (_, k) => [410 + k * 6.6, 140 + Math.sin(k / 2.5) * 6] as [number, number]),
      },
    ],
    connectors: [
      { id: 'k1', from: 'c1', to: 'c2' },
      { id: 'k2', from: 'c1', to: 'c3' },
      { id: 'k3', from: 'c1', to: 'c4' },
      { id: 'k4', from: 'c2', to: 'c3' },
      { id: 'k5', from: 'c3', to: 'c4' },
    ],
  }

  // fluxograma de exemplo: formas, setas em ângulo e rótulos
  const flow: CanvasData = {
    items: [
      { id: 'f1', type: 'shape', shape: 'round', x: 320, y: 40, w: 160, h: 60, html: 'Início', color: '#22c55e' },
      { id: 'f2', type: 'shape', shape: 'rect', x: 310, y: 150, w: 180, h: 70, html: 'Estudar o conteúdo', color: '#3b82f6' },
      { id: 'f3', type: 'shape', shape: 'parallelogram', x: 300, y: 270, w: 200, h: 70, html: 'Criar lacunas e termos', color: '#06b6d4' },
      { id: 'f4', type: 'shape', shape: 'diamond', x: 310, y: 390, w: 180, h: 110, html: 'Lembrei na revisão?', color: '#f59e0b' },
      { id: 'f5', type: 'shape', shape: 'rect', x: 580, y: 410, w: 190, h: 70, html: 'Aumentar o intervalo', color: '#22c55e' },
      { id: 'f6', type: 'shape', shape: 'rect', x: 40, y: 410, w: 180, h: 70, html: 'Revisar amanhã', color: '#ef4444' },
      { id: 'f7', type: 'shape', shape: 'cylinder', x: 600, y: 540, w: 150, h: 90, html: 'Memória de longo prazo', color: '#a855f7' },
      { id: 'f8', type: 'text', x: 560, y: 60, w: 250, h: 64, html: 'Dica: selecione várias formas arrastando no vazio e use os botões de alinhar.', color: '#94a3b8' },
    ],
    strokes: [],
    connectors: [
      { id: 'fk1', from: 'f1', to: 'f2', kind: 'elbow' },
      { id: 'fk2', from: 'f2', to: 'f3', kind: 'elbow' },
      { id: 'fk3', from: 'f3', to: 'f4', kind: 'elbow' },
      { id: 'fk4', from: 'f4', to: 'f5', kind: 'elbow', label: 'sim' },
      { id: 'fk5', from: 'f4', to: 'f6', kind: 'elbow', label: 'não' },
      { id: 'fk6', from: 'f6', to: 'f2', kind: 'elbow' },
      { id: 'fk7', from: 'f5', to: 'f7', kind: 'elbow' },
    ],
  }

  const emptyCanvas = (): CanvasData => ({ items: [], strokes: [], connectors: [] })
  const cards: Card[] = []
  let order = 0
  const node = (id: string, parentId: string | null, kind: TreeNode['kind'], icon: string, title: string, tags: TreeNode['tags'], content: J, extra: Partial<TreeNode> = {}): TreeNode => {
    const info = analyzeDoc(content)
    for (const c of info.clozes) cards.push(newCard({ id: c.id, type: 'cloze', refId: c.id, pageId: id, front: c.context, back: c.text }))
    const mediaKinds = [...new Set(info.fileIds.map((f) => mediaKind(fileMap[f].type, fileMap[f].name)))] as MediaKind[]
    return {
      id,
      parentId,
      order: order++,
      kind,
      title,
      icon,
      tags,
      collapsed: false,
      mode: 'doc',
      content,
      canvas: emptyCanvas(),
      text: info.text,
      termIds: info.termIds,
      linkIds: info.linkIds,
      fileIds: info.fileIds,
      mediaKinds,
      masteryManual: null,
      createdAt: now,
      updatedAt: now,
      ...extra,
    }
  }

  const nodes: TreeNode[] = [
    node(
      N.root,
      null,
      'notebook',
      '🍒',
      'Aprender a Aprender',
      [{ label: 'demo', color: '#ec4899' }],
      doc(
        h(1, 'Bem-vindo ao Notepad Everywhere'),
        p('Um caderno hierárquico (estilo CherryTree) com a liberdade do OneNote e um ', b('glossário vivo'), ': cada conceito definido vira um pop-up contextual que aparece em qualquer nota.'),
        callout('tip', p(b('Experimente agora: '), 'passe o mouse sobre ', gt('sinapse', T.sinapse), '. Dentro do pop-up, passe o mouse sobre ', i('neurotransmissor'), ' e depois sobre ', i('dopamina'), ' — os pop-ups abrem em cascata. Clique em um termo para fixá-lo, arrastar, redimensionar e editar.')),
        h(2, 'Roteiro de teste rápido'),
        tasks(
          [true, 'Abrir este caderno de exemplo'],
          [false, 'Selecionar um trecho de texto → ', b('+ Significado'), ' (cria um termo no glossário)'],
          [false, 'Selecionar um trecho → ', b('Lacuna (Cloze)'), ' ou ', t('Ctrl+Shift+C', { type: 'code' }), ' e ligar o ', b('Modo Estudo'), ' na barra superior'],
          [false, 'Ver os pins da imagem em ', pl('Neurônio e Sinapse', N.neuronio)],
          [false, 'Rodar os snippets JS/Python em ', pl('Curva do Esquecimento', N.curva)],
          [false, 'Marcar um timestamp no áudio de ', pl('Repetição Espaçada & Recuperação Ativa', N.srs)],
          [false, 'Selecionar texto no PDF e clicar em “Extrair para Nota” em ', pl('Artigo em PDF', N.pdf)],
          [false, 'Alternar para o ', pl('Mapa Mental', N.mapa), ' (modo Canvas livre)'],
          [false, 'Abrir a paleta de comandos com ', t('Ctrl+K', { type: 'code' }), ' e o Modo Zen com ', t('F11', { type: 'code' })],
        ),
        h(2, 'Como o conhecimento se conecta'),
        p('Termos definidos são reconhecidos automaticamente em qualquer nota — por exemplo, esta frase menciona hipocampo, mielina e repetição espaçada sem nenhum link manual. O sublinhado pontilhado indica um termo reconhecido; o sublinhado sólido, um termo linkado explicitamente.'),
        p('O ponto colorido ao lado de cada página na árvore é o ', b('mapa de calor de domínio'), ': vermelho = novo, amarelo = em aprendizagem, verde = dominado. Ele é calculado a partir das revisões (SRS) dos termos e lacunas da página; clique nele para definir manualmente.'),
      ),
    ),
    node(N.neuro, N.root, 'section', '🧠', 'Neurociência', [{ label: 'biologia', color: '#22c55e' }], doc(h(1, 'Neurociência'), p('Bases biológicas da aprendizagem. Comece por ', pl('Neurônio e Sinapse', N.neuronio), ' e avance para ', pl('Potenciação de Longo Prazo', N.ltp), '.'))),
    node(
      N.neuronio,
      N.neuro,
      'page',
      '🔬',
      'Neurônio e Sinapse',
      [{ label: 'imagem', color: '#06b6d4' }],
      doc(
        h(1, 'Neurônio e Sinapse'),
        p('O ', gt('neurônio', T.neuronio), ' é a unidade básica de processamento do cérebro. O cérebro humano tem cerca de ', cz('86 bilhões', 'cz-86b'), ' deles, e cada um pode formar milhares de conexões.'),
        p('A comunicação acontece na ', gt('sinapse', T.sinapse), ': o impulso percorre o ', gt('axônio', T.axonio), ', e no terminal é liberado um ', gt('neurotransmissor', T.nt), ' que se liga a receptores do neurônio seguinte.'),
        h(2, 'Imagem com hotspots'),
        p('A figura abaixo tem ', b('pins interativos'), '. Passe o mouse sobre eles; use a barra da imagem para zoom, rotação, recorte e para criar novos pins.'),
        media(F.img),
        h(2, 'Teste sua memória'),
        ul(
          ['A camada que acelera a condução no axônio é a ', cz('mielina', 'cz-mielina'), '.'],
          ['O principal neurotransmissor excitatório é o ', cz('glutamato', 'cz-glu'), '.'],
        ),
        callout('info', p('Quando uma sinapse é usada repetidamente ela se fortalece — veja ', pl('Potenciação de Longo Prazo', N.ltp), '.')),
      ),
    ),
    node(
      N.ltp,
      N.neuro,
      'page',
      '⚡',
      'Potenciação de Longo Prazo',
      [],
      doc(
        h(1, 'Potenciação de Longo Prazo (LTP)'),
        p('A ', gt('potenciação de longo prazo', T.ltp), ' foi descrita em 1973 no ', gt('hipocampo', T.hipo), ' de coelhos. É a forma mais estudada de ', gt('plasticidade sináptica', T.plast), '.'),
        p('Mecanismo resumido: o glutamato ativa receptores NMDA, entra ', mi('Ca^{2+}'), ' no neurônio pós-sináptico e mais receptores AMPA são inseridos na membrana.'),
        quote(p(i('“Neurônios que disparam juntos, conectam-se juntos.”'), ' — regra de Hebb')),
        p('Durante o sono, a consolidação reativa esses circuitos. É por isso que a ', pl('Repetição Espaçada', N.srs), ' funciona melhor distribuída em vários dias.'),
      ),
    ),
    node(N.mem, N.root, 'section', '⏳', 'Memória & Retenção', [{ label: 'método', color: '#f59e0b' }], doc(h(1, 'Memória & Retenção'), p('Por que esquecemos e como estudar de forma que o conhecimento permaneça.'))),
    node(
      N.curva,
      N.mem,
      'page',
      '📉',
      'Curva do Esquecimento',
      [{ label: 'fórmula', color: '#a855f7' }],
      doc(
        h(1, 'Curva do Esquecimento'),
        p('A ', gt('curva do esquecimento', T.curva), ' descreve como a retenção ', mi('R'), ' cai com o tempo ', mi('t'), ' quando não há revisão:'),
        math('R(t) = e^{-t/S}'),
        p('Quanto maior a estabilidade ', mi('S'), ', mais lenta é a queda. Sem revisão, esquecemos cerca de ', cz('metade', 'cz-metade'), ' do conteúdo novo em poucos dias.'),
        table(['Tempo desde o estudo', 'Retenção (S = 2 dias)', 'Retenção (S = 10 dias)'], ['1 dia', '61%', '90%'], ['7 dias', '3%', '50%'], ['30 dias', '≈ 0%', '5%']),
        h(2, 'Snippets executáveis'),
        p('Clique em ', b('▶ Executar'), ' para rodar o código direto na nota.'),
        code('javascript', `// Retenção após t dias para diferentes estabilidades\nconst R = (t, S) => Math.exp(-t / S)\nfor (const S of [1, 3, 10]) {\n  const linha = [0, 1, 2, 7, 30].map(t => (R(t, S) * 100).toFixed(0) + '%')\n  console.log('S=' + S, linha.join('  '))\n}`),
        code('python', `import math\n\ndef retencao(t, s):\n    return math.exp(-t / s)\n\n# Em quantos dias a retenção cai para 90%?\nfor s in (1, 3, 10, 30):\n    t = -s * math.log(0.9)\n    print(f"S={s:>2} -> revisar em {t:.1f} dias")`),
        callout('warn', p('O snippet Python usa o Pyodide, baixado da internet na primeira execução (alguns segundos).')),
      ),
    ),
    node(
      N.srs,
      N.mem,
      'page',
      '🔁',
      'Repetição Espaçada & Recuperação Ativa',
      [{ label: 'áudio', color: '#3b82f6' }],
      doc(
        h(1, 'Repetição Espaçada & Recuperação Ativa'),
        p('A ', gt('repetição espaçada', T.srs), ' agenda cada revisão para pouco antes do esquecimento. A ', gt('recuperação ativa', T.recall), ' garante que cada revisão seja um ', cz('teste', 'cz-teste'), ', não uma releitura.'),
        h(2, 'Aula em áudio (demonstração)'),
        p('O player abaixo tem controle de velocidade, loop A–B, transcrição clicável e o botão ', b('Marcar Timestamp'), '. O link a seguir pula direto para o trecho: ', ml('⏱ 0:08 — repetição espaçada', F.wav, { time: 8 }), '.'),
        media(F.wav),
        h(2, 'Meu protocolo de estudo'),
        tasks([true, 'Ler o material uma vez, com atenção'], [true, 'Transformar os pontos-chave em lacunas e termos do glossário'], [false, 'Revisar a fila do dia (aba Glossário & Revisão)'], [false, 'Fazer 4 ciclos de Pomodoro com ruído marrom']),
      ),
    ),
    node(N.lib, N.root, 'section', '📎', 'Biblioteca de Mídia', [], doc(h(1, 'Biblioteca de Mídia'), p('Arraste e solte ou cole (Ctrl+V) qualquer arquivo em uma nota: imagens, vídeos, áudios, PDFs, ZIPs, scripts…'))),
    node(
      N.pdf,
      N.lib,
      'page',
      '📄',
      'Artigo em PDF',
      [{ label: 'pdf', color: '#ef4444' }],
      doc(
        h(1, 'Artigo em PDF e arquivos genéricos'),
        p('Selecione um trecho no PDF abaixo e clique em ', b('Extrair para Nota'), '. A citação criada guarda um backlink que reabre o PDF na página exata.'),
        media(F.pdf),
        quote(p('Cada revisão bem-sucedida aumenta a estabilidade S, de modo que a próxima revisão pode acontecer mais tarde.'), p(ml('📄 ebbinghaus-memoria.pdf — p. 2', F.pdf, { page: 2 }))),
        h(2, 'Arquivo genérico'),
        p('Arquivos sem visualizador dedicado viram cartões com metadados, prévia de texto e download:'),
        media(F.py),
      ),
    ),
    node(N.mapa, N.root, 'page', '🗺️', 'Mapa Mental', [{ label: 'canvas', color: '#06b6d4' }], doc(p('Esta página está em modo Canvas. Alterne para Documento na barra superior para escrever texto corrido.')), { mode: 'canvas', canvas }),
    node(N.fluxo, N.root, 'page', '🔀', 'Fluxograma de Revisão', [{ label: 'diagrama', color: '#a855f7' }], doc(p('Esta página é um diagrama. Use as formas da barra do canvas para montar fluxogramas.')), { mode: 'canvas', canvas: flow }),
  ]
  // texto do canvas indexado para busca
  const mapa = nodes.find((n) => n.id === N.mapa)!
  mapa.text += '\n' + canvas.items.map((it) => (it.html || '').replace(/<[^>]+>/g, ' ')).join('\n')
  const fluxo = nodes.find((n) => n.id === N.fluxo)!
  fluxo.text += '\n' + flow.items.map((it) => it.html || '').join('\n')
  await db.nodes.bulkPut(nodes)

  /* ----- cartões SRS com estados variados (mapa de calor) ----- */
  for (const tm of terms) cards.push(newCard({ id: 'term:' + tm.id, type: 'term', refId: tm.id, pageId: null, front: tm.term, back: tm.html }))
  const state = (id: string, interval: number, reps: number, dueIn: number) => {
    const c = cards.find((x) => x.id === id)
    if (c) Object.assign(c, { interval, reps, ease: 2.6, last: now - interval * DAY, due: now + dueIn * DAY })
  }
  state('term:' + T.curva, 34, 6, 12) // dominado
  state('cz-metade', 28, 5, 9)
  state('term:' + T.srs, 30, 5, -0.1) // dominado, vence hoje
  state('term:' + T.recall, 3, 2, 1) // aprendendo
  state('cz-teste', 3, 2, -0.2)
  state('term:' + T.neuronio, 3, 2, -0.5)
  state('term:' + T.sinapse, 1, 1, -0.2)
  await db.cards.bulkPut(cards)

  /* ----- sessões Pomodoro de exemplo (ontem) ----- */
  await db.sessions.bulkPut([
    { id: 'ss1', pageId: N.neuronio, pageTitle: 'Neurônio e Sinapse', kind: 'focus', start: now - DAY - 3600000, seconds: 1500, completed: true },
    { id: 'ss2', pageId: N.curva, pageTitle: 'Curva do Esquecimento', kind: 'focus', start: now - DAY, seconds: 1500, completed: true },
  ])
  await db.settings.put({ key: 'currentId', value: N.root })
}

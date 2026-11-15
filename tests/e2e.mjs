// Testes de ponta a ponta: abrem o app empacotado (release/win-unpacked) num perfil temporário e o dirigem
// pelo protocolo de depuração do Chromium, com mouse e teclado de verdade.
//   npm run dist && npm test
//   node tests/e2e.mjs [filtro]     → roda só os testes cujo nome contém o filtro
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXE = path.join(ROOT, 'release', 'win-unpacked', 'Notepad Everywhere.exe')
const PORT = 9400 + Math.floor(Math.random() * 400)
const FILTER = (process.argv[2] || '').toLowerCase()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!existsSync(EXE)) {
  console.error('App empacotado não encontrado. Rode "npm run dist" antes.')
  process.exit(2)
}

const profile = mkdtempSync(path.join(tmpdir(), 'ne-test-profile-'))
const cloud = mkdtempSync(path.join(tmpdir(), 'ne-test-onedrive-'))
// OneDrive falso: o botão "Conectar OneDrive" grava aqui, nunca na nuvem de quem roda os testes
const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], { env: { ...process.env, OneDrive: cloud, OneDriveConsumer: '', OneDriveCommercial: '' }, stdio: 'ignore' })

/* ---------- conexão CDP ---------- */
let ws, seq = 0
const pageErrors = []
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('app://'))
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)))
        ws.addEventListener('message', (e) => {
          const m = JSON.parse(e.data)
          if (m.method === 'Runtime.exceptionThrown') pageErrors.push(String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text).slice(0, 300))
        })
        await call('Runtime.enable')
        await call('Page.bringToFront')
        // a página se comporta como focada mesmo se a janela perder o foco (alguém usando o PC durante os testes)
        await call('Emulation.setFocusEmulationEnabled', { enabled: true })
        return
      }
    } catch {}
    await sleep(500)
  }
  throw new Error('O app não abriu a porta de depuração.')
}
const call = (method, params = {}) =>
  new Promise((res) => {
    const id = ++seq
    const h = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === id) (ws.removeEventListener('message', h), res(m.result))
    }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id, method, params }))
  })
async function ev(expression) {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r?.exceptionDetails) throw new Error('erro na página: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300))
  return r?.result?.value
}
const js = (v) => JSON.stringify(v)

/* ---------- ajudantes de interface ---------- */
const prep = () => ev(`window.confirm = () => true; window.alert = (m) => { window.__alert = m }; if (!window.__N) { window.__N = []; function F(title, o) { const n = { title, body: o && o.body, onclick: null, close() {} }; window.__N.push(n); return n } F.permission = 'granted'; F.requestPermission = async () => 'granted'; window.Notification = F } true`)
async function waitFor(expr, ms = 6000, what = expr) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const v = await ev(expr).catch(() => null)
    if (v) return v
    await sleep(120)
  }
  throw new Error('tempo esgotado esperando: ' + what)
}
async function reloaded() {
  await sleep(1500)
  await waitFor(`!!document.querySelector('.tree-row')`, 15000, 'app recarregar')
  await prep()
}
const rect = async (selOrExpr, isExpr = false) => {
  const r = await ev(`(() => { const e = ${isExpr ? selOrExpr : `document.querySelector(${js(selOrExpr)})`}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, w: r.width, h: r.height } })()`)
  if (!r) throw new Error('elemento não encontrado: ' + selOrExpr)
  return r
}
const mouse = (type, x, y, extra = {}) => call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra })
const move = (x, y) => call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
async function clickAt(x, y) {
  await move(x, y)
  await mouse('mousePressed', x, y, { buttons: 1 })
  await mouse('mouseReleased', x, y)
}
async function dragTo(x0, y0, x1, y1) {
  await move(x0, y0)
  await mouse('mousePressed', x0, y0, { buttons: 1 })
  for (let i = 1; i <= 6; i++) {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + ((x1 - x0) * i) / 6, y: y0 + ((y1 - y0) * i) / 6, button: 'left', buttons: 1 })
    await sleep(40)
  }
  await mouse('mouseReleased', x1, y1)
}
const btnExpr = (text, scope = 'document') => `[...${scope}.querySelectorAll('button')].find(b => b.innerText.trim().startsWith(${js(text)}))`
// Os dois esperam até 3 s o botão existir: telas carregadas sob demanda aparecem um instante depois do clique que as abre.
async function clickBtn(text, scope) {
  await waitFor(`(() => { try { return !!${btnExpr(text, scope)} } catch { return false } })()`, 3000, 'botão: ' + text).catch(() => {
    throw new Error('botão não encontrado: ' + text)
  })
  await ev(`(() => { const b = ${btnExpr(text, scope)}; b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); b.click(); return true })()`)
}
async function clickTitle(title, scope = 'document') {
  await waitFor(`(() => { try { return !!${scope}.querySelector('button[title^=${js(title)}]') } catch { return false } })()`, 3000, 'botão: ' + title).catch(() => {
    throw new Error('botão (dica) não encontrado: ' + title)
  })
  await ev(`(() => { const b = ${scope}.querySelector('button[title^=${js(title)}]'); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); b.click(); return true })()`)
}
async function openPage(name) {
  const ok = await ev(`(() => { const r = [...document.querySelectorAll('.tree-row')].find(r => r.querySelector('.truncate')?.innerText.trim() === ${js(name)}); if (!r) return false; r.click(); return true })()`)
  if (!ok) throw new Error('página não encontrada na árvore: ' + name)
  await waitFor(`document.querySelector('input.font-semibold')?.value === ${js(name)}`, 4000, 'abrir ' + name)
  await sleep(350)
}
const rows = () => ev(`document.querySelectorAll('.tree-row').length`)
const type = (text) => call('Input.insertText', { text })
const key = async (k, code, vk, mods = 0) => {
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
}
const focusEditorEnd = async () => {
  await ev(`(() => { const pm = document.querySelector('.ProseMirror'); pm.focus(); const r = document.createRange(); r.selectNodeContents(pm.lastElementChild || pm); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true })()`)
  await sleep(200) // o editor lê a nova posição do cursor de forma assíncrona
}
/** seleciona a 1ª ocorrência de uma palavra dentro do seletor */
const selectWord = (word, sel = '.ProseMirror') =>
  ev(`(() => { const root = document.querySelector(${js(sel)}); const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); while (w.nextNode()) { const i = w.currentNode.data.indexOf(${js(word)}); if (i >= 0) { const r = document.createRange(); r.setStart(w.currentNode, i); r.setEnd(w.currentNode, i + ${word.length}); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true } } return false })()`)
const dbCount = (store) => ev(`new Promise(res => { const o = indexedDB.open('notepad-everywhere'); o.onsuccess = () => { o.result.transaction(${js(store)}).objectStore(${js(store)}).count().onsuccess = e => res(e.target.result) } })`)
const closeDialogs = () => ev(`(() => { for (let i = 0; i < 4; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true })()`)
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

/* ---------- os testes (rodam em ordem; um depende do estado deixado pelo anterior) ---------- */
const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('primeira abertura: boas-vindas e caderno vazio', async () => {
  await waitFor(`!!document.querySelector('[role=dialog][aria-label^="Bem-vindo"]')`, 8000, 'tela de boas-vindas')
  await clickBtn('Começar a escrever')
  assert((await rows()) === 1, 'esperava 1 página, veio ' + (await rows()))
  assert((await dbCount('terms')) === 0, 'glossário deveria começar vazio')
  await clickTitle('Mais opções')
  await clickBtn('Notificações na área de trabalho')
  await waitFor(`!!${btnExpr('Testar notificação')}`, 4000, 'diálogo de notificações abrir')
  await closeDialogs()
})

test('criar significado pela seleção e reconhecimento automático', async () => {
  await focusEditorEnd()
  await type('A mitocôndria produz energia para a célula.')
  await sleep(300)
  assert(await selectWord('mitocôndria'), 'não selecionou a palavra')
  await waitFor(`!!${btnExpr('+ Adicionar Significado')}`, 3000, 'menu flutuante de seleção')
  await clickBtn('+ Adicionar Significado')
  await waitFor(`!!document.querySelector('.rich-input')`, 3000, 'diálogo de significado')
  await ev(`document.querySelector('.rich-input').focus()`)
  await type('Organela que gera ATP; a "usina" da célula.')
  await clickBtn('Salvar significado')
  await waitFor(`document.querySelector('.ProseMirror .gloss-term')?.innerText === 'mitocôndria'`, 3000, 'termo marcado no texto')
  await waitFor(`new Promise(res => { const o = indexedDB.open('notepad-everywhere'); o.onsuccess = () => { o.result.transaction('terms').objectStore('terms').count().onsuccess = e => res(e.target.result === 1) } })`, 3000, 'termo gravado no banco')
  // outra página: o termo deve ser reconhecido sem link manual
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', altKey: true, bubbles: true, cancelable: true }))`)
  await waitFor(`document.querySelectorAll('.tree-row').length === 2`, 3000, 'atalho Alt+N criar página')
  await sleep(400)
  await focusEditorEnd()
  await type('Sem mitocôndria não há respiração celular.')
  await waitFor(`document.querySelector('.ProseMirror .gloss-auto')?.innerText === 'mitocôndria'`, 3000, 'reconhecimento automático')
})

test('pop-up ao passar o mouse e fixar com clique', async () => {
  const r = await rect('.ProseMirror .gloss-auto')
  await move(r.x, r.y)
  await waitFor(`document.querySelector('[data-pop-depth="0"]')?.innerText.includes('Organela')`, 3000, 'pop-up de hover')
  await clickAt(r.x, r.y)
  await waitFor(`document.querySelector('[data-pop-depth="-1"]')?.innerText.includes('Organela')`, 3000, 'pop-up fixado')
  // arrasta o pop-up fixado pelo cabeçalho
  const h = await rect('[data-pop-depth="-1"] .cursor-grab')
  await dragTo(h.left + 30, h.y, h.left + 190, h.y + 90)
  const after = await rect('[data-pop-depth="-1"] .cursor-grab')
  assert(Math.abs(after.left - h.left - 160) < 12, `pop-up fixado não arrastou (moveu ${Math.round(after.left - h.left)} px)`)
  await clickTitle('Fechar', `document.querySelector('[data-pop-depth="-1"]')`)
  await move(5, 5)
})

test('lacuna (cloze), cartão de revisão e Modo Estudo', async () => {
  await openPage('Meu caderno')
  assert(await selectWord('energia'), 'não selecionou')
  await sleep(250)
  await clickTitle('Ocultar lacuna')
  await waitFor(`document.querySelector('.ProseMirror .cloze')?.innerText === 'energia'`, 3000, 'lacuna criada')
  await waitFor(`new Promise(res => { const o = indexedDB.open('notepad-everywhere'); o.onsuccess = () => { o.result.transaction('cards').objectStore('cards').getAll().onsuccess = e => res(e.target.result.some(c => c.type === 'cloze' && c.back === 'energia' && c.front.includes('[ ... ]'))) } })`, 4000, 'cartão da lacuna')
  await clickBtn('Estudo')
  assert((await ev(`getComputedStyle(document.querySelector('.ProseMirror .cloze')).color`)) === 'rgba(0, 0, 0, 0)', 'lacuna não ficou oculta no Modo Estudo')
  const r = await rect('.ProseMirror .cloze')
  await clickAt(r.x, r.y)
  await waitFor(`[...document.querySelectorAll('[data-pop-depth="-1"]')].some(p => p.innerText.includes('energia') && p.innerText.includes('Fácil'))`, 3000, 'pop-up de avaliação da lacuna')
  await clickBtn('Bom', `[...document.querySelectorAll('[data-pop-depth="-1"]')].find(p => p.innerText.includes('Fácil'))`)
  await clickBtn('Estudo')
})

test('fonte, tamanho e mover bloco', async () => {
  await focusEditorEnd()
  await key('Enter', 'Enter', 13)
  await type('Segundo parágrafo')
  await sleep(200)
  assert(await selectWord('Segundo parágrafo'), 'não selecionou')
  await sleep(200)
  await ev(`(() => { const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })) }; set(document.querySelector('select[title^="Fonte"]'), 'Georgia, serif'); set(document.querySelector('select[title^="Tamanho"]'), '24px'); return true })()`)
  await waitFor(`/Georgia/.test(document.querySelector('.ProseMirror').lastElementChild.innerHTML) && /24px/.test(document.querySelector('.ProseMirror').lastElementChild.innerHTML)`, 3000, 'fonte e tamanho aplicados')
  await clickTitle('Mover o bloco atual para cima')
  const blocks = () => ev(`[...document.querySelector('.ProseMirror').children].map(c => c.innerText.trim().slice(0, 30)).join(' | ')`)
  await waitFor(`document.querySelector('.ProseMirror').firstElementChild.innerText.trim() === 'Segundo parágrafo'`, 3000, 'bloco movido para cima').catch(async (e) => {
    throw new Error(e.message + ' — blocos: ' + (await blocks()))
  })
})

test('Tab indenta no parágrafo, no código e na lista sem tirar o foco do texto', async () => {
  const inEditor = `!!document.activeElement?.closest('.ProseMirror')`
  // página nova para não misturar com as outras
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', altKey: true, bubbles: true, cancelable: true }))`)
  await sleep(500)
  await focusEditorEnd()
  await type('antes')
  await key('Tab', 'Tab', 9)
  await type('depois')
  assert(await ev(inEditor), 'Tab tirou o foco do editor (parágrafo)')
  assert((await ev(`document.querySelector('.ProseMirror').lastElementChild.textContent`)) === 'antes\tdepois', 'Tab não inseriu o recuo no parágrafo: ' + js(await ev(`document.querySelector('.ProseMirror').lastElementChild.textContent`)))
  await key('Tab', 'Tab', 9)
  await key('Tab', 'Tab', 9, 8) // Shift+Tab apaga o recuo anterior ao cursor
  assert((await ev(`document.querySelector('.ProseMirror').lastElementChild.textContent`)) === 'antes\tdepois', 'Shift+Tab não removeu o recuo do parágrafo')
  // lista: Tab cria subnível
  await key('Enter', 'Enter', 13)
  await clickTitle('Lista')
  await type('um')
  await key('Enter', 'Enter', 13)
  await type('dois')
  await key('Tab', 'Tab', 9)
  await waitFor(`document.querySelector('.ProseMirror ul ul li')?.textContent === 'dois'`, 3000, 'Tab criar subnível na lista')
  assert(await ev(inEditor), 'Tab tirou o foco do editor (lista)')
  await key('Tab', 'Tab', 9, 8)
  await waitFor(`!document.querySelector('.ProseMirror ul ul')`, 3000, 'Shift+Tab voltar o nível da lista')
  // código: 4 espaços; Shift+Tab remove; seleção de várias linhas indenta todas
  await key('Enter', 'Enter', 13)
  await key('Enter', 'Enter', 13) // sai da lista
  await clickTitle('Bloco de código')
  await waitFor(`!!document.querySelector('.ProseMirror pre code')`, 3000, 'bloco de código')
  await type('if x:')
  await key('Enter', 'Enter', 13)
  await key('Tab', 'Tab', 9)
  await type('y = 1')
  const code = () => ev(`document.querySelector('.ProseMirror pre code').textContent`)
  assert((await code()) === 'if x:\n    y = 1', 'Tab no código: ' + js(await code()))
  assert(await ev(inEditor), 'Tab tirou o foco do editor (código)')
  await key('Tab', 'Tab', 9, 8)
  assert((await code()) === 'if x:\ny = 1', 'Shift+Tab no código: ' + js(await code()))
  await ev(`(() => { const c = document.querySelector('.ProseMirror pre code'); const r = document.createRange(); r.selectNodeContents(c); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true })()`)
  await sleep(200)
  await key('Tab', 'Tab', 9)
  assert((await code()) === '    if x:\n    y = 1', 'Tab com várias linhas selecionadas: ' + js(await code()))
})

test('canvas embutido: criar caixa, digitar, sair e arrastar', async () => {
  await focusEditorEnd()
  await clickTitle('Inserir um canvas livre')
  await waitFor(`!!document.querySelector('.ProseMirror [style*="radial-gradient"]')`, 3000, 'canvas inserido')
  await ev(`document.querySelector('.ProseMirror button[title^="Caixa de texto"]').click()`)
  // mede a área visível (o contêiner com rolagem), não a superfície inteira de 1800×1200
  const s = await rect(`document.querySelector('.ProseMirror [style*="radial-gradient"]').parentElement`, true)
  await clickAt(s.left + 90, s.top + 70)
  await waitFor(`!!document.querySelector('.ProseMirror .rounded-xl.shadow-lg [contenteditable=true]')`, 3000, 'caixa em edição')
  await type('Ideia no canvas')
  await clickAt(s.left + 520, s.top + 260)
  await waitFor(`document.querySelector('.ProseMirror .cursor-move')?.innerText.trim() === 'Ideia no canvas'`, 3000, 'texto da caixa mantido ao sair')
  const b = await rect('.ProseMirror .cursor-move')
  await dragTo(b.left + 20, b.top + 12, b.left + 170, b.top + 62)
  const b2 = await rect('.ProseMirror .cursor-move')
  assert(Math.abs(b2.left - b.left - 150) < 12, `caixa não arrastou (moveu ${Math.round(b2.left - b.left)} px)`)
  await waitFor(`new Promise(res => { const o = indexedDB.open('notepad-everywhere'); o.onsuccess = () => { o.result.transaction('nodes').objectStore('nodes').getAll().onsuccess = e => res(e.target.result.some(n => n.text.includes('Ideia no canvas'))) } })`, 4000, 'canvas salvo e indexado na busca')
})

test('histórico de versões: restaurar a versão anterior', async () => {
  // nova sessão: a primeira edição de uma página que já tem conteúdo guarda a versão anterior
  await sleep(800)
  await call('Page.reload')
  await reloaded()
  await openPage('Meu caderno')
  await focusEditorEnd()
  await key('Enter', 'Enter', 13)
  await type('TEXTO QUE SERÁ DESFEITO')
  await sleep(900)
  await clickTitle('Histórico de versões')
  await waitFor(`document.querySelectorAll('[role=dialog] .w-52 button').length >= 1`, 4000, 'versão guardada no histórico')
  await clickBtn('Restaurar esta versão')
  await waitFor(`(() => { const t = document.querySelector('.ProseMirror')?.innerText || ''; return t.includes('Segundo parágrafo') && !t.includes('TEXTO QUE SERÁ DESFEITO') })()`, 4000, 'conteúdo voltar à versão anterior')
})

test('lixeira: excluir e restaurar página', async () => {
  const n = await rows()
  await ev(`[...document.querySelectorAll('.tree-row')].pop().querySelector('button[title^="Ícone"]').click()`)
  await clickBtn('Excluir')
  await waitFor(`document.querySelectorAll('.tree-row').length === ${n - 1}`, 3000, 'página sair da árvore')
  await clickTitle('Lixeira')
  await clickBtn('Restaurar')
  await waitFor(`document.querySelectorAll('.tree-row').length === ${n}`, 3000, 'página voltar da lixeira')
  await closeDialogs()
})

test('caderno de exemplo carrega', async () => {
  await clickTitle('Mais opções')
  await clickBtn('Carregar caderno de exemplo')
  await reloaded()
  await waitFor(`document.querySelectorAll('.tree-row').length >= 11`, 8000, 'árvore do exemplo')
  assert((await dbCount('terms')) >= 14, 'esperava ao menos 14 termos, veio ' + (await dbCount('terms')))
})

test('pop-ups em cascata (3 níveis) com o mouse', async () => {
  await openPage('Aprender a Aprender')
  const a = await rect(`[...document.querySelectorAll('.ProseMirror .gloss-term')].find(e => e.innerText === 'sinapse')`, true)
  await move(a.x, a.y)
  await waitFor(`document.querySelector('[data-pop-depth="0"]')?.innerText.includes('Junção')`, 3000, 'pop-up nível 1 (sinapse)')
  const b = await rect(`[...document.querySelectorAll('[data-pop-depth="0"] [data-term-id]')].find(e => e.innerText === 'neurotransmissor')`, true)
  await move((a.x + b.x) / 2, (a.y + b.y) / 2)
  await move(b.x, b.y)
  await waitFor(`document.querySelector('[data-pop-depth="1"]')?.innerText.includes('Molécula mensageira')`, 3000, 'pop-up nível 2 (neurotransmissor)')
  const c = await rect(`[...document.querySelectorAll('[data-pop-depth="1"] [data-term-id]')].find(e => e.innerText === 'dopamina')`, true)
  await move(c.x, c.y)
  await waitFor(`document.querySelector('[data-pop-depth="2"]')?.innerText.includes('motivação')`, 3000, 'pop-up nível 3 (dopamina)')
  assert((await ev(`document.querySelectorAll('[data-pop-depth="0"],[data-pop-depth="1"],[data-pop-depth="2"]').length`)) === 3, 'os três níveis deveriam estar abertos juntos')
  await move(5, 400)
  await waitFor(`!document.querySelector('[data-pop-depth="0"]')`, 3000, 'pop-ups fecharem ao sair')
})

test('imagem: pins, hover, novo pin e recorte', async () => {
  await openPage('Neurônio e Sinapse')
  await waitFor(`document.querySelectorAll('[data-hotspot-id]').length === 4`, 5000, '4 pins')
  const p = await rect('[data-hotspot-id]')
  await move(p.x, p.y)
  await waitFor(`document.querySelector('[data-pop-depth="0"]')?.innerText.includes('Corpo celular')`, 3000, 'pop-up do pin')
  await move(5, 400)
  await waitFor(`!document.querySelector('[data-pop-depth="0"]')`, 3000, 'pop-up do pin fechar')
  await clickBtn('Novo pin')
  const img = await rect('[data-media-host="f-neuronio"] img')
  await clickAt(img.left + img.w * 0.4, img.top + img.h * 0.8)
  await waitFor(`document.querySelectorAll('[data-hotspot-id]').length === 5`, 3000, 'novo pin criado')
  await clickBtn('Salvar', `document.querySelector('[data-pop-depth="-1"]')`)
  await clickTitle('Fechar', `document.querySelector('[data-pop-depth="-1"]')`)
  // recorte: arrasta um retângulo e aplica
  const w0 = await ev(`document.querySelector('[data-media-host="f-neuronio"] img').naturalWidth`)
  await clickTitle('Recortar')
  const i2 = await rect('[data-media-host="f-neuronio"] img')
  await dragTo(i2.left + i2.w * 0.1, i2.top + i2.h * 0.1, i2.left + i2.w * 0.6, i2.top + i2.h * 0.9)
  await clickBtn('Aplicar recorte')
  // o retângulo cobre 50% da largura: a imagem recortada precisa ter ~metade (e não uma lasca)
  await waitFor(`(() => { const i = document.querySelector('[data-media-host="f-neuronio"] img'); return i && i.complete && i.naturalWidth > ${w0} * 0.42 && i.naturalWidth < ${w0} * 0.58 })()`, 5000, 'imagem recortada para ~50% da largura')
  assert((await ev(`document.querySelectorAll('[data-hotspot-id]').length`)) === 3, 'os pins dentro do recorte deveriam continuar (3)')
})

/* ---------- Canvas (página inteira) ---------- */
const CV = {
  surface: `document.querySelector('main [style*="radial-gradient"]')`,
  boxes: `[...document.querySelectorAll('main .absolute.rounded-xl.shadow-lg')]`,
  box: (text) => `[...document.querySelectorAll('main .absolute.rounded-xl.shadow-lg')].find(b => b.innerText.trim().startsWith(${js(text)}))`,
  tool: (t) => ev(`(() => { const b = document.querySelector('main button[title^=${js(t)}]'); if (!b) return false; b.click(); return true })()`),
  view: () => rect(`document.querySelector('main [style*="radial-gradient"]').parentElement`, true),
  counts: () => ev(`({ boxes: document.querySelectorAll('main .absolute.rounded-xl.shadow-lg').length, arrows: document.querySelectorAll('main svg line[marker-end]').length, strokes: document.querySelectorAll('main svg path[stroke-linecap]').length })`),
  saved: (pageTitle) => ev(`new Promise(res => { const o = indexedDB.open('notepad-everywhere'); o.onsuccess = () => { o.result.transaction('nodes').objectStore('nodes').getAll().onsuccess = e => { const n = e.target.result.find(n => n.title === ${js(pageTitle)}); res(n ? { items: n.canvas.items.length, arrows: n.canvas.connectors.length, strokes: n.canvas.strokes.length, texts: n.canvas.items.map(i => (i.html || '').replace(/<[^>]+>/g, '')).join('|'), mode: n.mode } : null) } } })`),
}
/** mede o elemento e clica nele na hora (medir antes e clicar depois falha: medir outro elemento pode rolar a tela) */
const clickOn = async (expr, fx = 0.5, fy = 0.5) => {
  const r = await rect(expr, true)
  await clickAt(r.left + r.w * fx, r.top + r.h * fy)
  return r
}
const dblClickAt = async (x, y) => {
  await move(x, y)
  await mouse('mousePressed', x, y, { buttons: 1 })
  await mouse('mouseReleased', x, y)
  await mouse('mousePressed', x, y, { buttons: 1, clickCount: 2 })
  await mouse('mouseReleased', x, y, { clickCount: 2 })
}
/** cria uma caixa de texto no ponto (dx, dy) da área visível e sai da edição */
async function cvAddBox(dx, dy, text) {
  assert(await CV.tool('Caixa de texto'), 'ferramenta de texto não encontrada')
  const v = await CV.view()
  await clickAt(v.left + dx, v.top + dy)
  await waitFor(`!!document.querySelector('main [contenteditable=true]')`, 3000, 'caixa nova em edição')
  await type(text)
  await clickAt(v.left + v.w - 40, v.top + v.h - 40) // clica no vazio
  await waitFor(`!document.querySelector('main [contenteditable=true]') && !!${CV.box(text)}`, 3000, `caixa "${text}" gravada ao sair da edição`)
}

test('canvas página: alternar modo, criar, editar por duplo clique, pelo botão e com Esc', async () => {
  await clickTitle('Novo caderno')
  await sleep(400)
  await ev(`(() => { const i = document.querySelector('input.font-semibold'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; i.focus(); set.call(i, 'Teste Canvas'); i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); return true })()`)
  await waitFor(`[...document.querySelectorAll('.tree-row')].some(r => r.innerText.includes('Teste Canvas'))`, 3000, 'página renomeada')
  await clickBtn('Canvas')
  await waitFor(`!!${CV.surface}`, 3000, 'modo Canvas abrir')
  await cvAddBox(120, 90, 'Caixa A')
  // duplo clique entra em edição e o texto novo é acrescentado
  let b = await rect(CV.box('Caixa A'), true)
  await dblClickAt(b.x, b.y)
  await waitFor(`!!document.querySelector('main [contenteditable=true]')`, 3000, 'duplo clique abrir a edição')
  await type(' editada')
  const v = await CV.view()
  await clickAt(v.left + v.w - 40, v.top + v.h - 40)
  await waitFor(`!!${CV.box('Caixa A editada')}`, 3000, 'texto editado gravado')
  // botão "Editar texto" + Esc para sair mantendo o texto
  b = await rect(CV.box('Caixa A editada'), true)
  await clickAt(b.left + 12, b.top + 8)
  await clickBtn('Editar texto')
  await waitFor(`!!document.querySelector('main [contenteditable=true]')`, 3000, 'botão Editar texto abrir a edição')
  await type('!')
  await key('Escape', 'Escape', 27)
  await waitFor(`!document.querySelector('main [contenteditable=true]') && !!${CV.box('Caixa A editada!')}`, 3000, 'Esc sair da edição mantendo o texto')
  // caixa vazia não fica sobrando
  assert(await CV.tool('Caixa de texto'), 'ferramenta')
  await clickAt(v.left + 600, v.top + 80)
  await waitFor(`!!document.querySelector('main [contenteditable=true]')`, 3000, 'caixa vazia em edição')
  await clickAt(v.left + v.w - 40, v.top + v.h - 40)
  await waitFor(`${CV.boxes}.length === 1`, 3000, 'caixa vazia ser descartada')
})

test('canvas página: mover, redimensionar e trocar a cor', async () => {
  const b = await rect(CV.box('Caixa A'), true)
  await dragTo(b.left + 20, b.top + 10, b.left + 140, b.top + 70)
  const b2 = await rect(CV.box('Caixa A'), true)
  assert(Math.abs(b2.left - b.left - 120) < 10 && Math.abs(b2.top - b.top - 60) < 10, `caixa não moveu direito: Δx=${Math.round(b2.left - b.left)} Δy=${Math.round(b2.top - b.top)}`)
  // alça de redimensionar (canto inferior direito da caixa selecionada)
  const h = await rect('main .cursor-nwse-resize')
  await dragTo(h.x, h.y, h.x + 90, h.y + 50)
  const b3 = await rect(CV.box('Caixa A'), true)
  assert(Math.abs(b3.w - b2.w - 90) < 10, `largura não mudou como esperado: ${Math.round(b2.w)} → ${Math.round(b3.w)}`)
  assert(b3.h - b2.h > 30, `altura não aumentou: ${Math.round(b2.h)} → ${Math.round(b3.h)}`)
  // cor: 5ª bolinha (azul)
  const before = await ev(`getComputedStyle(${CV.box('Caixa A')}).borderLeftColor`)
  await ev(`document.querySelectorAll('main button.w-4.h-4.rounded-full')[4].click()`)
  await waitFor(`getComputedStyle(${CV.box('Caixa A')}).borderLeftColor !== ${js(before)}`, 3000, 'cor da caixa mudar')
})

test('canvas página: seta entre caixas, desenho à mão e borracha', async () => {
  await cvAddBox(560, 330, 'Caixa B')
  assert(await CV.tool('Conectar duas caixas'), 'ferramenta de seta')
  await clickOn(CV.box('Caixa A'))
  await clickOn(CV.box('Caixa B'))
  await waitFor(`document.querySelectorAll('main svg line[marker-end]').length === 1`, 3000, 'seta criada')
  // a seta acompanha a caixa quando ela é movida
  assert(await CV.tool('Selecionar'), 'ferramenta selecionar')
  // a ponta da seta tem de continuar encostada na borda da Caixa B depois de movê-la
  const tipOnB = `(() => { const l = document.querySelector('main svg line[marker-end]'); const s = ${CV.surface}.getBoundingClientRect(); const r = ${CV.box('Caixa B')}.getBoundingClientRect(); const x = s.left + Number(l.getAttribute('x2')), y = s.top + Number(l.getAttribute('y2')); const inside = x >= r.left - 3 && x <= r.right + 3 && y >= r.top - 3 && y <= r.bottom + 3; const onEdge = Math.min(Math.abs(x - r.left), Math.abs(x - r.right), Math.abs(y - r.top), Math.abs(y - r.bottom)) <= 4; return inside && onEdge })()`
  assert(await ev(tipOnB), 'a ponta da seta não está na borda da Caixa B')
  // posição dentro do canvas (offsetLeft), que não depende da rolagem da tela
  const x0 = await ev(`${CV.box('Caixa B')}.offsetLeft`)
  const b = await rect(CV.box('Caixa B'), true)
  await dragTo(b.left + 15, b.top + 10, b.left + 95, b.top + 50)
  const x1 = await ev(`${CV.box('Caixa B')}.offsetLeft`)
  assert(Math.abs(x1 - x0 - 80) < 10, `Caixa B não moveu 80 px (moveu ${Math.round(x1 - x0)})`)
  await waitFor(tipOnB, 3000, 'seta acompanhar a caixa movida')
  // caneta
  assert(await CV.tool('Desenho livre'), 'ferramenta caneta')
  const v = await CV.view()
  await dragTo(v.left + 120, v.top + 420, v.left + 420, v.top + 420)
  await waitFor(`document.querySelectorAll('main svg path[stroke-linecap]').length === 1`, 3000, 'traço desenhado')
  // um traço gravado tem pointer-events próprio; o "rascunho" em andamento não. Não pode sobrar rascunho.
  const drafts = () => ev(`document.querySelectorAll('main svg path[data-draft]').length`)
  assert((await drafts()) === 0, 'sobrou um traço em rascunho depois do 1º desenho')
  // com a caneta, clicar numa caixa não a move nem abre edição
  const ax0 = await ev(`${CV.box('Caixa A')}.offsetLeft`)
  const a0 = await rect(CV.box('Caixa A'), true)
  await dragTo(a0.x, a0.y, a0.x + 60, a0.y + 30)
  assert((await ev(`${CV.box('Caixa A')}.offsetLeft`)) === ax0, 'a caneta não deveria mover a caixa')
  assert(!(await ev(`!!document.querySelector('main [contenteditable=true]')`)), 'a caneta não deveria abrir a edição da caixa')
  await waitFor(`document.querySelectorAll('main svg path[stroke-linecap]').length === 2`, 3000, 'traço por cima da caixa')
  assert((await drafts()) === 0, 'sobrou um traço em rascunho depois do 2º desenho (por cima da caixa)')
  // borracha: apaga um traço e a seta
  assert(await CV.tool('Apagar traços'), 'ferramenta borracha')
  // ponto no meio do primeiro traço, convertido para a tela na hora (a tela pode ter rolado)
  const sp = await ev(`(() => { const p = document.querySelector('main svg path[stroke-linecap]'); const n = p.getAttribute('d').match(/-?[\\d.]+/g).map(Number); const i = Math.floor(n.length / 4) * 2; const r = ${CV.surface}.getBoundingClientRect(); return { x: r.left + n[i], y: r.top + n[i + 1] } })()`)
  const hit = await ev(`(() => { const e = document.elementFromPoint(${sp.x}, ${sp.y}); return e ? e.tagName + ' ' + (e.getAttribute('d') || e.getAttribute('class') || '').slice(0, 50) : 'nada' })()`)
  await ev(`(() => { window.__ev = []; for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'click', 'dragstart']) document.addEventListener(t, e => { if (!e.target.__n) e.target.__n = ++window.__seq; window.__ev.push(t + '@' + e.target.tagName + '#' + e.target.__n + (e.target.isConnected ? '' : '(removido)')) }, true); window.__seq = 0; new MutationObserver(ms => ms.forEach(m => window.__ev.push('MUT[' + m.type + (m.attributeName ? ':' + m.attributeName : '') + ' em ' + m.target.tagName + ' +' + m.addedNodes.length + ' -' + m.removedNodes.length + ']'))).observe(${CV.surface}, { childList: true, subtree: true, attributes: true }); return true })()`)
  await clickAt(sp.x, sp.y)
  await waitFor(`document.querySelectorAll('main svg path[stroke-linecap]').length === 1`, 3000, 'borracha apagar o traço').catch(async (e) => {
    throw new Error(`${e.message} (${hit}) eventos=${await ev(`window.__ev.join(' ')`)} traços=${await ev(`document.querySelectorAll('main svg path[stroke-linecap]').length`)} ativa=${await ev(`[...document.querySelectorAll('main .icon-btn.on')].map(b => b.title.slice(0, 14)).join(',')`)}`)
  })
  const mid = await ev(`(() => { const l = document.querySelector('main svg line[marker-end]'); const r = ${CV.surface}.getBoundingClientRect(); return { x: r.left + (Number(l.getAttribute('x1')) + Number(l.getAttribute('x2'))) / 2, y: r.top + (Number(l.getAttribute('y1')) + Number(l.getAttribute('y2'))) / 2 } })()`)
  await clickAt(mid.x, mid.y)
  await waitFor(`document.querySelectorAll('main svg line[marker-end]').length === 0`, 3000, 'borracha apagar a seta')
  // a borracha não apaga caixas
  assert((await CV.counts()).boxes === 2, 'a borracha não deveria apagar caixas')
  assert(await CV.tool('Selecionar'), 'ferramenta selecionar')
})

test('canvas página: arquivo solto vira caixa de mídia; excluir caixa leva as setas junto', async () => {
  const v = await CV.view()
  await ev(`(async () => { const c = document.createElement('canvas'); c.width = 120; c.height = 80; const x = c.getContext('2d'); x.fillStyle = '#e11d48'; x.fillRect(0, 0, 120, 80); const blob = await new Promise(r => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([blob], 'teste.png', { type: 'image/png' })); ${CV.surface}.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ${v.left + 140}, clientY: ${v.top + 470} })); return true })()`)
  await waitFor(`(() => { const i = document.querySelector('main .absolute.rounded-xl.shadow-lg img'); return i && i.complete && i.naturalWidth === 120 })()`, 6000, 'imagem solta aparecer no canvas')
  assert((await CV.counts()).boxes === 3, 'esperava 3 caixas')
  // liga A → B e A → mídia; excluir A remove as duas setas
  assert(await CV.tool('Conectar duas caixas'), 'seta')
  const media = `document.querySelector('main .absolute.rounded-xl.shadow-lg img').closest('.absolute')`
  await clickOn(CV.box('Caixa A'))
  await clickOn(CV.box('Caixa B'))
  await waitFor(`document.querySelectorAll('main svg line[marker-end]').length === 1`, 3000, 'seta A → B')
  await clickOn(CV.box('Caixa A'))
  await clickOn(media, 0.5, 0.9)
  await waitFor(`document.querySelectorAll('main svg line[marker-end]').length === 2`, 3000, 'seta A → imagem')
  assert(await CV.tool('Selecionar'), 'selecionar')
  await clickOn(CV.box('Caixa A'), 0.1, 0.2)
  await clickBtn('Excluir caixa')
  await waitFor(`${CV.boxes}.length === 2 && document.querySelectorAll('main svg line[marker-end]').length === 0`, 3000, 'excluir a caixa e as setas ligadas a ela')
})

test('canvas página: termo do glossário reconhecido na caixa abre pop-up', async () => {
  await cvAddBox(140, 120, 'A sinapse liga neurônios')
  const t = await rect(`${CV.box('A sinapse')}.querySelector('.gloss-auto')`, true)
  await move(t.x, t.y)
  await waitFor(`document.querySelector('[data-pop-depth="0"]')?.innerText.includes('Junção')`, 3000, 'pop-up do termo dentro da caixa')
  await move(5, 500)
  await waitFor(`!document.querySelector('[data-pop-depth="0"]')`, 3000, 'pop-up fechar')
})

test('canvas página: grava, sobrevive a recarregar e à troca de modo, e imprime como desenho', async () => {
  await sleep(900)
  const before = await CV.counts()
  const saved = await CV.saved('Teste Canvas')
  assert(saved && saved.mode === 'canvas' && saved.items === before.boxes && saved.strokes === before.strokes && saved.arrows === before.arrows, 'banco diferente da tela: ' + js(saved) + ' vs ' + js(before))
  assert(saved.texts.includes('Caixa B') && saved.texts.includes('A sinapse liga neurônios'), 'textos das caixas não gravados: ' + saved.texts)
  await call('Page.reload')
  await reloaded()
  await openPage('Teste Canvas')
  await waitFor(`!!${CV.surface}`, 4000, 'canvas reabrir')
  const after = await CV.counts()
  assert(js(after) === js(before), `canvas mudou ao recarregar: ${js(before)} → ${js(after)}`)
  // Documento ↔ Canvas não perde nada
  await clickBtn('Documento')
  await waitFor(`!!document.querySelector('.ProseMirror')`, 3000, 'modo Documento')
  await clickBtn('Canvas')
  await waitFor(`!!${CV.surface}`, 3000, 'voltar ao Canvas')
  assert(js(await CV.counts()) === js(before), 'canvas mudou ao alternar de modo')
  // busca encontra o texto de uma caixa
  await ev(`(() => { const i = document.querySelector('aside input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'liga neurônios'); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await waitFor(`[...document.querySelectorAll('aside button')].some(b => b.innerText.includes('Teste Canvas'))`, 3000, 'busca achar o texto do canvas')
  await ev(`(() => { const i = document.querySelector('aside input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  // impressão desta página: desenho com as caixas e o traço
  await clickTitle('Imprimir')
  await ev(`window.print = () => { window.__printed2 = true }`)
  await clickBtn('Imprimir…')
  await waitFor(`window.__printed2 === true`, 10000, 'preparar impressão do canvas')
  const pr = await ev(`(() => { const d = document.querySelector('#print-root .print-draw'); return d ? { boxes: d.querySelectorAll('[data-item]').length, paths: d.querySelectorAll('[data-stroke]').length, img: d.querySelectorAll('image').length, text: d.textContent.includes('Caixa B') } : null })()`)
  assert(pr && pr.boxes === before.boxes && pr.paths === before.strokes && pr.img === 1 && pr.text, 'desenho impresso incompleto: ' + js(pr))
  await ev(`document.getElementById('print-root')?.remove()`)
  await closeDialogs()
})

test('canvas do exemplo (Mapa Mental) e canvas embutido: altura, persistência e remoção', async () => {
  await openPage('Mapa Mental')
  await waitFor(`!!${CV.surface}`, 4000, 'Mapa Mental abrir em canvas')
  const c = await CV.counts()
  assert(c.boxes === 5 && c.arrows === 5 && c.strokes === 1, 'Mapa Mental de exemplo incompleto: ' + js(c))
  // embutido: numa página de documento nova
  await clickTitle('Novo caderno')
  await sleep(500)
  await focusEditorEnd()
  await type('Antes do canvas')
  await clickTitle('Inserir um canvas livre')
  const host = `document.querySelector('.ProseMirror [style*="radial-gradient"]')`
  await waitFor(`!!${host}`, 3000, 'canvas embutido inserido')
  const h0 = await ev(`${host}.parentElement.clientHeight`)
  await clickTitle('Aumentar a altura do canvas')
  await waitFor(`${host}.parentElement.clientHeight === ${h0 + 120}`, 3000, 'aumentar a altura')
  await clickTitle('Diminuir a altura do canvas')
  await clickTitle('Diminuir a altura do canvas')
  await waitFor(`${host}.parentElement.clientHeight === ${h0 - 120}`, 3000, 'diminuir a altura')
  // caixa + traço no embutido
  await ev(`document.querySelector('.ProseMirror button[title^="Caixa de texto"]').click()`)
  const v = await rect(`${host}.parentElement`, true)
  await clickAt(v.left + 80, v.top + 60)
  await waitFor(`!!document.querySelector('.ProseMirror [contenteditable=true].rich')`, 3000, 'caixa embutida em edição')
  await type('Embutida')
  await clickAt(v.left + v.w - 60, v.top + v.h - 40)
  await waitFor(`document.querySelector('.ProseMirror .cursor-move')?.innerText.trim() === 'Embutida'`, 3000, 'texto da caixa embutida')
  await ev(`document.querySelector('.ProseMirror button[title^="Desenho livre"]').click()`)
  await dragTo(v.left + 300, v.top + 120, v.left + 480, v.top + 150)
  await waitFor(`document.querySelectorAll('.ProseMirror svg path[stroke-linecap]').length === 1`, 3000, 'traço no canvas embutido')
  await ev(`document.querySelector('.ProseMirror button[title^="Selecionar"]').click()`)
  // digitar no texto da nota depois do canvas não mexe no canvas
  await focusEditorEnd()
  await type('Depois do canvas')
  await sleep(900)
  assert(await ev(`!!${host} && document.querySelector('.ProseMirror .cursor-move')?.innerText.trim() === 'Embutida' && document.querySelector('.ProseMirror').innerText.includes('Depois do canvas')`), 'digitar na nota afetou o canvas embutido')
  // sai e volta: tudo continua lá
  await openPage('Mapa Mental')
  await openPage('Novo caderno')
  await waitFor(`document.querySelector('.ProseMirror .cursor-move')?.innerText.trim() === 'Embutida' && document.querySelectorAll('.ProseMirror svg path[stroke-linecap]').length === 1 && ${host}.parentElement.clientHeight === ${h0 - 120}`, 4000, 'canvas embutido persistir ao trocar de página')
  // remover
  await clickTitle('Remover este canvas da nota')
  await waitFor(`!${host}`, 3000, 'canvas embutido removido')
  assert(await ev(`document.querySelector('.ProseMirror').innerText.includes('Antes do canvas') && document.querySelector('.ProseMirror').innerText.includes('Depois do canvas')`), 'remover o canvas apagou texto da nota')
})

/* ---------- Diagramas (formas, setas em ângulo, seleção múltipla, exportação) ---------- */
const DG = {
  shape: (kind) => `document.querySelector('main [data-shape=${js(kind)}]')`,
  shapes: `document.querySelectorAll('main [data-shape]').length`,
  conns: `document.querySelectorAll('main svg g[data-connector]').length`,
  /** ponto (na tela) no meio de um conector */
  connMid: () => ev(`(() => { const g = document.querySelector('main svg g[data-connector]'); const pl = g.querySelector('polyline:not([marker-end])'); const n = pl.getAttribute('points').trim().split(/[ ,]+/).map(Number); const pts = []; for (let i = 0; i < n.length; i += 2) pts.push([n[i], n[i + 1]]); const k = Math.floor((pts.length - 1) / 2); const r = ${CV.surface}.getBoundingClientRect(); return { x: r.left + (pts[k][0] + pts[k + 1][0]) / 2, y: r.top + (pts[k][1] + pts[k + 1][1]) / 2 } })()`),
}
async function dgAddShape(title, dx, dy, text) {
  await clickTitle('Forma: ' + title, 'document.querySelector("main")')
  const v = await CV.view()
  await clickAt(v.left + dx, v.top + dy)
  await waitFor(`!!document.querySelector('main [data-shape] [contenteditable=true]')`, 3000, 'forma nova em edição')
  await type(text)
  await clickAt(v.left + v.w - 40, v.top + v.h - 40)
  await waitFor(`!document.querySelector('main [contenteditable=true]')`, 3000, 'sair da edição da forma')
}

test('diagrama: formas, seta em ângulo com rótulo e troca para reta', async () => {
  await clickTitle('Novo caderno')
  await sleep(400)
  await ev(`(() => { const i = document.querySelector('input.font-semibold'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; i.focus(); set.call(i, 'Teste Diagrama'); i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); return true })()`)
  await waitFor(`[...document.querySelectorAll('.tree-row')].some(r => r.innerText.includes('Teste Diagrama'))`, 3000, 'página renomeada')
  await clickBtn('Canvas')
  await waitFor(`!!${CV.surface}`, 3000, 'modo Canvas')
  await dgAddShape('Losango', 300, 200, 'Decisão?')
  await dgAddShape('Retângulo', 620, 200, 'Processo')
  assert((await ev(DG.shapes)) === 2, 'esperava 2 formas')
  assert((await ev(`${DG.shape('diamond')}.innerText.trim()`)) === 'Decisão?' && (await ev(`${DG.shape('rect')}.innerText.trim()`)) === 'Processo', 'texto das formas')
  assert(await ev(`!!${DG.shape('diamond')}.querySelector('svg polygon') && !!${DG.shape('rect')}.querySelector('svg rect')`), 'desenho das formas')
  // forma vazia continua existindo (diferente da caixa de texto)
  await clickTitle('Forma: Elipse', 'document.querySelector("main")')
  const v = await CV.view()
  await clickAt(v.left + 460, v.top + 420)
  await waitFor(`!!document.querySelector('main [data-shape="ellipse"] [contenteditable=true]')`, 3000, 'elipse em edição')
  await clickAt(v.left + v.w - 40, v.top + v.h - 40)
  await waitFor(`!!${DG.shape('ellipse')} && !document.querySelector('main [contenteditable=true]')`, 3000, 'forma vazia mantida')
  // seta em ângulo reto
  await clickTitle('Novas setas', 'document.querySelector("main")')
  assert(await CV.tool('Conectar duas caixas'), 'ferramenta seta')
  await clickOn(DG.shape('diamond'))
  await clickOn(DG.shape('rect'))
  await waitFor(`!!document.querySelector('main svg g[data-connector="elbow"] polyline[marker-end]')`, 3000, 'seta em ângulo criada')
  // todos os trechos de uma seta em ângulo são horizontais ou verticais
  assert(await ev(`(() => { const p = document.querySelector('main svg g[data-connector="elbow"] polyline[marker-end]').getAttribute('points').trim().split(' ').map(s => s.split(',').map(Number)); return p.length >= 2 && p.slice(1).every((q, i) => Math.abs(q[0] - p[i][0]) < 0.6 || Math.abs(q[1] - p[i][1]) < 0.6) })()`), 'a seta em ângulo tem trecho inclinado')
  // selecionar a seta e dar rótulo
  assert(await CV.tool('Selecionar'), 'selecionar')
  let m = await DG.connMid()
  await clickAt(m.x, m.y)
  await waitFor(`(() => { const b = ${btnExpr('Rótulo', 'document.querySelector("main")')}; return b && !b.disabled })()`, 3000, 'seta selecionada (botão Rótulo habilitado)')
  await ev(`window.prompt = () => 'sim'`)
  await clickBtn('Rótulo', 'document.querySelector("main")')
  await waitFor(`document.querySelector('main svg g[data-connector] text')?.textContent === 'sim'`, 3000, 'rótulo na seta')
  await clickBtn('Deixar reta', 'document.querySelector("main")')
  await waitFor(`!!document.querySelector('main svg g[data-connector="straight"] line[marker-end]')`, 3000, 'seta virar reta')
  // ponta da seta reta encosta na borda do losango (não no retângulo em volta dele)
  const onDiamond = await ev(`(() => { const l = document.querySelector('main svg line[marker-end]'); const d = ${DG.shape('diamond')}; const cx = d.offsetLeft + d.offsetWidth / 2, cy = d.offsetTop + d.offsetHeight / 2; const x = Number(l.getAttribute('x1')), y = Number(l.getAttribute('y1')); return Math.abs(Math.abs(x - cx) / (d.offsetWidth / 2) + Math.abs(y - cy) / (d.offsetHeight / 2) - 1) < 0.06 })()`)
  assert(onDiamond, 'a seta não sai da borda do losango')
  await clickBtn('Em ângulo', 'document.querySelector("main")')
  await waitFor(`!!document.querySelector('main svg g[data-connector="elbow"]')`, 3000, 'voltar para ângulo')
})

test('diagrama: grade, seleção múltipla, alinhar, distribuir, duplicar e teclado', async () => {
  // grade: depois de arrastar, a posição cai em múltiplo de 10
  const r = await rect(DG.shape('rect'), true)
  await dragTo(r.x, r.y, r.x + 37, r.y + 63)
  const pos = await ev(`({ x: ${DG.shape('rect')}.offsetLeft, y: ${DG.shape('rect')}.offsetTop })`)
  assert(pos.x % 10 === 0 && pos.y % 10 === 0, 'a forma não encaixou na grade: ' + js(pos))
  // retângulo de seleção pega as três formas
  const v = await CV.view()
  await dragTo(v.left + 150, v.top + 90, v.left + 800, v.top + 500)
  await waitFor(`document.querySelector('main').innerText.includes('3 selecionadas')`, 3000, 'seleção múltipla pelo retângulo')
  await clickTitle('Alinhar ao topo', 'document.querySelector("main")')
  await waitFor(`new Set([...document.querySelectorAll('main [data-shape]')].map(e => e.offsetTop)).size === 1`, 3000, 'alinhar ao topo')
  await clickTitle('Distribuir na horizontal', 'document.querySelector("main")')
  const gaps = await ev(`(() => { const s = [...document.querySelectorAll('main [data-shape]')].sort((a, b) => a.offsetLeft - b.offsetLeft); return [s[1].offsetLeft - (s[0].offsetLeft + s[0].offsetWidth), s[2].offsetLeft - (s[1].offsetLeft + s[1].offsetWidth)] })()`)
  assert(Math.abs(gaps[0] - gaps[1]) < 2, 'espaços não ficaram iguais: ' + js(gaps))
  // mover o grupo inteiro arrastando uma forma
  const before = await ev(`[...document.querySelectorAll('main [data-shape]')].map(e => e.offsetTop)`)
  const d = await rect(DG.shape('diamond'), true)
  await dragTo(d.x, d.y, d.x, d.y + 60)
  const after = await ev(`[...document.querySelectorAll('main [data-shape]')].map(e => e.offsetTop)`)
  assert(after.every((y, i) => y - before[i] === 60), 'o grupo não moveu junto: ' + js(before) + ' → ' + js(after))
  // duplicar: 3 formas + a seta entre duas delas
  await clickTitle('Duplicar a seleção', 'document.querySelector("main")')
  await waitFor(`${DG.shapes} === 6 && ${DG.conns} === 2`, 3000, 'duplicar formas e a seta entre elas')
  // Delete apaga as cópias (que ficaram selecionadas) e a seta delas
  await key('Delete', 'Delete', 46)
  await waitFor(`${DG.shapes} === 3 && ${DG.conns} === 1`, 3000, 'tecla Delete apagar a seleção')
  // Ctrl+A, Ctrl+C, Ctrl+V
  await clickAt(v.left + v.w - 40, v.top + v.h - 40)
  await key('a', 'KeyA', 65, 2)
  await waitFor(`document.querySelector('main').innerText.includes('3 selecionadas')`, 3000, 'Ctrl+A selecionar tudo')
  await key('c', 'KeyC', 67, 2)
  await key('v', 'KeyV', 86, 2)
  await waitFor(`${DG.shapes} === 6`, 3000, 'Ctrl+C / Ctrl+V colar')
  await key('Delete', 'Delete', 46)
  await waitFor(`${DG.shapes} === 3`, 3000, 'apagar as coladas')
  // Shift+clique soma à seleção
  await clickOn(DG.shape('diamond'))
  await move(0, 0)
  const e2 = await rect(DG.shape('ellipse'), true)
  await move(e2.x, e2.y)
  await mouse('mousePressed', e2.x, e2.y, { buttons: 1, modifiers: 8 })
  await mouse('mouseReleased', e2.x, e2.y, { modifiers: 8 })
  await waitFor(`document.querySelector('main').innerText.includes('2 selecionadas')`, 3000, 'Shift+clique somar à seleção')
})

test('diagrama: desfazer / refazer e botões de selecionar, copiar, colar e mover', async () => {
  const main = 'document.querySelector("main")'
  const v = await CV.view()
  await clickAt(v.left + v.w - 40, v.top + v.h - 40) // limpa a seleção
  const left = (k) => ev(`${DG.shape(k)}.offsetLeft`)
  const x0 = await left('diamond')
  const d = await rect(DG.shape('diamond'), true)
  await dragTo(d.x, d.y, d.x + 50, d.y)
  const x1 = await left('diamond')
  assert(x1 - x0 === 50, `arraste de 50 px: ${x1 - x0}`)
  await clickTitle('Desfazer no canvas', main)
  await waitFor(`${DG.shape('diamond')}.offsetLeft === ${x0}`, 3000, 'botão Desfazer voltar a posição')
  await clickTitle('Refazer no canvas', main)
  await waitFor(`${DG.shape('diamond')}.offsetLeft === ${x1}`, 3000, 'botão Refazer')
  await clickOn(DG.shape('ellipse'))
  await key('z', 'KeyZ', 90, 2)
  await waitFor(`${DG.shape('diamond')}.offsetLeft === ${x0}`, 3000, 'Ctrl+Z')
  // excluir e desfazer: a forma e a seta ligada a ela voltam
  await clickOn(DG.shape('diamond'))
  await key('Delete', 'Delete', 46)
  await waitFor(`${DG.shapes} === 2 && ${DG.conns} === 0`, 3000, 'excluir o losango e sua seta')
  await key('z', 'KeyZ', 90, 2)
  await waitFor(`${DG.shapes} === 3 && ${DG.conns} === 1 && document.querySelector('main svg g[data-connector] text')?.textContent === 'sim'`, 3000, 'desfazer a exclusão (forma, seta e rótulo)')
  // botões equivalentes aos atalhos
  await clickTitle('Selecionar tudo', main)
  await waitFor(`${main}.innerText.includes('3 selecionadas')`, 3000, 'botão Selecionar tudo')
  const xs = await ev(`[...document.querySelectorAll('main [data-shape]')].map(e => e.offsetLeft)`)
  await clickTitle('Mover a seleção para a direita', main)
  const xs2 = await ev(`[...document.querySelectorAll('main [data-shape]')].map(e => e.offsetLeft)`)
  assert(xs2.every((x, i) => x - xs[i] === 10), 'botão de mover para a direita: ' + js(xs) + ' → ' + js(xs2))
  await clickTitle('Mover a seleção para a esquerda', main)
  await clickTitle('Copiar a seleção', main)
  await clickTitle('Colar', main)
  await waitFor(`${DG.shapes} === 6 && ${DG.conns} === 2`, 3000, 'botões Copiar e Colar')
  await clickTitle('Desfazer no canvas', main)
  await waitFor(`${DG.shapes} === 3 && ${DG.conns} === 1`, 3000, 'desfazer a colagem')
})

test('diagrama: grava, exporta SVG e PNG e imprime com as formas', async () => {
  await sleep(900)
  const saved = await ev(`new Promise(res => { const o = indexedDB.open('notepad-everywhere'); o.onsuccess = () => { o.result.transaction('nodes').objectStore('nodes').getAll().onsuccess = e => { const n = e.target.result.find(n => n.title === 'Teste Diagrama'); res(n ? { shapes: n.canvas.items.filter(i => i.type === 'shape').map(i => i.shape).sort().join(','), conn: n.canvas.connectors.map(c => c.kind + ':' + c.label).join(','), text: n.text.includes('Decisão?') } : null) } } })`)
  assert(saved && saved.shapes === 'diamond,ellipse,rect' && saved.conn === 'elbow:sim' && saved.text, 'diagrama não gravado como esperado: ' + js(saved))
  // exportação: captura o "download" em vez de gravar arquivo
  await ev(`(() => { window.__dl = []; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl.push({ name: this.download, href: this.href }); }; return true })()`)
  await clickBtn('SVG', 'document.querySelector("main")')
  await waitFor(`window.__dl.some(d => d.name.endsWith('.svg'))`, 5000, 'exportar SVG')
  const svg = await ev(`fetch(window.__dl.find(d => d.name.endsWith('.svg')).href).then(r => r.text())`)
  assert(svg.startsWith('<svg') && svg.includes('<polygon') && svg.includes('<ellipse') && svg.includes('Decisão?') && svg.includes('>sim<') && svg.includes('<polyline'), 'SVG exportado incompleto')
  // precisa ser XML válido para abrir em outros programas
  assert(await ev(`fetch(window.__dl.find(d => d.name.endsWith('.svg')).href).then(r => r.text()).then(t => !new DOMParser().parseFromString(t, 'image/svg+xml').querySelector('parsererror'))`), 'o SVG exportado não é XML válido')
  await clickBtn('PNG', 'document.querySelector("main")')
  await waitFor(`window.__dl.some(d => d.name.endsWith('.png'))`, 8000, 'exportar PNG')
  const png = await ev(`fetch(window.__dl.find(d => d.name.endsWith('.png')).href).then(r => r.blob()).then(async b => { const bmp = await createImageBitmap(b); return { type: b.type, size: b.size, w: bmp.width, h: bmp.height } })`)
  assert(png.type === 'image/png' && png.size > 3000 && png.w > 400 && png.h > 150, 'PNG exportado inválido: ' + js(png))
  // recarrega e confere que tudo voltou; depois imprime
  await call('Page.reload')
  await reloaded()
  await openPage('Teste Diagrama')
  await waitFor(`${DG.shapes} === 3 && ${DG.conns} === 1 && document.querySelector('main svg g[data-connector] text')?.textContent === 'sim'`, 5000, 'diagrama reabrir igual')
  await clickTitle('Imprimir')
  await ev(`window.print = () => { window.__printed3 = true }`)
  await clickBtn('Imprimir…')
  await waitFor(`window.__printed3 === true`, 10000, 'preparar impressão do diagrama')
  const pr = await ev(`(() => { const d = document.querySelector('#print-root .print-draw'); return d ? { shapes: d.querySelectorAll('[data-item="shape"]').length, conns: d.querySelectorAll('[data-connector]').length, text: d.textContent.includes('Decisão?') && d.textContent.includes('sim') } : null })()`)
  assert(pr && pr.shapes === 3 && pr.conns === 1 && pr.text, 'diagrama impresso incompleto: ' + js(pr))
  await ev(`document.getElementById('print-root')?.remove()`)
  await closeDialogs()
  // histórico de versões também cobre o canvas: move uma forma (1ª edição da sessão) e volta
  const hx = await ev(`${DG.shape('rect')}.offsetLeft`)
  const hr = await rect(DG.shape('rect'), true)
  await dragTo(hr.x, hr.y, hr.x + 80, hr.y)
  assert((await ev(`${DG.shape('rect')}.offsetLeft`)) === hx + 80, 'forma não moveu antes do teste de histórico')
  await sleep(900)
  await clickTitle('Histórico de versões')
  await waitFor(`document.querySelectorAll('[role=dialog] .w-52 button').length >= 1`, 4000, 'versão do canvas no histórico')
  await clickBtn('Restaurar esta versão')
  await waitFor(`${DG.shape('rect')}?.offsetLeft === ${hx} && ${DG.shapes} === 3`, 4000, 'histórico restaurar o canvas')
  // fluxograma de exemplo
  await openPage('Fluxograma de Revisão')
  await waitFor(`${DG.shapes} === 7 && ${DG.conns} === 7 && [...document.querySelectorAll('main svg g[data-connector] text')].map(t => t.textContent).sort().join(',') === 'não,sim'`, 5000, 'fluxograma de exemplo completo')
})

test('diagrama: formas novas, lado da seta, desvio de obstáculo, frente/trás e exportação formatada', async () => {
  const main = 'document.querySelector("main")'
  await clickTitle('Novo caderno')
  await sleep(400)
  await clickBtn('Canvas')
  await waitFor(`!!${CV.surface}`, 3000, 'modo Canvas')
  await dgAddShape('Hexágono', 200, 160, 'A')
  await dgAddShape('Documento', 760, 160, 'B')
  await dgAddShape('Nuvem', 480, 160, 'no caminho')
  await dgAddShape('Pessoa', 480, 420, 'x')
  for (const k of ['hexagon', 'document', 'cloud', 'person']) assert(await ev(`!!${DG.shape(k)}?.querySelector('svg')?.firstElementChild`), 'forma não desenhada: ' + k)
  // seta em ângulo de A para B: a nuvem está no meio, então o caminho tem de contorná-la
  await clickTitle('Novas setas', main)
  assert(await CV.tool('Conectar duas caixas'), 'seta')
  await clickOn(DG.shape('hexagon'))
  await clickOn(DG.shape('document'))
  await waitFor(`${DG.conns} === 1`, 3000, 'seta criada')
  const crosses = `(() => { const p = document.querySelector('main svg g[data-connector] polyline[marker-end]').getAttribute('points').trim().split(' ').map(s => s.split(',').map(Number)); const o = ${DG.shape('cloud')}; const l = o.offsetLeft, t = o.offsetTop, r = l + o.offsetWidth, b = t + o.offsetHeight; return p.slice(1).some((q, i) => Math.max(q[0], p[i][0]) > l && Math.min(q[0], p[i][0]) < r && Math.max(q[1], p[i][1]) > t && Math.min(q[1], p[i][1]) < b) })()`
  assert(!(await ev(crosses)), 'a seta em ângulo passou por cima da forma que estava no caminho')
  // escolher o lado de saída: "baixo" → a seta começa na base do hexágono
  assert(await CV.tool('Selecionar'), 'selecionar')
  const m = await DG.connMid()
  await clickAt(m.x, m.y)
  await waitFor(`!${main}.querySelector('select[title^="De que lado"]').disabled`, 3000, 'seta selecionada')
  await ev(`(() => { const s = ${main}.querySelector('select[title^="De que lado"]'); s.value = 'bottom'; s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  await waitFor(`(() => { const p = document.querySelector('main svg g[data-connector] polyline[marker-end]').getAttribute('points').trim().split(' ')[0].split(',').map(Number); const a = ${DG.shape('hexagon')}; return Math.abs(p[1] - (a.offsetTop + a.offsetHeight)) < 1 && Math.abs(p[0] - (a.offsetLeft + a.offsetWidth / 2)) < 1 })()`, 3000, 'seta sair pela base da forma')
  assert(!(await ev(crosses)), 'com o lado escolhido, a seta passou por cima da forma no caminho')
  // ordem de empilhamento
  await clickOn(DG.shape('hexagon'))
  await clickTitle('Trazer para a frente', main)
  await waitFor(`[...document.querySelectorAll('main [data-shape]')].pop().dataset.shape === 'hexagon'`, 3000, 'trazer para a frente')
  await clickTitle('Enviar para trás', main)
  await waitFor(`document.querySelector('main [data-shape]').dataset.shape === 'hexagon'`, 3000, 'enviar para trás')
  // exportação com texto formatado: negrito e fórmula
  const p = await rect(DG.shape('person'), true)
  await dblClickAt(p.x, p.y)
  await waitFor(`!!document.querySelector('main [data-shape="person"] [contenteditable=true]')`, 3000, 'editar a forma')
  await ev(`(() => { document.execCommand('selectAll'); document.execCommand('insertHTML', false, '<b>forte</b> $x^2$'); return true })()`)
  const v = await CV.view()
  await clickAt(v.left + v.w - 40, v.top + v.h - 40)
  await waitFor(`!!${DG.shape('person')}.querySelector('.katex')`, 3000, 'fórmula renderizada na forma')
  await ev(`(() => { window.__dl = []; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl.push({ name: this.download, href: this.href }); }; return true })()`)
  await clickBtn('SVG', main)
  await waitFor(`window.__dl.some(d => d.name.endsWith('.svg'))`, 5000, 'exportar SVG')
  const svg = await ev(`fetch(window.__dl.find(d => d.name.endsWith('.svg')).href).then(r => r.text())`)
  assert(svg.includes('<switch>') && svg.includes('<foreignObject') && /<math[ >]/.test(svg) && /<b[ >]/.test(svg), 'SVG sem o texto formatado (negrito/fórmula)')
  assert(await ev(`fetch(window.__dl.find(d => d.name.endsWith('.svg')).href).then(r => r.text()).then(t => !new DOMParser().parseFromString(t, 'image/svg+xml').querySelector('parsererror'))`), 'o SVG formatado não é XML válido')
  await clickBtn('PNG', main)
  await waitFor(`window.__dl.some(d => d.name.endsWith('.png'))`, 8000, 'exportar PNG com texto formatado')
  const png = await ev(`fetch(window.__dl.find(d => d.name.endsWith('.png')).href).then(r => r.blob()).then(b => ({ type: b.type, size: b.size }))`)
  assert(png.type === 'image/png' && png.size > 3000, 'PNG formatado inválido: ' + js(png))
})

test('buscar nesta página (Ctrl+F) e contagem de palavras', async () => {
  await openPage('Aprender a Aprender')
  const status = await ev(`document.querySelector('[data-status-bar]').innerText`)
  assert(/\d+ palavras/.test(status) && /min de leitura/.test(status) && /caracteres/.test(status), 'rodapé de contagem: ' + status)
  await clickTitle('Buscar nesta página')
  await waitFor(`!!document.querySelector('[role=search] input')`, 3000, 'barra de busca abrir pelo botão')
  await ev(`document.querySelector('[role=search] input').focus()`)
  await type('sinapse')
  await waitFor(`document.querySelectorAll('.ProseMirror .find-hit').length >= 2 && document.querySelectorAll('.ProseMirror .find-hit-current').length === 1`, 3000, 'ocorrências destacadas')
  const total = await ev(`document.querySelectorAll('.ProseMirror .find-hit').length`)
  assert((await ev(`document.querySelector('[data-find-count]').innerText`)) === `1 de ${total}`, 'contador da busca: ' + (await ev(`document.querySelector('[data-find-count]').innerText`)))
  await key('Enter', 'Enter', 13)
  await waitFor(`document.querySelector('[data-find-count]').innerText === '2 de ${total}'`, 3000, 'Enter ir para a próxima')
  await clickTitle('Ocorrência anterior')
  await waitFor(`document.querySelector('[data-find-count]').innerText === '1 de ${total}'`, 3000, 'botão de ocorrência anterior')
  await key('Escape', 'Escape', 27)
  await waitFor(`!document.querySelector('[role=search]') && !document.querySelector('.ProseMirror .find-hit')`, 3000, 'Esc fechar a busca e limpar o destaque')
  // atalho
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true }))`)
  await waitFor(`!!document.querySelector('[role=search] input')`, 3000, 'Ctrl+F abrir a busca')
  await ev(`document.querySelector('[role=search] input').focus()`)
  await type('zzzznada')
  await waitFor(`document.querySelector('[data-find-count]').innerText === 'nenhum'`, 3000, 'busca sem resultado')
  await clickTitle('Fechar a busca')
})

test('árvore pelo teclado e foco preso nos diálogos', async () => {
  const titles = () => ev(`[...document.querySelectorAll('.tree-row')].filter(r => r.getAttribute('aria-level') === '1').map(r => r.querySelector('.truncate').innerText.trim())`)
  const focused = () => ev(`document.activeElement?.classList.contains('tree-row') ? document.activeElement.querySelector('.truncate')?.innerText.trim() : null`)
  const before = await titles()
  assert(before.length >= 3, 'esperava ao menos 3 cadernos na raiz')
  await ev(`document.querySelector('.tree-row').focus()`)
  assert((await focused()) === before[0], 'foco na primeira linha')
  // Alt+↓ desce a página; Alt+↑ sobe de volta; o foco acompanha
  await key('ArrowDown', 'ArrowDown', 40, 1)
  await waitFor(`(() => { const t = [...document.querySelectorAll('.tree-row')].filter(r => r.getAttribute('aria-level') === '1').map(r => r.querySelector('.truncate').innerText.trim()); return t[0] === ${js(before[1])} && t[1] === ${js(before[0])} })()`, 3000, 'Alt+↓ mover a página para baixo')
  await waitFor(`document.activeElement?.querySelector?.('.truncate')?.innerText.trim() === ${js(before[0])}`, 3000, 'foco acompanhar a página movida')
  await key('ArrowUp', 'ArrowUp', 38, 1)
  await waitFor(`[...document.querySelectorAll('.tree-row')].filter(r => r.getAttribute('aria-level') === '1')[0].querySelector('.truncate').innerText.trim() === ${js(before[0])}`, 3000, 'Alt+↑ voltar')
  // ↓ navega, Enter abre, F2 renomeia
  await key('ArrowDown', 'ArrowDown', 40)
  const second = await focused()
  assert(second && second !== before[0], '↓ não levou o foco para a linha seguinte')
  await key('Enter', 'Enter', 13)
  await waitFor(`document.querySelector('input.font-semibold')?.value === ${js(second)}`, 3000, 'Enter abrir a página')
  await key('F2', 'F2', 113)
  await waitFor(`!!document.querySelector('.tree-row input')`, 3000, 'F2 abrir o campo de renomear')
  await key('Escape', 'Escape', 27)
  assert(await ev(`document.querySelector('[role=tree]') && [...document.querySelectorAll('.tree-row')].every(r => r.getAttribute('role') === 'treeitem' && r.hasAttribute('aria-level'))`), 'papéis de árvore ausentes')
  // diálogo: vira role=dialog, recebe o foco e o Tab não escapa dele
  await clickTitle('Backup')
  await waitFor(`(() => { const d = [...document.querySelectorAll('.fixed.inset-0 > .pop')].pop(); return d && d.getAttribute('role') === 'dialog' && d.contains(document.activeElement) })()`, 3000, 'diálogo receber o foco')
  for (let i = 0; i < 25; i++) await key('Tab', 'Tab', 9, i % 5 === 4 ? 8 : 0)
  assert(await ev(`[...document.querySelectorAll('.fixed.inset-0 > .pop')].pop().contains(document.activeElement)`), 'o Tab escapou do diálogo')
  await closeDialogs()
  assert(await ev(`[...document.querySelectorAll('button[title]')].every(b => b.getAttribute('aria-label'))`), 'há botões de ícone sem nome acessível')
})

test('código: executar snippet JavaScript', async () => {
  await openPage('Curva do Esquecimento')
  await ev(`${btnExpr('Executar')}.scrollIntoView({ block: 'center' })`)
  await clickBtn('Executar')
  await waitFor(`document.querySelector('.code-block .font-mono.whitespace-pre-wrap')?.innerText.includes('S=1')`, 8000, 'saída do snippet JS')
})

test('áudio: transcrição clicável e Marcar Timestamp', async () => {
  await openPage('Repetição Espaçada & Recuperação Ativa')
  await waitFor(`document.querySelector('audio')?.duration > 10`, 6000, 'áudio carregar')
  await ev(`document.querySelectorAll('[data-media-host="f-aula"] .divide-y button')[2].click()`)
  await waitFor(`Math.abs(document.querySelector('audio').currentTime - 8) < 1.5`, 3000, 'pular para 0:08 pela transcrição')
  await ev(`document.querySelector('audio').pause()`)
  const n = await ev(`document.querySelectorAll('.ProseMirror a.media-link').length`)
  await clickBtn('Marcar Timestamp')
  await waitFor(`document.querySelectorAll('.ProseMirror a.media-link').length === ${n + 1}`, 3000, 'link de timestamp inserido')
})

test('áudio: velocidade e loop A–B', async () => {
  const host = `document.querySelector('[data-media-host="f-aula"]')`
  const btn = (t) => `[...${host}.querySelectorAll('button')].find(b => b.innerText.trim().split(' ')[0] === ${js(t)})`
  await ev(`(() => { const a = document.querySelector('audio'); a.muted = true; a.pause(); a.currentTime = 2; return true })()`)
  await ev(`${btn('A')}.click()`)
  await ev(`document.querySelector('audio').currentTime = 3`)
  await ev(`${btn('B')}.click()`)
  await waitFor(`${btn('A')}.innerText.includes('0:02') && ${btn('B')}.innerText.includes('0:03')`, 3000, 'pontos A e B marcados')
  await ev(`(() => { const s = ${host}.querySelector('select'); s.value = '2'; s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  await waitFor(`document.querySelector('audio').playbackRate === 2`, 3000, 'velocidade 2×')
  await ev(`(() => { const a = document.querySelector('audio'); a.currentTime = 2.2; return a.play().then(() => true) })()`)
  // a 2×, em 1,5 s ele passaria de 5 s; com o loop tem de continuar entre A e B
  await sleep(1500)
  const t = await ev(`document.querySelector('audio').currentTime`)
  await ev(`document.querySelector('audio').pause()`)
  assert(t >= 1.9 && t <= 3.3, 'o loop A–B não segurou a reprodução: tempo = ' + t)
  await ev(`${btn('limpar')}.click()`)
  await waitFor(`!${btn('limpar')}`, 3000, 'limpar o loop')
})

test('vídeo: arquivo solto na nota vira player com velocidade e timestamp', async () => {
  await clickTitle('Novo caderno')
  await sleep(500)
  const r = await rect('.ProseMirror')
  // grava 1,2 s de vídeo de um canvas animado e solta no editor
  await ev(`(async () => { const c = document.createElement('canvas'); c.width = 160; c.height = 120; const x = c.getContext('2d'); let i = 0; const iv = setInterval(() => { x.fillStyle = 'hsl(' + (i++ * 12) + ',80%,50%)'; x.fillRect(0, 0, 160, 120) }, 40); const rec = new MediaRecorder(c.captureStream(25), { mimeType: 'video/webm' }); const chunks = []; rec.ondataavailable = e => chunks.push(e.data); const done = new Promise(r => (rec.onstop = r)); rec.start(); await new Promise(r => setTimeout(r, 1200)); rec.stop(); await done; clearInterval(iv); const dt = new DataTransfer(); dt.items.add(new File(chunks, 'clipe.webm', { type: 'video/webm' })); document.querySelector('.ProseMirror').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ${r.left + 40}, clientY: ${r.top + 20} })); return true })()`)
  await waitFor(`document.querySelector('.ProseMirror video')?.videoWidth === 160`, 10000, 'vídeo carregar no player')
  const host = `document.querySelector('.ProseMirror video').closest('[data-media-host]')`
  await ev(`(() => { const s = ${host}.querySelector('select'); s.value = '1.5'; s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  await waitFor(`document.querySelector('.ProseMirror video').playbackRate === 1.5`, 3000, 'velocidade do vídeo')
  await ev(`[...${host}.querySelectorAll('button')].find(b => b.innerText.includes('Marcar Timestamp')).click()`)
  await waitFor(`[...document.querySelectorAll('.ProseMirror a.media-link')].some(a => a.innerText.includes('clipe.webm'))`, 3000, 'timestamp do vídeo inserido na nota')
  // a página passa a aparecer no filtro de vídeos da árvore
  await sleep(700)
  await clickTitle('Filtrar páginas com: Vídeos')
  await waitFor(`[...document.querySelectorAll('aside button')].some(b => b.innerText.includes('Novo caderno'))`, 3000, 'filtro de vídeo achar a página')
  await clickTitle('Filtrar páginas com: Vídeos')
})

test('código Python (Pyodide) e sons de foco', async () => {
  await openPage('Curva do Esquecimento')
  await ev(`(() => { const b = [...document.querySelectorAll('button')].filter(b => b.innerText.trim().startsWith('Executar'))[1]; b.scrollIntoView({ block: 'center' }); b.click(); return true })()`)
  const out = `[...document.querySelectorAll('.code-block .font-mono.whitespace-pre-wrap')].map(e => e.innerText).join('\\n')`
  const r = await waitFor(`(() => { const t = ${out}; return t.includes('revisar em') ? 'ok' : /Pyodide|internet|NetworkError|Failed to fetch/i.test(t) ? 'offline' : '' })()`, 90000, 'saída do snippet Python')
  if (r === 'offline') console.log('      (sem internet: o Pyodide não pôde ser baixado; execução de Python não verificada)')
  // sons: liga e desliga cada um pelo botão
  await clickBtn('Pomodoro & Foco')
  for (const i of [0, 1, 2]) {
    await ev(`[...document.querySelectorAll('aside:last-of-type button[title="Ligar"]')][0].click()`)
    await waitFor(`document.querySelectorAll('aside:last-of-type button[title="Desligar"]').length === ${i + 1}`, 3000, 'ligar som ' + (i + 1))
  }
  assert(await ev(`[...document.querySelectorAll('aside:last-of-type input[type=range]')].every(s => Number(s.value) > 0)`), 'os controles de volume não refletem os sons ligados')
  for (const i of [0, 1, 2]) await ev(`document.querySelector('aside:last-of-type button[title="Desligar"]').click()`)
  await waitFor(`document.querySelectorAll('aside:last-of-type button[title="Desligar"]').length === 0`, 3000, 'desligar os sons')
  await clickBtn('Glossário & Revisão')
})

test('PDF: renderizar, selecionar texto e Extrair para Nota', async () => {
  await openPage('Artigo em PDF')
  await waitFor(`document.querySelectorAll('.textLayer span').length >= 5`, 10000, 'camada de texto do PDF')
  const q = await ev(`document.querySelectorAll('.ProseMirror blockquote').length`)
  await ev(`(() => { const s = [...document.querySelectorAll('.textLayer span')].find(x => x.innerText.includes('curva do esquecimento')) || document.querySelectorAll('.textLayer span')[3]; const r = document.createRange(); r.selectNodeContents(s); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.querySelector('.pdf-page').dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return true })()`)
  await waitFor(`(() => { const b = ${btnExpr('Extrair para Nota')}; return b && !b.disabled })()`, 3000, 'botão Extrair habilitar')
  await clickBtn('Extrair para Nota')
  await waitFor(`document.querySelectorAll('.ProseMirror blockquote').length === ${q + 1}`, 3000, 'citação inserida')
  assert(await ev(`[...document.querySelectorAll('.ProseMirror blockquote a.media-link')].some(a => a.dataset.page === '1' && a.dataset.fileId === 'f-artigo')`), 'citação sem backlink para a página 1 do PDF')
})

test('grafo de conhecimento', async () => {
  await clickTitle('Grafo de conhecimento')
  await waitFor(`document.querySelectorAll('svg g.cursor-pointer').length >= 20`, 5000, 'nós do grafo')
  await clickBtn('+')
  await clickBtn('Voltar para a página')
  await waitFor(`!!document.querySelector('.ProseMirror')`, 3000, 'voltar do grafo')
})

test('revisão SRS e Pomodoro', async () => {
  await ev(`${btnExpr('Tudo (')}.click()`)
  await clickBtn('Mostrar resposta')
  await clickBtn('Bom')
  await waitFor(`document.body.innerText.includes('Cartão 2 de')`, 3000, 'avançar para o próximo cartão')
  await clickBtn('encerrar')
  await clickBtn('Pomodoro & Foco')
  await clickBtn('Iniciar')
  await waitFor(`!!${btnExpr('Pausar')}`, 3000, 'Pomodoro rodando')
  await waitFor(`/^24:5\\d/.test(document.title)`, 4000, 'título da janela mostrar o tempo correndo')
  await clickBtn('Pausar')
  await clickBtn('Glossário & Revisão')
})

test('notificações: lembrete próprio e pergunta de revisão', async () => {
  await clickTitle('Mais opções')
  await clickBtn('Notificações na área de trabalho')
  await waitFor(`!!document.querySelector('input[placeholder^="Texto do lembrete"]')`, 4000, 'diálogo de notificações abrir')
  await ev(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const a = document.querySelector('[class*="pop"] input[placeholder^="Texto do lembrete"]'); set.call(a, 'Revisar anatomia'); a.dispatchEvent(new Event('input', { bubbles: true })); const t = document.querySelector('.border-dashed input[type=time]'); set.call(t, '00:01'); t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(150)
  await clickBtn('Criar lembrete')
  await clickBtn('Enviar uma agora')
  await waitFor(`window.__N.some(n => /lembra|lacuna/i.test(n.title))`, 3000, 'pergunta de revisão')
  await closeDialogs()
  await ev(`window.__N.find(n => /lembra|lacuna/i.test(n.title)).onclick()`)
  await waitFor(`document.body.innerText.includes('Cartão 1 de 1')`, 3000, 'clique na notificação abrir o cartão')
  await clickBtn('encerrar')
  await waitFor(`window.__N.some(n => n.title === 'Lembrete' && n.body.includes('Revisar anatomia'))`, 26000, 'lembrete disparar')
})

test('impressão: caderno inteiro, glossário, lacunas ocultas e canvas desenhado', async () => {
  await openPage('Mapa Mental')
  await clickTitle('Imprimir')
  await clickBtn('Caderno inteiro')
  for (const i of [0, 1]) {
    await ev(`(() => { const c = document.querySelectorAll('.pop input[type=checkbox]')[${i}]; if (!c.checked) c.click(); return true })()`)
    await sleep(120)
  }
  await ev(`window.print = () => { window.__printed = true }`)
  await clickBtn('Imprimir…')
  await waitFor(`window.__printed === true`, 15000, 'preparar a impressão')
  const info = await ev(`({ pages: document.querySelectorAll('#print-root .print-page').length, terms: document.querySelectorAll('#print-root .print-term').length, blanks: document.querySelectorAll('#print-root .print-blank').length, draw: document.querySelectorAll('#print-root .print-draw').length, pins: document.querySelectorAll('#print-root .print-pin').length })`)
  assert(info.pages === 12, 'esperava 11 páginas + glossário: ' + js(info))
  assert(info.terms >= 10 && info.blanks >= 4 && info.draw >= 1 && info.pins >= 3, 'conteúdo de impressão incompleto: ' + js(info))
  await ev(`document.getElementById('print-root')?.remove()`)
  await closeDialogs()
})

test('backup em pasta e restauração com mídias', async () => {
  const blobs0 = await dbCount('blobs')
  assert(blobs0 >= 4, 'esperava ao menos as 4 mídias do exemplo antes do backup: ' + blobs0)
  await clickTitle('Backup')
  await waitFor(`!!${btnExpr('Conectar OneDrive')}`, 3000, 'diálogo de backup')
  await clickBtn('Conectar OneDrive')
  await waitFor(`window.nativeBackup.info().then(i => i.files.length === 1 && i.files[0].size > 100000)`, 15000, 'primeiro backup gravado')
  assert(readdirSync(path.join(cloud, 'Notepad Everywhere Backups')).length === 1, 'arquivo de backup não está na pasta')
  await closeDialogs()
  // muda os dados e restaura o backup: a página nova some e as mídias continuam
  const n = await rows()
  await clickTitle('Novo caderno')
  await waitFor(`document.querySelectorAll('.tree-row').length === ${n + 1}`, 3000, 'novo caderno')
  await clickTitle('Backup')
  await waitFor(`!!${btnExpr('Restaurar')}`, 4000, 'lista de backups')
  await ev(`[...document.querySelectorAll('.pop button')].filter(b => b.innerText.trim() === 'Restaurar').pop().click()`)
  await reloaded()
  assert((await rows()) === n, 'restauração não trouxe a árvore do backup')
  assert((await dbCount('blobs')) === blobs0, `mídias não voltaram na restauração: ${await dbCount('blobs')} de ${blobs0}`)
  await openPage('Repetição Espaçada & Recuperação Ativa')
  await waitFor(`document.querySelector('audio')?.duration > 10`, 6000, 'áudio restaurado tocar')
})

test('mesclar backup: mantém o que é mais novo aqui e traz o que falta', async () => {
  // estado atual = backup + 1 página nova local; mesclar o mesmo backup não pode apagar a página nova
  const n = await rows()
  await clickTitle('Novo caderno')
  await waitFor(`document.querySelectorAll('.tree-row').length === ${n + 1}`, 3000, 'novo caderno')
  await clickTitle('Backup')
  await waitFor(`!!${btnExpr('Mesclar')}`, 4000, 'botão Mesclar')
  await ev(`[...document.querySelectorAll('.pop button')].filter(b => b.innerText.trim() === 'Mesclar').pop().click()`)
  await reloaded()
  assert((await rows()) === n + 1, `mesclagem alterou a árvore: ${await rows()} em vez de ${n + 1}`)
})

test('desempenho com 2.000 páginas', async () => {
  await ev(`new Promise(res => { const o = indexedDB.open('notepad-everywhere'); o.onsuccess = () => { const tx = o.result.transaction('nodes', 'readwrite'); const st = tx.objectStore('nodes'); const now = Date.now(); for (let i = 0; i < 2000; i++) { const text = 'Página de carga ' + i + ' com a palavra sinapse e algum texto de enchimento para simular uma nota real de estudo. '.repeat(6); st.put({ id: 'load-' + i, parentId: i % 50 ? 'load-' + (i - (i % 50)) : null, order: 1000 + i, kind: 'page', title: 'Carga ' + i, icon: '📄', tags: [], collapsed: true, mode: 'doc', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, canvas: { items: [], strokes: [], connectors: [] }, text, termIds: [], linkIds: [], fileIds: [], mediaKinds: [], masteryManual: null, createdAt: now, updatedAt: now }) } tx.oncomplete = () => res(true) } })`)
  const t0 = Date.now()
  await call('Page.reload')
  await sleep(150) // deixa a página antiga sair
  await waitFor(`document.querySelectorAll('.tree-row').length > 5 && !!document.querySelector('.ProseMirror')`, 20000, 'app recarregar com 2.000 páginas')
  const load = Date.now() - t0
  await prep()
  const search = await ev(`(async () => { const i = document.querySelector('aside input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const t = performance.now(); set.call(i, 'enchimento'); i.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const ms = performance.now() - t; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); return Math.round(ms) })()`)
  const open = await ev(`(async () => { const t = performance.now(); [...document.querySelectorAll('.tree-row')].find(r => r.innerText.includes('Curva do Esquecimento')).click(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return Math.round(performance.now() - t) })()`)
  console.log(`      abrir o app: ~${load} ms · busca: ${search} ms · trocar de página: ${open} ms`)
  assert(load < 6000, `abertura lenta com 2.000 páginas: ${load} ms`)
  assert(search < 1500, `busca lenta: ${search} ms`)
  assert(open < 1500, `troca de página lenta: ${open} ms`)
})

/* ---------- execução ---------- */
let failed = 0
const results = []
try {
  await connect()
  await prep()
  for (const t of tests) {
    if (FILTER && !t.name.toLowerCase().includes(FILTER) && !/primeira abertura|caderno de exemplo/.test(t.name)) continue
    const t0 = Date.now()
    try {
      await t.fn()
      results.push(`  ✔ ${t.name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
    } catch (e) {
      failed++
      results.push(`  ✘ ${t.name}\n      ${String(e.message || e).split('\n')[0]}`)
      await closeDialogs().catch(() => {})
      await ev(`document.querySelectorAll('[data-pop-depth="-1"] button[title="Fechar"]').forEach(b => b.click())`).catch(() => {})
    }
    console.log(results[results.length - 1])
  }
} catch (e) {
  failed++
  console.error('Falha geral:', e.message)
} finally {
  try {
    ws?.close()
  } catch {}
  child.kill()
  await sleep(800)
  for (const d of [profile, cloud]) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {}
  }
}
if (pageErrors.length) console.log('\nErros de JavaScript na página durante os testes:\n  ' + [...new Set(pageErrors)].join('\n  '))
console.log(`\n${results.length - failed} passaram, ${failed} falharam.`)
process.exit(failed ? 1 : 0)

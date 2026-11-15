/* Execução de snippets: JS em Web Worker isolado; Python via Pyodide (CDN, carregado sob demanda). */

export interface RunResult {
  output: string
  error?: string
}

const WORKER_SRC = `
const fmt = (a) => a.map((x) => { if (typeof x === 'string') return x; try { return JSON.stringify(x, null, 1) } catch { return String(x) } }).join(' ')
for (const k of ['log', 'info', 'warn', 'error', 'debug']) console[k] = (...a) => postMessage({ t: 'log', d: fmt(a) })
onmessage = async (e) => {
  try {
    const r = await (0, eval)(e.data)
    if (r !== undefined) postMessage({ t: 'log', d: '→ ' + fmt([r]) })
  } catch (err) { postMessage({ t: 'err', d: String(err) }) }
  postMessage({ t: 'done' })
}`

export function runJs(code: string, timeoutMs = 6000): Promise<RunResult> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))
    const w = new Worker(url)
    const lines: string[] = []
    let error: string | undefined
    const finish = () => {
      clearTimeout(timer)
      w.terminate()
      URL.revokeObjectURL(url)
      resolve({ output: lines.join('\n'), error })
    }
    const timer = setTimeout(() => {
      error = `Tempo limite excedido (${timeoutMs / 1000}s)`
      finish()
    }, timeoutMs)
    w.onmessage = (e) => {
      if (e.data.t === 'log') lines.push(e.data.d)
      else if (e.data.t === 'err') error = e.data.d
      else finish()
    }
    w.onerror = (e) => {
      error = e.message
      finish()
    }
    w.postMessage(code)
  })
}

let pyodide: Promise<any> | null = null
function loadPy() {
  if (!pyodide) {
    pyodide = new Promise((resolve, reject) => {
      const base = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/'
      const s = document.createElement('script')
      s.src = base + 'pyodide.js'
      s.onload = () => (window as any).loadPyodide({ indexURL: base }).then(resolve, reject)
      s.onerror = () => reject(new Error('Não foi possível baixar o Pyodide (verifique a conexão com a internet).'))
      document.head.appendChild(s)
    })
    pyodide.catch(() => (pyodide = null))
  }
  return pyodide
}

export async function runPython(code: string): Promise<RunResult> {
  const lines: string[] = []
  try {
    const py = await loadPy()
    py.setStdout({ batched: (s: string) => lines.push(s) })
    py.setStderr({ batched: (s: string) => lines.push(s) })
    const r = await py.runPythonAsync(code)
    if (r !== undefined && r !== null) lines.push('→ ' + String(r))
    return { output: lines.join('\n') }
  } catch (e: any) {
    return { output: lines.join('\n'), error: String(e?.message || e) }
  }
}

export function canRun(lang: string | null | undefined) {
  return ['javascript', 'js', 'python', 'py'].includes(lang || '')
}
export function runCode(lang: string, code: string) {
  return lang.startsWith('py') ? runPython(code) : runJs(code)
}

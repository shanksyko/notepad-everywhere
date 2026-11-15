import { useStore } from '../store'
import { buildZip, importZip, mergeZip } from './exporter'

/* Backup automático em pasta sincronizada (só existe no app instalado — Electron). */

export type Provider = 'onedrive' | 'gdrive' | 'local' | 'custom'
export interface BackupFile {
  name: string
  size: number
  mtime: number
}
export interface BackupInfo {
  config: { folder: string | null; provider: Provider | null; onClose: boolean; everyMin: number; keep: number }
  detected: { onedrive: string | null; gdrive: string | null }
  folderOk: boolean
  files: BackupFile[]
}
interface NativeBackup {
  info(): Promise<BackupInfo>
  set(patch: Partial<BackupInfo['config']>): Promise<BackupInfo['config']>
  connect(provider: Provider): Promise<{ ok: boolean; folder?: string; reason?: string }>
  write(name: string, data: Uint8Array): Promise<{ name: string; files: BackupFile[] }>
  read(name: string): Promise<Uint8Array>
  open(): Promise<void>
  onBeforeClose(cb: () => void): void
  closedOk(): void
}

export const native: NativeBackup | undefined = (window as any).nativeBackup

let dirty = false
let busy: Promise<void> | null = null
let lastAt = Date.now()

const stamp = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

/** Grava um .zip completo na pasta conectada. */
export function backupNow(): Promise<void> {
  if (!native) return Promise.reject(new Error('Disponível apenas no app instalado'))
  if (busy) return busy
  useStore.setState({ backupStatus: 'saving' })
  busy = (async () => {
    try {
      const blob = await buildZip()
      await native.write(`notepad-backup-${stamp()}.zip`, new Uint8Array(await blob.arrayBuffer()))
      dirty = false
      lastAt = Date.now()
      useStore.setState({ backupStatus: 'ok', lastBackup: lastAt })
    } catch (e) {
      useStore.setState({ backupStatus: 'error' })
      throw e
    } finally {
      busy = null
    }
  })()
  return busy
}

export async function restoreBackup(name: string) {
  if (!native) return
  const data = await native.read(name)
  await importZip(data)
}

/** Mescla (sem apagar nada) e recarrega para mostrar o resultado. */
export async function mergeAndReload(data: Blob | ArrayBuffer | Uint8Array) {
  const s = await mergeZip(data)
  alert(`Mesclagem concluída.\n\nAtualizados ou adicionados a partir do backup:\n• ${s.paginas} página(s)\n• ${s.termos} termo(s) do glossário\n• ${s.cartoes} cartão(ões) de revisão\n• ${s.arquivos} arquivo(s) de mídia\n• ${s.pins} pin(s) de imagem\n\nO que era mais recente neste PC foi mantido.`)
  location.reload()
}
export async function mergeBackup(name: string) {
  if (native) await mergeAndReload(await native.read(name))
}

export function initAutoBackup() {
  if (!native) return
  // marca "há mudanças" sempre que os dados (não a interface) mudam
  useStore.subscribe((s, p) => {
    if (!s.ready || !p.ready) return
    if (s.nodes !== p.nodes || s.terms !== p.terms || s.cards !== p.cards || s.hotspots !== p.hotspots || s.files !== p.files || s.sessions !== p.sessions) dirty = true
  })
  native.info().then((i) => useStore.setState({ lastBackup: i.files[0]?.mtime ?? 0, backupStatus: i.config.folder ? (i.folderOk ? 'ok' : 'error') : 'off' }))
  // backup periódico, só quando há mudanças
  setInterval(async () => {
    if (!dirty || busy) return
    const { config, folderOk } = await native.info()
    if (config.folder && folderOk && config.everyMin > 0 && Date.now() - lastAt >= config.everyMin * 60000) backupNow().catch(() => {})
  }, 30000)
  // último backup ao fechar a janela
  native.onBeforeClose(async () => {
    try {
      if (dirty) {
        // dá tempo de salvar edições ainda em debounce
        await new Promise((r) => setTimeout(r, 600))
        await backupNow()
      }
    } catch {}
    native.closedOk()
  })
}

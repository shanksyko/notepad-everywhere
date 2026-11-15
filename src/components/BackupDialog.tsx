import { useEffect, useState } from 'react'
import { Check, Cloud, CloudUpload, Download, FolderOpen, HardDrive, History, Loader2, Unplug, Upload, X, GitMerge } from 'lucide-react'
import { useStore } from '../store'
import { backupNow, mergeAndReload, mergeBackup, native, restoreBackup, type BackupInfo, type Provider } from '../lib/backup'
import { exportZip, importZip } from '../lib/exporter'
import { fmtDate, fmtSize } from '../lib/util'

const PROVIDER_LABEL: Record<Provider, string> = { onedrive: 'OneDrive', gdrive: 'Google Drive', local: 'Documentos (neste PC)', custom: 'Pasta escolhida' }

function pickZip(merge = false) {
  const i = document.createElement('input')
  i.type = 'file'
  i.accept = '.zip'
  i.onchange = () => {
    const f = i.files?.[0]
    if (!f) return
    if (merge) mergeAndReload(f).catch((e) => alert(e.message))
    else if (confirm('Restaurar este backup? Tudo o que está no app agora será substituído.')) importZip(f).catch((e) => alert(e.message))
  }
  i.click()
}

/** Passo a passo para quem ainda não tem o OneDrive / Google Drive configurado no PC. */
function SetupGuide({ which, onRetry, onClose }: { which: 'onedrive' | 'gdrive'; onRetry: () => void; onClose: () => void }) {
  const od = which === 'onedrive'
  const url = od ? 'https://www.microsoft.com/microsoft-365/onedrive/download' : 'https://www.google.com/drive/download/'
  const steps = od
    ? [
        'O OneDrive já vem no Windows 10 e 11. Abra o menu Iniciar, digite “OneDrive” e abra o aplicativo. Se não aparecer, baixe pelo link abaixo e instale.',
        'Entre com a sua conta Microsoft (Outlook, Hotmail ou a conta do trabalho/escola). Se não tiver, crie uma gratuita na própria tela de login.',
        'Avance pelas telas de configuração aceitando a pasta sugerida. Uma nuvem aparece ao lado do relógio quando estiver pronto.',
        'Volte aqui e clique em “Já configurei — tentar de novo”.',
      ]
    : [
        'Baixe o “Google Drive para computador” pelo link abaixo e instale.',
        'Abra o Google Drive e entre com a sua conta Google (Gmail).',
        'Aguarde: o Drive cria uma unidade nova no PC (em geral G:) com a pasta “Meu Drive”.',
        'Volte aqui e clique em “Já configurei — tentar de novo”.',
      ]
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[13px]">
      <div className="flex items-center gap-2 mb-2">
        <div className="font-semibold flex-1">{od ? 'O OneDrive não está configurado neste PC' : 'O Google Drive não está instalado neste PC'}</div>
        <button className="icon-btn !w-6 !h-6" onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      <ol className="list-decimal pl-5 flex flex-col gap-1.5">
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <a href={url} className="btn" target="_blank" rel="noreferrer">
          <Download size={13} /> Baixar {od ? 'OneDrive' : 'Google Drive'}
        </a>
        <button className="btn btn-accent" onClick={onRetry}>
          <Check size={13} /> Já configurei — tentar de novo
        </button>
      </div>
      <div className="text-[11.5px] text-muted mt-2">Enquanto isso, o backup pode ficar em “Só neste PC (Documentos)”. Você troca para a nuvem depois, com um clique.</div>
    </div>
  )
}

/** Backup automático: conectar OneDrive / Google Drive (pasta sincronizada), fazer backup agora e restaurar. */
export function BackupDialog() {
  const open = useStore((s) => s.backupOpen)
  const status = useStore((s) => s.backupStatus)
  const lastBackup = useStore((s) => s.lastBackup)
  const [info, setInfo] = useState<BackupInfo | null>(null)
  const [msg, setMsg] = useState('')
  const [guide, setGuide] = useState<'onedrive' | 'gdrive' | null>(null)
  const refresh = () => native?.info().then(setInfo)
  useEffect(() => {
    if (open) {
      setMsg('')
      refresh()
    }
  }, [open, lastBackup])
  if (!open) return null
  const close = () => useStore.setState({ backupOpen: false })

  const connect = async (p: Provider) => {
    setMsg('')
    setGuide(null)
    const r = await native!.connect(p)
    if (r.ok) {
      useStore.setState({ backupStatus: 'ok' })
      await refresh()
      backupNow().catch((e) => setMsg('Falha no backup: ' + e.message))
    } else if (r.reason === 'not-found') {
      setGuide(p as 'onedrive' | 'gdrive')
    } else if (r.reason !== 'canceled') setMsg('Não foi possível usar essa pasta: ' + r.reason)
  }
  const patch = async (p: Partial<BackupInfo['config']>) => {
    await native!.set(p)
    if (p.folder === null) useStore.setState({ backupStatus: 'off' })
    refresh()
  }
  const cfg = info?.config
  const connected = !!cfg?.folder

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-start justify-center pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="pop w-[600px] max-w-[94vw] max-h-[86vh] overflow-auto p-4 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <CloudUpload size={18} className="text-accent" />
          <div className="font-semibold text-[15px]">Backup automático</div>
          <button className="icon-btn ml-auto" onClick={close}>
            <X size={15} />
          </button>
        </div>

        {!native && (
          <div className="rounded-lg border border-line bg-panel2/50 p-3 text-[13px] text-muted">
            O backup automático em OneDrive / Google Drive funciona no <b className="text-fg">app instalado</b>. No navegador, use a exportação manual abaixo.
          </div>
        )}

        {native && info && (
          <>
            {connected ? (
              <div className="rounded-lg border p-3 flex items-start gap-3" style={{ borderColor: info.folderOk ? '#22c55e88' : '#ef444488', background: `color-mix(in srgb, ${info.folderOk ? '#22c55e' : '#ef4444'} 8%, transparent)` }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: info.folderOk ? '#22c55e33' : '#ef444433' }}>
                  {status === 'saving' ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {info.folderOk ? `Conectado: ${PROVIDER_LABEL[cfg!.provider || 'custom']}` : 'Pasta de backup indisponível'}
                  </div>
                  <div className="text-xs text-muted break-all">{cfg!.folder}</div>
                  <div className="text-xs text-muted mt-0.5">
                    {status === 'saving' ? 'Salvando backup…' : status === 'error' ? 'O último backup falhou.' : info.files[0] ? `Último backup: ${fmtDate(info.files[0].mtime)}` : 'Nenhum backup ainda.'}
                  </div>
                </div>
                <button className="icon-btn" title="Abrir a pasta" onClick={() => native!.open()}>
                  <FolderOpen size={15} />
                </button>
                <button className="icon-btn" title="Desconectar (os backups já feitos continuam na pasta)" onClick={() => patch({ folder: null })}>
                  <Unplug size={15} />
                </button>
              </div>
            ) : (
              <div className="text-[13px] text-muted">Conecte uma pasta de nuvem. O app grava os backups nela e o OneDrive / Google Drive do seu PC envia para a nuvem sozinho.</div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button className={'btn !py-2.5 !justify-center ' + (cfg!.provider === 'onedrive' ? 'btn-on' : '')} onClick={() => connect('onedrive')}>
                <Cloud size={15} className="text-sky-400" /> Conectar OneDrive
              </button>
              <button className={'btn !py-2.5 !justify-center ' + (cfg!.provider === 'gdrive' ? 'btn-on' : '')} onClick={() => connect('gdrive')}>
                <Cloud size={15} className="text-emerald-400" /> Conectar Google Drive
              </button>
              <button className={'btn !py-2.5 !justify-center ' + (cfg!.provider === 'local' ? 'btn-on' : '')} title="Sem nuvem: salva em Documentos\Notepad Everywhere Backups" onClick={() => connect('local')}>
                <HardDrive size={15} /> Só neste PC (Documentos)
              </button>
              <button className={'btn !py-2.5 !justify-center ' + (cfg!.provider === 'custom' ? 'btn-on' : '')} title="Pendrive, HD externo, Dropbox, pasta de rede…" onClick={() => connect('custom')}>
                <FolderOpen size={15} /> Outra pasta…
              </button>
            </div>
            <div className="text-[11px] text-muted -mt-2">
              OneDrive: {info.detected.onedrive ? 'detectado neste PC' : 'não detectado'} · Google Drive: {info.detected.gdrive ? 'detectado neste PC' : 'não detectado'}
            </div>
            {!guide && (!info.detected.onedrive || !info.detected.gdrive) && (
              <div className="text-[12px] text-muted -mt-2">
                Não tem instalado?{' '}
                {!info.detected.onedrive && (
                  <button className="underline hover:text-fg" onClick={() => setGuide('onedrive')}>
                    Como configurar o OneDrive
                  </button>
                )}
                {!info.detected.onedrive && !info.detected.gdrive && ' · '}
                {!info.detected.gdrive && (
                  <button className="underline hover:text-fg" onClick={() => setGuide('gdrive')}>
                    Como configurar o Google Drive
                  </button>
                )}
              </div>
            )}
            {guide && <SetupGuide which={guide} onRetry={() => connect(guide)} onClose={() => setGuide(null)} />}
            {msg && <div className="text-[12.5px] rounded-md px-3 py-2 bg-amber-500/10 border border-amber-500/40">{msg}</div>}

            {connected && (
              <>
                <div className="flex flex-col gap-2 text-[13px]">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={cfg!.onClose} onChange={(e) => patch({ onClose: e.target.checked })} className="accent-[var(--accent)]" />
                    Fazer backup ao fechar o app
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="flex-1">Backup periódico (só quando há mudanças)</span>
                    <select value={cfg!.everyMin} onChange={(e) => patch({ everyMin: Number(e.target.value) })}>
                      <option value={0}>desligado</option>
                      <option value={10}>a cada 10 min</option>
                      <option value={30}>a cada 30 min</option>
                      <option value={60}>a cada 1 h</option>
                      <option value={240}>a cada 4 h</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="flex-1">Manter os últimos</span>
                    <select value={cfg!.keep} onChange={(e) => patch({ keep: Number(e.target.value) })}>
                      {[3, 5, 10, 20, 50].map((n) => (
                        <option key={n} value={n}>
                          {n} backups
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button className="btn btn-accent !py-2 !justify-center" disabled={status === 'saving'} onClick={() => backupNow().catch((e) => setMsg('Falha no backup: ' + e.message))}>
                  {status === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />} Fazer backup agora
                </button>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted mb-1.5 flex items-center gap-1.5">
                    <History size={11} /> Backups na pasta ({info.files.length})
                  </div>
                  <div className="flex flex-col gap-1 max-h-44 overflow-auto">
                    {!info.files.length && <div className="text-xs text-muted">Nenhum backup ainda.</div>}
                    {info.files.map((f) => (
                      <div key={f.name} className="flex items-center gap-2 text-xs rounded-md px-2 py-1.5 bg-panel2/50">
                        <span className="flex-1">{fmtDate(f.mtime)}</span>
                        <span className="text-muted">{fmtSize(f.size)}</span>
                        <button
                          className="btn !py-0.5"
                          onClick={() => confirm(`Restaurar o backup de ${fmtDate(f.mtime)}? Tudo o que está no app agora será substituído.`) && restoreBackup(f.name).catch((e) => setMsg('Falha ao restaurar: ' + e.message))}
                        >
                          Restaurar
                        </button>
                        <button className="btn !py-0.5" title="Junta este backup com o que já está no app: vence o que foi editado por último; nada é apagado" onClick={() => mergeBackup(f.name).catch((e) => setMsg('Falha ao mesclar: ' + e.message))}>
                          Mesclar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        <div className="border-t border-line pt-3 flex items-center gap-2">
          <span className="text-xs text-muted flex-1">Backup manual (.zip com notas, glossário, mídias e Markdown)</span>
          <button className="btn" onClick={() => exportZip()}>
            <Download size={13} /> Exportar .zip
          </button>
          <button className="btn" onClick={() => pickZip()}>
            <Upload size={13} /> Importar .zip
          </button>
          <button className="btn" title="Para usar o mesmo caderno em dois PCs: junta o backup com o que já está aqui, sem apagar nada" onClick={() => pickZip(true)}>
            <GitMerge size={13} /> Mesclar .zip
          </button>
        </div>
      </div>
    </div>
  )
}

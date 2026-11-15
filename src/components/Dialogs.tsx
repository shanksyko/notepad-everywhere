import { useEffect, useState } from 'react'
import { BookOpen, CloudUpload, EyeOff, History, Keyboard, RotateCcw, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import { actions, loadDemoNotebook, useStore } from '../store'
import type { Snapshot } from '../db'
import { fmtDate } from '../lib/util'

/* Lixeira, histórico de versões e boas-vindas. */

function Shell({ title, icon, onClose, children, width = 560 }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode; width?: number }) {
  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-start justify-center pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="pop max-w-[94vw] max-h-[86vh] overflow-auto p-4 flex flex-col gap-3" style={{ width }}>
        <div className="flex items-center gap-2">
          <span className="text-accent">{icon}</span>
          <div className="font-semibold text-[15px]">{title}</div>
          <button className="icon-btn ml-auto" title="Fechar" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Lixeira: páginas excluídas ficam 30 dias aqui e podem ser restauradas. */
export function TrashDialog() {
  const open = useStore((s) => s.trashOpen)
  const trash = useStore((s) => s.trash)
  if (!open) return null
  const close = () => useStore.setState({ trashOpen: false })
  return (
    <Shell title="Lixeira" icon={<Trash2 size={18} />} onClose={close}>
      <div className="text-[12.5px] text-muted">Páginas excluídas ficam aqui por 30 dias, com as subpáginas e as lacunas. Depois disso são apagadas de vez.</div>
      {!trash.length && <div className="text-sm text-muted py-6 text-center">A lixeira está vazia.</div>}
      <div className="flex flex-col gap-1.5">
        {trash.map((t) => (
          <div key={t.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] truncate">
                {t.icon} {t.title}
              </div>
              <div className="text-[11px] text-muted">
                Excluída em {fmtDate(t.deletedAt)}
                {t.nodes.length > 1 ? ` · ${t.nodes.length - 1} subpágina(s)` : ''}
              </div>
            </div>
            <button className="btn btn-accent" onClick={() => actions.restoreTrash(t.id)}>
              <Undo2 size={13} /> Restaurar
            </button>
            <button className="icon-btn" title="Apagar de vez" onClick={() => confirm(`Apagar "${t.title}" definitivamente? Não dá para desfazer.`) && actions.purgeTrash(t.id)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      {trash.length > 0 && (
        <button className="btn !text-red-400 self-start" onClick={() => confirm('Esvaziar a lixeira? Todas as páginas nela serão apagadas definitivamente.') && actions.emptyTrash()}>
          <Trash2 size={13} /> Esvaziar lixeira
        </button>
      )}
    </Shell>
  )
}

/** Histórico de versões da página atual. */
export function HistoryDialog() {
  const open = useStore((s) => s.historyOpen)
  const node = useStore((s) => (s.currentId ? s.nodes[s.currentId] : null))
  const [list, setList] = useState<Snapshot[]>([])
  const [sel, setSel] = useState<Snapshot | null>(null)
  useEffect(() => {
    if (open && node) actions.listHistory(node.id).then((l) => (setList(l), setSel(l[0] || null)))
    // eslint-disable-next-line
  }, [open, node?.id])
  if (!open || !node) return null
  const close = () => useStore.setState({ historyOpen: false })
  return (
    <Shell title={`Histórico de versões — ${node.title}`} icon={<History size={18} />} onClose={close} width={760}>
      <div className="text-[12.5px] text-muted">O app guarda a versão anterior quando você começa a editar uma página e depois a cada 10 minutos de edição (até 40 versões por página). Vale para o texto e para o canvas.</div>
      {!list.length ? (
        <div className="text-sm text-muted py-6 text-center">Ainda não há versões guardadas desta página.</div>
      ) : (
        <div className="flex gap-3 min-h-[280px]">
          <div className="w-52 shrink-0 flex flex-col gap-1 max-h-[52vh] overflow-auto">
            {list.map((s) => (
              <button key={s.id} className={'text-left rounded-md px-2.5 py-1.5 text-[12.5px] border ' + (sel?.id === s.id ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-panel2')} onClick={() => setSel(s)}>
                {fmtDate(s.at)}
                <span className="block text-[11px] text-muted">{s.text.length} caracteres</span>
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <div className="flex-1 rounded-lg border border-line bg-panel2/50 p-3 text-[13px] whitespace-pre-wrap overflow-auto max-h-[46vh]">{sel?.text || <span className="text-muted">(sem texto — só mídia ou página vazia)</span>}</div>
            <button
              className="btn btn-accent self-end"
              disabled={!sel}
              onClick={async () => {
                if (!sel || !confirm(`Voltar a página para a versão de ${fmtDate(sel.at)}? A versão atual fica guardada no histórico.`)) return
                await actions.restoreSnapshot(sel.id)
                close()
              }}
            >
              <RotateCcw size={13} /> Restaurar esta versão
            </button>
          </div>
        </div>
      )}
    </Shell>
  )
}

/** Tela de boas-vindas na primeira abertura. */
export function WelcomeDialog() {
  const open = useStore((s) => s.welcomeOpen)
  if (!open) return null
  const close = () => actions.closeWelcome()
  const Tip = ({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) => (
    <div className="flex gap-2.5">
      <span className="text-accent mt-0.5 shrink-0">{icon}</span>
      <div className="text-[13px]">
        <b>{title}</b>
        <span className="block text-muted text-[12.5px]">{text}</span>
      </div>
    </div>
  )
  return (
    <Shell title="Bem-vindo ao Notepad Everywhere" icon={<img src="./icon.png" alt="" className="w-6 h-6" />} onClose={close} width={600}>
      <div className="text-[13px]">Um bloco de notas em árvore para estudar: cada conceito que você define vira um pop-up que aparece em qualquer nota, e o app te ajuda a revisar na hora certa.</div>
      <div className="flex flex-col gap-2.5 py-1">
        <Tip icon={<BookOpen size={16} />} title="Crie significados" text="Selecione uma palavra na nota e clique em “+ Adicionar Significado”. Depois, passe o mouse sobre ela em qualquer página." />
        <Tip icon={<EyeOff size={16} />} title="Esconda lacunas para se testar" text="Selecione um trecho e clique em “Ocultar Lacuna”. Ligue o Modo Estudo na barra de cima para escondê-las." />
        <Tip icon={<CloudUpload size={16} />} title="Ligue o backup" text="No ícone de download, conecte o OneDrive, o Google Drive ou uma pasta. O app salva sozinho." />
        <Tip icon={<Keyboard size={16} />} title="Tudo tem botão" text="Os três pontinhos no canto reúnem todas as funções: temas, impressão, atalhos, notificações, lixeira." />
      </div>
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <button
          className="btn"
          onClick={() => {
            actions.closeWelcome()
            setTimeout(loadDemoNotebook, 150)
          }}
        >
          <Sparkles size={13} /> Ver o caderno de exemplo
        </button>
        <button
          className="btn"
          onClick={() => {
            close()
            useStore.setState({ backupOpen: true })
          }}
        >
          <CloudUpload size={13} /> Configurar backup
        </button>
        <span className="flex-1" />
        <button className="btn btn-accent" onClick={close}>
          Começar a escrever
        </button>
      </div>
    </Shell>
  )
}

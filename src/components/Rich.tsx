import { useEffect, useMemo, useRef } from 'react'
import { Bold, Image as ImageIcon, Italic, Link2, List, Sigma } from 'lucide-react'
import { enrich } from '../lib/matcher'
import { useStore } from '../store'

/** Renderiza HTML de definição com LaTeX e termos do glossário auto-linkados (pop-ups em cascata). */
export function RichHtml({ html, exclude, className = '' }: { html: string; exclude?: string; className?: string }) {
  const v = useStore((s) => s.termsVersion)
  const out = useMemo(() => enrich(html, exclude), [html, exclude, v])
  return <div className={'rich ' + className} dangerouslySetInnerHTML={{ __html: out }} />
}

/** Mini editor rico (contentEditable) para definições: negrito, itálico, links, listas, imagens e $LaTeX$. */
export function RichInput({ html, onChange, placeholder, autoFocus }: { html: string; onChange: (html: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = html
      if (autoFocus) ref.current.focus()
    }
    // eslint-disable-next-line
  }, [])
  const emit = () => onChange(ref.current?.innerHTML || '')
  const cmd = (c: string, arg?: string) => {
    ref.current?.focus()
    document.execCommand(c, false, arg)
    emit()
  }
  const tb = 'icon-btn !w-6 !h-6'
  return (
    <div>
      <div className="flex items-center gap-0.5 mb-1">
        <button type="button" className={tb} title="Negrito" onMouseDown={(e) => (e.preventDefault(), cmd('bold'))}>
          <Bold size={13} />
        </button>
        <button type="button" className={tb} title="Itálico" onMouseDown={(e) => (e.preventDefault(), cmd('italic'))}>
          <Italic size={13} />
        </button>
        <button type="button" className={tb} title="Lista" onMouseDown={(e) => (e.preventDefault(), cmd('insertUnorderedList'))}>
          <List size={13} />
        </button>
        <button
          type="button"
          className={tb}
          title="Link externo"
          onMouseDown={(e) => {
            e.preventDefault()
            const url = prompt('URL do link:', 'https://')
            if (url) cmd('createLink', url)
          }}
        >
          <Link2 size={13} />
        </button>
        <button type="button" className={tb} title="Fórmula LaTeX ($...$)" onMouseDown={(e) => (e.preventDefault(), cmd('insertText', '$x^2$'))}>
          <Sigma size={13} />
        </button>
        <button type="button" className={tb} title="Inserir imagem" onMouseDown={(e) => (e.preventDefault(), fileRef.current?.click())}>
          <ImageIcon size={13} />
        </button>
        <span className="text-[11px] text-muted ml-2">Use $...$ para fórmulas</span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (!f) return
            const r = new FileReader()
            r.onload = () => cmd('insertImage', String(r.result))
            r.readAsDataURL(f)
            e.target.value = ''
          }}
        />
      </div>
      <div ref={ref} className="rich rich-input" contentEditable suppressContentEditableWarning data-placeholder={placeholder} onInput={emit} onBlur={emit} style={{ tabSize: 4, whiteSpace: 'pre-wrap' }} />
    </div>
  )
}

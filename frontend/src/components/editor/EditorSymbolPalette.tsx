import { useMemo, useState } from 'react'
import { LATEX_SYMBOL_CATEGORIES, type SymbolCategory } from '../../lib/latexSymbols'

export default function EditorSymbolPalette(props: {
  open: boolean
  onClose: () => void
  onPick: (latex: string) => void
}) {
  const { open, onClose, onPick } = props
  const [cat, setCat] = useState<SymbolCategory>('common')
  const [q, setQ] = useState('')

  const items = useMemo(() => {
    const block = LATEX_SYMBOL_CATEGORIES.find((c) => c.id === cat)
    if (!block) return []
    const s = q.trim().toLowerCase()
    if (!s) return block.items
    return block.items.filter(
      (it) => it.label.toLowerCase().includes(s) || it.insert.toLowerCase().includes(s),
    )
  }, [cat, q])

  if (!open) return null

  return (
    <div className="editor-symbol-palette" role="dialog" aria-label="插入符号">
      <div className="editor-symbol-palette__head">
        <div className="editor-symbol-palette__tabs" role="tablist">
          {LATEX_SYMBOL_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={cat === c.id}
              className={cat === c.id ? 'is-on' : ''}
              onClick={() => setCat(c.id)}
            >
              {c.title}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="editor-symbol-palette__search"
          placeholder="搜索…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="搜索符号"
        />
        <button type="button" className="editor-symbol-palette__close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
      <div className="editor-symbol-palette__grid">
        {items.map((it) => {
          const longLabel = it.label.length > 2 || it.insert.length > 14
          return (
            <button
              key={`${cat}-${it.insert}`}
              type="button"
              className={`editor-symbol-palette__cell${longLabel ? ' editor-symbol-palette__cell--wide' : ''}`}
              title={it.insert}
              onClick={() => onPick(it.insert)}
            >
              {it.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

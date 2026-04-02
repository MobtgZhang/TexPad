import type * as monaco from 'monaco-editor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default function EditorFindBar(props: {
  editor: monaco.editor.IStandaloneCodeEditor | null
  monacoApi: typeof monaco | null
  open: boolean
  onClose: () => void
}) {
  const { editor, monacoApi, open, onClose } = props
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [inSelection, setInSelection] = useState(false)
  const [matches, setMatches] = useState<monaco.editor.FindMatch[]>([])
  const [idx, setIdx] = useState(0)
  const findInputRef = useRef<HTMLInputElement>(null)
  const decoRef = useRef<string[]>([])

  const pattern = useMemo(() => {
    if (!find) return { text: '', isRegex: false as boolean }
    if (regex) return { text: find, isRegex: true }
    if (wholeWord) return { text: `\\b${escapeRegExp(find)}\\b`, isRegex: true }
    return { text: find, isRegex: false }
  }, [find, regex, wholeWord])

  const runSearch = useCallback(() => {
    if (!editor || !monacoApi) {
      setMatches([])
      setIdx(0)
      return
    }
    const model = editor.getModel()
    if (!model || !pattern.text) {
      setMatches([])
      setIdx(0)
      return
    }
    const sel = inSelection ? editor.getSelection() : null
    const scope = sel && !sel.isEmpty() ? sel : null
    const found = scope
      ? model.findMatches(pattern.text, scope, pattern.isRegex, caseSensitive, null, false)
      : model.findMatches(pattern.text, false, pattern.isRegex, caseSensitive, null, false)
    setMatches(found)
    setIdx(0)
  }, [editor, monacoApi, pattern.text, pattern.isRegex, caseSensitive, inSelection])

  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(runSearch, find ? 100 : 0)
    return () => window.clearTimeout(id)
  }, [open, find, runSearch])

  useEffect(() => {
    if (open) {
      window.setTimeout(() => findInputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    if (!editor || !monacoApi || !open) {
      return
    }
    const model = editor.getModel()
    if (!model) return

    const applyDeco = () => {
      const old = decoRef.current
      if (!matches.length) {
        decoRef.current = model.deltaDecorations(old, [])
        return
      }
      const cur = matches[Math.min(idx, matches.length - 1)]!
      const next = matches.map((m, i) => ({
        range: m.range,
        options: {
          className: i === Math.min(idx, matches.length - 1) ? 'editor-find-match--current' : 'editor-find-match',
          isWholeLine: false,
        },
      }))
      decoRef.current = model.deltaDecorations(old, next)
      editor.revealRangeInCenter(cur.range)
      editor.setPosition(cur.range.getStartPosition())
    }
    applyDeco()

    return () => {
      decoRef.current = model.deltaDecorations(decoRef.current, [])
    }
  }, [editor, monacoApi, matches, idx, open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function goPrev() {
    if (!matches.length) return
    setIdx((i) => (i - 1 + matches.length) % matches.length)
  }

  function goNext() {
    if (!matches.length) return
    setIdx((i) => (i + 1) % matches.length)
  }

  function replaceOne() {
    if (!editor || !matches.length) return
    const m = matches[Math.min(idx, matches.length - 1)]!
    editor.executeEdits('texpad-find', [{ range: m.range, text: replace, forceMoveMarkers: true }])
    window.setTimeout(() => runSearch(), 0)
  }

  function replaceAll() {
    if (!editor || !matches.length) return
    const model = editor.getModel()
    if (!model) return
    const sorted = [...matches].sort((a, b) => {
      const la = a.range.startLineNumber * 1e6 + a.range.startColumn
      const lb = b.range.startLineNumber * 1e6 + b.range.startColumn
      return lb - la
    })
    const edits = sorted.map((m) => ({ range: m.range, text: replace, forceMoveMarkers: true }))
    editor.executeEdits('texpad-find-all', edits)
    window.setTimeout(() => runSearch(), 0)
  }

  if (!open) return null

  return (
    <div className="editor-find-bar" role="search">
      <div className="editor-find-bar__main">
        <div className="editor-find-bar__inputs">
          <div className="editor-find-bar__field-wrap">
            <input
              ref={findInputRef}
              className="editor-find-bar__input"
              placeholder="Search for"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              aria-label="查找"
            />
            <div className="editor-find-bar__toggles">
              <button
                type="button"
                className={`editor-find-bar__toggle${caseSensitive ? ' is-on' : ''}`}
                title="区分大小写 (Aa)"
                aria-pressed={caseSensitive}
                onClick={() => setCaseSensitive((v) => !v)}
              >
                Aa
              </button>
              <button
                type="button"
                className={`editor-find-bar__toggle${regex ? ' is-on' : ''}`}
                title="正则表达式"
                aria-pressed={regex}
                onClick={() => setRegex((v) => !v)}
              >
                [.*]
              </button>
              <button
                type="button"
                className={`editor-find-bar__toggle${wholeWord ? ' is-on' : ''}`}
                title="全字匹配"
                aria-pressed={wholeWord}
                onClick={() => setWholeWord((v) => !v)}
              >
                W
              </button>
              <button
                type="button"
                className={`editor-find-bar__toggle${inSelection ? ' is-on' : ''}`}
                title="仅在选区内查找"
                aria-pressed={inSelection}
                onClick={() => setInSelection((v) => !v)}
              >
                <span className="editor-find-bar__icon-sel" aria-hidden>
                  ┃
                </span>
              </button>
            </div>
          </div>
          <input
            className="editor-find-bar__input editor-find-bar__input--replace"
            placeholder="Replace with"
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            aria-label="替换为"
          />
        </div>
        <div className="editor-find-bar__mid">
          <button type="button" className="editor-find-bar__iconbtn" title="上一处" aria-label="上一处" onClick={goPrev}>
            ↑
          </button>
          <button type="button" className="editor-find-bar__iconbtn" title="下一处" aria-label="下一处" onClick={goNext}>
            ↓
          </button>
          <span className="editor-find-bar__count" aria-live="polite">
            {matches.length ? `${Math.min(idx + 1, matches.length)}/${matches.length}` : '0/0'}
          </span>
        </div>
        <div className="editor-find-bar__actions">
          <button type="button" className="editor-find-bar__textbtn" onClick={replaceOne} disabled={!matches.length}>
            Replace
          </button>
          <button type="button" className="editor-find-bar__textbtn" onClick={replaceAll} disabled={!matches.length}>
            Replace All
          </button>
        </div>
      </div>
      <button type="button" className="editor-find-bar__close" aria-label="关闭查找" onClick={onClose}>
        ×
      </button>
    </div>
  )
}

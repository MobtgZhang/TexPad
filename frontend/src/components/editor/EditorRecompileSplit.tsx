import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CompilePrefs } from '../../lib/compilePrefs'
import { saveCompilePrefs } from '../../lib/compilePrefs'

function MenuSectionTitle({ children }: { children: ReactNode }) {
  return <div className="editor-recompile-pop__section">{children}</div>
}

function MenuChoice(props: {
  label: string
  selected: boolean
  onPick: () => void
}) {
  const { label, selected, onPick } = props
  return (
    <button type="button" className="editor-recompile-pop__row" role="menuitemradio" aria-checked={selected} onClick={onPick}>
      <span>{label}</span>
      {selected ? <span className="editor-recompile-pop__check">✓</span> : <span className="editor-recompile-pop__check" />}
    </button>
  )
}

function MenuAction(props: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="editor-recompile-pop__row editor-recompile-pop__row--action" role="menuitem" disabled={props.disabled} onClick={props.onClick}>
      {props.label}
    </button>
  )
}

export default function EditorRecompileSplit(props: {
  readOnly: boolean
  compiling: boolean
  prefs: CompilePrefs
  onPrefsChange: (p: CompilePrefs) => void
  onRecompile: () => void
  onRecompileFromScratch: () => void
}) {
  const { readOnly, compiling, prefs, onPrefsChange, onRecompile, onRecompileFromScratch } = props
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function patch(p: Partial<CompilePrefs>) {
    const next = { ...prefs, ...p }
    saveCompilePrefs(next)
    onPrefsChange(next)
  }

  return (
    <div className="editor-recompile-wrap" ref={rootRef}>
      <div className="editor-recompile-split" role="group" aria-label="编译">
        <button
          type="button"
          className="editor-recompile-main"
          disabled={readOnly || compiling}
          onClick={() => {
            setOpen(false)
            onRecompile()
          }}
        >
          {compiling ? '编译中…' : '重新编译'}
        </button>
        <button
          type="button"
          className="editor-recompile-caret"
          disabled={readOnly}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="编译选项"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open ? (
        <div className="editor-recompile-pop dash-pop" role="menu" aria-label="编译菜单">
          <MenuSectionTitle>编译模式（Compile mode）</MenuSectionTitle>
          <MenuChoice label="Normal" selected={prefs.compileMode === 'normal'} onPick={() => patch({ compileMode: 'normal' })} />
          <MenuChoice label="Fast [draft]" selected={prefs.compileMode === 'draft'} onPick={() => patch({ compileMode: 'draft' })} />
          <div className="dash-pop__rule" />
          <MenuSectionTitle>语法检查（Syntax checks）</MenuSectionTitle>
          <MenuChoice
            label="编译前检查语法（Check syntax before compile）"
            selected={prefs.syntaxCheckBeforeCompile}
            onPick={() => patch({ syntaxCheckBeforeCompile: true })}
          />
          <MenuChoice
            label="不检查语法（Don't check syntax）"
            selected={!prefs.syntaxCheckBeforeCompile}
            onPick={() => patch({ syntaxCheckBeforeCompile: false })}
          />
          <div className="dash-pop__rule" />
          <MenuSectionTitle>错误处理（Compile error handling）</MenuSectionTitle>
          <MenuChoice label="首个错误即停止（Stop on first error）" selected={prefs.haltOnFirstError} onPick={() => patch({ haltOnFirstError: true })} />
          <MenuChoice
            label="尽力编译（Try to compile despite errors）"
            selected={!prefs.haltOnFirstError}
            onPick={() => patch({ haltOnFirstError: false })}
          />
          <div className="dash-pop__rule" />
          <MenuSectionTitle>自动编译（Autocompile）</MenuSectionTitle>
          <MenuChoice label="关闭" selected={!prefs.autoCompile} onPick={() => patch({ autoCompile: false })} />
          <MenuChoice label="开启（编辑停止约 4.5s 后编译）" selected={prefs.autoCompile} onPick={() => patch({ autoCompile: true })} />
          <div className="dash-pop__rule" />
          <MenuSectionTitle>操作</MenuSectionTitle>
          <MenuAction
            label="停止编译（Stop compilation）"
            onClick={() => {
              setOpen(false)
              window.alert('当前版本无法在服务端中断进行中的编译。')
            }}
          />
          <MenuAction
            label="从零重新编译（Recompile from scratch）"
            disabled={readOnly || compiling}
            onClick={() => {
              setOpen(false)
              onRecompileFromScratch()
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

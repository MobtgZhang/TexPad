import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { AgentPrefs, AgentSamplingPreset } from '../../lib/agentPrefs'
import type { ThemePref } from '../../lib/theme'
import EditorAgentSettingsForm from './EditorAgentSettingsForm'
import {
  EDITOR_FONT_FAMILY_OPTIONS,
  EDITOR_FONT_SIZE_OPTIONS,
  EDITOR_LINE_HEIGHT_OPTIONS,
  saveEditorPrefs,
  SPELLCHECK_LANGS,
  type EditorFontStackId,
  type EditorLineHeightPreset,
  type EditorPrefs,
  type KeybindingPref,
  type PdfViewerPref,
} from '../../lib/editorSettings'
import type { ViewPrefs } from '../../lib/viewPrefs'
import { MONACO_EDITOR_THEME_OPTIONS } from '../../lib/monacoEditorThemes'
import type { CompilePrefs } from '../../lib/compilePrefs'

export type SettingsSection = 'editor' | 'compiler' | 'appearance' | 'agent'

function ToggleRow(props: {
  title: string
  hint?: string
  on: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  const { title, hint, on, onChange, disabled } = props
  return (
    <div className="editor-settings-row">
      <div className="editor-settings-row__text">
        <div className="editor-settings-row__title">{title}</div>
        {hint ? <div className="editor-settings-row__hint">{hint}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        className={`editor-settings-toggle${on ? ' is-on' : ''}`}
        onClick={() => onChange(!on)}
      />
    </div>
  )
}

function SelectRow(props: {
  title: string
  hint?: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  const { title, hint, value, onChange, options, disabled } = props
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const tr = triggerRef.current.getBoundingClientRect()
    const dialog = triggerRef.current.closest('.editor-settings-dialog')
    const dr = dialog?.getBoundingClientRect()
    const pad = 12
    const maxFromDialog = dr ? Math.max(100, dr.bottom - tr.bottom - pad) : 200
    const maxH = Math.min(200, maxFromDialog, window.innerHeight - tr.bottom - pad)
    const maxW = dr ? Math.min(Math.max(tr.width, 200), dr.width - pad * 2) : Math.max(tr.width, 220)
    setMenuStyle({
      position: 'fixed',
      left: Math.min(tr.left, (dr?.right ?? window.innerWidth) - maxW - pad),
      top: tr.bottom + 4,
      width: maxW,
      maxHeight: maxH,
      zIndex: 10050,
    })
  }, [open, value, options.length])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const n = e.target as Node
      if (triggerRef.current?.contains(n) || menuRef.current?.contains(n)) return
      setOpen(false)
    }
    const onScroll = () => {
      if (!triggerRef.current) return
      const tr = triggerRef.current.getBoundingClientRect()
      const dialog = triggerRef.current.closest('.editor-settings-dialog')
      const dr = dialog?.getBoundingClientRect()
      const pad = 12
      const maxFromDialog = dr ? Math.max(100, dr.bottom - tr.bottom - pad) : 200
      const maxH = Math.min(200, maxFromDialog, window.innerHeight - tr.bottom - pad)
      const maxW = dr ? Math.min(Math.max(tr.width, 200), dr.width - pad * 2) : Math.max(tr.width, 220)
      setMenuStyle((s) => ({
        ...s,
        left: Math.min(tr.left, (dr?.right ?? window.innerWidth) - maxW - pad),
        top: tr.bottom + 4,
        width: maxW,
        maxHeight: maxH,
      }))
    }
    document.addEventListener('mousedown', onDoc, false)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDoc, false)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  useEffect(() => {
    if (!open || !triggerRef.current) return
    const dialog = triggerRef.current.closest('.editor-settings-dialog')
    if (!dialog) return
    const onKey = (e: Event) => {
      if (!(e instanceof KeyboardEvent) || e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
    dialog.addEventListener('keydown', onKey, true)
    return () => dialog.removeEventListener('keydown', onKey, true)
  }, [open])

  return (
    <div className="editor-settings-row editor-settings-row--select">
      <div className="editor-settings-row__text">
        <div className="editor-settings-row__title">{title}</div>
        {hint ? <div className="editor-settings-row__hint">{hint}</div> : null}
      </div>
      <div className="editor-settings-select-wrap">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          className={`editor-settings-select-trigger${open ? ' is-open' : ''}`}
          aria-label={title}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => !disabled && setOpen((o) => !o)}
        >
          <span className="editor-settings-select-trigger__text">{selectedLabel}</span>
          <span className="editor-settings-select-trigger__chev" aria-hidden>
            ▾
          </span>
        </button>
        {open
          ? createPortal(
              <div ref={menuRef} className="editor-settings-select-menu" role="listbox" style={menuStyle}>
                {options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    className={`editor-settings-select-opt${o.value === value ? ' is-active' : ''}`}
                    onClick={() => {
                      onChange(o.value)
                      setOpen(false)
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>,
              document.body,
            )
          : null}
      </div>
    </div>
  )
}

export default function EditorSettingsModal(props: {
  open: boolean
  initialSection: SettingsSection
  onClose: () => void
  themePref: ThemePref
  onThemePref: (p: ThemePref) => void
  engine: string
  onEngine: (e: string) => void
  readOnly: boolean
  prefs: EditorPrefs
  onPrefsChange: (p: EditorPrefs) => void
  projectId?: string
  agentPrefs: AgentPrefs
  onPatchAgentPrefs: (patch: Partial<AgentPrefs>) => void
  onSamplingPreset: (preset: AgentSamplingPreset) => void
  activeSamplingPreset: AgentSamplingPreset | null
  compilePrefs: CompilePrefs
  onCompilePrefsChange: (p: CompilePrefs) => void
  mainTexPath: string
  mainTexOptions: string[]
  onMainTexPath: (path: string) => void | Promise<void>
  viewPrefs: ViewPrefs
  onPatchViewPrefs: (patch: Partial<ViewPrefs>) => void
  /** 当前界面实际亮/暗（含「跟随系统」解析结果） */
  appUiTheme: 'dark' | 'light'
}) {
  const {
    open,
    initialSection,
    onClose,
    themePref,
    onThemePref,
    engine,
    onEngine,
    readOnly,
    prefs,
    onPrefsChange,
    projectId,
    agentPrefs,
    onPatchAgentPrefs,
    onSamplingPreset,
    activeSamplingPreset,
    compilePrefs,
    onCompilePrefsChange,
    mainTexPath,
    mainTexOptions,
    onMainTexPath,
    viewPrefs,
    onPatchViewPrefs,
    appUiTheme,
  } = props

  const [section, setSection] = useState<SettingsSection>(initialSection)
  const [dictOpen, setDictOpen] = useState(false)
  const [dictDraft, setDictDraft] = useState('')

  useEffect(() => {
    if (open) setSection(initialSection)
  }, [open, initialSection])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (dictOpen) setDictOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dictOpen])

  useEffect(() => {
    if (dictOpen) setDictDraft(prefs.customDictionary.join('\n'))
  }, [dictOpen, prefs.customDictionary])

  if (!open) return null

  function patchPrefs(patch: Partial<EditorPrefs>) {
    const next = { ...prefs, ...patch }
    saveEditorPrefs(next)
    onPrefsChange(next)
  }

  function patchCompile(patch: Partial<CompilePrefs>) {
    const next = { ...compilePrefs, ...patch }
    onCompilePrefsChange(next)
  }

  function saveDictionary() {
    const words = dictDraft
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    patchPrefs({ customDictionary: [...new Set(words)] })
    setDictOpen(false)
  }

  const nav: { id: SettingsSection; label: string }[] = [
    { id: 'editor', label: '编辑器' },
    { id: 'compiler', label: '编译器' },
    { id: 'appearance', label: '主题' },
    { id: 'agent', label: '智能体' },
  ]

  const editorPanel = (
    <div className="editor-settings-panel">
      <h3 className="editor-settings-panel__heading">编辑器</h3>
        <ToggleRow
          title="自动补全"
          hint="输入时弹出代码补全建议。"
          on={prefs.autoComplete}
          onChange={(v) => patchPrefs({ autoComplete: v })}
          disabled={readOnly}
        />
        <ToggleRow
          title="自动闭合括号"
          hint="自动补全括号与引号。"
          on={prefs.autoCloseBrackets}
          onChange={(v) => patchPrefs({ autoCloseBrackets: v })}
          disabled={readOnly}
        />
        <ToggleRow
          title="代码检查"
          hint="编辑器内实时语法检查。"
          on={prefs.codeCheck}
          onChange={(v) => patchPrefs({ codeCheck: v })}
          disabled={readOnly}
        />
        <SelectRow
          title="快捷键"
          hint="Vim / Emacs 模拟将在后续版本接入。"
          value={prefs.keybinding}
          onChange={(v) => {
            const kb = v as KeybindingPref
            if (kb === 'none') {
              patchPrefs({ keybinding: 'none' })
              return
            }
            window.alert('Vim / Emacs 键位模拟将在后续版本接入；当前仍为默认键位。')
          }}
          options={[
            { value: 'none', label: '默认' },
            { value: 'vim', label: 'Vim' },
            { value: 'emacs', label: 'Emacs' },
          ]}
          disabled={readOnly}
        />
        <SelectRow
          title="PDF 预览"
          hint="在应用内嵌预览或使用浏览器打开。"
          value={prefs.pdfViewer}
          onChange={(v) => patchPrefs({ pdfViewer: v as PdfViewerPref })}
          options={[
            { value: 'in_app', label: '应用内预览' },
            { value: 'browser', label: '系统浏览器' },
          ]}
          disabled={readOnly}
        />
        <div className="editor-settings-row editor-settings-row--action">
          <div className="editor-settings-row__text">
            <div className="editor-settings-row__title">参考文献检索</div>
            <div className="editor-settings-row__hint">在项目中搜索 .bib / \\cite 相关内容。</div>
          </div>
          <button
            type="button"
            className="editor-settings-btn"
            onClick={() =>
              window.alert(
                '参考文献检索：当前可使用左侧「查找文件」在项目中搜索 .bib / \\cite 相关内容；完整引用面板将在后续版本提供。',
              )
            }
          >
            设置
          </button>
        </div>
        <div className="editor-settings-divider" />
        <h4 className="editor-settings-subheading">拼写检查</h4>
        <SelectRow
          title="拼写检查语言"
          hint="拼写检查所用语言。"
          value={prefs.spellcheckLang}
          onChange={(v) => patchPrefs({ spellcheckLang: v })}
          options={SPELLCHECK_LANGS}
          disabled={readOnly}
        />
        <div className="editor-settings-row editor-settings-row--action">
          <div className="editor-settings-row__text">
            <div className="editor-settings-row__title">自定义词典</div>
            <div className="editor-settings-row__hint">自定义词典词条。</div>
          </div>
          <button type="button" className="editor-settings-btn" onClick={() => setDictOpen(true)} disabled={readOnly}>
            编辑
          </button>
        </div>
    </div>
  )

  const texMainChoices =
    mainTexOptions.length > 0 ? mainTexOptions : mainTexPath ? [mainTexPath] : ['main.tex']

  const compilerPanel = (
    <div className="editor-settings-panel">
      <h3 className="editor-settings-panel__heading">编译器</h3>
      <SelectRow
        title="主文档"
        hint="编译时使用的入口 .tex 文件；也可在左侧文件树中对文件右键设为根文档。"
        value={mainTexPath}
        onChange={(v) => void onMainTexPath(v)}
        options={texMainChoices.map((p) => ({ value: p, label: p }))}
        disabled={readOnly}
      />
      <SelectRow
        title="编译引擎"
        hint="与工具栏「重新编译」一致；ConTeXt 用于 \\starttext … \\stoptext 等文档。"
        value={engine}
        onChange={onEngine}
        options={[
          { value: 'pdflatex', label: 'pdfLaTeX' },
          { value: 'xelatex', label: 'XeLaTeX' },
          { value: 'lualatex', label: 'LuaLaTeX' },
          { value: 'context', label: 'ConTeXt' },
        ]}
        disabled={readOnly}
      />
      <SelectRow
        title="TeX Live 年份"
        hint="需部署对应年份的完整 TeX 镜像（见环境变量）；与 Docker 编译所用镜像一致。"
        value={compilePrefs.texLiveLabel}
        onChange={(v) => patchCompile({ texLiveLabel: v })}
        options={[
          { value: '2025', label: 'TeX Live 2025' },
          { value: '2024', label: 'TeX Live 2024' },
        ]}
        disabled={readOnly}
      />
      <SelectRow
        title="编译模式"
        hint="草稿模式可加快迭代（对应后端 draft 编译选项）。"
        value={compilePrefs.compileMode}
        onChange={(v) => patchCompile({ compileMode: v === 'draft' ? 'draft' : 'normal' })}
        options={[
          { value: 'normal', label: '标准' },
          { value: 'draft', label: '快速草稿（draft）' },
        ]}
        disabled={readOnly}
      />
      <ToggleRow
        title="编译前语法检查"
        hint="与 Overleaf「语法检查」类似：在完整编译前先做语法检查。"
        on={compilePrefs.syntaxCheckBeforeCompile}
        onChange={(v) => patchCompile({ syntaxCheckBeforeCompile: v })}
        disabled={readOnly}
      />
      <ToggleRow
        title="首个错误即停止"
        hint="遇到第一个错误即停止编译，便于逐个修复。"
        on={compilePrefs.haltOnFirstError}
        onChange={(v) => patchCompile({ haltOnFirstError: v })}
        disabled={readOnly}
      />
      <ToggleRow
        title="自动编译"
        hint="编辑停止一段时间后自动触发重新编译（防抖；主文档见上文）。"
        on={compilePrefs.autoCompile}
        onChange={(v) => patchCompile({ autoCompile: v })}
        disabled={readOnly}
      />
    </div>
  )

  const body = (() => {
    switch (section) {
      case 'editor':
        return editorPanel
      case 'compiler':
        return compilerPanel
      case 'agent':
        return (
          <div className="editor-settings-panel">
            <h3 className="editor-settings-panel__heading">智能体</h3>
            <EditorAgentSettingsForm
              readOnly={readOnly}
              projectId={projectId}
              agentPrefs={agentPrefs}
              onPatchAgentPrefs={onPatchAgentPrefs}
              onSamplingPreset={onSamplingPreset}
              activeSamplingPreset={activeSamplingPreset}
            />
          </div>
        )
      case 'appearance':
        return (
          <div className="editor-settings-panel editor-settings-panel--appearance">
            <h3 className="editor-settings-panel__heading">外观</h3>
            <SelectRow
              title="界面主题"
              hint="控制侧栏、工具栏与设置窗等整体明暗；风格类似常见在线 LaTeX 编辑器。"
              value={themePref}
              onChange={(v) => onThemePref(v as ThemePref)}
              options={[
                { value: 'dark', label: '深色' },
                { value: 'light', label: '浅色' },
                { value: 'system', label: '跟随系统' },
              ]}
              disabled={readOnly}
            />
            <ToggleRow
              title="深色模式下反色 PDF"
              hint={
                appUiTheme === 'light'
                  ? '当前为浅色界面，开启后将在切换到深色主题时对 PDF 反色显示。'
                  : '仅作用于内嵌 PDF 预览。'
              }
              on={viewPrefs.pdfInvertInDarkMode}
              onChange={(v) => onPatchViewPrefs({ pdfInvertInDarkMode: v })}
              disabled={readOnly || prefs.pdfViewer !== 'in_app'}
            />
            <div className="editor-settings-divider" role="presentation" />
            <h4 className="editor-settings-subheading">编辑器外观</h4>
            <SelectRow
              title="代码配色主题"
              hint="Monaco 编辑器语法高亮配色。"
              value={prefs.editorColorTheme}
              onChange={(v) => patchPrefs({ editorColorTheme: v })}
              options={MONACO_EDITOR_THEME_OPTIONS.map((t) => ({ value: t.id, label: t.label }))}
              disabled={readOnly}
            />
            <SelectRow
              title="字号"
              hint="代码编辑器字体大小。"
              value={String(prefs.editorFontSize)}
              onChange={(v) => patchPrefs({ editorFontSize: Math.min(22, Math.max(9, Number(v) || 14)) })}
              options={EDITOR_FONT_SIZE_OPTIONS}
              disabled={readOnly}
            />
            <SelectRow
              title="字体"
              hint="等宽字体栈。"
              value={prefs.editorFontStack}
              onChange={(v) => patchPrefs({ editorFontStack: v as EditorFontStackId })}
              options={EDITOR_FONT_FAMILY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              disabled={readOnly}
            />
            <SelectRow
              title="行高"
              hint="代码编辑器行距。"
              value={prefs.editorLineHeightPreset}
              onChange={(v) => patchPrefs({ editorLineHeightPreset: v as EditorLineHeightPreset })}
              options={EDITOR_LINE_HEIGHT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              disabled={readOnly}
            />
          </div>
        )
      default:
        return null
    }
  })()

  return (
    <>
      <div className="editor-settings-scrim" aria-hidden />
      <div className="editor-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-settings-title">
        <div className="editor-settings-head">
          <h2 id="editor-settings-title" className="editor-settings-title">
            设置
          </h2>
          <button type="button" className="editor-settings-close" onClick={onClose} aria-label="关闭设置">
            ×
          </button>
        </div>
        <div className="editor-settings-body">
          <nav className="editor-settings-nav" aria-label="设置分类">
            {nav.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`editor-settings-nav__btn${section === n.id ? ' is-active' : ''}`}
                onClick={() => setSection(n.id)}
              >
                {n.label}
              </button>
            ))}
          </nav>
          <div className="editor-settings-content">
            {body}
            <p className="editor-settings-autosave-hint">
              本页选项在更改后立即保存到本机浏览器；自定义词典请在弹窗内编辑后点击「保存」。
            </p>
          </div>
        </div>
      </div>

      {dictOpen ? (
        <>
          <div className="editor-settings-scrim editor-settings-scrim--nested" aria-hidden onClick={() => setDictOpen(false)} />
          <div className="editor-settings-subdialog" role="dialog" aria-modal="true" aria-label="自定义词典">
            <div className="editor-settings-subdialog__head">
              <span>自定义词典</span>
              <button type="button" className="editor-settings-close" onClick={() => setDictOpen(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <p className="editor-settings-muted">每行一个词，或使用英文逗号分隔。</p>
            <textarea
              className="editor-settings-textarea"
              value={dictDraft}
              onChange={(e) => setDictDraft(e.target.value)}
              rows={10}
              spellCheck={false}
            />
            <div className="editor-settings-subdialog__actions">
              <button type="button" className="editor-settings-btn" onClick={() => setDictOpen(false)}>
                取消
              </button>
              <button type="button" className="editor-settings-btn editor-settings-btn--primary" onClick={saveDictionary}>
                保存
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}

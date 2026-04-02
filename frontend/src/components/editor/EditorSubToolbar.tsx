import type { CompilePrefs } from '../../lib/compilePrefs'
import EditorRecompileSplit from './EditorRecompileSplit'

export default function EditorSubToolbar(props: {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  breadcrumb: string
  onBreadcrumbRename?: () => void
  editorMode: 'code' | 'visual'
  onEditorMode: (m: 'code' | 'visual') => void
  readOnly: boolean
  onSave: () => void
  onJumpError: () => void
  jumpErrorDisabled: boolean
  onToggleLog: () => void
  logOpen: boolean
  compiling: boolean
  hideSidebarToggle?: boolean
  compilePrefs: CompilePrefs
  onCompilePrefs: (p: CompilePrefs) => void
  onRecompile: () => void
  onRecompileFromScratch: () => void
  showBreadcrumb?: boolean
}) {
  const {
    sidebarCollapsed,
    onToggleSidebar,
    hideSidebarToggle,
    breadcrumb,
    onBreadcrumbRename,
    showBreadcrumb = true,
    editorMode,
    onEditorMode,
    readOnly,
    onSave,
    onJumpError,
    jumpErrorDisabled,
    onToggleLog,
    logOpen,
    compiling,
    compilePrefs,
    onCompilePrefs,
    onRecompile,
    onRecompileFromScratch,
  } = props

  return (
    <div className="editor-subtoolbar" role="toolbar" aria-label="编辑器工具条">
      <div className="editor-subtoolbar-zone editor-subtoolbar-zone--left">
        {!hideSidebarToggle && (
          <button
            type="button"
            className="editor-subtoolbar-iconbtn"
            onClick={onToggleSidebar}
            title={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}
          >
            ≡
          </button>
        )}
      </div>
      <div className="editor-subtoolbar-zone editor-subtoolbar-zone--mid">
        <div className="editor-mode-toggle" role="group" aria-label="编辑模式">
          <button
            type="button"
            className={editorMode === 'code' ? 'is-on' : ''}
            onClick={() => onEditorMode('code')}
          >
            代码
          </button>
          <button
            type="button"
            className={editorMode === 'visual' ? 'is-on' : ''}
            onClick={() => onEditorMode('visual')}
            disabled
            title="可视化编辑即将推出"
          >
            可视化
          </button>
        </div>
        {showBreadcrumb ? (
          onBreadcrumbRename ? (
            <button
              type="button"
              className="editor-breadcrumb editor-breadcrumb--btn"
              title="点击重命名当前文件"
              onClick={onBreadcrumbRename}
            >
              {breadcrumb}
            </button>
          ) : (
            <span className="editor-breadcrumb" title={breadcrumb}>
              {breadcrumb}
            </span>
          )
        ) : null}
        <button type="button" className="editor-subtoolbar-textbtn" onClick={onSave} disabled={readOnly}>
          保存
        </button>
        <button
          type="button"
          className="editor-subtoolbar-textbtn"
          onClick={onJumpError}
          disabled={jumpErrorDisabled}
        >
          跳到错误行
        </button>
        <button
          type="button"
          className={`editor-subtoolbar-textbtn ${logOpen ? 'is-on' : ''}`}
          onClick={onToggleLog}
          aria-pressed={logOpen}
        >
          编译日志
        </button>
        {compiling && <span className="editor-compiling-badge">编译中…</span>}
      </div>
      <div className="editor-subtoolbar-zone editor-subtoolbar-zone--right">
        <EditorRecompileSplit
          readOnly={readOnly}
          compiling={compiling}
          prefs={compilePrefs}
          onPrefsChange={onCompilePrefs}
          onRecompile={onRecompile}
          onRecompileFromScratch={onRecompileFromScratch}
        />
      </div>
    </div>
  )
}

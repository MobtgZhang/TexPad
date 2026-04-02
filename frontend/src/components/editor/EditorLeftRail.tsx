import type { ReactNode } from 'react'

export type LeftTool = 'files' | 'search' | 'snapshots' | 'plugins' | 'paperclaw' | 'comments' | 'evolveAgent'

function IconFiles() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7l-2-2H5a2 2 0 0 0-2 2z" />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-3.5-3.5" />
    </svg>
  )
}

function IconPlugin() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

/** Paperclaw：文稿 + 爪印示意 */
function IconPaperclaw() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" aria-hidden>
      <path d="M6 4h10a2 2 0 0 1 2 2v11l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2z" strokeLinejoin="round" />
      <path d="M8 8h6M8 11h4" strokeLinecap="round" opacity="0.7" />
      <circle cx="17" cy="17" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="14" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="14" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconSnapshots() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function IconReviewer() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 15l2 2 4-4" />
    </svg>
  )
}

/** 自进化智能体：中心核 + 星芒，暗示迭代与增强 */
function IconEvolvingAgent() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="2.25" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
      <path d="M12 7v2M12 15v2M7 12h2M15 12h2" opacity="0.55" />
    </svg>
  )
}

function IconCollapse() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}

function IconGear() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.132a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.13a1.125 1.125 0 01-1.372.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.132a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.431l1.297-2.132a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

export default function EditorLeftRail(props: {
  activeTool: LeftTool
  panelOpen: boolean
  onTool: (t: LeftTool) => void
  onTogglePanel: () => void
  helpOpen: boolean
  onToggleHelp: () => void
  /** Close flyouts without toggle (click outside) */
  onCloseFlyouts: () => void
  /** Open centered settings dialog (no popover menu). */
  onOpenSettingsModal: () => void
  onHelpDoc: () => void
  onHelpAbout: () => void
  onHelpBlog: () => void
  onHelpContact: () => void
  onHelpHotkeys: () => void
}) {
  const {
    activeTool,
    panelOpen,
    onTool,
    onTogglePanel,
    helpOpen,
    onToggleHelp,
    onCloseFlyouts,
    onOpenSettingsModal,
    onHelpDoc,
    onHelpAbout,
    onHelpBlog,
    onHelpContact,
    onHelpHotkeys,
  } = props

  const tools: { id: LeftTool; label: string; icon: ReactNode }[] = [
    { id: 'files', label: '文件树', icon: <IconFiles /> },
    { id: 'search', label: '查找文件', icon: <IconSearch /> },
    { id: 'snapshots', label: '快照', icon: <IconSnapshots /> },
    { id: 'plugins', label: '插件', icon: <IconPlugin /> },
    { id: 'paperclaw', label: 'Paperclaw 论文构建', icon: <IconPaperclaw /> },
    { id: 'comments', label: '评论 / 审稿', icon: <IconReviewer /> },
    { id: 'evolveAgent', label: '自进化智能体', icon: <IconEvolvingAgent /> },
  ]

  return (
    <nav className="editor-left-rail" aria-label="侧栏工具">
      <div className="editor-rail-collapse-wrap">
        <button
          type="button"
          className="editor-rail-collapse"
          onClick={onTogglePanel}
          title={panelOpen ? '向左折叠侧栏' : '展开侧栏'}
          aria-label={panelOpen ? '向左折叠侧栏' : '展开侧栏'}
          aria-expanded={panelOpen}
        >
          <span className={panelOpen ? '' : 'editor-rail-collapse--flipped'}>
            <IconCollapse />
          </span>
        </button>
      </div>
      <div className="editor-rail-tools">
        {tools.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`editor-rail-btn ${activeTool === t.id ? 'editor-rail-btn--active' : ''}`}
            title={t.label}
            aria-label={t.label}
            aria-pressed={activeTool === t.id}
            onClick={() => onTool(t.id)}
          >
            {t.icon}
          </button>
        ))}
      </div>
      <div className="editor-rail-spacer" />
      <div className="editor-rail-footer">
        <div className="editor-help-wrap">
          {helpOpen ? (
            <div className="dash-pop editor-help-flyout" role="menu" aria-label="帮助菜单">
              <button
                type="button"
                className="dash-pop__row dash-pop__row--simple"
                role="menuitem"
                onClick={() => {
                  onCloseFlyouts()
                  onHelpDoc()
                }}
              >
                文档
              </button>
              <button
                type="button"
                className="dash-pop__row dash-pop__row--simple"
                role="menuitem"
                onClick={() => {
                  onCloseFlyouts()
                  onHelpHotkeys()
                }}
              >
                快捷键…
              </button>
              <button
                type="button"
                className="dash-pop__row dash-pop__row--simple"
                role="menuitem"
                onClick={() => {
                  onCloseFlyouts()
                  onHelpAbout()
                }}
              >
                什么是 TexPad
              </button>
              <button
                type="button"
                className="dash-pop__row dash-pop__row--simple"
                role="menuitem"
                onClick={() => {
                  onCloseFlyouts()
                  onHelpBlog()
                }}
              >
                博客
              </button>
              <button
                type="button"
                className="dash-pop__row dash-pop__row--simple"
                role="menuitem"
                onClick={() => {
                  onCloseFlyouts()
                  onHelpContact()
                }}
              >
                联系我们
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className={`dash-footer-btn-help${helpOpen ? ' dash-footer-btn-help--open' : ''}`}
            title="帮助"
            aria-label="帮助"
            aria-expanded={helpOpen}
            aria-haspopup="menu"
            onClick={(e) => {
              e.stopPropagation()
              onToggleHelp()
            }}
          >
            ?
          </button>
        </div>
        <div className="editor-settings-wrap">
          <button
            type="button"
            className="editor-rail-settings"
            title="设置"
            aria-label="设置"
            onClick={(e) => {
              e.stopPropagation()
              onCloseFlyouts()
              onOpenSettingsModal()
            }}
          >
            <IconGear />
          </button>
        </div>
      </div>
    </nav>
  )
}

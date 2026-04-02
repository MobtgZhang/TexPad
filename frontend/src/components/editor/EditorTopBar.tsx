import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export type TopMenuId = 'file' | 'edit' | 'insert' | 'view' | 'format' | 'help' | null

export default function EditorTopBar(props: {
  projectName: string
  role: string
  collabLabel: string
  topMenu: TopMenuId
  setTopMenu: (m: TopMenuId) => void
  onCollaboration: () => void
  collaborationDisabled: boolean
  fileMenu: ReactNode
  editMenu: ReactNode
  insertMenu: ReactNode
  viewMenu: ReactNode
  formatMenu: ReactNode
  helpMenu: ReactNode
}) {
  const {
    projectName,
    role,
    collabLabel,
    topMenu,
    setTopMenu,
    onCollaboration,
    collaborationDisabled,
    fileMenu,
    editMenu,
    insertMenu,
    viewMenu,
    formatMenu,
    helpMenu,
  } = props

  function toggle(id: Exclude<TopMenuId, null>) {
    setTopMenu(topMenu === id ? null : id)
  }

  return (
    <header className="editor-topbar" role="banner">
      <div className="editor-topbar-left">
        <Link to="/" className="editor-topbar-logo" aria-label="返回项目列表">
          TexPad
        </Link>
        <div className="editor-topbar-menus">
          <div className="editor-topbar-menu-group">
            <button
              type="button"
              className={`editor-topbar-menuhit${topMenu === 'file' ? ' is-open' : ''}`}
              aria-haspopup="true"
              aria-expanded={topMenu === 'file'}
              onClick={() => toggle('file')}
            >
              文件
            </button>
            {topMenu === 'file' ? fileMenu : null}
          </div>
          <div className="editor-topbar-menu-group">
            <button
              type="button"
              className={`editor-topbar-menuhit${topMenu === 'edit' ? ' is-open' : ''}`}
              aria-haspopup="true"
              aria-expanded={topMenu === 'edit'}
              onClick={() => toggle('edit')}
            >
              编辑
            </button>
            {topMenu === 'edit' ? editMenu : null}
          </div>
          <div className="editor-topbar-menu-group">
            <button
              type="button"
              className={`editor-topbar-menuhit${topMenu === 'insert' ? ' is-open' : ''}`}
              aria-expanded={topMenu === 'insert'}
              onClick={() => toggle('insert')}
            >
              插入
            </button>
            {topMenu === 'insert' ? insertMenu : null}
          </div>
          <div className="editor-topbar-menu-group">
            <button
              type="button"
              className={`editor-topbar-menuhit${topMenu === 'view' ? ' is-open' : ''}`}
              aria-expanded={topMenu === 'view'}
              onClick={() => toggle('view')}
            >
              查看
            </button>
            {topMenu === 'view' ? viewMenu : null}
          </div>
          <div className="editor-topbar-menu-group">
            <button
              type="button"
              className={`editor-topbar-menuhit${topMenu === 'format' ? ' is-open' : ''}`}
              aria-expanded={topMenu === 'format'}
              onClick={() => toggle('format')}
            >
              格式
            </button>
            {topMenu === 'format' ? formatMenu : null}
          </div>
          <div className="editor-topbar-menu-group">
            <button
              type="button"
              className={`editor-topbar-menuhit${topMenu === 'help' ? ' is-open' : ''}`}
              aria-haspopup="true"
              aria-expanded={topMenu === 'help'}
              onClick={() => toggle('help')}
            >
              帮助
            </button>
            {topMenu === 'help' ? helpMenu : null}
          </div>
        </div>
      </div>
      <div className="editor-topbar-center">
        <span className="editor-topbar-project" title={projectName}>
          {projectName || '项目'}
        </span>
        {role && (
          <span className="editor-topbar-role" title="当前权限">
            {role}
          </span>
        )}
      </div>
      <div className="editor-topbar-right">
        {collabLabel && <span className="editor-topbar-collab">{collabLabel}</span>}
        <button
          type="button"
          className="editor-topbar-share"
          onClick={onCollaboration}
          disabled={collaborationDisabled}
          title="多人协作：访客链接与指定成员"
          aria-label="打开协作"
        >
          协作
        </button>
      </div>
    </header>
  )
}

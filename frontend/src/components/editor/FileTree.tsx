import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const DND_INTERNAL_PATH = 'application/x-texpad-path'

function dataTransferHasFiles(dt: DataTransfer): boolean {
  return [...dt.types].includes('Files')
}

function dataTransferIsDroppable(dt: DataTransfer): boolean {
  return dataTransferHasFiles(dt) || [...dt.types].includes(DND_INTERNAL_PATH)
}

export type FileEnt = { path: string; size_bytes?: number }

type DirNode = { kind: 'dir'; name: string; children: Map<string, TreeNode> }
type FileNode = { kind: 'file'; name: string; path: string }
type TreeNode = DirNode | FileNode

type MenuState =
  | null
  | { kind: 'file'; path: string; x: number; y: number }
  | { kind: 'dir'; prefix: string; x: number; y: number }

/** 将错误存成单段的 URL 编码路径（如 figures%2Fa.pdf）还原为层级，展示用；path 仍为后端原始键 */
function logicalPathSegments(rawPath: string): string[] {
  const raw = rawPath.replace(/\\/g, '/').trim()
  if (!raw) return []
  let logical = raw
  try {
    const dec = decodeURIComponent(raw)
    if (dec.includes('/') && !raw.includes('/') && dec !== raw) logical = dec
  } catch {
    /* 非法 % 序列则保持 raw */
  }
  return logical.split('/').filter(Boolean)
}

function sameProjectPath(a: string, b: string): boolean {
  if (a === b) return true
  return logicalPathSegments(a).join('/') === logicalPathSegments(b).join('/')
}

function buildTree(files: FileEnt[]): Map<string, TreeNode> {
  const root = new Map<string, TreeNode>()
  for (const f of files) {
    const parts = logicalPathSegments(f.path)
    if (parts.length === 0) continue
    let cur = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const isLast = i === parts.length - 1
      if (isLast) {
        cur.set(part, { kind: 'file', name: part, path: f.path })
      } else {
        let n = cur.get(part)
        if (!n || n.kind !== 'dir') {
          n = { kind: 'dir', name: part, children: new Map() }
          cur.set(part, n)
        }
        cur = n.children
      }
    }
  }
  return root
}

function IconNewFile() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M12 11v6M9 14h6" />
    </svg>
  )
}

function IconNewFolder() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <path d="M12 11v6M9 14h6" />
    </svg>
  )
}

function IconUpload() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
    </svg>
  )
}

function IconMore() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  )
}

function sortedKeys(map: Map<string, TreeNode>): string[] {
  return Array.from(map.keys()).sort((a, b) => {
    const na = map.get(a)!
    const nb = map.get(b)!
    if (na.kind !== nb.kind) return na.kind === 'dir' ? -1 : 1
    return a.localeCompare(b)
  })
}

function canSetMain(path: string): boolean {
  return /\.(tex|bib)$/i.test(path)
}

export default function FileTree(props: {
  files: FileEnt[]
  activePath: string
  mainPath: string
  readOnly: boolean
  panelExpanded?: boolean
  onTogglePanel?: () => void
  onOpen: (path: string) => void
  onNewFile: (name: string) => void
  onNewFolder: (folderPrefix: string) => void
  onDelete: (path: string) => void
  onDeleteFolder?: (folderPrefix: string) => void
  onSetMain: (path: string) => void
  onRenameFile: (path: string) => void
  onDownloadFile: (path: string) => void
  onImportZipClick: () => void
  onUploadDropped?: (folderPrefix: string, files: FileList) => void
  onMoveFile?: (fromPath: string, toFolderPrefix: string) => void
}) {
  const {
    files,
    activePath,
    mainPath,
    readOnly,
    panelExpanded = true,
    onTogglePanel,
    onOpen,
    onNewFile,
    onNewFolder,
    onDelete,
    onDeleteFolder,
    onSetMain,
    onRenameFile,
    onDownloadFile,
    onImportZipClick,
    onUploadDropped,
    onMoveFile,
  } = props

  const tree = useMemo(() => buildTree(files), [files])
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set())
  const [menu, setMenu] = useState<MenuState>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [dropHighlightPrefix, setDropHighlightPrefix] = useState<string | null>(null)

  useEffect(() => {
    const parts = logicalPathSegments(activePath)
    if (parts.length <= 1) return
    let acc = ''
    setOpenDirs((prev) => {
      const next = new Set(prev)
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]!}` : parts[i]!
        next.add(acc)
      }
      return next
    })
  }, [activePath])

  useEffect(() => {
    const onDragEnd = () => setDropHighlightPrefix(null)
    window.addEventListener('dragend', onDragEnd)
    return () => window.removeEventListener('dragend', onDragEnd)
  }, [])

  useEffect(() => {
    if (!menu) return
    const onDocMouseDown = (e: MouseEvent) => {
      const el = menuRef.current
      if (el && el.contains(e.target as Node)) return
      setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', onDocMouseDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  function toggleDir(key: string) {
    setOpenDirs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function promptNewFile() {
    const name = window.prompt('新文件路径（可含子目录，如 chapters/intro.tex）', 'new.tex')
    if (name?.trim()) onNewFile(name.trim())
  }

  function promptNewFolder() {
    const name = window.prompt('新文件夹名称（将创建占位文件 .texpadkeep）', 'figures')
    if (!name?.trim()) return
    const prefix = name.trim().replace(/\/+$/, '')
    onNewFolder(prefix)
  }

  function openFileMenu(path: string, clientX: number, clientY: number) {
    setMenu({ kind: 'file', path, x: clientX, y: clientY })
  }

  function openDirMenu(prefix: string, clientX: number, clientY: number) {
    setMenu({ kind: 'dir', prefix, x: clientX, y: clientY })
  }

  function clampMenuPosition(x: number, y: number) {
    const pad = 8
    const mw = 220
    const mh = 320
    let nx = x
    let ny = y
    if (typeof window !== 'undefined') {
      if (nx + mw > window.innerWidth - pad) nx = Math.max(pad, window.innerWidth - mw - pad)
      if (ny + mh > window.innerHeight - pad) ny = Math.max(pad, window.innerHeight - mh - pad)
    }
    return { x: nx, y: ny }
  }

  function runDrop(e: DragEvent, folderPrefix: string) {
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()
    setDropHighlightPrefix(null)
    const from = e.dataTransfer.getData(DND_INTERNAL_PATH)
    if (from && onMoveFile) {
      void onMoveFile(from, folderPrefix)
      return
    }
    if (e.dataTransfer.files?.length && onUploadDropped) {
      void onUploadDropped(folderPrefix, e.dataTransfer.files)
    }
  }

  function onListDragOver(e: DragEvent, folderPrefix: string) {
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()
    if (!dataTransferIsDroppable(e.dataTransfer)) return
    e.dataTransfer.dropEffect = dataTransferHasFiles(e.dataTransfer) ? 'copy' : 'move'
    setDropHighlightPrefix(folderPrefix)
  }

  function onDirRowDragOver(e: DragEvent, fullKey: string) {
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()
    if (!dataTransferIsDroppable(e.dataTransfer)) return
    e.dataTransfer.dropEffect = dataTransferHasFiles(e.dataTransfer) ? 'copy' : 'move'
    setDropHighlightPrefix(fullKey)
  }

  function renderLevel(map: Map<string, TreeNode>, prefix: string, listDropPrefix: string, ulClass: string): ReactNode {
    const keys = sortedKeys(map)
    return (
      <ul
        className={`${ulClass}${dropHighlightPrefix === listDropPrefix ? ' editor-ft-ul--drop' : ''}`}
        onDragOver={(e) => onListDragOver(e, listDropPrefix)}
        onDrop={(e) => runDrop(e, listDropPrefix)}
      >
        {keys.map((key) => {
      const node = map.get(key)!
      const fullKey = prefix ? `${prefix}/${key}` : key
      if (node.kind === 'file') {
        const isActive = sameProjectPath(node.path, activePath)
        const isMain = sameProjectPath(node.path, mainPath)
        return (
          <li
            key={node.path}
            className="editor-ft-row"
            draggable={!readOnly && Boolean(onMoveFile)}
            onDragStart={(e) => {
              if (readOnly || !onMoveFile) return
              e.dataTransfer.setData(DND_INTERNAL_PATH, node.path)
              e.dataTransfer.effectAllowed = 'move'
            }}
          >
            <button
              type="button"
              className={`editor-ft-file ${isActive ? 'editor-ft-active' : ''}${isMain ? ' editor-ft-file--main' : ''}`}
              onClick={() => onOpen(node.path)}
              onContextMenu={(e) => {
                e.preventDefault()
                if (readOnly) return
                openFileMenu(node.path, e.clientX, e.clientY)
              }}
              title={node.path}
            >
              {node.name}
            </button>
            {!readOnly && (
              <span className="editor-ft-actions">
                <button
                  type="button"
                  className="editor-ft-kebab"
                  aria-label="文件菜单"
                  aria-haspopup="menu"
                  aria-expanded={menu?.kind === 'file' && sameProjectPath(menu.path, node.path)}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    openFileMenu(node.path, r.right - 4, r.bottom + 2)
                  }}
                >
                  <IconMore />
                </button>
              </span>
            )}
          </li>
        )
      }
      const isOpen = openDirs.has(fullKey)
      return (
        <li key={fullKey} className="editor-ft-dirwrap">
          <div
            className={`editor-ft-dir${dropHighlightPrefix === fullKey ? ' editor-ft-dir--drop' : ''}`}
            onDragOver={(e) => onDirRowDragOver(e, fullKey)}
            onDrop={(e) => runDrop(e, fullKey)}
          >
            <button
              type="button"
              className="editor-ft-chevron"
              onClick={() => toggleDir(fullKey)}
              aria-expanded={isOpen}
              title={isOpen ? '折叠' : '展开'}
            >
              {isOpen ? '▼' : '▶'}
            </button>
            <span
              className="editor-ft-dirname"
              onContextMenu={(e) => {
                e.preventDefault()
                if (readOnly) return
                openDirMenu(fullKey, e.clientX, e.clientY)
              }}
              role="presentation"
            >
              {node.name}/
            </span>
            {!readOnly && (
              <button
                type="button"
                className="editor-ft-kebab editor-ft-kebab--dir"
                aria-label="文件夹菜单"
                aria-haspopup="menu"
                aria-expanded={menu?.kind === 'dir' && menu.prefix === fullKey}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  openDirMenu(fullKey, r.right - 4, r.bottom + 2)
                }}
              >
                <IconMore />
              </button>
            )}
          </div>
          {isOpen ? renderLevel(node.children, fullKey, fullKey, 'editor-ft-nested') : null}
        </li>
      )
        })}
      </ul>
    )
  }

  const menuPos = menu ? clampMenuPosition(menu.x, menu.y) : null
  const menuPortal =
    menu &&
    menuPos &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        ref={menuRef}
        className="editor-ft-menu"
        role="menu"
        style={{
          position: 'fixed',
          left: menuPos.x,
          top: menuPos.y,
          zIndex: 13000,
        }}
      >
        {menu.kind === 'file' ? (
          <>
            {canSetMain(menu.path) && !sameProjectPath(menu.path, mainPath) ? (
              <button type="button" className="editor-ft-menu__item" role="menuitem" onClick={() => { onSetMain(menu.path); setMenu(null) }}>
                设为主文档
              </button>
            ) : null}
            {canSetMain(menu.path) && sameProjectPath(menu.path, mainPath) ? (
              <div className="editor-ft-menu__hint" role="presentation">
                当前主文档
              </div>
            ) : null}
            <button type="button" className="editor-ft-menu__item" role="menuitem" onClick={() => { onRenameFile(menu.path); setMenu(null) }}>
              重命名
            </button>
            <button type="button" className="editor-ft-menu__item" role="menuitem" onClick={() => { onDownloadFile(menu.path); setMenu(null) }}>
              下载
            </button>
            <div className="editor-ft-menu__sep" role="separator" />
            <button type="button" className="editor-ft-menu__item editor-ft-menu__item--danger" role="menuitem" onClick={() => { onDelete(menu.path); setMenu(null) }}>
              删除
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="editor-ft-menu__item"
              role="menuitem"
              onClick={() => {
                const def = `${menu.prefix}/new.tex`
                const name = window.prompt('新文件路径（相对于项目根）', def)?.trim()
                if (name) onNewFile(name)
                setMenu(null)
              }}
            >
              新建文件
            </button>
            <button
              type="button"
              className="editor-ft-menu__item"
              role="menuitem"
              onClick={() => {
                const def = `${menu.prefix}/子文件夹`
                const name = window.prompt('新文件夹路径', def)?.trim()
                if (name) onNewFolder(name.replace(/\/+$/, ''))
                setMenu(null)
              }}
            >
              新建文件夹
            </button>
            <button type="button" className="editor-ft-menu__item" role="menuitem" onClick={() => { onImportZipClick(); setMenu(null) }}>
              上传 zip 导入
            </button>
            {onDeleteFolder ? (
              <>
                <div className="editor-ft-menu__sep" role="separator" />
                <button
                  type="button"
                  className="editor-ft-menu__item editor-ft-menu__item--danger"
                  role="menuitem"
                  onClick={() => {
                    onDeleteFolder(menu.prefix)
                    setMenu(null)
                  }}
                >
                  删除文件夹
                </button>
              </>
            ) : null}
          </>
        )}
      </div>,
      document.body,
    )

  return (
    <div
      className="editor-filetree"
      onDragOver={(e) => {
        if (readOnly || !panelExpanded) return
        if (!dataTransferIsDroppable(e.dataTransfer)) return
        e.preventDefault()
      }}
    >
      {menuPortal}
      <div className="editor-filetree-head">
        {onTogglePanel ? (
          <button
            type="button"
            className="editor-filetree-head-chevron"
            onClick={onTogglePanel}
            aria-expanded={panelExpanded}
            title={panelExpanded ? '折叠文件树' : '展开文件树'}
            aria-label={panelExpanded ? '折叠文件树' : '展开文件树'}
          >
            {panelExpanded ? '▼' : '▶'}
          </button>
        ) : null}
        <span className="editor-filetree-head-label">文件树</span>
        {!readOnly && (
          <div className="editor-filetree-tools">
            <button type="button" onClick={promptNewFile} title="新建文件" aria-label="新建文件">
              <IconNewFile />
            </button>
            <button type="button" onClick={promptNewFolder} title="新建文件夹" aria-label="新建文件夹">
              <IconNewFolder />
            </button>
            <button type="button" onClick={onImportZipClick} title="上传 zip 导入" aria-label="上传 zip 导入">
              <IconUpload />
            </button>
          </div>
        )}
      </div>
      {panelExpanded ? renderLevel(tree, '', '', 'editor-filetree-list') : null}
    </div>
  )
}

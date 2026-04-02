import { useEffect, useMemo, useState, type ReactNode } from 'react'

export type FileEnt = { path: string; size_bytes?: number }

type DirNode = { kind: 'dir'; name: string; children: Map<string, TreeNode> }
type FileNode = { kind: 'file'; name: string; path: string }
type TreeNode = DirNode | FileNode

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

/** 主文档路径与列表项可能一端为 URL 编码单段，用于高亮与 ★ */
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

function sortedKeys(map: Map<string, TreeNode>): string[] {
  return Array.from(map.keys()).sort((a, b) => {
    const na = map.get(a)!
    const nb = map.get(b)!
    if (na.kind !== nb.kind) return na.kind === 'dir' ? -1 : 1
    return a.localeCompare(b)
  })
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
  onSetMain: (path: string) => void
  onImportZipClick: () => void
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
    onSetMain,
    onImportZipClick,
  } = props

  const tree = useMemo(() => buildTree(files), [files])
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set())

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

  function renderLevel(map: Map<string, TreeNode>, prefix: string): ReactNode {
    const keys = sortedKeys(map)
    return keys.map((key) => {
      const node = map.get(key)!
      const fullKey = prefix ? `${prefix}/${key}` : key
      if (node.kind === 'file') {
        const isActive = sameProjectPath(node.path, activePath)
        return (
          <li key={node.path} className="editor-ft-row">
            <button
              type="button"
              className={`editor-ft-file ${isActive ? 'editor-ft-active' : ''}`}
              onClick={() => onOpen(node.path)}
              title={node.path}
            >
              {node.name}
              {sameProjectPath(node.path, mainPath) ? ' ★' : ''}
            </button>
            {!readOnly && (
              <span className="editor-ft-actions">
                {!sameProjectPath(node.path, mainPath) && /\.(tex|bib)$/i.test(node.path) && (
                  <button
                    type="button"
                    className="editor-ft-mini"
                    onClick={() => onSetMain(node.path)}
                    title="设为主文档"
                  >
                    ★
                  </button>
                )}
                <button type="button" className="editor-ft-mini" onClick={() => onDelete(node.path)} title="删除">
                  ×
                </button>
              </span>
            )}
          </li>
        )
      }
      const isOpen = openDirs.has(fullKey)
      return (
        <li key={fullKey} className="editor-ft-dirwrap">
          <div className="editor-ft-dir">
            <button
              type="button"
              className="editor-ft-chevron"
              onClick={() => toggleDir(fullKey)}
              aria-expanded={isOpen}
              title={isOpen ? '折叠' : '展开'}
            >
              {isOpen ? '▼' : '▶'}
            </button>
            <span className="editor-ft-dirname">{node.name}/</span>
          </div>
          {isOpen && <ul className="editor-ft-nested">{renderLevel(node.children, fullKey)}</ul>}
        </li>
      )
    })
  }

  return (
    <div className="editor-filetree">
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
      {panelExpanded ? <ul className="editor-filetree-list">{renderLevel(tree, '')}</ul> : null}
    </div>
  )
}

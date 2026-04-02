import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OutlineSection } from '../../lib/outline'

type OutlineTreeNode = { section: OutlineSection; flatIndex: number; children: OutlineTreeNode[] }

function buildOutlineTree(sections: OutlineSection[]): OutlineTreeNode[] {
  const roots: OutlineTreeNode[] = []
  const stack: OutlineTreeNode[] = []
  let flatIndex = 0
  for (const s of sections) {
    const node: OutlineTreeNode = { section: s, flatIndex: flatIndex++, children: [] }
    while (stack.length > 0 && stack[stack.length - 1]!.section.level >= s.level) {
      stack.pop()
    }
    if (stack.length === 0) roots.push(node)
    else stack[stack.length - 1]!.children.push(node)
    stack.push(node)
  }
  return roots
}

function OutlineTreeRows(props: {
  nodes: OutlineTreeNode[]
  depth: number
  activeIndex: number
  collapsedLines: Set<number>
  onToggleBranch: (line: number) => void
  onGoToLine: (line: number) => void
  activeRef: ((el: HTMLButtonElement | null) => void) | undefined
}) {
  const { nodes, depth, activeIndex, collapsedLines, onToggleBranch, onGoToLine, activeRef } = props

  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0
        const isCollapsed = hasChildren && collapsedLines.has(node.section.line)
        const isActive = node.flatIndex === activeIndex
        return (
          <li key={`${node.section.line}-${node.flatIndex}`} className="editor-outline-tree-node">
            <div
              className="editor-outline-row"
              style={{ paddingLeft: Math.min(depth, 6) * 10 }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="editor-outline-tree-chevron"
                  aria-expanded={!isCollapsed}
                  title={isCollapsed ? '展开' : '折叠'}
                  onClick={() => onToggleBranch(node.section.line)}
                >
                  {isCollapsed ? '▶' : '▼'}
                </button>
              ) : (
                <span className="editor-outline-tree-chevron-spacer" aria-hidden />
              )}
              <button
                type="button"
                ref={isActive ? activeRef : undefined}
                className={`editor-outline-row-btn ${isActive ? 'editor-outline-active' : ''}`}
                onClick={() => onGoToLine(node.section.line)}
                title={`第 ${node.section.line} 行`}
              >
                {node.section.title || '(空标题)'}
              </button>
            </div>
            {hasChildren && !isCollapsed ? (
              <ul className="editor-outline-tree-children" role="list">
                <OutlineTreeRows
                  nodes={node.children}
                  depth={depth + 1}
                  activeIndex={activeIndex}
                  collapsedLines={collapsedLines}
                  onToggleBranch={onToggleBranch}
                  onGoToLine={onGoToLine}
                  activeRef={activeRef}
                />
              </ul>
            ) : null}
          </li>
        )
      })}
    </>
  )
}

export default function OutlinePanel(props: {
  sections: OutlineSection[]
  activeIndex: number
  onGoToLine: (line: number) => void
  panelExpanded?: boolean
  onTogglePanel?: () => void
}) {
  const { sections, activeIndex, onGoToLine, panelExpanded = true, onTogglePanel } = props
  const tree = useMemo(() => buildOutlineTree(sections), [sections])
  const [collapsedLines, setCollapsedLines] = useState<Set<number>>(() => new Set())
  const activeBtnRef = useRef<HTMLButtonElement | null>(null)

  const activeRef = useCallback((el: HTMLButtonElement | null) => {
    activeBtnRef.current = el
  }, [])

  useEffect(() => {
    if (activeIndex < 0) return
    activeBtnRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, sections])

  function toggleBranch(line: number) {
    setCollapsedLines((prev) => {
      const next = new Set(prev)
      if (next.has(line)) next.delete(line)
      else next.add(line)
      return next
    })
  }

  return (
    <div className="editor-outline">
      <div className="editor-outline-head">
        {onTogglePanel ? (
          <button
            type="button"
            className="editor-outline-head-chevron"
            onClick={onTogglePanel}
            aria-expanded={panelExpanded}
            title={panelExpanded ? '折叠文档大纲' : '展开文档大纲'}
            aria-label={panelExpanded ? '折叠文档大纲' : '展开文档大纲'}
          >
            {panelExpanded ? '▼' : '▶'}
          </button>
        ) : null}
        <span className="editor-outline-head-label">文档大纲</span>
      </div>
      {panelExpanded ? (
        <ul className="editor-outline-list" role="list">
          {sections.length === 0 ? (
            <li className="editor-outline-empty">无 \\section 结构</li>
          ) : (
            <OutlineTreeRows
              nodes={tree}
              depth={0}
              activeIndex={activeIndex}
              collapsedLines={collapsedLines}
              onToggleBranch={toggleBranch}
              onGoToLine={onGoToLine}
              activeRef={activeRef}
            />
          )}
        </ul>
      ) : null}
    </div>
  )
}

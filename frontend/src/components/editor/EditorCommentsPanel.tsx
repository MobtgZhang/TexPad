import { useMemo, useState } from 'react'

export type ProjectComment = {
  id: string
  path: string
  line: number
  body: string
  author_email: string
  end_line?: number
  start_col?: number
  end_col?: number
  quote?: string
}

export type CommentSelection = {
  quote: string
  startLine: number
  endLine: number
  startCol: number
  endCol: number
}

export default function EditorCommentsPanel(props: {
  readOnly: boolean
  activePath: string
  selection: CommentSelection | null
  comments: ProjectComment[]
  onSubmit: (body: string) => void
  onJump: (path: string, line: number) => void
}) {
  const { readOnly, activePath, selection, comments, onSubmit, onJump } = props
  const [tab, setTab] = useState<'compose' | 'overview'>('compose')
  const [overviewQ, setOverviewQ] = useState('')
  const [body, setBody] = useState('')

  const sorted = useMemo(() => {
    const q = overviewQ.trim().toLowerCase()
    const list = [...comments].sort((a, b) => {
      if (a.path !== b.path) return a.path.localeCompare(b.path)
      return a.line - b.line || a.id.localeCompare(b.id)
    })
    if (!q) return list
    return list.filter(
      (c) =>
        c.path.toLowerCase().includes(q) ||
        c.body.toLowerCase().includes(q) ||
        (c.quote && c.quote.toLowerCase().includes(q)) ||
        c.author_email.toLowerCase().includes(q),
    )
  }, [comments, overviewQ])

  return (
    <div className="editor-comments-panel">
      <h3 className="editor-comments-panel__title">评论 / 审稿</h3>
      <p className="editor-comments-panel__hint">
        在编辑器中<strong>拖选一段文字</strong>，在此填写批注后发表。批注会绑定到所选原文位置。
      </p>
      <nav className="editor-drawer-subtabs" role="tablist" aria-label="评论视图">
        <button
          type="button"
          role="tab"
          className={tab === 'compose' ? 'is-on' : ''}
          aria-selected={tab === 'compose'}
          onClick={() => setTab('compose')}
        >
          撰写
        </button>
        <button
          type="button"
          role="tab"
          className={tab === 'overview' ? 'is-on' : ''}
          aria-selected={tab === 'overview'}
          onClick={() => setTab('overview')}
        >
          总览 ({comments.length})
        </button>
      </nav>

      {tab === 'compose' ? (
        <>
          <p className="editor-comments-panel__path">
            文件: <strong>{activePath || '—'}</strong>
          </p>
          <div className="editor-comments-panel__quote">
            {selection?.quote ? (
              <>
                <span className="editor-comments-panel__quote-label">已选原文</span>
                <pre className="editor-comments-panel__quote-pre">{selection.quote}</pre>
                <span className="editor-comments-panel__meta">
                  位置 L{selection.startLine}:{selection.startCol} — L{selection.endLine}:{selection.endCol}
                </span>
              </>
            ) : (
              <span className="editor-comments-panel__empty-sel">未选中文字。请在编辑器中选中要评论的句子或段落。</span>
            )}
          </div>
          <label className="editor-comments-panel__field">
            审稿意见
            <textarea
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="例如：此处与上文定义不一致，建议改为…"
              disabled={readOnly}
            />
          </label>
          <button
            type="button"
            className="editor-drawer-primary"
            disabled={readOnly || !selection || !body.trim()}
            onClick={() => {
              const t = body.trim()
              if (!t || !selection) return
              onSubmit(t)
              setBody('')
            }}
          >
            发表批注
          </button>
        </>
      ) : (
        <>
          <input
            type="search"
            className="editor-drawer-search"
            placeholder="按路径、原文、意见、作者筛选…"
            value={overviewQ}
            onChange={(e) => setOverviewQ(e.target.value)}
            aria-label="筛选评论"
          />
          <ul className="editor-drawer-comments editor-drawer-comments--overview">
            {sorted.map((c) => (
              <li key={c.id}>
                <div className="editor-drawer-comment-head">
                  <strong>
                    {c.path}:{c.line}
                    {c.end_line && c.end_line !== c.line ? `–${c.end_line}` : ''}
                  </strong>
                  <span className="editor-drawer-muted">{c.author_email}</span>
                  <button type="button" className="editor-ft-mini" onClick={() => onJump(c.path, c.line)}>
                    跳转
                  </button>
                </div>
                {c.quote ? <pre className="editor-comments-panel__quote-snippet">{c.quote}</pre> : null}
                <div className="editor-drawer-comment-body">{c.body}</div>
              </li>
            ))}
          </ul>
          {sorted.length === 0 ? <p className="editor-drawer-muted">暂无评论</p> : null}
        </>
      )}
    </div>
  )
}

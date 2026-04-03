import { useCallback, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'

export type AgentToolTrace = { name: string; args?: string; result?: string }

export type AgentAssistantTurn = {
  role: 'assistant'
  content: string
  thinking?: string
  tools?: AgentToolTrace[]
  check?: string
}

export type AgentUserTurn = {
  role: 'user'
  content: string
  imagePreviews?: string[]
}

export type AgentChatTurn = AgentUserTurn | AgentAssistantTurn

function isAssistant(m: AgentChatTurn): m is AgentAssistantTurn {
  return m.role === 'assistant'
}

function Collapsible(props: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const { title, defaultOpen, children } = props
  const [open, setOpen] = useState(defaultOpen ?? true)
  return (
    <div className="editor-agent-fold">
      <button type="button" className="editor-agent-fold__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="editor-agent-fold__chev" aria-hidden>
          {open ? '▼' : '▶'}
        </span>
        {title}
      </button>
      {open ? <div className="editor-agent-fold__body">{children}</div> : null}
    </div>
  )
}

function escapeHtml(t: string) {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function Md(props: { text: string }) {
  const html = useMemo(() => {
    const chunks: string[] = []
    let s = props.text.replace(/```[\s\S]*?```/g, (block) => {
      const inner = block.slice(3, -3).trim()
      chunks.push(`<pre><code>${escapeHtml(inner)}</code></pre>`)
      return `\x00C${chunks.length - 1}\x00`
    })
    s = escapeHtml(s)
    s = s.replace(/\x00C(\d+)\x00/g, (_, i) => chunks[parseInt(i, 10)] || '')
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    s = s.replace(/^### (.+)$/gm, '<h4>$1</h4>')
    s = s.replace(/^## (.+)$/gm, '<h3>$1</h3>')
    s = s.replace(/^# (.+)$/gm, '<h2>$1</h2>')
    s = s.replace(/^\* (.+)$/gm, '<li>$1</li>')
    s = s.replace(/(<li>.*?<\/li>(?:\n|$))+/g, (m) => `<ul>${m}</ul>`)
    const paras = s.split(/\n\n+/)
    return paras.map((p) => (p.trim() ? `<p>${p.replace(/\n/g, '<br/>')}</p>` : '')).join('')
  }, [props.text])
  return <div className="editor-agent-md" dangerouslySetInnerHTML={{ __html: html }} />
}

function ToolList(props: { tools: AgentToolTrace[] }) {
  return (
    <ul className="editor-agent-tools">
      {props.tools.map((t, i) => (
        <li key={`${t.name}-${i}`} className="editor-agent-tools__item">
          <Collapsible title={`${t.name}`} defaultOpen={false}>
            {t.args ? <pre className="editor-agent-tools__args">{t.args}</pre> : null}
            {t.result !== undefined ? (
              <pre className="editor-agent-tools__res">{t.result || '(空)'}</pre>
            ) : (
              <span className="editor-agent-tools__pending">运行中…</span>
            )}
          </Collapsible>
        </li>
      ))}
    </ul>
  )
}

export type AgentQuickAction = { label: string; fill: string }

/** 仅对话区：连接与采样请在「设置 → 智能体」中配置 */
export default function EditorAgentPanel(props: {
  readOnly: boolean
  messages: AgentChatTurn[]
  input: string
  onInput: (v: string) => void
  sending: boolean
  onSend: () => void
  pendingImages: File[]
  onPendingImages: (files: File[]) => void
  /** 侧栏等场景可覆盖标题 */
  title?: string
  /** 为 false 时隐藏标题、设置提示、快捷问题与空状态说明，仅保留对话与输入（由父级在用户首次发送后置为 false） */
  showWelcomeChrome?: boolean
  /** 类似 Overleaf 的快捷开场，点击填入输入框 */
  quickActions?: AgentQuickAction[]
  /** 空状态与输入框占位 */
  emptyHint?: string
  inputPlaceholder?: string
}) {
  const {
    readOnly,
    messages,
    input,
    onInput,
    sending,
    onSend,
    pendingImages,
    onPendingImages,
    title = '智能体对话',
    showWelcomeChrome = true,
    quickActions,
    emptyHint = '在下方输入问题，可附带图片；支持工具链、思考过程与引用自检。',
    inputPlaceholder,
  } = props

  const onPickImages = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files
      if (!list?.length) return
      onPendingImages([...pendingImages, ...Array.from(list)].slice(0, 6))
      e.target.value = ''
    },
    [onPendingImages, pendingImages],
  )

  const removeImage = useCallback(
    (idx: number) => {
      onPendingImages(pendingImages.filter((_, i) => i !== idx))
    },
    [onPendingImages, pendingImages],
  )

  const placeholder =
    inputPlaceholder ?? (readOnly ? '只读项目无法使用智能体' : '输入消息…')

  const hasUserTurn = messages.some((m) => m.role === 'user')
  const showOnboarding = showWelcomeChrome && !hasUserTurn && !sending

  return (
    <div className="editor-agent-panel editor-agent-panel--chat-only">
      {showWelcomeChrome ? <div className="editor-agent-panel__head">{title}</div> : null}
      {showOnboarding ? (
        <p className="editor-agent-panel__settings-hint">模型与采样请在「设置 → 智能体」中调整。</p>
      ) : null}
      {showOnboarding && quickActions?.length ? (
        <div className="editor-agent-panel__starters" aria-label="快捷提问">
          <div className="editor-agent-panel__starters-label">开始对话</div>
          <div className="editor-agent-panel__starters-chips">
            {quickActions.map((a) => (
              <button
                key={a.label}
                type="button"
                className="editor-agent-panel__starter-chip"
                disabled={readOnly || sending}
                onClick={() => onInput(a.fill)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="editor-agent-panel__thread" role="log" aria-live="polite">
        {showOnboarding ? <p className="editor-agent-panel__empty">{emptyHint}</p> : null}
        {messages.map((m, i) => {
          if (m.role === 'user') {
            return (
              <div key={`turn-${i}`} className="editor-agent-panel__msg editor-agent-panel__msg--user">
                <span className="editor-agent-panel__role">你</span>
                <div className="editor-agent-panel__body">
                  <Md text={m.content} />
                  {m.imagePreviews?.length ? (
                    <div className="editor-agent-panel__imgs">
                      {m.imagePreviews.map((src, j) => (
                        <img key={j} src={src} alt="" className="editor-agent-panel__imgthumb" />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          }
          if (!isAssistant(m)) return null
          const streamingThis = sending && i === messages.length - 1
          return (
            <div key={`turn-${i}`} className="editor-agent-panel__msg editor-agent-panel__msg--assistant">
              <span className="editor-agent-panel__role">智能体</span>
              <div className="editor-agent-panel__body">
                {m.thinking ? (
                  <Collapsible title={streamingThis && !m.content ? '思考过程（流式）' : '思考过程'} defaultOpen>
                    <div className="editor-agent-thinking">{m.thinking}</div>
                  </Collapsible>
                ) : null}
                {m.tools?.length ? (
                  <Collapsible title={`工具 (${m.tools.length})`} defaultOpen={false}>
                    <ToolList tools={m.tools} />
                  </Collapsible>
                ) : null}
                {m.content ? <Md text={m.content} /> : streamingThis ? <span className="editor-agent-panel__pending">…</span> : null}
                {m.check ? (
                  <Collapsible title="引用 / 事实自检" defaultOpen>
                    <div className="editor-agent-check">{m.check}</div>
                  </Collapsible>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      <div className="editor-agent-panel__compose">
        {pendingImages.length > 0 ? (
          <div className="editor-agent-panel__pending-row">
            {pendingImages.map((f, idx) => (
              <span key={`${f.name}-${idx}`} className="editor-agent-panel__pill">
                {f.name}
                <button type="button" className="editor-agent-panel__pill-x" onClick={() => removeImage(idx)} aria-label="移除">
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="editor-agent-panel__compose-row">
          <label className="editor-agent-panel__imgbtn">
            图片
            <input type="file" accept="image/*" multiple className="sr-only" onChange={onPickImages} disabled={readOnly || sending} />
          </label>
          <textarea
            className="editor-agent-panel__textarea"
            rows={3}
            placeholder={placeholder}
            value={input}
            disabled={readOnly || sending}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!readOnly && !sending && (input.trim() || pendingImages.length)) onSend()
              }
            }}
          />
        </div>
        <button
          type="button"
          className="editor-agent-panel__send"
          disabled={readOnly || sending || (!input.trim() && pendingImages.length === 0)}
          onClick={onSend}
        >
          {sending ? '生成中…' : '发送'}
        </button>
      </div>
    </div>
  )
}

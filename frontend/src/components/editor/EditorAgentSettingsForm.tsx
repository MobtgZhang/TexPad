import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { apiAgentModels } from '../../api'
import {
  AGENT_SAMPLING_PRESETS,
  type AgentPrefs,
  type AgentSamplingPreset,
} from '../../lib/agentPrefs'

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
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

/** 设置中的 Agent：采样预设 + 连接与模型（保存在本机浏览器） */
export default function EditorAgentSettingsForm(props: {
  readOnly: boolean
  projectId?: string
  agentPrefs: AgentPrefs
  onPatchAgentPrefs: (patch: Partial<AgentPrefs>) => void
  onSamplingPreset: (preset: AgentSamplingPreset) => void
  activeSamplingPreset: AgentSamplingPreset | null
}) {
  const { readOnly, projectId, agentPrefs, onPatchAgentPrefs, onSamplingPreset, activeSamplingPreset } = props

  const [modelPopOpen, setModelPopOpen] = useState(false)
  const [modelsBusy, setModelsBusy] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const modelPopRef = useRef<HTMLDivElement>(null)
  const modelTriggerRef = useRef<HTMLButtonElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const [modelMenuStyle, setModelMenuStyle] = useState<CSSProperties>({})

  useLayoutEffect(() => {
    if (!modelPopOpen || !modelTriggerRef.current) return
    const tr = modelTriggerRef.current.getBoundingClientRect()
    const maxW = Math.min(Math.max(tr.width, 220), window.innerWidth - tr.left - 12)
    setModelMenuStyle({
      position: 'fixed',
      left: Math.min(tr.left, window.innerWidth - maxW - 12),
      top: tr.bottom + 4,
      width: maxW,
      maxHeight: 220,
      zIndex: 10050,
    })
  }, [modelPopOpen, fetchedModels, agentPrefs.model])

  useEffect(() => {
    if (!modelPopOpen) return
    const close = (e: MouseEvent) => {
      const n = e.target as Node
      if (modelTriggerRef.current?.contains(n) || modelMenuRef.current?.contains(n)) return
      setModelPopOpen(false)
    }
    document.addEventListener('mousedown', close, false)
    return () => document.removeEventListener('mousedown', close, false)
  }, [modelPopOpen])

  const refreshModels = useCallback(async () => {
    if (!projectId) {
      window.alert('无法刷新：缺少项目上下文。')
      return
    }
    setModelsBusy(true)
    setFetchedModels([])
    try {
      const r = await apiAgentModels(projectId, {
        llm_base_url: agentPrefs.llmBaseUrl.trim() || undefined,
        llm_api_key: agentPrefs.llmApiKey.trim() || undefined,
      })
      setFetchedModels(r.models || [])
      if (r.error) window.alert(`刷新模型列表：${r.error}`)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '刷新失败')
    } finally {
      setModelsBusy(false)
    }
  }, [projectId, agentPrefs.llmApiKey, agentPrefs.llmBaseUrl])

  const presetKeys = Object.keys(AGENT_SAMPLING_PRESETS) as AgentSamplingPreset[]

  return (
    <div className="editor-agent-settings-form">
      <p className="editor-settings-muted">
        以下配置保存在本机浏览器，并随每次智能体请求发送。使用菜单「文件 → 打开智能体对话」进入对话窗口。
      </p>
      <div className="editor-agent-presets" role="group" aria-label="采样风格">
        {presetKeys.map((key) => {
          const s = AGENT_SAMPLING_PRESETS[key]
          return (
            <button
              key={key}
              type="button"
              className={`editor-agent-preset${activeSamplingPreset === key ? ' is-on' : ''}`}
              disabled={readOnly}
              onClick={() => onSamplingPreset(key)}
              title={`写入 Temperature=${s.temperature}，top_p=${s.topP}，top_k=${s.topK}（仍可手动改下方数值）`}
            >
              {s.label}
            </button>
          )
        })}
      </div>
      <Collapsible title="采样参数（Temperature / Top-p / Top-k）" defaultOpen>
        <p className="editor-settings-muted">
          使用数字框输入并在合法范围内自动约束：温度 0–2；Top-p 0–1；Top-k 为 0–200 的整数（0 表示请求里不传 top_k）。
        </p>
        <label className="editor-agent-field">
          <span>温度（Temperature）</span>
          <input
            type="number"
            min={0}
            max={2}
            step={0.01}
            className="editor-agent-field__input editor-agent-field__input--num"
            disabled={readOnly}
            value={agentPrefs.temperature}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (!Number.isFinite(v)) return
              onPatchAgentPrefs({ temperature: clamp(v, 0, 2) })
            }}
            aria-label="温度"
          />
        </label>
        <label className="editor-agent-field">
          <span>核采样（Top-p）</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            className="editor-agent-field__input editor-agent-field__input--num"
            disabled={readOnly}
            value={agentPrefs.topP}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (!Number.isFinite(v)) return
              onPatchAgentPrefs({ topP: clamp(v, 0, 1) })
            }}
            aria-label="Top-p"
          />
        </label>
        <label className="editor-agent-field">
          <span>Top-k</span>
          <input
            type="number"
            min={0}
            max={200}
            step={1}
            className="editor-agent-field__input editor-agent-field__input--num"
            disabled={readOnly}
            value={agentPrefs.topK}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              if (!Number.isFinite(v)) return
              onPatchAgentPrefs({ topK: clamp(v, 0, 200) })
            }}
            aria-label="Top-k"
          />
        </label>
      </Collapsible>
      <Collapsible title="连接与模型" defaultOpen>
        <p className="editor-settings-muted">
          API 基础地址可填服务根 URL（如 <code>https://api.example.com</code>）或已带版本前缀的地址（如 <code>https://api.example.com/v1</code>），二者均支持。
        </p>
        <label className="editor-agent-field">
          <span>API 基础地址</span>
          <input
            type="url"
            className="editor-agent-field__input editor-settings-input--full"
            placeholder="留空则使用服务器环境变量中的配置"
            value={agentPrefs.llmBaseUrl}
            onChange={(e) => onPatchAgentPrefs({ llmBaseUrl: e.target.value })}
            disabled={readOnly}
            autoComplete="off"
          />
        </label>
        <label className="editor-agent-field">
          <span>API 密钥</span>
          <input
            type="password"
            className="editor-agent-field__input editor-settings-input--full"
            placeholder="Bearer 所用密钥"
            value={agentPrefs.llmApiKey}
            onChange={(e) => onPatchAgentPrefs({ llmApiKey: e.target.value })}
            disabled={readOnly}
            autoComplete="off"
          />
        </label>
        <div className="editor-agent-field">
          <span>模型</span>
          <div className="editor-settings-model-row" ref={modelPopRef}>
            <button
              ref={modelTriggerRef}
              type="button"
              className="editor-settings-model-trigger"
              disabled={readOnly}
              onClick={() => setModelPopOpen((o) => !o)}
            >
              <span className="editor-settings-model-trigger__text">{agentPrefs.model.trim() || '选择模型…'}</span>
              <span aria-hidden>▾</span>
            </button>
            <button type="button" className="editor-settings-btn" disabled={readOnly || modelsBusy} onClick={() => void refreshModels()}>
              {modelsBusy ? '刷新中…' : '刷新'}
            </button>
            {modelPopOpen
              ? createPortal(
                  <div ref={modelMenuRef} className="editor-settings-model-pop" role="listbox" style={modelMenuStyle}>
                    {(() => {
                      const u = new Set(fetchedModels)
                      const cur = agentPrefs.model.trim()
                      if (cur) u.add(cur)
                      return [...u]
                    })().map((id) => (
                      <button
                        key={id}
                        type="button"
                        role="option"
                        className="editor-settings-model-opt"
                        onClick={() => {
                          onPatchAgentPrefs({ model: id })
                          setModelPopOpen(false)
                        }}
                      >
                        {id}
                      </button>
                    ))}
                    {!fetchedModels.length && !agentPrefs.model ? (
                      <div className="editor-settings-muted editor-settings-model-empty">点击「刷新」拉取模型列表</div>
                    ) : null}
                  </div>,
                  document.body,
                )
              : null}
          </div>
          <input
            type="text"
            className="editor-agent-field__input editor-settings-input--full"
            style={{ marginTop: 8 }}
            placeholder="模型 ID（可手动填写）"
            value={agentPrefs.model}
            onChange={(e) => onPatchAgentPrefs({ model: e.target.value })}
            disabled={readOnly}
          />
        </div>
        <label className="editor-agent-field">
          <span>智能体工具轮次（-1 不限；0 仅对话）</span>
          <input
            type="number"
            className="editor-agent-field__input editor-agent-field__input--num"
            min={-1}
            max={100}
            value={agentPrefs.agentRounds}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              if (Number.isFinite(v)) onPatchAgentPrefs({ agentRounds: v })
            }}
            disabled={readOnly}
          />
        </label>
      </Collapsible>
    </div>
  )
}

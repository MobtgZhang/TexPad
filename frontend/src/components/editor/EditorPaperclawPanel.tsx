import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api'

type JobStatus = {
  id: string
  status: string
  step: number
  progress: number
  message: string
  cancel_requested?: boolean
}

export default function EditorPaperclawPanel(props: { projectId: string; readOnly: boolean }) {
  const { projectId, readOnly } = props
  const [jobId, setJobId] = useState<string | null>(null)
  const [st, setSt] = useState<JobStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [llmOk, setLlmOk] = useState<boolean | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await api<{ configured: boolean }>(
          `/api/v1/projects/${projectId}/agent/llm-configured`,
        )
        if (!cancelled) setLlmOk(r.configured)
      } catch {
        if (!cancelled) setLlmOk(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const pollOnce = useCallback(
    async (id: string) => {
      try {
        const r = await api<JobStatus>(`/api/v1/projects/${projectId}/paperclaw/jobs/${id}`)
        setSt(r)
        if (r.status === 'success' || r.status === 'failed' || r.status === 'cancelled') {
          stopPoll()
          setBusy(false)
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : '查询失败')
        stopPoll()
        setBusy(false)
      }
    },
    [projectId, stopPoll],
  )

  useEffect(() => {
    if (!jobId) return
    void pollOnce(jobId)
    pollRef.current = setInterval(() => void pollOnce(jobId), 1500)
    return () => stopPoll()
  }, [jobId, pollOnce, stopPoll])

  async function startJob() {
    setErr('')
    setSt(null)
    setBusy(true)
    try {
      const r = await api<{ job_id: string }>(`/api/v1/projects/${projectId}/paperclaw/jobs`, { method: 'POST' })
      setJobId(r.job_id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '创建任务失败')
      setBusy(false)
    }
  }

  async function cancelJob(id: string) {
    setErr('')
    try {
      await api(`/api/v1/projects/${projectId}/paperclaw/jobs/${id}/cancel`, { method: 'POST' })
      void pollOnce(id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '取消失败')
    }
  }

  const canStart = llmOk === true && !readOnly
  const llmHint =
    llmOk === false
      ? 'Paperclaw 需要服务端配置 TEXPAD_LLM_BASE_URL 与 TEXPAD_LLM_API_KEY（与编辑器内 Agent 临时密钥无关）。'
      : null

  return (
    <div className="editor-paperclaw">
      <h3 className="editor-left-placeholder-title">Paperclaw</h3>
      <p className="editor-left-placeholder-text">
        服务端异步论文辅助：使用与编辑器 Agent 相同的工具链（读文件、改 .tex/.bib、可选编译）。关闭页面后任务仍会继续；完成后修改已写入项目。
      </p>
      {llmHint ? <p className="editor-paperclaw__err">{llmHint}</p> : null}
      {llmOk === null ? <p className="editor-left-placeholder-text">正在检查 LLM 配置…</p> : null}
      <button
        type="button"
        className="editor-drawer-primary"
        disabled={readOnly || busy || !canStart}
        onClick={() => void startJob()}
      >
        {busy ? '任务进行中…' : '开始 Paperclaw'}
      </button>
      {err ? <p className="editor-paperclaw__err">{err}</p> : null}
      {st ? (
        <div className="editor-paperclaw__status">
          <div className="editor-paperclaw__progress-wrap" aria-hidden>
            <div className="editor-paperclaw__progress-bar" style={{ width: `${Math.min(100, st.progress)}%` }} />
          </div>
          <p className="editor-paperclaw__meta">
            状态：<strong>{st.status}</strong>
            {st.cancel_requested ? ' · 取消请求已发送' : ''} · 步骤 {st.step} · {st.progress}%
          </p>
          <p className="editor-paperclaw__msg">{st.message || '—'}</p>
          {st.id && (st.status === 'queued' || st.status === 'running') ? (
            <button type="button" className="editor-drawer-primary" onClick={() => void cancelJob(st.id)}>
              请求取消
            </button>
          ) : null}
          {st.id ? (
            <p className="editor-paperclaw__id" title={st.id}>
              任务 ID：{st.id.slice(0, 8)}…
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

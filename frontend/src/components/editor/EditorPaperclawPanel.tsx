import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api'

type JobStatus = {
  id: string
  status: string
  step: number
  progress: number
  message: string
}

export default function EditorPaperclawPanel(props: { projectId: string; readOnly: boolean }) {
  const { projectId, readOnly } = props
  const [jobId, setJobId] = useState<string | null>(null)
  const [st, setSt] = useState<JobStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
        if (r.status === 'success' || r.status === 'failed') {
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

  return (
    <div className="editor-paperclaw">
      <h3 className="editor-left-placeholder-title">Paperclaw</h3>
      <p className="editor-left-placeholder-text">
        一键生成论文（占位预览）：任务在服务端异步执行，关闭本页后仍会继续，稍后重新打开本项目可再次查看进度。
      </p>
      <button type="button" className="editor-drawer-primary" disabled={readOnly || busy} onClick={() => void startJob()}>
        {busy ? '任务进行中…' : '开始构建（占位）'}
      </button>
      {err ? <p className="editor-paperclaw__err">{err}</p> : null}
      {st ? (
        <div className="editor-paperclaw__status">
          <div className="editor-paperclaw__progress-wrap" aria-hidden>
            <div className="editor-paperclaw__progress-bar" style={{ width: `${Math.min(100, st.progress)}%` }} />
          </div>
          <p className="editor-paperclaw__meta">
            状态：<strong>{st.status}</strong> · 步骤 {st.step} · {st.progress}%
          </p>
          <p className="editor-paperclaw__msg">{st.message || '—'}</p>
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

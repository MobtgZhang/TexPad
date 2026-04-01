import Editor, { OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { MonacoBinding } from 'y-monaco'
import { api, apiBlob, getToken } from '../api'

function registerLatex(m: typeof monaco) {
  if (m.languages.getLanguages().some((l) => l.id === 'latex')) return
  m.languages.register({ id: 'latex' })
  m.languages.setMonarchTokensProvider('latex', {
    tokenizer: {
      root: [
        [/\\[a-zA-Z@]+/, 'keyword'],
        [/\\./, 'keyword'],
        [/[{}[\]]/, 'delimiter'],
        [/[$]/, 'string'],
        [/%[^\n]*/, 'comment'],
      ],
    },
  })
}

export default function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const nav = useNavigate()
  const [mainPath, setMainPath] = useState('main.tex')
  const [role, setRole] = useState('')
  const [engine, setEngine] = useState('pdflatex')
  const [jobId, setJobId] = useState<string | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [agentOut, setAgentOut] = useState('')
  const [collabOn] = useState(() => !!import.meta.env.VITE_COLLAB_WS)
  const ydocRef = useRef<Y.Doc | null>(null)
  const providerRef = useRef<WebsocketProvider | null>(null)
  const bindingRef = useRef<MonacoBinding | null>(null)
  const seededRef = useRef(false)
  const editorInstRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [editorReady, setEditorReady] = useState(!collabOn)

  useEffect(() => {
    seededRef.current = false
  }, [projectId])

  const loadMain = useCallback(async () => {
    if (!projectId) return
    const p = await api<{ main_tex_path: string; role?: string }>(`/api/v1/projects/${projectId}`)
    setMainPath(p.main_tex_path)
    setRole(p.role || '')
  }, [projectId])

  useEffect(() => {
    loadMain().catch((e) => setMsg(String(e)))
  }, [loadMain])

  useEffect(() => {
    if (!projectId || !collabOn) return
    const yd = new Y.Doc()
    ydocRef.current = yd
    const url = import.meta.env.VITE_COLLAB_WS || 'ws://localhost:1234'
    const prov = new WebsocketProvider(url, projectId, yd)
    providerRef.current = prov
    return () => {
      bindingRef.current?.destroy()
      bindingRef.current = null
      prov.destroy()
      ydocRef.current = null
    }
  }, [projectId, collabOn])

  useEffect(() => {
    if (!projectId || collabOn) return
    setEditorReady(true)
  }, [projectId, collabOn])

  useEffect(() => {
    if (!projectId || !collabOn) return
    let cancelled = false
    ;(async () => {
      try {
        const path = mainPath
        const res = await fetch(
          `${(import.meta.env.VITE_API_BASE || '')}/api/v1/projects/${projectId}/files/${encodeURIComponent(path)}`,
          { headers: { Authorization: `Bearer ${getToken() || ''}` } },
        )
        const text = await res.text()
        if (cancelled || seededRef.current) return
        const ytext = ydocRef.current?.getText('tex')
        if (ytext && ytext.length === 0) {
          ytext.insert(0, text)
          seededRef.current = true
        }
        setEditorReady(true)
      } catch {
        setEditorReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, mainPath, collabOn])

  const onMount: OnMount = useCallback(
    (editor, m) => {
      editorInstRef.current = editor
      registerLatex(m)
      editor.updateOptions({ fontSize: 14, minimap: { enabled: false } })
      const model = editor.getModel()
      if (!model) return
      m.editor.setModelLanguage(model, 'latex')

      if (collabOn && ydocRef.current && providerRef.current) {
        bindingRef.current?.destroy()
        const ytext = ydocRef.current.getText('tex')
        bindingRef.current = new MonacoBinding(ytext, model, new Set([editor]), providerRef.current.awareness)
      } else {
        ;(async () => {
          if (!projectId) return
          const res = await fetch(
            `${(import.meta.env.VITE_API_BASE || '')}/api/v1/projects/${projectId}/files/${encodeURIComponent(mainPath)}`,
            { headers: { Authorization: `Bearer ${getToken() || ''}` } },
          )
          const text = await res.text()
          model.setValue(text)
        })().catch(() => {})
      }
    },
    [collabOn, projectId, mainPath],
  )

  async function save() {
    if (!projectId || role === 'viewer') return
    const v = editorInstRef.current?.getModel()?.getValue() ?? ''
    await fetch(
      `${(import.meta.env.VITE_API_BASE || '')}/api/v1/projects/${projectId}/files/${encodeURIComponent(mainPath)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${getToken() || ''}`,
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: v,
      },
    )
    setMsg('已保存')
    setTimeout(() => setMsg(''), 2000)
  }

  async function compile() {
    if (!projectId || role === 'viewer') return
    setMsg('编译中…')
    const res = await api<{ job_id: string }>(`/api/v1/projects/${projectId}/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine }),
    })
    setJobId(res.job_id)
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsBase = `${proto}//${window.location.host}`
    const tok = getToken()
    const ws = new WebSocket(`${wsBase}/api/v1/projects/${projectId}/ws?token=${encodeURIComponent(tok || '')}`)
    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data as string)
        if (d.type === 'compile_done' && d.job_id === res.job_id) {
          void showPdf(res.job_id)
          ws.close()
        }
      } catch {
        /* ignore */
      }
    }
    const t0 = Date.now()
    const poll = setInterval(async () => {
      if (Date.now() - t0 > 120000) {
        clearInterval(poll)
        return
      }
      try {
        const st = await api<{ status: string }>(`/api/v1/projects/${projectId}/compile/jobs/${res.job_id}`)
        if (st.status === 'success' || st.status === 'failed') {
          clearInterval(poll)
          await showPdf(res.job_id)
        }
      } catch {
        /* ignore */
      }
    }, 1500)
  }

  async function showPdf(jid: string) {
    if (!projectId) return
    if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    try {
      const blob = await apiBlob(`/api/v1/projects/${projectId}/pdf/${jid}/download`)
      const u = URL.createObjectURL(blob)
      setPdfUrl(u)
      setMsg('PDF 已更新')
    } catch {
      setMsg('编译失败或 PDF 未生成')
    }
  }

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
  }, [pdfUrl])

  async function exportZip() {
    if (!projectId) return
    const BASE = import.meta.env.VITE_API_BASE || ''
    const res = await fetch(`${BASE}/api/v1/projects/${projectId}/export.zip`, { headers: { Authorization: `Bearer ${getToken() || ''}` } })
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'project.zip'
    a.click()
  }

  async function importZip(f: File | null) {
    if (!projectId || !f || role === 'viewer') return
    const fd = new FormData()
    fd.append('file', f)
    await fetch(`${(import.meta.env.VITE_API_BASE || '')}/api/v1/projects/${projectId}/import.zip`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken() || ''}` },
      body: fd,
    })
    setMsg('导入完成')
    await loadMain()
  }

  async function snapshot() {
    if (!projectId || role === 'viewer') return
    await api(`/api/v1/projects/${projectId}/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: new Date().toISOString() }),
    })
    setMsg('快照已创建')
  }

  async function share() {
    if (!projectId || role !== 'owner') return
    const res = await api<{ token: string }>(`/api/v1/projects/${projectId}/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    })
    const url = `${window.location.origin}/share/${res.token}`
    await navigator.clipboard.writeText(url)
    setMsg('分享链接已复制')
  }

  async function runAgent() {
    if (!projectId || role === 'viewer') return
    setAgentOut('')
    const BASE = import.meta.env.VITE_API_BASE || ''
    const messages = [
      { role: 'system', content: '你是 LaTeX 助手，简洁回答。' },
      { role: 'user', content: '请根据当前项目给出一条写作建议。' },
    ]
    const res = await fetch(`${BASE}/api/v1/projects/${projectId}/agent/stream`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getToken() || ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages }),
    })
    const reader = res.body?.getReader()
    const dec = new TextDecoder()
    if (!reader) return
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const parts = buf.split('\n\n')
      buf = parts.pop() || ''
      for (const block of parts) {
        if (!block.startsWith('data: ')) continue
        const line = block.slice(6).trim()
        try {
          const j = JSON.parse(line) as { type?: string; content?: string }
          if (j.type === 'token' && j.content) setAgentOut((o) => o + j.content)
          if (j.type === 'note' && j.content) setAgentOut((o) => o + '\n' + j.content)
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (!projectId) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          padding: 8,
          borderBottom: '1px solid #21262d',
          background: '#161b22',
        }}
      >
        <Link to="/">← 项目</Link>
        <span style={{ color: '#8b949e' }}>{mainPath}</span>
        {role && <span style={{ color: '#8b949e' }}>({role})</span>}
        <select value={engine} onChange={(e) => setEngine(e.target.value)} disabled={role === 'viewer'}>
          <option value="pdflatex">pdflatex</option>
          <option value="xelatex">xelatex</option>
          <option value="lualatex">lualatex</option>
        </select>
        <button type="button" onClick={() => save()} disabled={role === 'viewer'}>
          保存
        </button>
        <button type="button" onClick={() => compile()} disabled={role === 'viewer'}>
          编译
        </button>
        <button type="button" onClick={() => exportZip()}>
          导出 zip
        </button>
        <input type="file" accept=".zip" onChange={(e) => void importZip(e.target.files?.[0] || null)} disabled={role === 'viewer'} />
        <button type="button" onClick={() => snapshot()} disabled={role === 'viewer'}>
          快照
        </button>
        <button type="button" onClick={() => share()} disabled={role !== 'owner'}>
          分享
        </button>
        <button type="button" onClick={() => runAgent()} disabled={role === 'viewer'}>
          Agent
        </button>
        <button type="button" onClick={() => nav('/')}>
          关闭
        </button>
        {msg && <span style={{ color: '#58a6ff' }}>{msg}</span>}
        {jobId && <span style={{ color: '#8b949e' }}>job {jobId.slice(0, 8)}…</span>}
      </header>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0 }}>
        <div style={{ borderRight: '1px solid #21262d' }}>
          {editorReady ? (
            <Editor height="100%" theme="vs-dark" path={mainPath} onMount={onMount} options={{ automaticLayout: true }} />
          ) : (
            <div style={{ padding: 16 }}>加载协作与内容…</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {pdfUrl ? (
            <iframe title="pdf" src={pdfUrl} style={{ flex: 1, border: 'none', width: '100%' }} />
          ) : (
            <div style={{ padding: 16, color: '#8b949e' }}>编译成功后在此预览 PDF</div>
          )}
          <div style={{ maxHeight: 120, overflow: 'auto', padding: 8, borderTop: '1px solid #21262d', fontSize: 13 }}>
            <strong>Agent 输出</strong>
            <pre style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{agentOut || '—'}</pre>
          </div>
        </div>
      </div>
    </div>
  )
}

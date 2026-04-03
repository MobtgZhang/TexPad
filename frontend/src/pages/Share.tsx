import Editor from '@monaco-editor/react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

const BASE = import.meta.env.VITE_API_BASE || ''

function encodeProjectFilePathForUrl(rel: string): string {
  return rel
    .replace(/\\/g, '/')
    .trim()
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

export default function Share() {
  const { token } = useParams<{ token: string }>()
  const [name, setName] = useState('')
  const [main, setMain] = useState('main.tex')
  const [text, setText] = useState('')

  useEffect(() => {
    if (!token) return
    ;(async () => {
      const r = await fetch(`${BASE}/api/v1/share/${token}/project`)
      const p = (await r.json()) as { name: string; main_tex_path: string }
      setName(p.name)
      setMain(p.main_tex_path)
      const fr = await fetch(`${BASE}/api/v1/share/${token}/files/${encodeProjectFilePathForUrl(p.main_tex_path)}`)
      setText(await fr.text())
    })().catch(() => setText('% load error'))
  }, [token])

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: 8, borderBottom: '1px solid #21262d' }}>
        只读分享：{name} — {main}
      </header>
      <Editor height="100%" theme="vs-dark" value={text} options={{ readOnly: true, automaticLayout: true }} />
    </div>
  )
}

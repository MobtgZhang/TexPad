import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, setToken } from '../api'

type Project = { id: string; name: string; main_tex_path: string }

export default function Projects() {
  const nav = useNavigate()
  const [list, setList] = useState<Project[]>([])
  const [name, setName] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const res = await api<{ projects: Project[] }>('/api/v1/projects')
    setList(res.projects)
  }

  useEffect(() => {
    load().catch(() => setErr('加载失败'))
  }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    try {
      const res = await api<{ id: string }>('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || 'Untitled' }),
      })
      setName('')
      nav(`/p/${res.id}`)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '创建失败')
    }
  }

  function logout() {
    setToken(null)
    nav('/login')
  }

  return (
    <div style={{ maxWidth: 720, margin: '2rem auto', padding: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>我的项目</h1>
        <button type="button" onClick={logout}>
          退出
        </button>
      </header>
      <form onSubmit={create} style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input placeholder="项目名称" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
        <button type="submit">新建项目</button>
      </form>
      {err && <p style={{ color: '#f85149' }}>{err}</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {list.map((p) => (
          <li key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid #21262d' }}>
            <Link to={`/p/${p.id}`}>{p.name}</Link>
            <span style={{ color: '#8b949e', marginLeft: 8 }}>{p.main_tex_path}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

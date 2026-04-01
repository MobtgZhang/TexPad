import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, setToken } from '../api'

export default function Register() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    try {
      const res = await api<{ token: string }>('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      setToken(res.token)
      nav('/')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '注册失败')
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '4rem auto', padding: 16 }}>
      <h1>注册 TexPad</h1>
      <form onSubmit={submit}>
        <div style={{ marginBottom: 12 }}>
          <label>
            邮箱
            <br />
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required style={{ width: '100%' }} />
          </label>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label>
            密码（至少 8 位）
            <br />
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" minLength={8} required style={{ width: '100%' }} />
          </label>
        </div>
        {err && <p style={{ color: '#f85149' }}>{err}</p>}
        <button type="submit">注册</button>
      </form>
      <p>
        <Link to="/login">已有账号</Link>
      </p>
    </div>
  )
}

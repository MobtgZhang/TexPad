import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, setToken } from '../api'

export default function Login() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    try {
      const res = await api<{ token: string }>('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      setToken(res.token)
      nav('/')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '登录失败')
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '4rem auto', padding: 16 }}>
      <h1>TexPad 登录</h1>
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
            密码
            <br />
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required style={{ width: '100%' }} />
          </label>
        </div>
        {err && <p style={{ color: '#f85149' }}>{err}</p>}
        <button type="submit">登录</button>
      </form>
      <p>
        <Link to="/register">注册账号</Link>
      </p>
    </div>
  )
}

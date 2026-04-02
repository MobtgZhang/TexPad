import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PageBackdrop from '../components/PageBackdrop'
import { api, setToken } from '../api'

export default function Login() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setPending(true)
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
    } finally {
      setPending(false)
    }
  }

  return (
    <PageBackdrop>
      <div className="auth-card">
        <div className="auth-brand">TexPad</div>
        <h1 className="auth-title">欢迎回来</h1>
        <p className="auth-sub">登录以继续编辑你的 LaTeX 项目</p>
        <form onSubmit={submit}>
          <div className="auth-field">
            <label htmlFor="login-email">邮箱</label>
            <input
              id="login-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              autoComplete="email"
            />
          </div>
          <div className="auth-field">
            <label htmlFor="login-password">密码</label>
            <input
              id="login-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              autoComplete="current-password"
            />
          </div>
          {err ? <p className="auth-error">{err}</p> : null}
          <button className="btn-primary" type="submit" disabled={pending}>
            {pending ? '登录中…' : '登录'}
          </button>
        </form>
        <p className="auth-footer">
          还没有账号？ <Link to="/register">注册 TexPad</Link>
        </p>
      </div>
    </PageBackdrop>
  )
}

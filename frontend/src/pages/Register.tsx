import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PageBackdrop from '../components/PageBackdrop'
import { api, setToken } from '../api'

export default function Register() {
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
      const res = await api<{ token: string }>('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      setToken(res.token)
      nav('/')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '注册失败')
    } finally {
      setPending(false)
    }
  }

  return (
    <PageBackdrop>
      <div className="auth-card">
        <div className="auth-brand">TexPad</div>
        <h1 className="auth-title">创建账号</h1>
        <p className="auth-sub">几分钟即可开始在线协作与编译</p>
        <form onSubmit={submit}>
          <div className="auth-field">
            <label htmlFor="reg-email">邮箱</label>
            <input
              id="reg-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              autoComplete="email"
            />
          </div>
          <div className="auth-field">
            <label htmlFor="reg-password">密码（至少 8 位）</label>
            <input
              id="reg-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
            />
          </div>
          {err ? <p className="auth-error">{err}</p> : null}
          <button className="btn-primary" type="submit" disabled={pending}>
            {pending ? '注册中…' : '注册并登录'}
          </button>
        </form>
        <p className="auth-footer">
          已有账号？ <Link to="/login">返回登录</Link>
        </p>
      </div>
    </PageBackdrop>
  )
}

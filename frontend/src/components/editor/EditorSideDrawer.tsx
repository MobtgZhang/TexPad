import { useState } from 'react'

export type ProjectMemberRow = { user_id: string; email: string; role: string }

export default function EditorSideDrawer(props: {
  open: boolean
  onClose: () => void
  role: string
  shares: { token: string; role: string; created_at: string; expires_at?: string }[]
  members: ProjectMemberRow[]
  membersBusy: boolean
  onRefreshMembers: () => void
  onAddMember: (email: string, mrole: string) => Promise<void>
  onRemoveMember: (userId: string) => Promise<void>
  onCreateGuestLink: () => void
  onRevokeShare: (tok: string) => void
}) {
  const {
    open,
    onClose,
    role,
    shares,
    members,
    membersBusy,
    onRefreshMembers,
    onAddMember,
    onRemoveMember,
    onCreateGuestLink,
    onRevokeShare,
  } = props

  if (!open) return null

  const isOwner = role === 'owner'

  return (
    <>
      <button type="button" className="editor-drawer-scrim" aria-label="关闭侧栏" onClick={onClose} />
      <aside className="editor-drawer" role="dialog" aria-modal="true" aria-label="多人协作">
        <div className="editor-drawer-head">
          <span className="editor-drawer-title">多人协作</span>
          <button type="button" className="editor-drawer-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="editor-drawer-body">
          <section className="editor-drawer-section">
            <h3 className="editor-drawer-section__title">访客协作</h3>
            <p className="editor-drawer-section__hint">
              生成只通过链接加入的访客（只读或可编辑由链接角色决定）。适合外部审稿人或临时参与者。
            </p>
            {isOwner ? (
              <button type="button" className="editor-settings-btn editor-settings-btn--primary" onClick={onCreateGuestLink}>
                生成访客链接并复制
              </button>
            ) : (
              <p className="editor-settings-muted">仅项目所有者可为访客创建链接。</p>
            )}
            <ul className="editor-drawer-list">
              {shares.length === 0 ? (
                <li className="editor-drawer-list-empty">暂无访客链接。所有者点击上方按钮可生成。</li>
              ) : null}
              {shares.map((s) => (
                <li key={s.token}>
                  <span className="editor-drawer-list-label">
                    {s.role === 'editor' ? '可编辑' : '只读'} · {s.expires_at ? `至 ${s.expires_at}` : '永久'}
                  </span>
                  <div className="editor-drawer-list-actions">
                    <button
                      type="button"
                      className="editor-ft-mini"
                      onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/share/${s.token}`)}
                    >
                      复制链接
                    </button>
                    {isOwner ? (
                      <button type="button" className="editor-ft-mini" onClick={() => onRevokeShare(s.token)}>
                        撤销
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="editor-drawer-section">
            <h3 className="editor-drawer-section__title">指定用户协作</h3>
            <p className="editor-drawer-section__hint">
              将已注册用户（对方需已在本站注册）按邮箱加入项目。对方刷新项目列表后即可看到本项目。
            </p>
            <div className="editor-drawer-row">
              <button type="button" className="editor-settings-btn" disabled={membersBusy} onClick={() => onRefreshMembers()}>
                {membersBusy ? '刷新中…' : '刷新成员列表'}
              </button>
            </div>
            {isOwner ? (
              <GuestMemberInviteForm
                busy={membersBusy}
                onAdd={async (email, mrole) => {
                  await onAddMember(email, mrole)
                }}
              />
            ) : (
              <p className="editor-settings-muted">仅所有者可添加或移除指定成员。</p>
            )}
            <ul className="editor-drawer-list">
              {members.length === 0 && !membersBusy ? (
                <li className="editor-drawer-list-empty">暂无成员数据。点击「刷新成员列表」加载。</li>
              ) : null}
              {members.map((m) => (
                <li key={m.user_id}>
                  <span className="editor-drawer-list-label">
                    {m.email} · {m.role === 'owner' ? '所有者' : m.role === 'editor' ? '编辑' : '只读'}
                  </span>
                  {isOwner && m.role !== 'owner' ? (
                    <button type="button" className="editor-ft-mini" onClick={() => void onRemoveMember(m.user_id)}>
                      移除
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    </>
  )
}

function GuestMemberInviteForm(props: {
  busy: boolean
  onAdd: (email: string, role: string) => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [mrole, setMrole] = useState('editor')
  const [pending, setPending] = useState(false)

  return (
    <form
      className="editor-drawer-invite"
      onSubmit={(e) => {
        e.preventDefault()
        const em = email.trim()
        if (!em || pending || props.busy) return
        setPending(true)
        void props
          .onAdd(em, mrole)
          .then(() => setEmail(''))
          .catch((err: unknown) => window.alert(err instanceof Error ? err.message : '添加失败'))
          .finally(() => setPending(false))
      }}
    >
      <label className="editor-drawer-invite__field">
        <span>对方邮箱</span>
        <input
          type="email"
          className="editor-settings-input--full"
          placeholder="user@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
        />
      </label>
      <label className="editor-drawer-invite__field">
        <span>角色</span>
        <select className="editor-settings-select" value={mrole} onChange={(e) => setMrole(e.target.value)} aria-label="成员角色">
          <option value="editor">编辑</option>
          <option value="viewer">只读</option>
        </select>
      </label>
      <button type="submit" className="editor-settings-btn editor-settings-btn--primary" disabled={pending || props.busy}>
        {pending ? '添加中…' : '添加成员'}
      </button>
    </form>
  )
}

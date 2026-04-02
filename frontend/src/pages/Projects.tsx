import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, apiBlob, apiForm, apiOk, setToken } from '../api'
import { getThemePref, setThemePref as saveThemePref, type ThemePref } from '../lib/theme'

type Project = {
  id: string
  name: string
  main_tex_path: string
  last_edited?: string | null
  created_at?: string | null
  is_owner?: boolean
  role?: string
  latest_pdf_job_id?: string | null
}

type ProjectView = 'all' | 'mine' | 'shared' | 'archived' | 'trash'

type ModalKind = 'blank' | 'sample' | 'zip' | 'github'

const VIEW_TITLE: Record<ProjectView, string> = {
  all: '全部项目',
  mine: '我的项目',
  shared: '与我共享',
  archived: '归档项目',
  trash: '回收站',
}

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  )
}

function formatRelativeZh(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 19).replace('T', ' ')
  const sec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (sec < 45) return '刚刚'
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)} 天前`
  return d.toLocaleDateString('zh-CN')
}

function IconPdf() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M10 12h4M10 16h4M10 8h2" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  )
}

function IconUser() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function IconChevronDown({ open }: { open?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
      style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s ease' }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function IconLogout() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  )
}

function IconMoon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function IconSun() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function IconMonitor() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  )
}

function IconDoc() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  )
}

function IconUpload() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
    </svg>
  )
}

function IconGithub() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

function IconDuplicateProject() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M4 16V6a2 2 0 0 1 2-2h10" />
    </svg>
  )
}

function IconDownloadZip() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  )
}

function IconArchive() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
    </svg>
  )
}

function IconRestore() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 12a9 9 0 1 0 3-7.1L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}

function IconBan() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M4.93 4.93l14.14 14.14" />
    </svg>
  )
}

function downloadBlob(blob: Blob, filename: string) {
  const u = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = u
  a.download = filename
  a.click()
  URL.revokeObjectURL(u)
}

function safeFileBase(s: string) {
  return s.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 80) || 'project'
}

function suggestDuplicateName(projects: Project[]): string {
  let maxN = 0
  let hasBare = false
  const re = /^复制(\d+)$/
  for (const p of projects) {
    if (p.name === '复制') {
      hasBare = true
      continue
    }
    const m = re.exec(p.name)
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10))
  }
  if (hasBare && maxN === 0) return '复制1'
  return `复制${maxN + 1}`
}

const MODAL_TITLE: Record<ModalKind, string> = {
  blank: '空白项目',
  sample: '论文示例模板',
  zip: '上传项目（ZIP）',
  github: '从 GitHub 导入',
}

export default function Projects() {
  const nav = useNavigate()
  const loadGenRef = useRef(0)
  const [list, setList] = useState<Project[]>([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortDesc, setSortDesc] = useState(true)
  const [hoverRow, setHoverRow] = useState<string | null>(null)
  const [projectView, setProjectView] = useState<ProjectView>('all')
  const [actionBusy, setActionBusy] = useState<string | null>(null)

  const [dupTarget, setDupTarget] = useState<Project | null>(null)
  const [dupName, setDupName] = useState('')
  const [trashTarget, setTrashTarget] = useState<Project | null>(null)
  const [purgeTarget, setPurgeTarget] = useState<Project | null>(null)

  const [helpOpen, setHelpOpen] = useState(false)
  const helpWrapRef = useRef<HTMLDivElement>(null)

  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userWrapRef = useRef<HTMLDivElement>(null)
  const [meEmail, setMeEmail] = useState('')
  const [themePref, setThemePrefState] = useState<ThemePref>(() => getThemePref())

  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const newWrapRef = useRef<HTMLDivElement>(null)

  const [modal, setModal] = useState<ModalKind | null>(null)
  const [modalName, setModalName] = useState('')
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [ghOwner, setGhOwner] = useState('')
  const [ghRepo, setGhRepo] = useState('')
  const [ghRef, setGhRef] = useState('main')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const gen = ++loadGenRef.current
    const ac = new AbortController()

    async function load() {
      setLoading(true)
      try {
        const res = await api<{ projects?: Project[] }>(`/api/v1/projects?view=${projectView}`, {
          signal: ac.signal,
        })
        if (gen !== loadGenRef.current) return
        const projects = Array.isArray(res.projects) ? res.projects : []
        setList(projects)
        setErr('')
      } catch (e: unknown) {
        if (gen !== loadGenRef.current || isAbortError(e)) return
        setErr('加载失败')
      } finally {
        if (gen === loadGenRef.current) setLoading(false)
      }
    }

    load()

    return () => {
      ac.abort()
    }
  }, [projectView])

  useEffect(() => {
    const ac = new AbortController()
    api<{ email?: string }>('/api/v1/me', { signal: ac.signal })
      .then((r) => setMeEmail(r.email || ''))
      .catch(() => setMeEmail(''))
    return () => ac.abort()
  }, [])

  useEffect(() => {
    if (!helpOpen) return
    function onDocMouseDown(e: MouseEvent) {
      if (helpWrapRef.current?.contains(e.target as Node)) return
      setHelpOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [helpOpen])

  useEffect(() => {
    if (!userMenuOpen) return
    function onDocMouseDown(e: MouseEvent) {
      if (userWrapRef.current?.contains(e.target as Node)) return
      setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [userMenuOpen])

  useEffect(() => {
    if (!newMenuOpen) return
    function onDocMouseDown(e: MouseEvent) {
      if (newWrapRef.current?.contains(e.target as Node)) return
      setNewMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [newMenuOpen])

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = q
      ? list.filter(
          (p) =>
            p.name.toLowerCase().includes(q) || p.main_tex_path.toLowerCase().includes(q),
        )
      : [...list]
    const key = (p: Project) => {
      const t = p.last_edited || p.created_at
      if (!t) return 0
      const n = new Date(t).getTime()
      return Number.isNaN(n) ? 0 : n
    }
    rows.sort((a, b) => (sortDesc ? key(b) - key(a) : key(a) - key(b)))
    return rows
  }, [list, search, sortDesc])

  function closeAllMenus() {
    setHelpOpen(false)
    setUserMenuOpen(false)
    setNewMenuOpen(false)
  }

  function openModal(kind: ModalKind) {
    closeAllMenus()
    setModal(kind)
    setModalName('')
    setZipFile(null)
    setGhOwner('')
    setGhRepo('')
    setGhRef('main')
    setErr('')
  }

  function requestLogout() {
    if (!window.confirm('是否要退出？')) return
    setToken(null)
    nav('/login')
  }

  function closeHelpAnd(fn: () => void) {
    setHelpOpen(false)
    fn()
  }

  async function submitModal() {
    if (!modal || pending) return
    setPending(true)
    setErr('')
    try {
      if (modal === 'blank') {
        const res = await api<{ id: string }>('/api/v1/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: modalName.trim() || 'Untitled' }),
        })
        setModal(null)
        nav(`/p/${res.id}`)
        return
      }
      if (modal === 'sample') {
        const res = await api<{ id: string }>('/api/v1/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: modalName.trim() || 'Untitled', template: 'sample' }),
        })
        setModal(null)
        nav(`/p/${res.id}`)
        return
      }
      if (modal === 'zip') {
        if (!zipFile) {
          setErr('请选择 ZIP 文件')
          setPending(false)
          return
        }
        const fd = new FormData()
        fd.append('name', modalName.trim() || zipFile.name.replace(/\.zip$/i, '') || 'Imported')
        fd.append('archive', zipFile)
        const res = await apiForm<{ id: string }>('/api/v1/projects/import/zip', fd)
        setModal(null)
        nav(`/p/${res.id}`)
        return
      }
      if (modal === 'github') {
        const owner = ghOwner.trim()
        const repo = ghRepo.trim()
        if (!owner || !repo) {
          setErr('请填写所有者与仓库名')
          setPending(false)
          return
        }
        const res = await api<{ id: string }>('/api/v1/projects/import/github', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: modalName.trim() || repo,
            owner,
            repo,
            ref: ghRef.trim() || 'main',
          }),
        })
        setModal(null)
        nav(`/p/${res.id}`)
        return
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '操作失败')
    } finally {
      setPending(false)
    }
  }

  async function reloadList() {
    try {
      const res = await api<{ projects?: Project[] }>(`/api/v1/projects?view=${projectView}`)
      setList(Array.isArray(res.projects) ? res.projects : [])
    } catch {
      setErr('刷新列表失败')
    }
  }

  function openDuplicateModal(p: Project) {
    setErr('')
    setDupTarget(p)
    setDupName(suggestDuplicateName(list.filter((x) => x.is_owner)))
    closeAllMenus()
  }

  async function submitDuplicate() {
    if (!dupTarget || actionBusy) return
    const name = dupName.trim()
    if (!name) {
      setErr('请填写项目名称')
      return
    }
    setActionBusy(dupTarget.id)
    setErr('')
    try {
      const res = await api<{ id: string }>(`/api/v1/projects/${dupTarget.id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      setDupTarget(null)
      await reloadList()
      nav(`/p/${res.id}`)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '复制失败')
    } finally {
      setActionBusy(null)
    }
  }

  async function downloadProjectZip(p: Project) {
    setActionBusy(p.id)
    setErr('')
    try {
      const blob = await apiBlob(`/api/v1/projects/${p.id}/export.zip`)
      downloadBlob(blob, `${safeFileBase(p.name)}.zip`)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '下载失败')
    } finally {
      setActionBusy(null)
    }
  }

  async function downloadProjectPdf(p: Project) {
    if (!p.latest_pdf_job_id) {
      setErr('暂无可用 PDF，请先在编辑器中编译成功')
      return
    }
    setActionBusy(p.id)
    setErr('')
    try {
      const blob = await apiBlob(`/api/v1/projects/${p.id}/pdf/latest/download`)
      downloadBlob(blob, `${safeFileBase(p.name)}.pdf`)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '下载 PDF 失败')
    } finally {
      setActionBusy(null)
    }
  }

  async function archiveProject(p: Project) {
    setActionBusy(p.id)
    setErr('')
    try {
      await apiOk(`/api/v1/projects/${p.id}/archive`, { method: 'POST' })
      await reloadList()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '归档失败')
    } finally {
      setActionBusy(null)
    }
  }

  async function unarchiveProject(p: Project) {
    setActionBusy(p.id)
    setErr('')
    try {
      await apiOk(`/api/v1/projects/${p.id}/unarchive`, { method: 'POST' })
      await reloadList()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '恢复失败')
    } finally {
      setActionBusy(null)
    }
  }

  async function moveToTrash(p: Project) {
    setActionBusy(p.id)
    setErr('')
    try {
      await apiOk(`/api/v1/projects/${p.id}/trash`, { method: 'POST' })
      setTrashTarget(null)
      await reloadList()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '移入回收站失败')
    } finally {
      setActionBusy(null)
    }
  }

  async function restoreFromTrash(p: Project) {
    setActionBusy(p.id)
    setErr('')
    try {
      await apiOk(`/api/v1/projects/${p.id}/restore`, { method: 'POST' })
      await reloadList()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '恢复失败')
    } finally {
      setActionBusy(null)
    }
  }

  async function purgeProject(p: Project) {
    setActionBusy(p.id)
    setErr('')
    try {
      await api(`/api/v1/projects/${p.id}`, { method: 'DELETE' })
      setPurgeTarget(null)
      await reloadList()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '删除失败')
    } finally {
      setActionBusy(null)
    }
  }

  return (
    <div className="dash-root">
      <header className="dash-topnav">
        <Link to="/" className="dash-logo">
          TexPad
        </Link>
      </header>

      <div className="dash-body">
        <aside className="dash-sidebar">
          <div className="dash-np-wrap" ref={newWrapRef}>
            <button
              type="button"
              className="dash-np-trigger"
              aria-expanded={newMenuOpen}
              aria-haspopup="menu"
              onClick={(e) => {
                e.stopPropagation()
                setUserMenuOpen(false)
                setHelpOpen(false)
                setNewMenuOpen((v) => !v)
              }}
            >
              <span>新建项目</span>
              <IconChevronDown open={newMenuOpen} />
            </button>
            {newMenuOpen ? (
              <div className="dash-pop dash-np-pop" role="menu" aria-label="新建项目">
                <button
                  type="button"
                  className="dash-pop__row"
                  role="menuitem"
                  onClick={() => openModal('blank')}
                >
                  <span className="dash-pop__icon" aria-hidden>
                    <IconDoc />
                  </span>
                  <span className="dash-pop__text">
                    <span className="dash-pop__title">空白项目</span>
                    <span className="dash-pop__hint">最简 main.tex，适合从零开始</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="dash-pop__row"
                  role="menuitem"
                  onClick={() => openModal('sample')}
                >
                  <span className="dash-pop__icon" aria-hidden>
                    <IconDoc />
                  </span>
                  <span className="dash-pop__text">
                    <span className="dash-pop__title">论文示例模板</span>
                    <span className="dash-pop__hint">摘要、多节结构与参考文献示例</span>
                  </span>
                </button>
                <div className="dash-pop__rule" role="separator" />
                <button
                  type="button"
                  className="dash-pop__row"
                  role="menuitem"
                  onClick={() => openModal('zip')}
                >
                  <span className="dash-pop__icon" aria-hidden>
                    <IconUpload />
                  </span>
                  <span className="dash-pop__text">
                    <span className="dash-pop__title">上传项目</span>
                    <span className="dash-pop__hint">从 ZIP 解压到新建项目</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="dash-pop__row"
                  role="menuitem"
                  onClick={() => openModal('github')}
                >
                  <span className="dash-pop__icon" aria-hidden>
                    <IconGithub />
                  </span>
                  <span className="dash-pop__text">
                    <span className="dash-pop__title">从 GitHub 导入</span>
                    <span className="dash-pop__hint">下载仓库源码压缩包</span>
                  </span>
                </button>
              </div>
            ) : null}
          </div>

          <nav className="dash-side-nav" aria-label="项目视图">
            {(
              [
                ['all', '全部项目'],
                ['mine', '我的项目'],
                ['shared', '与我共享'],
                ['archived', '归档项目'],
                ['trash', '回收站'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`dash-side-nav__item${projectView === key ? ' dash-side-nav__item--active' : ''}`}
                onClick={() => setProjectView(key)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="dash-tags-block">
            <div className="dash-tags-heading">整理标签</div>
            <button type="button" className="dash-link-new-tag" disabled>
              + 新建标签
            </button>
          </div>

          <div className="dash-sidebar-spacer" />

          <div className="dash-sidebar-footer">
            <div className="dash-help-wrap" ref={helpWrapRef}>
              {helpOpen ? (
                <div className="dash-pop dash-help-pop" role="menu" aria-label="帮助菜单">
                  <button
                    type="button"
                    className="dash-pop__row dash-pop__row--simple"
                    role="menuitem"
                    onClick={() => setHelpOpen(false)}
                  >
                    文档
                  </button>
                  <button
                    type="button"
                    className="dash-pop__row dash-pop__row--simple"
                    role="menuitem"
                    onClick={() =>
                      closeHelpAnd(() =>
                        window.alert(
                          '什么是 TaxPad？\n\nTaxPad 是在线 LaTeX 编辑与项目管理工具，支持在浏览器中写作与编译。\n\n按「确定」关闭。',
                        ),
                      )
                    }
                  >
                    什么是 TaxPad
                  </button>
                  <button
                    type="button"
                    className="dash-pop__row dash-pop__row--simple"
                    role="menuitem"
                    onClick={() => setHelpOpen(false)}
                  >
                    博客
                  </button>
                  <button
                    type="button"
                    className="dash-pop__row dash-pop__row--simple"
                    role="menuitem"
                    onClick={() =>
                      closeHelpAnd(() =>
                        window.alert(
                          '联系我们\n\n邮箱：mobtgzhang@outlook.com\nGitHub：https://github.com/mobtgzhang\n\n按「确定」关闭。',
                        ),
                      )
                    }
                  >
                    联系我们
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                className={`dash-footer-btn-help${helpOpen ? ' dash-footer-btn-help--open' : ''}`}
                title="帮助"
                aria-label="帮助"
                aria-expanded={helpOpen}
                aria-haspopup="menu"
                onClick={(e) => {
                  e.stopPropagation()
                  setUserMenuOpen(false)
                  setNewMenuOpen(false)
                  setHelpOpen((v) => !v)
                }}
              >
                ?
              </button>
            </div>

            <div className="dash-user-wrap" ref={userWrapRef}>
              {userMenuOpen ? (
                <div className="dash-pop dash-account-pop" role="menu" aria-label="账户菜单">
                  <div className="dash-account-email">{meEmail || '已登录'}</div>
                  <div className="dash-pop__rule" />
                  <button type="button" className="dash-pop__row dash-pop__row--simple" disabled>
                    账户设置
                  </button>
                  <button type="button" className="dash-pop__row dash-pop__row--simple" disabled>
                    订阅
                  </button>
                  <div className="dash-account-theme">
                    <span className="dash-account-theme-label">主题</span>
                    <div className="dash-theme-pill" role="group" aria-label="主题">
                      <button
                        type="button"
                        className={`dash-theme-opt${themePref === 'dark' ? ' dash-theme-opt--on' : ''}`}
                        title="深色"
                        aria-pressed={themePref === 'dark'}
                        onClick={() => {
                          setThemePrefState('dark')
                          saveThemePref('dark')
                        }}
                      >
                        <IconMoon />
                      </button>
                      <button
                        type="button"
                        className={`dash-theme-opt${themePref === 'light' ? ' dash-theme-opt--on' : ''}`}
                        title="浅色"
                        aria-pressed={themePref === 'light'}
                        onClick={() => {
                          setThemePrefState('light')
                          saveThemePref('light')
                        }}
                      >
                        <IconSun />
                      </button>
                      <button
                        type="button"
                        className={`dash-theme-opt${themePref === 'system' ? ' dash-theme-opt--on' : ''}`}
                        title="跟随系统"
                        aria-pressed={themePref === 'system'}
                        onClick={() => {
                          setThemePrefState('system')
                          saveThemePref('system')
                        }}
                      >
                        <IconMonitor />
                      </button>
                    </div>
                  </div>
                  <div className="dash-pop__rule" />
                  <button
                    type="button"
                    className="dash-pop__row dash-pop__row--logout"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false)
                      requestLogout()
                    }}
                  >
                    <span>登出</span>
                    <IconLogout />
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                className={`dash-footer-btn-user${userMenuOpen ? ' dash-footer-btn-user--open' : ''}`}
                title="账户"
                aria-label="账户菜单"
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                onClick={(e) => {
                  e.stopPropagation()
                  setHelpOpen(false)
                  setNewMenuOpen(false)
                  setUserMenuOpen((v) => !v)
                }}
              >
                <IconUser />
              </button>
            </div>
          </div>
        </aside>

        <main className="dash-main">
          <div className="dash-panel">
            <div className="dash-panel-head">
              <h1 className="dash-panel-title">{VIEW_TITLE[projectView]}</h1>
            </div>

            <div className="dash-search-wrap">
              <span className="dash-search-icon" aria-hidden>
                <IconSearch />
              </span>
              <input
                className="dash-search"
                placeholder="在所有项目中搜索…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="搜索项目"
              />
            </div>

            {err && !modal && !dupTarget && !trashTarget && !purgeTarget ? (
              <p className="dash-inline-error">{err}</p>
            ) : null}

            {loading ? (
              <div className="dash-table-skeleton" aria-hidden>
                <div className="dash-skel-row" />
                <div className="dash-skel-row" />
                <div className="dash-skel-row" />
              </div>
            ) : filteredSorted.length === 0 ? (
              <div className="dash-empty">
                {list.length === 0
                  ? projectView === 'trash'
                    ? '回收站为空。'
                    : projectView === 'archived'
                      ? '暂无归档项目。在「全部项目」中可将自有项目归档。'
                      : projectView === 'shared'
                        ? '暂无他人与你共享的项目。'
                        : projectView === 'mine'
                          ? '暂无我的项目，点击「新建项目」开始。'
                          : '暂无项目，点击左上方「新建项目」开始。'
                  : '没有符合搜索条件的项目。'}
              </div>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th className="dash-th-check" aria-hidden />
                      <th>标题</th>
                      <th>所有者</th>
                      <th>
                        <button
                          type="button"
                          className="dash-th-sort"
                          onClick={() => setSortDesc((v) => !v)}
                          aria-label={sortDesc ? '按修改时间降序，点击切换' : '按修改时间升序，点击切换'}
                        >
                          最近修改
                          <span className="dash-sort-icon" data-desc={sortDesc}>
                            ↓
                          </span>
                        </button>
                      </th>
                      <th className="dash-th-actions">
                        <span className="dash-th-actions__main">操作</span>
                        <span className="dash-th-actions__sub">
                          {                            projectView === 'archived'
                            ? 'ZIP · PDF · 回收站 · 恢复'
                            : projectView === 'trash'
                              ? '复制 · ZIP · PDF · 恢复 · — · 彻底删除'
                              : '复制 · ZIP · PDF · 归档 · 回收站'}
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSorted.map((p) => {
                      const when = formatRelativeZh(p.last_edited || p.created_at)
                      const active = hoverRow === p.id
                      return (
                        <tr
                          key={p.id}
                          className={active ? 'dash-tr--hover' : undefined}
                          onMouseEnter={() => setHoverRow(p.id)}
                          onMouseLeave={() => setHoverRow(null)}
                        >
                          <td className="dash-td-check">
                            <input type="checkbox" disabled className="dash-checkbox" aria-label="选择（即将支持）" />
                          </td>
                          <td className="dash-td-title">
                            <Link to={`/p/${p.id}`}>{p.name}</Link>
                            <span className="dash-td-sub">{p.main_tex_path}</span>
                          </td>
                          <td className="dash-td-muted">{p.is_owner ? '你' : '共享'}</td>
                          <td className="dash-td-muted">
                            {when} · {p.is_owner ? '你' : '共享'}
                          </td>
                          <td className="dash-td-actions">
                            <div className="dash-action-row">
                              {projectView === 'archived' ? (
                                <>
                                  <button
                                    type="button"
                                    className="dash-act-btn"
                                    title="下载项目 ZIP"
                                    aria-label="下载 ZIP"
                                    disabled={actionBusy === p.id}
                                    onClick={() => void downloadProjectZip(p)}
                                  >
                                    <IconDownloadZip />
                                  </button>
                                  <button
                                    type="button"
                                    className="dash-act-btn"
                                    title="下载 PDF"
                                    aria-label="下载 PDF"
                                    disabled={actionBusy === p.id || !p.latest_pdf_job_id}
                                    onClick={() => void downloadProjectPdf(p)}
                                  >
                                    <IconPdf />
                                  </button>
                                  <button
                                    type="button"
                                    className="dash-act-btn dash-act-btn--danger"
                                    title="移入回收站"
                                    aria-label="移入回收站"
                                    disabled={actionBusy === p.id || !p.is_owner}
                                    onClick={() => {
                                      setErr('')
                                      setTrashTarget(p)
                                    }}
                                  >
                                    <IconTrash />
                                  </button>
                                  <button
                                    type="button"
                                    className="dash-act-btn"
                                    title="恢复到项目列表"
                                    aria-label="取消归档"
                                    disabled={actionBusy === p.id || !p.is_owner}
                                    onClick={() => void unarchiveProject(p)}
                                  >
                                    <IconRestore />
                                  </button>
                                </>
                              ) : projectView === 'trash' ? (
                                <>
                                  <button
                                    type="button"
                                    className="dash-act-btn"
                                    title="复制项目"
                                    aria-label="复制项目"
                                    disabled={actionBusy === p.id}
                                    onClick={() => openDuplicateModal(p)}
                                  >
                                    <IconDuplicateProject />
                                  </button>
                                  <button
                                    type="button"
                                    className="dash-act-btn"
                                    title="下载 ZIP"
                                    aria-label="下载 ZIP"
                                    disabled={actionBusy === p.id}
                                    onClick={() => void downloadProjectZip(p)}
                                  >
                                    <IconDownloadZip />
                                  </button>
                                  <button
                                    type="button"
                                    className="dash-act-btn"
                                    title="下载 PDF"
                                    aria-label="下载 PDF"
                                    disabled={actionBusy === p.id || !p.latest_pdf_job_id}
                                    onClick={() => void downloadProjectPdf(p)}
                                  >
                                    <IconPdf />
                                  </button>
                                  <button
                                    type="button"
                                    className="dash-act-btn"
                                    title="从回收站恢复"
                                    aria-label="恢复项目"
                                    disabled={actionBusy === p.id || !p.is_owner}
                                    onClick={() => void restoreFromTrash(p)}
                                  >
                                    <IconRestore />
                                  </button>
                                  <span className="dash-act-btn dash-act-btn--muted" title="已在回收站" aria-hidden>
                                    <IconBan />
                                  </span>
                                  <button
                                    type="button"
                                    className="dash-act-btn dash-act-btn--danger"
                                    title="彻底删除"
                                    aria-label="彻底删除"
                                    disabled={actionBusy === p.id || !p.is_owner}
                                    onClick={() => {
                                      setErr('')
                                      setPurgeTarget(p)
                                    }}
                                  >
                                    <IconTrash />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="dash-act-btn"
                                    title="复制项目"
                                    aria-label="复制项目"
                                    disabled={actionBusy === p.id}
                                    onClick={() => openDuplicateModal(p)}
                                  >
                                    <IconDuplicateProject />
                                  </button>
                                  <button
                                    type="button"
                                    className="dash-act-btn"
                                    title="下载 ZIP"
                                    aria-label="下载 ZIP"
                                    disabled={actionBusy === p.id}
                                    onClick={() => void downloadProjectZip(p)}
                                  >
                                    <IconDownloadZip />
                                  </button>
                                  <button
                                    type="button"
                                    className="dash-act-btn"
                                    title="下载 PDF"
                                    aria-label="下载 PDF"
                                    disabled={actionBusy === p.id || !p.latest_pdf_job_id}
                                    onClick={() => void downloadProjectPdf(p)}
                                  >
                                    <IconPdf />
                                  </button>
                                  {p.is_owner ? (
                                    <button
                                      type="button"
                                      className="dash-act-btn"
                                      title="归档为模板"
                                      aria-label="归档"
                                      disabled={actionBusy === p.id}
                                      onClick={() => void archiveProject(p)}
                                    >
                                      <IconArchive />
                                    </button>
                                  ) : (
                                    <span className="dash-act-btn dash-act-btn--muted" title="仅所有者可归档" aria-hidden>
                                      <IconBan />
                                    </span>
                                  )}
                                  {p.is_owner ? (
                                    <button
                                      type="button"
                                      className="dash-act-btn dash-act-btn--danger"
                                      title="移入回收站"
                                      aria-label="移入回收站"
                                      disabled={actionBusy === p.id}
                                      onClick={() => {
                                        setErr('')
                                        setTrashTarget(p)
                                      }}
                                    >
                                      <IconTrash />
                                    </button>
                                  ) : (
                                    <span className="dash-act-btn dash-act-btn--muted" title="仅所有者可删除" aria-hidden>
                                      <IconBan />
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>

      {modal ? (
        <div
          className="dash-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!pending) setModal(null)
          }}
        >
          <div
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dash-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="dash-modal-title" className="dash-modal__title">
              {MODAL_TITLE[modal]}
            </h2>
            <p className="dash-modal__desc">
              {modal === 'blank' && '将创建仅含基础 main.tex 的空项目。'}
              {modal === 'sample' && '将创建含摘要、章节与参考文献结构的示例论文稿。'}
              {modal === 'zip' && '上传 LaTeX 项目压缩包（仅允许常见源码与资源扩展名）。'}
              {modal === 'github' && '从公开仓库下载默认分支源码（与 GitHub 网页「Download ZIP」一致）。'}
            </p>

            {(modal === 'blank' || modal === 'sample' || modal === 'zip' || modal === 'github') && (
              <label className="dash-modal__field">
                <span className="dash-modal__label">项目名称</span>
                <input
                  className="dash-modal__input"
                  placeholder={modal === 'github' ? '默认使用仓库名' : '留空则使用 Untitled / 文件名'}
                  value={modalName}
                  onChange={(e) => setModalName(e.target.value)}
                />
              </label>
            )}

            {modal === 'zip' ? (
              <label className="dash-modal__field">
                <span className="dash-modal__label">ZIP 文件</span>
                <input
                  className="dash-modal__file"
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
                />
              </label>
            ) : null}

            {modal === 'github' ? (
              <>
                <label className="dash-modal__field">
                  <span className="dash-modal__label">所有者（owner）</span>
                  <input
                    className="dash-modal__input"
                    placeholder="例如：octocat"
                    value={ghOwner}
                    onChange={(e) => setGhOwner(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className="dash-modal__field">
                  <span className="dash-modal__label">仓库（repo）</span>
                  <input
                    className="dash-modal__input"
                    placeholder="例如：Hello-World"
                    value={ghRepo}
                    onChange={(e) => setGhRepo(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className="dash-modal__field">
                  <span className="dash-modal__label">分支（ref）</span>
                  <input
                    className="dash-modal__input"
                    placeholder="main"
                    value={ghRef}
                    onChange={(e) => setGhRef(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              </>
            ) : null}

            {err ? <p className="dash-modal__error">{err}</p> : null}

            <div className="dash-modal__actions">
              <button type="button" className="dash-modal__btn dash-modal__btn--ghost" disabled={pending} onClick={() => setModal(null)}>
                取消
              </button>
              <button type="button" className="dash-modal__btn dash-modal__btn--primary" disabled={pending} onClick={() => void submitModal()}>
                {pending ? '请稍候…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {dupTarget ? (
        <div
          className="dash-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (actionBusy === null) {
              setDupTarget(null)
              setErr('')
            }
          }}
        >
          <div className="dash-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="dash-modal__title">复制项目</h2>
            <p className="dash-modal__desc">
              使用「{dupTarget.name}」当前文件创建副本，默认名称为「复制N」；可在下方修改。
            </p>
            <label className="dash-modal__field">
              <span className="dash-modal__label">新项目标题</span>
              <input
                className="dash-modal__input"
                value={dupName}
                onChange={(e) => setDupName(e.target.value)}
                autoFocus
              />
            </label>
            {err ? <p className="dash-modal__error">{err}</p> : null}
            <div className="dash-modal__actions">
              <button
                type="button"
                className="dash-modal__btn dash-modal__btn--ghost"
                disabled={actionBusy !== null}
                onClick={() => {
                  setDupTarget(null)
                  setErr('')
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="dash-modal__btn dash-modal__btn--primary"
                disabled={actionBusy !== null}
                onClick={() => void submitDuplicate()}
              >
                {actionBusy ? '请稍候…' : '创建副本'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {trashTarget ? (
        <div
          className="dash-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (actionBusy === null) {
              setTrashTarget(null)
              setErr('')
            }
          }}
        >
          <div className="dash-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="dash-modal__title">移入回收站</h2>
            <p className="dash-modal__desc">
              确定将「{trashTarget.name}」移入回收站？协作者将无法再访问；你可在回收站中恢复或彻底删除。
            </p>
            {err ? <p className="dash-modal__error">{err}</p> : null}
            <div className="dash-modal__actions">
              <button
                type="button"
                className="dash-modal__btn dash-modal__btn--ghost"
                disabled={actionBusy !== null}
                onClick={() => {
                  setTrashTarget(null)
                  setErr('')
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="dash-modal__btn dash-modal__btn--primary"
                disabled={actionBusy !== null}
                onClick={() => void moveToTrash(trashTarget)}
              >
                {actionBusy ? '请稍候…' : '移入回收站'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {purgeTarget ? (
        <div
          className="dash-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (actionBusy === null) {
              setPurgeTarget(null)
              setErr('')
            }
          }}
        >
          <div className="dash-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="dash-modal__title">彻底删除</h2>
            <p className="dash-modal__desc">
              确定永久删除「{purgeTarget.name}」？此操作不可恢复，存储中的文件也将随数据库一并移除。
            </p>
            {err ? <p className="dash-modal__error">{err}</p> : null}
            <div className="dash-modal__actions">
              <button
                type="button"
                className="dash-modal__btn dash-modal__btn--ghost"
                disabled={actionBusy !== null}
                onClick={() => {
                  setPurgeTarget(null)
                  setErr('')
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="dash-modal__btn dash-modal__btn--primary"
                disabled={actionBusy !== null}
                onClick={() => void purgeProject(purgeTarget)}
              >
                {actionBusy ? '请稍候…' : '彻底删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

import Editor, { OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { MonacoBinding } from 'y-monaco'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  api,
  apiBlob,
  apiForm,
  apiOk,
  apiWebSocketOrigin,
  getCollabState,
  getToken,
  putCollabState,
} from '../api'
import EditorFindBar from '../components/editor/EditorFindBar'
import EditorHotkeysModal from '../components/editor/EditorHotkeysModal'
import EditorSymbolPalette from '../components/editor/EditorSymbolPalette'
import {
  buildAgentQuickActions,
  humanizeAgentErrorMessage,
  humanizeAgentHttpStatus,
} from '../lib/agentQuickActions'
import {
  agentPrefsToStreamFields,
  applyAgentSamplingPreset,
  loadAgentPrefs,
  matchAgentSamplingPreset,
  saveAgentPrefs,
  type AgentPrefs,
  type AgentSamplingPreset,
} from '../lib/agentPrefs'
import EditorAgentPanel, { type AgentAssistantTurn, type AgentChatTurn } from '../components/editor/EditorAgentPanel'
import EditorPaperclawPanel from '../components/editor/EditorPaperclawPanel'
import EditorCommentsPanel, {
  type CommentSelection,
  type ProjectComment,
} from '../components/editor/EditorCommentsPanel'
import EditorSideDrawer, { type ProjectMemberRow } from '../components/editor/EditorSideDrawer'
import EditorSettingsModal, { type SettingsSection } from '../components/editor/EditorSettingsModal'
import EditorLeftRail, { type LeftTool } from '../components/editor/EditorLeftRail'
import EditorProjectSearch from '../components/editor/EditorProjectSearch'
import EditorSubToolbar from '../components/editor/EditorSubToolbar'
import EditorTopBar, { type TopMenuId } from '../components/editor/EditorTopBar'
import FileTree from '../components/editor/FileTree'
import OutlinePanel from '../components/editor/OutlinePanel'
import { makeCollabRoom } from '../lib/collabRoom'
import { outlineIndexForLine, parseTexOutline, type OutlineSection } from '../lib/outline'
import { extractEquationSnippet } from '../lib/equationPreview'
import { loadCompilePrefs, saveCompilePrefs, type CompilePrefs } from '../lib/compilePrefs'
import { loadEditorPrefs, prefsToMonacoDisplayOptions, prefsToMonacoOptions } from '../lib/editorSettings'
import {
  DEFAULT_EDITOR_COLOR_THEME,
  isKnownEditorTheme,
  registerMonacoLatexEditorThemes,
} from '../lib/monacoEditorThemes'
import { applyTheme, getThemePref, setThemePref, type ThemePref } from '../lib/theme'
import { loadViewPrefs, saveViewPrefs, type ViewPrefs } from '../lib/viewPrefs'
import { insertTextAtCursor, insertTextAndMoveCaret } from '../lib/monacoInsert'
import {
  moveCursorDocumentEnd,
  moveCursorDocumentStart,
  registerTexPadMonacoCommands,
  type TexPadCommandCtx,
  toggleLatexLineComment,
  transformSelection,
  wrapSelection,
} from '../lib/texpadMonacoCommands'

type FileEnt = { path: string; size_bytes?: number }

function registerLatex(m: typeof monaco) {
  if (m.languages.getLanguages().some((l) => l.id === 'latex')) return
  m.languages.register({ id: 'latex' })
  m.languages.setMonarchTokensProvider('latex', {
    tokenizer: {
      root: [
        [/\\[a-zA-Z@]+/, 'keyword'],
        [/\\./, 'keyword'],
        [/[{}[\]]/, 'delimiter.bracket'],
        [/[$]/, 'string'],
        [/%[^\n]*/, 'comment'],
      ],
    },
  })
}

const BASE = () => (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')

/** 与 chi `/files/*` 一致：保留路径中的 `/`，逐段 encode（避免 figures/foo 被整段 encode 成 figures%2Ffoo 导致 404） */
function encodeProjectFilePathForUrl(rel: string): string {
  return rel
    .replace(/\\/g, '/')
    .trim()
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

function decodeProposalB64(b64: string): string {
  if (!b64) return ''
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return ''
  }
}

type AgentFileProposal = { path: string; before: string; after: string }

async function fetchProjectFile(pid: string, p: string): Promise<string> {
  const res = await fetch(`${BASE()}/api/v1/projects/${pid}/files/${encodeProjectFilePathForUrl(p)}`, {
    headers: { Authorization: `Bearer ${getToken() || ''}` },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.text()
}

async function putProjectFile(pid: string, p: string, body: string) {
  const res = await fetch(`${BASE()}/api/v1/projects/${pid}/files/${encodeProjectFilePathForUrl(p)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${getToken() || ''}`,
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body,
  })
  if (!res.ok) throw new Error(await res.text())
}

function modelUri(m: typeof monaco, projectId: string, filePath: string) {
  const enc = encodeURIComponent(filePath)
  return m.Uri.parse(`texpad://${projectId}/${enc}`)
}

function parseLogLineHint(log: string): { line: number; msg: string } | null {
  const lines = log.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith('! LaTeX Error:')) {
      const msg = lines[i]!.trim()
      const next = lines[i + 1] || ''
      const m = /^l\.(\d+)/.exec(next.trim())
      const line = m ? parseInt(m[1]!, 10) : 0
      return { line, msg }
    }
  }
  return null
}

/** 合并后端返回的编译日志与 error_text；失败时摘要在上方，便于先看到原因 */
function mergeCompileJobServerLog(st: { log?: string; error?: string; status?: string }): string {
  const log = (st.log ?? '').trimEnd()
  const err = (st.error ?? '').trim()
  if (!err) return st.log ?? ''
  const block = `---\n摘要（后端）：${err}`
  if (!log) return block
  if (log.includes(err)) return log
  if (st.status === 'failed') {
    return `${block}\n\n──────── 完整日志 ────────\n\n${log}`
  }
  return `${log}\n\n---\n摘要（后端）：${err}`
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

function isCompileJobRetryable(msg: string): boolean {
  const m = msg.toLowerCase()
  if (m.includes('job_wrong_project')) return false
  return m.includes('not found') || m.includes('unknown_job')
}

function isPdfDownloadRetryable(msg: string): boolean {
  const m = msg.toLowerCase()
  return m.includes('not found') || m.includes('not ready') || m.includes('pdf not ready')
}

async function fetchCompileJobWithRetry(
  projectId: string,
  jobId: string,
  attempts = 12,
  delayMs = 220,
): Promise<{ status: string; log?: string; error?: string }> {
  let last: Error | null = null
  for (let i = 0; i < attempts; i++) {
    try {
      return await api<{ status: string; log?: string; error?: string }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/compile/jobs/${encodeURIComponent(jobId)}`,
      )
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e))
      if (!isCompileJobRetryable(last.message) || i === attempts - 1) throw last
      await sleep(delayMs)
    }
  }
  throw last
}

async function apiBlobWithRetry(path: string, attempts = 15, delayMs = 220): Promise<Blob> {
  let last: Error | null = null
  for (let i = 0; i < attempts; i++) {
    try {
      return await apiBlob(path)
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e))
      if (!isPdfDownloadRetryable(last.message) || i === attempts - 1) throw last
      await sleep(delayMs)
    }
  }
  throw last
}

/** 当前标签为图片或 PDF 时，用二进制预览而非 Monaco 读文本（避免乱码/损坏） */
function binaryPreviewKindForPath(p: string): 'image' | 'pdf' | null {
  const low = p.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(p)) return 'image'
  if (low.endsWith('.pdf')) return 'pdf'
  return null
}

function readLsFloat(key: string, def: number, min: number, max: number): number {
  try {
    const s = localStorage.getItem(key)
    const n = s ? parseFloat(s) : def
    if (!Number.isFinite(n)) return def
    return Math.min(max, Math.max(min, n))
  } catch {
    return def
  }
}

function readFileAsDataURL(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(f)
  })
}

function safeFileBase(s: string) {
  return s.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 80) || 'project'
}

function dataURLToImagePart(dataUrl: string): { mime: string; data: string } {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  if (!m) return { mime: 'image/png', data: dataUrl }
  return { mime: m[1], data: m[2] }
}

export default function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const nav = useNavigate()
  const [projectName, setProjectName] = useState('')
  const [mainPath, setMainPath] = useState('main.tex')
  const [role, setRole] = useState('')
  const ENGINE_LS = 'texpad_latex_engine'
  const [engine, setEngineState] = useState(() => {
    try {
      const v = localStorage.getItem(ENGINE_LS)
      if (v === 'pdflatex' || v === 'xelatex' || v === 'lualatex' || v === 'context') return v
    } catch {
      /* ignore */
    }
    return 'pdflatex'
  })
  const setEngine = useCallback((e: string) => {
    setEngineState(e)
    try {
      localStorage.setItem(ENGINE_LS, e)
    } catch {
      /* ignore */
    }
  }, [])
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [agentMessages, setAgentMessages] = useState<AgentChatTurn[]>([])
  const [agentInput, setAgentInput] = useState('')
  const [agentSending, setAgentSending] = useState(false)
  const [agentProposals, setAgentProposals] = useState<AgentFileProposal[]>([])
  const [agentProposalPanelOpen, setAgentProposalPanelOpen] = useState(false)
  /** 左侧/弹窗智能体：仅首屏显示引导文案与快捷问题；用户一旦发问过则只保留对话区 */
  const [agentWelcomeChrome, setAgentWelcomeChrome] = useState(true)
  const [collabOn] = useState(() => !!import.meta.env.VITE_COLLAB_WS)
  const [files, setFiles] = useState<FileEnt[]>([])
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activePath, setActivePath] = useState('')
  const [editorReady, setEditorReady] = useState(false)
  const [compileLog, setCompileLog] = useState('')
  const binaryPreviewKind = useMemo(
    () => (activePath ? binaryPreviewKindForPath(activePath) : null),
    [activePath],
  )
  const [binaryPreviewUrl, setBinaryPreviewUrl] = useState<string | null>(null)
  const [binaryPreviewErr, setBinaryPreviewErr] = useState('')
  const [compilePrefs, setCompilePrefs] = useState<CompilePrefs>(() => loadCompilePrefs())
  const setCompilePrefsPersist = useCallback((p: CompilePrefs) => {
    saveCompilePrefs(p)
    setCompilePrefs(p)
  }, [])
  const [snapshots, setSnapshots] = useState<{ id: string; label: string; created_at: string }[]>([])
  const [shares, setShares] = useState<{ token: string; role: string; created_at: string; expires_at?: string }[]>([])
  const [members, setMembers] = useState<ProjectMemberRow[]>([])
  const [membersBusy, setMembersBusy] = useState(false)
  const [comments, setComments] = useState<ProjectComment[]>([])
  const [awarenessLabel, setAwarenessLabel] = useState('')
  const [commentSelection, setCommentSelection] = useState<CommentSelection | null>(null)
  const [symbolPaletteOpen, setSymbolPaletteOpen] = useState(false)
  const [viewPrefs, setViewPrefs] = useState<ViewPrefs>(() => loadViewPrefs())
  const [equationSnippet, setEquationSnippet] = useState<string | null>(null)
  const [agentPrefs, setAgentPrefs] = useState<AgentPrefs>(() => loadAgentPrefs())

  const [leftPanelOpen, setLeftPanelOpen] = useState(() => {
    const v = localStorage.getItem('texpad_left_panel_open')
    if (v === '0') return false
    if (v === '1') return true
    return localStorage.getItem('texpad_sidebar_collapsed') !== '1'
  })
  const [leftTool, setLeftTool] = useState<LeftTool>('files')
  const [fileSearchQuery, setFileSearchQuery] = useState('')
  const [splitRatio, setSplitRatio] = useState(() => readLsFloat('texpad_split_ratio', 0.52, 0.18, 0.82))
  const [editorMode, setEditorMode] = useState<'code' | 'visual'>('code')
  const [logPanelOpen, setLogPanelOpen] = useState(() => localStorage.getItem('texpad_log_open') === '1')
  const [logPanelHeight, setLogPanelHeight] = useState(() => Math.round(readLsFloat('texpad_log_height', 160, 80, 400)))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [topMenu, setTopMenu] = useState<TopMenuId>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [settingsModalSection, setSettingsModalSection] = useState<SettingsSection | null>(null)
  const [leftPanelWidth, setLeftPanelWidth] = useState(() =>
    Math.round(readLsFloat('texpad_left_panel_w', 260, 180, 560)),
  )
  /** 文件树区域占「文件侧栏」高度的比例（仅两区均展开时生效） */
  const [leftFilesSplitRatio, setLeftFilesSplitRatio] = useState(() =>
    readLsFloat('texpad_left_files_split_ratio', 0.48, 0.22, 0.78),
  )
  const [fileTreeSectionExpanded, setFileTreeSectionExpanded] = useState(() => localStorage.getItem('texpad_filetree_section_expanded') !== '0')
  const [outlineSectionExpanded, setOutlineSectionExpanded] = useState(() => localStorage.getItem('texpad_outline_section_expanded') !== '0')
  const [agentPendingImages, setAgentPendingImages] = useState<File[]>([])
  /** 用于 Agent 推荐问题：与编辑器内容同步（防抖），避免每键入一次就整页重渲染 */
  const [agentSourcePreview, setAgentSourcePreview] = useState('')
  const agentPreviewDebounceRef = useRef<number | undefined>(undefined)
  const [editorPrefs, setEditorPrefs] = useState(() => loadEditorPrefs())
  const editorPrefsRef = useRef(editorPrefs)
  editorPrefsRef.current = editorPrefs
  const [themePrefState, setThemePrefState] = useState<ThemePref>(() => getThemePref())
  const [systemScheme, setSystemScheme] = useState<'dark' | 'light'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
  )
  const appUiTheme: 'dark' | 'light' = themePrefState === 'system' ? systemScheme : themePrefState
  const [compilingUi, setCompilingUi] = useState(false)
  const [outlineSections, setOutlineSections] = useState<OutlineSection[]>([])
  const [outlineActiveIdx, setOutlineActiveIdx] = useState(-1)
  const [narrow, setNarrow] = useState(false)
  const [mobilePane, setMobilePane] = useState<'files' | 'code' | 'pdf'>('code')
  const [findOpen, setFindOpen] = useState(false)
  const [wordCountOpen, setWordCountOpen] = useState(false)
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  const [agentModalOpen, setAgentModalOpen] = useState(false)

  const editorInstRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof monaco | null>(null)
  const modelsRef = useRef<Map<string, monaco.editor.ITextModel>>(new Map())
  const ydocRef = useRef<Y.Doc | null>(null)
  const providerRef = useRef<WebsocketProvider | null>(null)
  const bindingRef = useRef<MonacoBinding | null>(null)
  const compilingRef = useRef(false)
  const splitRef = useRef<HTMLDivElement | null>(null)
  const zipInputRef = useRef<HTMLInputElement | null>(null)
  const uploadSingleInputRef = useRef<HTMLInputElement | null>(null)
  const insertImageInputRef = useRef<HTMLInputElement | null>(null)
  const commentDecorationIdsRef = useRef<string[]>([])
  const cmdCtxRef = useRef<TexPadCommandCtx>({} as TexPadCommandCtx)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chromeTopRef = useRef<HTMLDivElement | null>(null)
  const leftChromeRef = useRef<HTMLDivElement | null>(null)
  const logDragRef = useRef<{ startY: number; startH: number } | null>(null)
  const leftResizeRef = useRef<{ startX: number; startW: number } | null>(null)
  const filesSidebarRef = useRef<HTMLDivElement | null>(null)

  const loadMain = useCallback(async () => {
    if (!projectId) return
    const p = await api<{ main_tex_path: string; role?: string; name?: string }>(`/api/v1/projects/${projectId}`)
    setMainPath(p.main_tex_path)
    setRole(p.role || '')
    setProjectName(p.name || '')
  }, [projectId])

  const loadFiles = useCallback(async () => {
    if (!projectId) return
    const res = await api<{ files: FileEnt[] }>(`/api/v1/projects/${projectId}/files`)
    setFiles(res.files || [])
  }, [projectId])


  useEffect(() => {
    loadMain().catch((e) => setMsg(String(e)))
  }, [loadMain])

  useEffect(() => {
    if (!projectId) return
    void loadFiles()
  }, [projectId, loadFiles])

  useEffect(() => {
    setAgentProposals([])
    setAgentProposalPanelOpen(false)
    setAgentWelcomeChrome(true)
  }, [projectId])

  useEffect(() => {
    if (files.length === 0) return
    setActivePath((cur) => {
      if (cur && files.some((f) => f.path === cur)) return cur
      return files.find((f) => f.path === mainPath)?.path ?? files[0]!.path
    })
  }, [files, mainPath])

  useEffect(() => {
    if (!activePath) return
    setOpenTabs((t) => (t.includes(activePath) ? t : [...t, activePath]))
  }, [activePath])

  useEffect(() => {
    const ro = () => setNarrow(window.innerWidth < 880)
    ro()
    window.addEventListener('resize', ro)
    return () => window.removeEventListener('resize', ro)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const fn = () => {
      setSystemScheme(mq.matches ? 'light' : 'dark')
      if (getThemePref() === 'system') applyTheme('system')
    }
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])

  useEffect(() => {
    if (!agentModalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setAgentModalOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [agentModalOpen])

  useEffect(() => {
    if (topMenu === null) return
    const close = (e: MouseEvent) => {
      if (chromeTopRef.current && !chromeTopRef.current.contains(e.target as Node)) setTopMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [topMenu])

  useEffect(() => {
    if (!helpOpen) return
    const close = (e: MouseEvent) => {
      if (leftChromeRef.current?.contains(e.target as Node)) return
      setHelpOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [helpOpen])

  useEffect(() => {
    const ed = editorInstRef.current
    if (!ed || !editorReady) return
    ed.updateOptions({
      ...prefsToMonacoOptions(editorPrefs),
      ...prefsToMonacoDisplayOptions(editorPrefs),
      glyphMargin: true,
    })
  }, [editorReady, editorPrefs])

  useEffect(() => {
    const m = monacoRef.current
    if (!m || !editorReady) return
    const id = editorPrefs.editorColorTheme
    m.editor.setTheme(isKnownEditorTheme(id) ? id : DEFAULT_EDITOR_COLOR_THEME)
  }, [editorReady, editorPrefs.editorColorTheme])

  const showPdf = useCallback(
    async (jid: string) => {
      if (!projectId) return
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      try {
        const blob = await apiBlobWithRetry(
          `/api/v1/projects/${encodeURIComponent(projectId)}/pdf/${encodeURIComponent(jid)}/download`,
        )
        const u = URL.createObjectURL(blob)
        setPdfUrl(u)
        setMsg('')
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e)
        setCompileLog((prev) => (prev ? `${prev}\n\n` : '') + `---\nPDF 下载失败: ${m}`)
        setMsg('PDF 未就绪或下载失败')
        window.setTimeout(() => setMsg(''), 3500)
      }
    },
    [projectId],
  )

  const compileNow = useCallback(
    async (opts?: { clean?: boolean }) => {
      if (!projectId || role === 'viewer' || compilingRef.current) return
      compilingRef.current = true
      setCompilingUi(true)
      setMsg('编译中…')

      let ws: WebSocket | null = null
      let poll: ReturnType<typeof setInterval> | null = null
      let finalized = false

      const cleanupTracking = () => {
        if (poll != null) {
          clearInterval(poll)
          poll = null
        }
        try {
          ws?.close()
        } catch {
          /* ignore */
        }
        ws = null
      }

      const finalizeCompile = async (jid: string) => {
        if (finalized) return
        finalized = true
        cleanupTracking()
        compilingRef.current = false
        setCompilingUi(false)
        let okForPdf = false
        try {
          const st = await fetchCompileJobWithRetry(projectId, jid)
          setCompileLog(mergeCompileJobServerLog(st))
          okForPdf = st.status === 'success'
          if (st.status === 'failed' || !okForPdf) {
            setLogPanelOpen(true)
            try {
              localStorage.setItem('texpad_log_open', '1')
            } catch {
              /* ignore */
            }
          }
        } catch (e) {
          const em = e instanceof Error ? e.message : String(e)
          setCompileLog((prev) => (prev ? `${prev}\n\n` : '') + `---\n获取编译任务详情失败: ${em}`)
          setLogPanelOpen(true)
          try {
            localStorage.setItem('texpad_log_open', '1')
          } catch {
            /* ignore */
          }
        }
        setMsg('')
        if (okForPdf) await showPdf(jid)
      }

      try {
        const res = await api<{ job_id: string }>(
          `/api/v1/projects/${encodeURIComponent(projectId)}/compile`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              engine,
              draft_mode: compilePrefs.compileMode === 'draft',
              halt_on_error: compilePrefs.haltOnFirstError,
              clean_build: !!opts?.clean,
              syntax_check: compilePrefs.syntaxCheckBeforeCompile,
              texlive_year: compilePrefs.texLiveLabel === '2024' ? '2024' : '2025',
            }),
          },
        )
        const jid = String(res.job_id ?? '').trim()
        if (!jid) {
          cleanupTracking()
          compilingRef.current = false
          setCompilingUi(false)
          setCompileLog((prev) => (prev ? `${prev}\n\n` : '') + '---\n编译接口未返回有效的 job_id')
          setMsg('编译任务创建异常')
          window.setTimeout(() => setMsg(''), 4000)
          return
        }
        const wsBase = apiWebSocketOrigin()
        const tok = getToken()
        ws = new WebSocket(
          `${wsBase}/api/v1/projects/${encodeURIComponent(projectId)}/ws?token=${encodeURIComponent(tok || '')}`,
        )
        ws.onmessage = (ev) => {
          try {
            const d = JSON.parse(ev.data as string)
            if (d.type === 'compile_done' && d.job_id === jid) {
              void finalizeCompile(jid)
            }
          } catch {
            /* ignore */
          }
        }

        const t0 = Date.now()
        poll = setInterval(() => {
          void (async () => {
            if (finalized) return
            if (Date.now() - t0 > 120000) {
              if (finalized) return
              finalized = true
              cleanupTracking()
              compilingRef.current = false
              setCompilingUi(false)
              setMsg('')
              setCompileLog((prev) =>
                (prev ? `${prev}\n\n` : '') + '---\n编译状态轮询超时（120s），请刷新页面或检查后端任务状态。',
              )
              return
            }
            try {
              const st = await fetchCompileJobWithRetry(projectId, jid, 8, 280)
              if (finalized) return
              setCompileLog(mergeCompileJobServerLog(st))
              if (st.status === 'success' || st.status === 'failed') {
                await finalizeCompile(jid)
              }
            } catch (e) {
              if (finalized) return
              const em = e instanceof Error ? e.message : String(e)
              setCompileLog((prev) => (prev ? `${prev}\n\n` : '') + `---\n轮询编译状态失败: ${em}`)
            }
          })()
        }, 1200)
      } catch (e) {
        cleanupTracking()
        compilingRef.current = false
        setCompilingUi(false)
        const m = e instanceof Error ? e.message : String(e)
        setCompileLog((prev) => (prev ? `${prev}\n\n` : '') + `---\n发起编译失败: ${m}`)
        setMsg(m)
        window.setTimeout(() => setMsg(''), 4000)
      }
    },
    [projectId, role, engine, compilePrefs, showPdf],
  )

  const compileNowRef = useRef(compileNow)
  useEffect(() => {
    compileNowRef.current = compileNow
  }, [compileNow])

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
  }, [pdfUrl])

  /** PDF 演示模式为全屏遮罩；无 PDF 时若仍开启会与深色底形成「整页黑屏」，并挡住工具栏。 */
  useEffect(() => {
    if (pdfUrl) return
    setViewPrefs((v) => {
      if (!v.pdfPresentationMode) return v
      const n = { ...v, pdfPresentationMode: false }
      saveViewPrefs(n)
      return n
    })
  }, [pdfUrl])

  useEffect(() => {
    if (!projectId || !activePath || !binaryPreviewKind) {
      setBinaryPreviewUrl((u) => {
        if (u) URL.revokeObjectURL(u)
        return null
      })
      setBinaryPreviewErr('')
      return
    }
    let cancelled = false
    setBinaryPreviewErr('')
    void (async () => {
      try {
        const res = await fetch(
          `${BASE()}/api/v1/projects/${projectId}/files/${encodeProjectFilePathForUrl(activePath)}`,
          { headers: { Authorization: `Bearer ${getToken() || ''}` } },
        )
        if (!res.ok) {
          const t = await res.text()
          throw new Error(t || res.statusText)
        }
        const blob = await res.blob()
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        setBinaryPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return url
        })
      } catch (e) {
        if (cancelled) return
        setBinaryPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return null
        })
        setBinaryPreviewErr(e instanceof Error ? e.message : '加载失败')
      }
    })()
    return () => {
      cancelled = true
      setBinaryPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
    }
  }, [projectId, activePath, binaryPreviewKind])

  useEffect(() => {
    if (!projectId || !editorReady || !activePath) return
    const editor = editorInstRef.current
    const M = monacoRef.current
    if (!editor || !M) return

    let cancelled = false
    let persistTimer = 0
    let fileSyncTimer = 0
    const disposers: (() => void)[] = []

    const cleanupCollab = () => {
      window.clearTimeout(persistTimer)
      window.clearTimeout(fileSyncTimer)
      bindingRef.current?.destroy()
      bindingRef.current = null
      providerRef.current?.destroy()
      providerRef.current = null
      ydocRef.current?.destroy()
      ydocRef.current = null
      setAwarenessLabel('')
    }

    cleanupCollab()

    const uri = modelUri(M, projectId, activePath)
    let model = M.editor.getModel(uri)
    if (!model || model.isDisposed()) {
      model = M.editor.createModel('', 'latex', uri)
      modelsRef.current.set(activePath, model)
    }

    if (binaryPreviewKind) {
      M.editor.setModelLanguage(model, 'plaintext')
      model.setValue(
        `# 二进制预览（只读）\n# ${activePath}\n\n` +
          (binaryPreviewKind === 'image' ? '图片显示在下方叠加层。' : 'PDF 显示在下方叠加层。'),
      )
      editor.setModel(model)
      editor.updateOptions({ readOnly: true })
      return () => {
        cancelled = true
        window.clearTimeout(persistTimer)
        window.clearTimeout(fileSyncTimer)
        disposers.forEach((d) => d())
        cleanupCollab()
      }
    }

    M.editor.setModelLanguage(model, 'latex')
    editor.updateOptions({ readOnly: role === 'viewer' })
    editor.setModel(model)

    if (!collabOn) {
      void fetchProjectFile(projectId, activePath)
        .then((text) => {
          if (!cancelled) model.setValue(text)
        })
        .catch(() => {
          if (!cancelled) model.setValue('')
        })
    } else {
      const yd = new Y.Doc()
      ydocRef.current = yd
      const ytext = yd.getText('tex')

      void (async () => {
        try {
          const st = await getCollabState(projectId, activePath)
          if (cancelled) return
          if (st && st.byteLength > 0) {
            Y.applyUpdate(yd, st)
          } else {
            const t = await fetchProjectFile(projectId, activePath)
            if (cancelled) return
            if (ytext.length === 0) ytext.insert(0, t)
          }
        } catch {
          if (!cancelled && ytext.length === 0) {
            try {
              const t = await fetchProjectFile(projectId, activePath)
              if (!cancelled) ytext.insert(0, t)
            } catch {
              /* empty */
            }
          }
        }
        if (cancelled) return

        const wsBase = (import.meta.env.VITE_COLLAB_WS || 'ws://localhost:18475').replace(/\/$/, '')
        const room = makeCollabRoom(projectId, activePath)
        const prov = new WebsocketProvider(wsBase, room, yd, {
          params: { token: getToken() || '' },
        })
        providerRef.current = prov

        try {
          const me = await api<{ email?: string }>('/api/v1/me')
          prov.awareness.setLocalStateField('user', {
            name: me.email || 'user',
            color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
          })
        } catch {
          prov.awareness.setLocalStateField('user', { name: 'user', color: '#7c6cf9' })
        }

        if (cancelled) {
          prov.destroy()
          return
        }

        bindingRef.current = new MonacoBinding(ytext, model, new Set([editor]), prov.awareness)

        const flushAwareness = () => {
          const states = Array.from(prov.awareness.getStates().values()) as { user?: { name?: string } }[]
          const names = states.map((s) => s.user?.name).filter(Boolean)
          setAwarenessLabel(names.length ? `在线: ${names.join(', ')}` : '')
        }
        prov.awareness.on('update', flushAwareness)
        flushAwareness()
        disposers.push(() => prov.awareness.off('update', flushAwareness))

        const onYUpdate = () => {
          window.clearTimeout(persistTimer)
          persistTimer = window.setTimeout(() => {
            if (cancelled) return
            const u = Y.encodeStateAsUpdate(yd)
            void putCollabState(projectId, activePath, u).catch(() => {})
          }, 1200)
          window.clearTimeout(fileSyncTimer)
          fileSyncTimer = window.setTimeout(() => {
            if (cancelled) return
            void putProjectFile(projectId, activePath, ytext.toString()).catch(() => {})
          }, 1500)
        }
        yd.on('update', onYUpdate)
        disposers.push(() => yd.off('update', onYUpdate))
      })()
    }

    return () => {
      cancelled = true
      window.clearTimeout(persistTimer)
      window.clearTimeout(fileSyncTimer)
      disposers.forEach((d) => d())
      cleanupCollab()
    }
  }, [projectId, activePath, collabOn, editorReady, binaryPreviewKind, role])

  useEffect(() => {
    if (!editorReady || !activePath || !activePath.toLowerCase().endsWith('.tex')) {
      setOutlineSections([])
      setOutlineActiveIdx(-1)
      return
    }
    const ed = editorInstRef.current
    if (!ed) return
    const model = ed.getModel()
    if (!model) return

    const refresh = () => {
      const sections = parseTexOutline(model.getValue())
      setOutlineSections(sections)
      const line = ed.getPosition()?.lineNumber ?? 1
      setOutlineActiveIdx(outlineIndexForLine(sections, line))
    }
    refresh()
    const d1 = model.onDidChangeContent(() => refresh())
    const d2 = ed.onDidChangeCursorPosition(() => {
      const sections = parseTexOutline(model.getValue())
      const line = ed.getPosition()?.lineNumber ?? 1
      setOutlineActiveIdx(outlineIndexForLine(sections, line))
    })
    return () => {
      d1.dispose()
      d2.dispose()
    }
  }, [editorReady, activePath])

  const beforeMount = useCallback((m: typeof monaco) => {
    registerLatex(m)
    registerMonacoLatexEditorThemes(m)
  }, [])

  const onMount: OnMount = useCallback((editor, m) => {
    editorInstRef.current = editor
    monacoRef.current = m
    const th = editorPrefsRef.current.editorColorTheme
    m.editor.setTheme(isKnownEditorTheme(th) ? th : DEFAULT_EDITOR_COLOR_THEME)
    editor.updateOptions({
      minimap: { enabled: false },
      glyphMargin: true,
      renderLineHighlight: 'line',
      ...prefsToMonacoDisplayOptions(editorPrefsRef.current),
      ...prefsToMonacoOptions(editorPrefsRef.current),
    })
    registerTexPadMonacoCommands(editor, m, () => cmdCtxRef.current)
    setEditorReady(true)
  }, [])

  async function save(opts?: { quiet?: boolean }) {
    if (!projectId || role === 'viewer' || !activePath) return
    if (binaryPreviewKindForPath(activePath)) return
    const v = editorInstRef.current?.getModel()?.getValue() ?? ''
    await putProjectFile(projectId, activePath, v)
    if (collabOn && ydocRef.current) {
      const u = Y.encodeStateAsUpdate(ydocRef.current)
      await putCollabState(projectId, activePath, u).catch(() => {})
    }
    if (!opts?.quiet) {
      setMsg('已保存')
      setTimeout(() => setMsg(''), 2000)
    }
  }

  async function compile(opts?: { clean?: boolean }) {
    await compileNow(opts)
  }

  function jumpToLogLine() {
    const hint = parseLogLineHint(compileLog)
    const line = hint?.line || editorInstRef.current?.getPosition()?.lineNumber || 1
    if (line < 1) return
    editorInstRef.current?.revealLineInCenter(line)
    editorInstRef.current?.setPosition({ lineNumber: line, column: 1 })
  }

  function goOutlineLine(line: number) {
    editorInstRef.current?.revealLineInCenter(line)
    editorInstRef.current?.setPosition({ lineNumber: line, column: 1 })
    editorInstRef.current?.focus()
  }

  async function exportZip() {
    if (!projectId) return
    const res = await fetch(`${BASE()}/api/v1/projects/${projectId}/export.zip`, {
      headers: { Authorization: `Bearer ${getToken() || ''}` },
    })
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${safeFileBase(projectName)}.zip`
    a.click()
    setTopMenu(null)
  }

  async function downloadPdfLatest() {
    if (!projectId) return
    try {
      const blob = await apiBlob(`/api/v1/projects/${projectId}/pdf/latest/download`)
      const u = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = u
      a.download = `${safeFileBase(projectName)}.pdf`
      a.click()
      URL.revokeObjectURL(u)
      setTopMenu(null)
    } catch {
      setMsg('暂无可用 PDF，请先在编辑器中编译成功')
      window.setTimeout(() => setMsg(''), 4000)
    }
  }

  async function duplicateProjectFromMenu() {
    if (!projectId || role === 'viewer') return
    const name = window.prompt('新项目名称（留空则自动生成）', '')?.trim() ?? ''
    try {
      const res = await api<{ id: string }>(`/api/v1/projects/${projectId}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(name ? { name } : {}),
      })
      setTopMenu(null)
      nav(`/p/${res.id}`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '复制项目失败')
    }
  }

  async function uploadSingleProjectFile(f: File | null) {
    if (!projectId || !f || role === 'viewer') return
    const fd = new FormData()
    fd.append('file', f)
    fd.append('path', f.name)
    await apiForm<{ path: string }>(`/api/v1/projects/${projectId}/files/upload`, fd)
    setMsg('上传完成')
    window.setTimeout(() => setMsg(''), 2500)
    setTopMenu(null)
    await loadFiles()
    const p = f.name
    setActivePath(p)
    setOpenTabs((t) => [...new Set([...t, p])])
  }

  function runEditorAction(actionId: string) {
    editorInstRef.current?.getAction(actionId)?.run()
    setTopMenu(null)
  }

  async function importZip(f: File | null) {
    if (!projectId || !f || role === 'viewer') return
    const fd = new FormData()
    fd.append('file', f)
    await fetch(`${BASE()}/api/v1/projects/${projectId}/import.zip`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken() || ''}` },
      body: fd,
    })
    setMsg('导入完成')
    window.setTimeout(() => setMsg(''), 2500)
    setTopMenu(null)
    await loadMain()
    await loadFiles()
  }

  async function snapshot() {
    if (!projectId || role === 'viewer') return
    await api(`/api/v1/projects/${projectId}/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: new Date().toISOString() }),
    })
    setMsg('快照已创建')
    setTimeout(() => setMsg(''), 2500)
    await refreshSnapshots()
    setTopMenu(null)
  }

  async function deleteSnapshot(sid: string) {
    if (!projectId || role === 'viewer') return
    if (!confirm('确定删除此快照？存储中的副本将一并删除，不可恢复。')) return
    await api(`/api/v1/projects/${projectId}/snapshots/${encodeURIComponent(sid)}`, { method: 'DELETE' })
    setMsg('快照已删除')
    setTimeout(() => setMsg(''), 2500)
    await refreshSnapshots()
  }

  async function refreshSnapshots() {
    if (!projectId) return
    const r = await api<{ snapshots: { id: string; label: string; created_at: string }[] }>(
      `/api/v1/projects/${projectId}/snapshots`,
    )
    setSnapshots(r.snapshots || [])
  }

  async function restoreSnapshot(sid: string) {
    if (!projectId || role === 'viewer') return
    if (!confirm('确定从快照恢复？未快照的当前文件可能被覆盖。')) return
    await api(`/api/v1/projects/${projectId}/snapshots/${sid}/restore`, { method: 'POST' })
    setMsg('已恢复')
    await loadFiles()
    window.location.reload()
  }

  async function refreshShares() {
    if (!projectId) return
    const r = await api<{ shares: typeof shares }>(`/api/v1/projects/${projectId}/shares`)
    setShares(r.shares || [])
  }

  async function refreshMembers() {
    if (!projectId) return
    setMembersBusy(true)
    try {
      const r = await api<{ members: ProjectMemberRow[] }>(`/api/v1/projects/${projectId}/members`)
      setMembers(r.members || [])
    } catch {
      setMembers([])
    } finally {
      setMembersBusy(false)
    }
  }

  async function addProjectMember(email: string, mrole: string) {
    if (!projectId || role !== 'owner') return
    await api(`/api/v1/projects/${projectId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), role: mrole }),
    })
    setMsg('已添加成员')
    setTimeout(() => setMsg(''), 2400)
    await refreshMembers()
  }

  async function removeProjectMember(uid: string) {
    if (!projectId || role !== 'owner') return
    if (!confirm('确定从项目移除该成员？')) return
    await apiOk(`/api/v1/projects/${projectId}/members/${encodeURIComponent(uid)}`, { method: 'DELETE' })
    setMsg('已移除成员')
    setTimeout(() => setMsg(''), 2400)
    await refreshMembers()
  }

  async function createGuestCollaborationLink() {
    if (!projectId || role !== 'owner') return
    const asEditor = window.confirm('访客通过链接加入后的权限：确定 = 可编辑，取消 = 只读')
    const hours = window.prompt('链接有效期（小时，留空表示永久）', '')
    const body: { role: string; expires_in_hours?: number } = { role: asEditor ? 'editor' : 'viewer' }
    if (hours && hours.trim() !== '') {
      const n = parseInt(hours, 10)
      if (n > 0) body.expires_in_hours = n
    }
    const res = await api<{ token: string }>(`/api/v1/projects/${projectId}/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const url = `${window.location.origin}/share/${res.token}`
    await navigator.clipboard.writeText(url)
    setMsg('访客协作链接已复制到剪贴板')
    await refreshShares()
  }

  async function revokeShare(tok: string) {
    if (!projectId || role !== 'owner') return
    await api(`/api/v1/projects/${projectId}/shares/${encodeURIComponent(tok)}`, { method: 'DELETE' })
    await refreshShares()
  }

  async function refreshComments() {
    if (!projectId) return
    const r = await api<{ comments: ProjectComment[] }>(`/api/v1/projects/${projectId}/comments`)
    setComments(r.comments || [])
  }

  async function submitCommentWithSelection(body: string) {
    if (!projectId || role === 'viewer' || !activePath || !commentSelection) return
    await api(`/api/v1/projects/${projectId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: activePath,
        line: commentSelection.startLine,
        end_line: commentSelection.endLine,
        start_col: commentSelection.startCol,
        end_col: commentSelection.endCol,
        quote: commentSelection.quote,
        body,
      }),
    })
    await refreshComments()
  }

  async function sendAgentMessage() {
    if (!projectId || role === 'viewer' || agentSending) return
    const text = agentInput.trim()
    const imgs = agentPendingImages
    if (!text && imgs.length === 0) return

    setAgentWelcomeChrome(false)
    setAgentSending(true)

    const imagePreviews: string[] = []
    const imageParts: { mime: string; data: string }[] = []
    try {
      for (const f of imgs) {
        const url = await readFileAsDataURL(f)
        imagePreviews.push(url)
        imageParts.push(dataURLToImagePart(url))
      }
    } catch {
      setAgentWelcomeChrome(true)
      setAgentSending(false)
      setMsg('读取附图失败，请重试或换一张图片。')
      window.setTimeout(() => setMsg(''), 3200)
      return
    }

    const prior = agentMessages.map((m) =>
      m.role === 'user'
        ? { role: 'user' as const, content: m.content }
        : { role: 'assistant' as const, content: (m as AgentAssistantTurn).content },
    )
    const apiMessages = [...prior, { role: 'user' as const, content: text || '(附图)' }]

    setAgentInput('')
    setAgentPendingImages([])
    setAgentMessages((prev) => [
      ...prev,
      { role: 'user', content: text || '(附图)', imagePreviews },
      { role: 'assistant', content: '', thinking: '', tools: [] },
    ])

    const applyEvent = (j: {
      type?: string
      content?: string
      name?: string
      args?: string
      result?: string
    }) => {
      setAgentMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (!last || last.role !== 'assistant') return prev
        const cur = last as AgentAssistantTurn
        const upt: AgentAssistantTurn = {
          role: 'assistant',
          content: cur.content,
          thinking: cur.thinking,
          tools: cur.tools ? [...cur.tools] : [],
          check: cur.check,
        }
        switch (j.type) {
          case 'thinking':
            upt.thinking = (cur.thinking || '') + (j.content || '')
            break
          case 'token':
            upt.content = (cur.content || '') + (j.content || '')
            break
          case 'tool_start':
            upt.tools = [...(upt.tools || []), { name: j.name || '', args: j.args || '', result: undefined }]
            break
          case 'tool_end': {
            const tools = [...(upt.tools || [])]
            for (let k = tools.length - 1; k >= 0; k--) {
              const t = tools[k]!
              if (t.name === j.name && t.result === undefined) {
                tools[k] = { ...t, result: j.result || '' }
                break
              }
            }
            upt.tools = tools
            break
          }
          case 'check':
            upt.check = j.content || ''
            break
          case 'note': {
            const chunk = j.content || ''
            upt.content = cur.content ? `${cur.content}\n${chunk}` : chunk
            break
          }
          case 'error': {
            const chunk = j.content ? humanizeAgentErrorMessage(j.content) : ''
            if (!chunk) break
            upt.content = cur.content ? `${cur.content}\n${chunk}` : chunk
            break
          }
          default:
            break
        }
        next[next.length - 1] = upt
        return next
      })
    }

    try {
      const res = await fetch(`${BASE()}/api/v1/projects/${projectId}/agent/stream`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken() || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: apiMessages,
          images: imageParts,
          ...agentPrefsToStreamFields(agentPrefs),
        }),
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        applyEvent({ type: 'error', content: humanizeAgentHttpStatus(res.status, errBody) })
        return
      }
      const reader = res.body?.getReader()
      const dec = new TextDecoder()
      if (!reader) {
        applyEvent({ type: 'error', content: '无法使用 API（无响应体）。' })
        return
      }
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
          if (line === '[DONE]') continue
          try {
            const j = JSON.parse(line) as {
              type?: string
              content?: string
              name?: string
              args?: string
              result?: string
              files?: { path: string; before_b64?: string; after_b64?: string }[]
            }
            if (j.type === 'done') continue
            if (j.type === 'proposals' && Array.isArray(j.files)) {
              setAgentProposals((prev) => {
                const m = new Map(prev.map((x) => [x.path, x]))
                for (const f of j.files!) {
                  if (!f.path || f.after_b64 === undefined) continue
                  m.set(f.path, {
                    path: f.path,
                    before: decodeProposalB64(f.before_b64 || ''),
                    after: decodeProposalB64(f.after_b64),
                  })
                }
                return [...m.values()]
              })
              continue
            }
            applyEvent(j)
          } catch {
            /* ignore */
          }
        }
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : '请求失败'
      applyEvent({ type: 'error', content: humanizeAgentErrorMessage(raw) })
    } finally {
      setAgentSending(false)
    }
  }

  const acceptAgentProposals = useCallback(async () => {
    if (!projectId || role === 'viewer' || agentProposals.length === 0) return
    const n = agentProposals.length
    const batch = agentProposals
    try {
      for (const f of batch) {
        await putProjectFile(projectId, f.path, f.after)
      }
      await loadFiles()
      for (const f of batch) {
        const model = modelsRef.current.get(f.path)
        if (model && !model.isDisposed() && !binaryPreviewKindForPath(f.path)) {
          model.setValue(f.after)
        }
      }
      setAgentProposals([])
      setAgentProposalPanelOpen(false)
      setMsg(`已应用智能体修改（${n} 个文件）`)
      window.setTimeout(() => setMsg(''), 2800)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '应用修改失败')
      window.setTimeout(() => setMsg(''), 4000)
    }
  }, [projectId, role, agentProposals, loadFiles])

  const rejectAgentProposals = useCallback(() => {
    setAgentProposals([])
    setAgentProposalPanelOpen(false)
  }, [])

  async function newFile(name: string) {
    if (!projectId || role === 'viewer') return
    const n = name.trim()
    if (!n) return
    await putProjectFile(projectId, n, '% new file\n')
    await loadFiles()
    setActivePath(n)
    setOpenTabs((t) => [...new Set([...t, n])])
  }

  async function newFolder(prefix: string) {
    if (!projectId || role === 'viewer') return
    const p = prefix.replace(/\/+$/, '')
    if (!p) return
    await putProjectFile(projectId, `${p}/.texpadkeep`, '% folder\n')
    await loadFiles()
  }

  async function deleteFile(p: string) {
    if (!projectId || role === 'viewer') return
    if (!confirm(`删除 ${p}？`)) return
    await fetch(`${BASE()}/api/v1/projects/${projectId}/files/${encodeProjectFilePathForUrl(p)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken() || ''}` },
    })
    modelsRef.current.get(p)?.dispose()
    modelsRef.current.delete(p)
    setOpenTabs((tabs) => tabs.filter((x) => x !== p))
    if (activePath === p) {
      const next = files.find((f) => f.path !== p)?.path || 'main.tex'
      setActivePath(next)
    }
    await loadFiles()
  }

  async function renameActiveFile() {
    if (!projectId || role === 'viewer' || !activePath) return
    if (collabOn) {
      setMsg('协作模式下暂不支持重命名文件')
      setTimeout(() => setMsg(''), 3200)
      return
    }
    const next = window.prompt('新文件路径（相对于项目根）', activePath)?.trim()
    if (!next || next === activePath) return
    const content = editorInstRef.current?.getModel()?.getValue() ?? ''
    try {
      await putProjectFile(projectId, next, content)
      const del = await fetch(`${BASE()}/api/v1/projects/${projectId}/files/${encodeProjectFilePathForUrl(activePath)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken() || ''}` },
      })
      if (!del.ok) throw new Error(await del.text())
      modelsRef.current.get(activePath)?.dispose()
      modelsRef.current.delete(activePath)
      setOpenTabs((tabs) => tabs.map((p) => (p === activePath ? next : p)))
      setActivePath(next)
      if (mainPath === activePath) {
        await api(`/api/v1/projects/${projectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ main_tex_path: next }),
        })
        setMainPath(next)
      }
      await loadFiles()
      setMsg('已重命名')
      setTimeout(() => setMsg(''), 2000)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '重命名失败')
    }
  }

  async function renameProjectFile(oldPath: string) {
    if (!projectId || role === 'viewer' || !oldPath) return
    if (collabOn) {
      setMsg('协作模式下暂不支持重命名文件')
      setTimeout(() => setMsg(''), 3200)
      return
    }
    const next = window.prompt('新文件路径（相对于项目根）', oldPath)?.trim()
    if (!next || next === oldPath) return
    let content: string
    if (oldPath === activePath) {
      content = editorInstRef.current?.getModel()?.getValue() ?? ''
    } else {
      const m = modelsRef.current.get(oldPath)
      content = m ? m.getValue() : await fetchProjectFile(projectId, oldPath)
    }
    try {
      await putProjectFile(projectId, next, content)
      const del = await fetch(`${BASE()}/api/v1/projects/${projectId}/files/${encodeProjectFilePathForUrl(oldPath)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken() || ''}` },
      })
      if (!del.ok) throw new Error(await del.text())
      modelsRef.current.get(oldPath)?.dispose()
      modelsRef.current.delete(oldPath)
      setOpenTabs((tabs) => tabs.map((p) => (p === oldPath ? next : p)))
      if (activePath === oldPath) setActivePath(next)
      if (mainPath === oldPath) {
        await api(`/api/v1/projects/${projectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ main_tex_path: next }),
        })
        setMainPath(next)
      }
      await loadFiles()
      setMsg('已重命名')
      setTimeout(() => setMsg(''), 2000)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '重命名失败')
    }
  }

  async function downloadProjectFile(p: string) {
    if (!projectId || !p) return
    try {
      const res = await fetch(`${BASE()}/api/v1/projects/${projectId}/files/${encodeProjectFilePathForUrl(p)}`, {
        headers: { Authorization: `Bearer ${getToken() || ''}` },
      })
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const base = p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'file'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = base
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '下载失败')
    }
  }

  async function setMainTex(p: string) {
    if (!projectId || role === 'viewer') return
    await api(`/api/v1/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ main_tex_path: p }),
    })
    setMainPath(p)
    setMsg('主文档已更新')
    window.setTimeout(() => setMsg(''), 2500)
  }

  function openTab(p: string) {
    setActivePath(p)
    setOpenTabs((t) => (t.includes(p) ? t : [...t, p]))
  }

  function jumpToComment(path: string, line: number) {
    const L = Math.max(1, line)
    openTab(path)
    openCommentsUi()
    window.setTimeout(() => {
      editorInstRef.current?.revealLineInCenter(L)
      editorInstRef.current?.setPosition({ lineNumber: L, column: 1 })
      editorInstRef.current?.focus()
    }, 160)
  }

  function closeTab(p: string, e: ReactMouseEvent) {
    e.stopPropagation()
    setOpenTabs((tabs) => {
      const next = tabs.filter((x) => x !== p)
      if (activePath === p && next.length) setActivePath(next[next.length - 1]!)
      return next
    })
  }

  function toggleLeftPanel() {
    setLeftPanelOpen((o) => {
      const n = !o
      localStorage.setItem('texpad_left_panel_open', n ? '1' : '0')
      return n
    })
  }

  function selectLeftTool(t: LeftTool) {
    setHelpOpen(false)
    setLeftTool(t)
    setLeftPanelOpen(true)
    localStorage.setItem('texpad_left_panel_open', '1')
    if (t === 'snapshots') void refreshSnapshots()
    if (t === 'evolveAgent') setAgentModalOpen(false)
  }

  function applyEditorThemePref(p: ThemePref) {
    setThemePref(p)
    setThemePrefState(p)
    applyTheme(p)
  }

  function onSplitMouseDown(e: ReactMouseEvent<HTMLDivElement>) {
    e.preventDefault()
    const el = splitRef.current
    if (!el) return
    const move = (ev: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      const x = ev.clientX - rect.left
      const r = x / rect.width
      setSplitRatio(Math.min(0.82, Math.max(0.18, r)))
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      setSplitRatio((cur) => {
        localStorage.setItem('texpad_split_ratio', String(cur))
        return cur
      })
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  function onLeftPanelResizeMouseDown(e: ReactMouseEvent<HTMLDivElement>) {
    e.preventDefault()
    leftResizeRef.current = { startX: e.clientX, startW: leftPanelWidth }
    const move = (ev: MouseEvent) => {
      const st = leftResizeRef.current
      if (!st) return
      const dx = ev.clientX - st.startX
      const w = Math.min(560, Math.max(180, st.startW + dx))
      setLeftPanelWidth(w)
    }
    const up = () => {
      leftResizeRef.current = null
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      setLeftPanelWidth((w) => {
        localStorage.setItem('texpad_left_panel_w', String(w))
        return w
      })
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  function onLeftFilesSplitMouseDown(e: ReactMouseEvent<HTMLButtonElement>) {
    e.preventDefault()
    const el = filesSidebarRef.current
    if (!el) return
    const move = (ev: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      const h = rect.height
      if (h < 8) return
      const y = ev.clientY - rect.top
      const r = y / h
      setLeftFilesSplitRatio(Math.min(0.78, Math.max(0.22, r)))
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      setLeftFilesSplitRatio((cur) => {
        localStorage.setItem('texpad_left_files_split_ratio', String(cur))
        return cur
      })
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  function nudgeLeftFilesSplit(delta: number) {
    setLeftFilesSplitRatio((cur) => {
      const n = Math.min(0.78, Math.max(0.22, cur + delta))
      localStorage.setItem('texpad_left_files_split_ratio', String(n))
      return n
    })
  }

  function toggleFileTreeSection() {
    setFileTreeSectionExpanded((v) => {
      const n = !v
      localStorage.setItem('texpad_filetree_section_expanded', n ? '1' : '0')
      return n
    })
  }

  function toggleOutlineSection() {
    setOutlineSectionExpanded((v) => {
      const n = !v
      localStorage.setItem('texpad_outline_section_expanded', n ? '1' : '0')
      return n
    })
  }

  function onLogResizeMouseDown(e: ReactMouseEvent<HTMLButtonElement>) {
    e.preventDefault()
    logDragRef.current = { startY: e.clientY, startH: logPanelHeight }
    const move = (ev: MouseEvent) => {
      const st = logDragRef.current
      if (!st) return
      const dy = st.startY - ev.clientY
      const h = Math.min(400, Math.max(80, st.startH + dy))
      setLogPanelHeight(h)
    }
    const up = () => {
      logDragRef.current = null
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      setLogPanelHeight((h) => {
        localStorage.setItem('texpad_log_height', String(h))
        return h
      })
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  function toggleLogPanel(open: boolean) {
    setLogPanelOpen(open)
    localStorage.setItem('texpad_log_open', open ? '1' : '0')
  }

  useEffect(() => {
    if (!projectId) return
    void refreshSnapshots()
    void refreshShares()
    void refreshComments()
  }, [projectId])

  useEffect(() => {
    const ed = editorInstRef.current
    const mm = monacoRef.current
    if (!ed || !mm || !editorReady) return
    const model = ed.getModel()
    if (!model) return
    const pathComments = comments.filter((c) => c.path === activePath)
    const decos = pathComments.map((c) => {
      const sl = c.line
      const el = c.end_line ?? c.line
      const sc = c.start_col ?? 1
      const ec = c.end_col ?? model.getLineMaxColumn(el)
      return {
        range: new mm.Range(sl, sc, el, ec),
        options: {
          isWholeLine: el > sl,
          className: 'texpad-line-has-comment',
          glyphMarginClassName: 'texpad-glyph-comment',
        },
      }
    })
    commentDecorationIdsRef.current = ed.deltaDecorations(commentDecorationIdsRef.current, decos)
    return () => {
      commentDecorationIdsRef.current = ed.deltaDecorations(commentDecorationIdsRef.current, [])
    }
  }, [comments, activePath, editorReady])

  useEffect(() => {
    if (!editorReady || !viewPrefs.showEquationPreview) {
      setEquationSnippet(null)
      return
    }
    const ed = editorInstRef.current
    if (!ed) return
    const upd = () => {
      const m = ed.getModel()
      const p = ed.getPosition()
      if (!m || !p) {
        setEquationSnippet(null)
        return
      }
      setEquationSnippet(extractEquationSnippet(m, p))
    }
    upd()
    const d1 = ed.onDidChangeCursorPosition(upd)
    const d2 = ed.onDidChangeModelContent(upd)
    return () => {
      d1.dispose()
      d2.dispose()
    }
  }, [editorReady, viewPrefs.showEquationPreview, activePath])

  useEffect(() => {
    if (leftTool !== 'comments' || !editorReady) {
      setCommentSelection(null)
      return
    }
    const ed = editorInstRef.current
    if (!ed) return
    const upd = () => {
      const model = ed.getModel()
      const sel = ed.getSelection()
      if (!model || !sel || sel.isEmpty()) {
        setCommentSelection(null)
        return
      }
      const quote = model.getValueInRange(sel)
      if (!quote.trim()) {
        setCommentSelection(null)
        return
      }
      setCommentSelection({
        quote,
        startLine: sel.startLineNumber,
        endLine: sel.endLineNumber,
        startCol: sel.startColumn,
        endCol: sel.endColumn,
      })
    }
    upd()
    const d1 = ed.onDidChangeCursorSelection(upd)
    const d2 = ed.onDidChangeModelContent(upd)
    return () => {
      d1.dispose()
      d2.dispose()
    }
  }, [leftTool, editorReady, activePath])

  useEffect(() => {
    if (!viewPrefs.pdfPresentationMode) return
    const onK = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setViewPrefs((v) => {
          const n = { ...v, pdfPresentationMode: false }
          saveViewPrefs(n)
          return n
        })
      }
    }
    window.addEventListener('keydown', onK)
    return () => window.removeEventListener('keydown', onK)
  }, [viewPrefs.pdfPresentationMode])

  useEffect(() => {
    if (!editorReady || !projectId || role === 'viewer' || !activePath) return
    if (binaryPreviewKindForPath(activePath)) return
    const ed = editorInstRef.current
    const model = ed?.getModel()
    if (!ed || !model) return
    const schedule = () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = setTimeout(() => {
        if (!projectId || role === 'viewer' || !activePath) return
        const v = editorInstRef.current?.getModel()?.getValue() ?? ''
        void (async () => {
          try {
            await putProjectFile(projectId, activePath, v)
            if (collabOn && ydocRef.current) {
              const u = Y.encodeStateAsUpdate(ydocRef.current)
              await putCollabState(projectId, activePath, u).catch(() => {})
            }
          } catch {
            setMsg('自动保存失败')
            setTimeout(() => setMsg(''), 3200)
          }
        })()
      }, 2000)
    }
    const sub = model.onDidChangeContent(schedule)
    return () => {
      sub.dispose()
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [editorReady, activePath, projectId, role, collabOn])

  useEffect(() => {
    if (!editorReady || !activePath) {
      setAgentSourcePreview('')
      return
    }
    const ed = editorInstRef.current
    if (!ed) return
    const tick = () => {
      const v = ed.getModel()?.getValue() ?? ''
      setAgentSourcePreview(v.slice(0, 16000))
    }
    tick()
    const sub = ed.onDidChangeModelContent(() => {
      if (agentPreviewDebounceRef.current) window.clearTimeout(agentPreviewDebounceRef.current)
      agentPreviewDebounceRef.current = window.setTimeout(tick, 450)
    })
    const sub2 = ed.onDidChangeModel(() => {
      if (agentPreviewDebounceRef.current) window.clearTimeout(agentPreviewDebounceRef.current)
      tick()
    })
    return () => {
      if (agentPreviewDebounceRef.current) window.clearTimeout(agentPreviewDebounceRef.current)
      sub.dispose()
      sub2.dispose()
    }
  }, [editorReady, activePath])

  const patchViewPrefs = useCallback((patch: Partial<ViewPrefs>) => {
    setViewPrefs((v) => {
      const n = { ...v, ...patch }
      saveViewPrefs(n)
      return n
    })
  }, [])

  const patchAgentPrefs = useCallback((patch: Partial<AgentPrefs>) => {
    setAgentPrefs((d) => {
      const n = { ...d, ...patch }
      saveAgentPrefs(n)
      return n
    })
  }, [])

  const applySamplingPreset = useCallback((preset: AgentSamplingPreset) => {
    setAgentPrefs((d) => {
      const n = applyAgentSamplingPreset(d, preset)
      saveAgentPrefs(n)
      return n
    })
  }, [])

  const activeSamplingPreset = useMemo(() => matchAgentSamplingPreset(agentPrefs), [agentPrefs])

  const agentQuickActions = useMemo(
    () => buildAgentQuickActions(activePath, agentSourcePreview),
    [activePath, agentSourcePreview],
  )

  const mainTexOptions = useMemo(() => {
    const tex = files.map((f) => f.path).filter((p) => /\.tex$/i.test(p))
    return tex.length ? tex : files.map((f) => f.path)
  }, [files])

  const compilePrefsRef = useRef(compilePrefs)
  compilePrefsRef.current = compilePrefs

  useEffect(() => {
    if (!drawerOpen || !projectId) return
    void refreshShares()
    void refreshMembers()
  }, [drawerOpen, projectId])

  useEffect(() => {
    if (!editorReady || !projectId || role === 'viewer' || !compilePrefs.autoCompile) return
    const ed = editorInstRef.current
    const model = ed?.getModel()
    if (!ed || !model) return
    let t: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        if (!compilePrefsRef.current.autoCompile) return
        if (compilingRef.current) return
        void compileNowRef.current()
      }, 4500)
    }
    const sub = model.onDidChangeContent(schedule)
    return () => {
      sub.dispose()
      if (t) clearTimeout(t)
    }
  }, [editorReady, activePath, projectId, role, compilePrefs.autoCompile])

  if (!projectId) return null

  const readOnly = role === 'viewer'
  const breadcrumb = `${activePath || mainPath}`

  function openCommentsUi() {
    setHelpOpen(false)
    setLeftTool('comments')
    setLeftPanelOpen(true)
    localStorage.setItem('texpad_left_panel_open', '1')
  }

  cmdCtxRef.current = {
    openFind: () => setFindOpen(true),
    compile: () => void compileNowRef.current(),
    openCommentsPanel: () => openCommentsUi(),
    saveAndCompile: async () => {
      if (!projectId || role === 'viewer' || !activePath) {
        await compileNowRef.current()
        return
      }
      if (!binaryPreviewKindForPath(activePath)) {
        const v = editorInstRef.current?.getModel()?.getValue() ?? ''
        await putProjectFile(projectId, activePath, v)
        if (collabOn && ydocRef.current) {
          const u = Y.encodeStateAsUpdate(ydocRef.current)
          await putCollabState(projectId, activePath, u).catch(() => {})
        }
      }
      setMsg('已保存并开始编译')
      setTimeout(() => setMsg(''), 2200)
      await compileNowRef.current()
    },
    trackChangesStub: () => {
      void window.alert('修订追踪功能即将推出。')
    },
  }

  const viewMenuDropdown = (
    <div className="editor-file-menu editor-view-menu" role="menu">
      <div className="editor-view-menu__section">布局选项</div>
      <button
        type="button"
        role="menuitem"
        className={viewPrefs.layoutMode === 'split' ? 'is-checked' : ''}
        onClick={() => {
          patchViewPrefs({ layoutMode: 'split' })
          setTopMenu(null)
        }}
      >
        <span className="editor-view-check" aria-hidden>
          {viewPrefs.layoutMode === 'split' ? '✓' : '\u00a0'}
        </span>
        分屏视图
      </button>
      <button
        type="button"
        role="menuitem"
        className={viewPrefs.layoutMode === 'editor' ? 'is-checked' : ''}
        onClick={() => {
          patchViewPrefs({ layoutMode: 'editor' })
          setTopMenu(null)
        }}
      >
        <span className="editor-view-check" aria-hidden>
          {viewPrefs.layoutMode === 'editor' ? '✓' : '\u00a0'}
        </span>
        仅编辑器
      </button>
      <button
        type="button"
        role="menuitem"
        className={viewPrefs.layoutMode === 'pdf' ? 'is-checked' : ''}
        onClick={() => {
          patchViewPrefs({ layoutMode: 'pdf' })
          setTopMenu(null)
        }}
      >
        <span className="editor-view-check" aria-hidden>
          {viewPrefs.layoutMode === 'pdf' ? '✓' : '\u00a0'}
        </span>
        仅 PDF
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!pdfUrl}
        onClick={() => {
          if (!pdfUrl) {
            setMsg('请先编译生成 PDF')
            setTimeout(() => setMsg(''), 2200)
          } else {
            window.open(pdfUrl, '_blank', 'noopener,noreferrer')
          }
          setTopMenu(null)
        }}
      >
        <span className="editor-view-check" aria-hidden>
          {'\u00a0'}
        </span>
        在新标签页打开 PDF
      </button>
      <div className="editor-file-menu-sep" role="separator" />
      <div className="editor-view-menu__section">编辑器设置</div>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          patchViewPrefs({ showBreadcrumbs: !viewPrefs.showBreadcrumbs })
        }}
      >
        <span className="editor-view-check" aria-hidden>
          {viewPrefs.showBreadcrumbs ? '✓' : '\u00a0'}
        </span>
        显示面包屑
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          patchViewPrefs({ showEquationPreview: !viewPrefs.showEquationPreview })
        }}
      >
        <span className="editor-view-check" aria-hidden>
          {viewPrefs.showEquationPreview ? '✓' : '\u00a0'}
        </span>
        显示公式预览
      </button>
      <div className="editor-file-menu-sep" role="separator" />
      <div className="editor-view-menu__section">PDF 预览</div>
      <button
        type="button"
        role="menuitem"
        className={viewPrefs.pdfPresentationMode ? 'is-checked' : ''}
        onClick={() => {
          patchViewPrefs({ pdfPresentationMode: !viewPrefs.pdfPresentationMode })
          setTopMenu(null)
        }}
      >
        <span className="editor-view-check" aria-hidden>
          {viewPrefs.pdfPresentationMode ? '✓' : '\u00a0'}
        </span>
        演示模式（Esc 退出）
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          patchViewPrefs({ pdfZoom: Math.min(3, viewPrefs.pdfZoom * 1.15), pdfFit: 'none' })
        }}
      >
        放大
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          patchViewPrefs({ pdfZoom: Math.max(0.35, viewPrefs.pdfZoom / 1.15), pdfFit: 'none' })
        }}
      >
        缩小
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          patchViewPrefs({ pdfZoom: 1, pdfFit: 'width' })
          setTopMenu(null)
        }}
      >
        适合宽度
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          patchViewPrefs({ pdfZoom: 1, pdfFit: 'height' })
          setTopMenu(null)
        }}
      >
        适合高度
      </button>
    </div>
  )

  function insertAtCursor(text: string, caretOffsetInText?: number) {
    const ed = editorInstRef.current
    const mm = monacoRef.current
    if (!ed || !mm) return
    if (caretOffsetInText !== undefined) insertTextAndMoveCaret(ed, mm, text, caretOffsetInText)
    else insertTextAtCursor(ed, mm, text)
    ed.focus()
  }

  function runInsert(fn: () => void) {
    if (readOnly) return
    fn()
    setTopMenu(null)
  }

  const formatMenuDropdown = (
    <div className="editor-file-menu editor-format-menu" role="menu">
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() =>
          runInsert(() => {
            const ed = editorInstRef.current
            const mm = monacoRef.current
            if (ed && mm) wrapSelection(ed, mm, '\\textbf{', '}')
          })
        }
      >
        粗体 <span className="editor-menu-kbd">Ctrl+B</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() =>
          runInsert(() => {
            const ed = editorInstRef.current
            const mm = monacoRef.current
            if (ed && mm) wrapSelection(ed, mm, '\\textit{', '}')
          })
        }
      >
        斜体 <span className="editor-menu-kbd">Ctrl+I</span>
      </button>
      <div className="editor-file-menu-sep" role="separator" />
      <div className="editor-view-menu__section">列表与缩进</div>
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() =>
          runInsert(() => insertAtCursor('\\begin{itemize}\n\\item \n\\end{itemize}', '\\begin{itemize}\n\\item '.length))
        }
      >
        无序列表
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() =>
          runInsert(() =>
            insertAtCursor('\\begin{enumerate}\n\\item \n\\end{enumerate}', '\\begin{enumerate}\n\\item '.length),
          )
        }
      >
        有序列表
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() =>
          runInsert(() => {
            editorInstRef.current?.getAction('editor.action.indentLines')?.run()
          })
        }
      >
        增加缩进
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() =>
          runInsert(() => {
            editorInstRef.current?.getAction('editor.action.outdentLines')?.run()
          })
        }
      >
        减少缩进
      </button>
      <div className="editor-file-menu-sep" role="separator" />
      <div className="editor-view-menu__section">段落样式</div>
      <button type="button" role="menuitem" disabled={readOnly} onClick={() => runInsert(() => insertAtCursor('\n\n'))}>
        正文
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() =>
          runInsert(() => {
            const t = window.prompt('节标题（\\section）', '引言')
            if (t === null) return
            insertAtCursor(`\\section{${t || '未命名'}}`)
          })
        }
      >
        节（section）
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() =>
          runInsert(() => {
            const t = window.prompt('小节标题（\\subsection）', '')
            if (t === null) return
            insertAtCursor(`\\subsection{${t || '未命名'}}`)
          })
        }
      >
        小节（subsection）
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() =>
          runInsert(() => {
            const t = window.prompt('小小节标题（\\subsubsection）', '')
            if (t === null) return
            insertAtCursor(`\\subsubsection{${t || '未命名'}}`)
          })
        }
      >
        小小节（subsubsection）
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() =>
          runInsert(() => {
            const t = window.prompt('段落标题（\\paragraph）', '')
            if (t === null) return
            insertAtCursor(`\\paragraph{${t || '未命名'}}`)
          })
        }
      >
        段落（paragraph）
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() =>
          runInsert(() => {
            const t = window.prompt('子段落标题（\\subparagraph）', '')
            if (t === null) return
            insertAtCursor(`\\subparagraph{${t || '未命名'}}`)
          })
        }
      >
        子段落（subparagraph）
      </button>
    </div>
  )

  async function insertImageFromLocalFile(f: File | null) {
    if (!projectId || !f || readOnly) return
    const fd = new FormData()
    fd.append('file', f)
    fd.append('path', f.name)
    try {
      await apiForm<{ path: string }>(`/api/v1/projects/${projectId}/files/upload`, fd)
      await loadFiles()
      openTab(f.name)
      insertAtCursor(`\\includegraphics[width=\\linewidth]{${f.name}}`)
      setMsg('图片已上传并插入')
      setTimeout(() => setMsg(''), 2000)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '上传失败')
    }
  }

  const insertMenuDropdown = (
    <div className="editor-file-menu editor-insert-menu" role="menu">
      <div className="editor-insert-submenu-wrap">
        <button type="button" className="editor-insert-parent">
          数学 <span aria-hidden>▸</span>
        </button>
        <div className="editor-insert-submenu">
          <button
            type="button"
            role="menuitem"
            onClick={() => runInsert(() => insertAtCursor('$$', 1))}
          >
            行内公式（$…$）
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runInsert(() => insertAtCursor('$$\n\n$$', 3))}
          >
            行外公式（$$…$$）
          </button>
        </div>
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          if (readOnly) return
          setSymbolPaletteOpen(true)
          setTopMenu(null)
        }}
      >
        符号…
      </button>
      <div className="editor-insert-submenu-wrap">
        <button type="button" className="editor-insert-parent">
          图片 <span aria-hidden>▸</span>
        </button>
        <div className="editor-insert-submenu">
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              runInsert(() => {
                const url = window.prompt('图片 URL（将插入注释与占位 \\includegraphics，请下载到项目后替换路径）', 'https://')
                if (!url?.trim()) return
                insertAtCursor(
                  `% 网络图片：${url.trim()}\n\\includegraphics[width=\\linewidth]{figures/placeholder.png}`,
                )
              })
            }
          >
            从网站导入
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              if (readOnly) return
              setTopMenu(null)
              insertImageInputRef.current?.click()
            }}
          >
            从本机导入
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              runInsert(() => {
                const imgs = files
                  .map((x) => x.path)
                  .filter((p) => /\.(png|jpe?g|gif|svg|pdf)$/i.test(p))
                const p = window.prompt(`项目内图片路径（可用路径之一）：\n${imgs.slice(0, 30).join('\n')}`, imgs[0] || 'figure.png')
                if (!p?.trim()) return
                insertAtCursor(`\\includegraphics[width=\\linewidth]{${p.trim()}}`)
              })
            }
          >
            从本项目导入
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setTopMenu(null)
              window.alert('从其他项目导入：请打开目标项目复制图片文件后，在本项目中使用「上传文件」或「从本项目导入」。')
            }}
          >
            从其他项目导入
          </button>
        </div>
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={() =>
          runInsert(() =>
            insertAtCursor(
              '\\begin{table}[htbp]\n  \\centering\n  \\begin{tabular}{c c}\n    a & b \\\\\n  \\end{tabular}\n  \\caption{}\n  \\label{tab:}\n\\end{table}\n',
            ),
          )
        }
      >
        表格
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() =>
          runInsert(() => {
            const t = window.prompt('章节标题（\\section）', '引言')
            if (t === null) return
            insertAtCursor(`\\section{${t || '未命名'}}`)
          })
        }
      >
        标题
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() =>
          runInsert(() => {
            const k = window.prompt('文献引用键（\\cite）', 'key')
            if (!k?.trim()) return
            insertAtCursor(`\\cite{${k.trim()}}`)
          })
        }
      >
        引用
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() =>
          runInsert(() => {
            const k = window.prompt('标签（\\ref）', 'fig:')
            if (!k?.trim()) return
            insertAtCursor(`\\ref{${k.trim()}}`)
          })
        }
      >
        交叉引用
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setTopMenu(null)
          openCommentsUi()
        }}
      >
        评论（审稿）
      </button>
    </div>
  )

  const fileMenuDropdown = (
    <div className="editor-file-menu" role="menu">
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() => {
          setTopMenu(null)
          const name = window.prompt('新文件路径（可含子目录，如 chapters/intro.tex）', 'new.tex')
          if (name?.trim()) void newFile(name.trim())
        }}
      >
        新建文件
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() => {
          setTopMenu(null)
          const name = window.prompt('新文件夹名称（将创建占位文件 .texpadkeep）', 'figures')
          if (!name?.trim()) return
          void newFolder(name.trim().replace(/\/+$/, ''))
        }}
      >
        新建文件夹
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() => {
          uploadSingleInputRef.current?.click()
          setTopMenu(null)
        }}
      >
        上传文件
      </button>
      <button type="button" role="menuitem" disabled={role === 'viewer'} onClick={() => void duplicateProjectFromMenu()}>
        复制项目
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setTopMenu(null)
          selectLeftTool('snapshots')
        }}
      >
        显示历史版本
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setTopMenu(null)
          setDrawerOpen(true)
        }}
      >
        多人协作
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setTopMenu(null)
          setWordCountOpen(true)
        }}
      >
        字数统计
      </button>
      <button type="button" role="menuitem" onClick={() => void exportZip()}>
        下载源码（.zip）
      </button>
      <button type="button" role="menuitem" onClick={() => void downloadPdfLatest()}>
        下载 PDF
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setTopMenu(null)
          setSettingsModalSection('editor')
        }}
      >
        设置…
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setTopMenu(null)
          setSettingsModalSection('agent')
        }}
      >
        智能体设置…
      </button>
      <div className="editor-file-menu-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() => {
          zipInputRef.current?.click()
          setTopMenu(null)
        }}
      >
        导入 zip
      </button>
      <button type="button" role="menuitem" disabled={readOnly} onClick={() => void snapshot()}>
        创建快照
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() => {
          setTopMenu(null)
          setAgentModalOpen(true)
        }}
      >
        打开智能体对话
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setTopMenu(null)
          nav('/')
        }}
      >
        关闭项目
      </button>
    </div>
  )

  const editMenuDropdown = (
    <div className="editor-file-menu" role="menu">
      <button type="button" role="menuitem" disabled={readOnly} onClick={() => runEditorAction('editor.action.undo')}>
        撤销 <span className="editor-menu-kbd">Ctrl+Z</span>
      </button>
      <button type="button" role="menuitem" disabled={readOnly} onClick={() => runEditorAction('editor.action.redo')}>
        重做 <span className="editor-menu-kbd">Ctrl+Y</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setTopMenu(null)
          setFindOpen(true)
        }}
      >
        查找 <span className="editor-menu-kbd">Ctrl+F</span>
      </button>
      <button type="button" role="menuitem" onClick={() => runEditorAction('editor.action.selectAll')}>
        全选 <span className="editor-menu-kbd">Ctrl+A</span>
      </button>
      <div className="editor-file-menu-sep" role="separator" />
      <button type="button" role="menuitem" disabled={readOnly} onClick={() => runEditorAction('editor.action.gotoLine')}>
        跳转到行 <span className="editor-menu-kbd">Ctrl+Shift+L</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() => {
          const ed = editorInstRef.current
          const mm = monacoRef.current
          if (ed && mm) moveCursorDocumentStart(ed, mm)
          setTopMenu(null)
        }}
      >
        文档开头 <span className="editor-menu-kbd">Ctrl+Home</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() => {
          const ed = editorInstRef.current
          const mm = monacoRef.current
          if (ed && mm) moveCursorDocumentEnd(ed, mm)
          setTopMenu(null)
        }}
      >
        文档末尾 <span className="editor-menu-kbd">Ctrl+End</span>
      </button>
      <div className="editor-file-menu-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() => {
          const ed = editorInstRef.current
          const mm = monacoRef.current
          if (ed && mm) toggleLatexLineComment(ed, mm)
          setTopMenu(null)
        }}
      >
        切换行注释 <span className="editor-menu-kbd">Ctrl+/</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() => {
          const ed = editorInstRef.current
          if (ed) transformSelection(ed, (s) => s.toUpperCase())
          setTopMenu(null)
        }}
      >
        转为大写 <span className="editor-menu-kbd">Ctrl+U</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() => {
          const ed = editorInstRef.current
          if (ed) transformSelection(ed, (s) => s.toLowerCase())
          setTopMenu(null)
        }}
      >
        转为小写 <span className="editor-menu-kbd">Ctrl+Shift+U</span>
      </button>
      <button type="button" role="menuitem" disabled={readOnly} onClick={() => runEditorAction('editor.action.deleteLines')}>
        删除当前行 <span className="editor-menu-kbd">Ctrl+D</span>
      </button>
      <button type="button" role="menuitem" disabled={readOnly} onClick={() => runEditorAction('editor.action.triggerSuggest')}>
        触发补全 <span className="editor-menu-kbd">Ctrl+Space</span>
      </button>
      <div className="editor-file-menu-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        disabled={readOnly}
        onClick={() => {
          setTopMenu(null)
          void compile()
        }}
      >
        编译 <span className="editor-menu-kbd">Ctrl+Enter</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setTopMenu(null)
          openCommentsUi()
        }}
      >
        评论侧栏 <span className="editor-menu-kbd">Ctrl+J</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setTopMenu(null)
          void window.alert('修订追踪功能即将推出。')
        }}
      >
        修订追踪 <span className="editor-menu-kbd">Ctrl+Shift+A</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setTopMenu(null)
          openCommentsUi()
        }}
      >
        添加评论 <span className="editor-menu-kbd">Ctrl+Shift+C</span>
      </button>
    </div>
  )

  const helpMenuDropdown = (
    <div className="editor-file-menu" role="menu">
      <button type="button" role="menuitem" onClick={() => setTopMenu(null)}>
        文档
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setTopMenu(null)
          setHotkeysOpen(true)
        }}
      >
        快捷键
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setTopMenu(null)
          window.alert(
            '什么是 TexPad？\n\nTexPad 是在线 LaTeX 编辑与项目管理工具，支持在浏览器中写作与编译。\n\n按「确定」关闭。',
          )
        }}
      >
        什么是 TexPad
      </button>
      <button type="button" role="menuitem" onClick={() => setTopMenu(null)}>
        博客
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setTopMenu(null)
          window.alert(
            '联系我们\n\n邮箱：mobtgzhang@outlook.com\nGitHub：https://github.com/mobtgzhang\n\n按「确定」关闭。',
          )
        }}
      >
        联系我们
      </button>
    </div>
  )

  const showFilesSplitGutter = fileTreeSectionExpanded && outlineSectionExpanded
  const treePaneFlex =
    !fileTreeSectionExpanded
      ? '0 0 auto'
      : !outlineSectionExpanded
        ? '1 1 auto'
        : `${leftFilesSplitRatio} 1 0`
  const outlinePaneFlex =
    !outlineSectionExpanded
      ? '0 0 auto'
      : !fileTreeSectionExpanded
        ? '1 1 auto'
        : `${1 - leftFilesSplitRatio} 1 0`

  const sidebarInner = (
    <div className="editor-files-sidebar" ref={filesSidebarRef}>
      <div
        className="editor-files-sidebar-pane editor-files-sidebar-pane--tree"
        style={{
          flex: treePaneFlex,
          minHeight: showFilesSplitGutter ? 72 : fileTreeSectionExpanded ? 0 : undefined,
        }}
      >
        <FileTree
          files={files}
          activePath={activePath}
          mainPath={mainPath}
          readOnly={readOnly}
          panelExpanded={fileTreeSectionExpanded}
          onTogglePanel={toggleFileTreeSection}
          onOpen={openTab}
          onNewFile={(n) => void newFile(n)}
          onNewFolder={(prefix) => void newFolder(prefix)}
          onDelete={(p) => void deleteFile(p)}
          onSetMain={(p) => void setMainTex(p)}
          onRenameFile={(p) => void renameProjectFile(p)}
          onDownloadFile={(p) => void downloadProjectFile(p)}
          onImportZipClick={() => zipInputRef.current?.click()}
        />
      </div>
      {showFilesSplitGutter ? (
        <button
          type="button"
          className="editor-files-sidebar-gutter"
          role="separator"
          aria-orientation="horizontal"
          aria-label="调整文件树与文档大纲高度比例"
          tabIndex={0}
          onMouseDown={onLeftFilesSplitMouseDown}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              const step = 0.03
              nudgeLeftFilesSplit(e.key === 'ArrowUp' ? -step : step)
            }
          }}
        />
      ) : null}
      <div
        className="editor-files-sidebar-pane editor-files-sidebar-pane--outline"
        style={{
          flex: outlinePaneFlex,
          minHeight: showFilesSplitGutter ? 72 : outlineSectionExpanded ? 0 : undefined,
        }}
      >
        <OutlinePanel
          sections={outlineSections}
          activeIndex={outlineActiveIdx}
          onGoToLine={goOutlineLine}
          panelExpanded={outlineSectionExpanded}
          onTogglePanel={toggleOutlineSection}
        />
      </div>
    </div>
  )

  const leftPanelBody =
    leftTool === 'files' ? (
      sidebarInner
    ) : leftTool === 'search' ? (
      <EditorProjectSearch
        files={files}
        query={fileSearchQuery}
        onQuery={setFileSearchQuery}
        onOpenFile={(p) => openTab(p)}
      />
    ) : leftTool === 'snapshots' ? (
      <div className="editor-left-snapshots">
        <p className="editor-left-snapshots__hint">创建快照可保存当前项目文件副本，可随时恢复或删除。</p>
        <button type="button" className="editor-drawer-primary" disabled={readOnly} onClick={() => void snapshot()}>
          创建快照
        </button>
        <ul className="editor-drawer-list">
          {snapshots.map((s) => (
            <li key={s.id}>
              <span className="editor-drawer-list-label">{s.label || s.id.slice(0, 8)}</span>
              <span className="editor-left-snapshots__actions">
                <button type="button" className="editor-ft-mini" disabled={readOnly} onClick={() => void restoreSnapshot(s.id)}>
                  恢复
                </button>
                <button
                  type="button"
                  className="editor-ft-mini editor-ft-mini--danger"
                  disabled={readOnly}
                  onClick={() => void deleteSnapshot(s.id)}
                >
                  删除
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    ) : leftTool === 'plugins' ? (
      <div className="editor-left-placeholder">
        <h3 className="editor-left-placeholder-title">插件与集成</h3>
        <p className="editor-left-placeholder-text">第三方扩展与工具集成即将推出。</p>
      </div>
    ) : leftTool === 'paperclaw' ? (
      projectId ? (
        <EditorPaperclawPanel projectId={projectId} readOnly={readOnly} />
      ) : null
    ) : leftTool === 'comments' ? (
      <EditorCommentsPanel
        readOnly={readOnly}
        activePath={activePath}
        selection={commentSelection}
        comments={comments}
        onSubmit={(b) => void submitCommentWithSelection(b)}
        onJump={jumpToComment}
      />
    ) : (
      <div className="editor-left-agent-host">
        <EditorAgentPanel
          readOnly={readOnly}
          messages={agentMessages}
          input={agentInput}
          onInput={setAgentInput}
          sending={agentSending}
          onSend={() => void sendAgentMessage()}
          pendingImages={agentPendingImages}
          onPendingImages={setAgentPendingImages}
          title="自进化智能体"
          showWelcomeChrome={agentWelcomeChrome}
          emptyHint="在下方描述目标或问题；可附带图片。智能体会结合项目上下文与工具链作答，并可在设置中调整模型与采样。"
          inputPlaceholder="想对当前项目做什么？"
          quickActions={agentQuickActions}
        />
      </div>
    )

  const editorBlock = (
    <div className="editor-pane">
      <div className="editor-tabs" role="tablist" aria-label="打开的文件">
        {openTabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={t === activePath}
            className={t === activePath ? 'tab-on' : ''}
            onClick={() => setActivePath(t)}
          >
            <span className="editor-tab-label">{t}</span>
            <span
              role="button"
              tabIndex={0}
              className="editor-tab-close"
              onClick={(e) => closeTab(t, e)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  closeTab(t, e as unknown as ReactMouseEvent)
                }
              }}
              aria-label={`关闭 ${t}`}
            >
              ×
            </span>
          </button>
        ))}
      </div>
      <div className="editor-monaco-stack">
        <div className="editor-monaco-wrap">
          <Editor
            height="100%"
            theme={
              isKnownEditorTheme(editorPrefs.editorColorTheme)
                ? editorPrefs.editorColorTheme
                : DEFAULT_EDITOR_COLOR_THEME
            }
            path="_texpad_"
            beforeMount={beforeMount}
            onMount={onMount}
            options={{ automaticLayout: true }}
          />
          {binaryPreviewKind ? (
            <div className="editor-binary-preview-wrap">
              {binaryPreviewErr ? (
                <div className="editor-binary-preview-err">{binaryPreviewErr}</div>
              ) : binaryPreviewUrl ? (
                binaryPreviewKind === 'image' ? (
                  <img src={binaryPreviewUrl} alt="" className="editor-binary-preview-img" />
                ) : (
                  <iframe title="file-pdf" src={binaryPreviewUrl} className="editor-binary-preview-pdf" />
                )
              ) : (
                <div className="editor-binary-preview-loading">加载预览…</div>
              )}
            </div>
          ) : null}
        </div>
        <EditorFindBar
          editor={editorInstRef.current}
          monacoApi={monacoRef.current}
          open={findOpen}
          onClose={() => setFindOpen(false)}
        />
        <EditorSymbolPalette
          open={symbolPaletteOpen}
          onClose={() => setSymbolPaletteOpen(false)}
          onPick={(latex) => {
            if (readOnly) return
            insertAtCursor(latex)
          }}
        />
      </div>
    </div>
  )

  const pdfPresentationActive = viewPrefs.pdfPresentationMode && Boolean(pdfUrl)
  const pdfCanvasClass =
    `editor-pdf-canvas${viewPrefs.pdfFit === 'width' ? ' editor-pdf-canvas--fit-w' : ''}${viewPrefs.pdfFit === 'height' ? ' editor-pdf-canvas--fit-h' : ''}${pdfPresentationActive ? ' editor-pdf-canvas--presentation' : ''}`
  const pdfDarkInvert = appUiTheme === 'dark' && viewPrefs.pdfInvertInDarkMode && editorPrefs.pdfViewer === 'in_app'

  const pdfBlock = (
    <div className="editor-preview">
      <div className={pdfCanvasClass}>
        {pdfUrl ? (
          editorPrefs.pdfViewer === 'in_app' ? (
            <div
              className="editor-pdf-scaled"
              style={{
                transformOrigin: 'top center',
                transform: viewPrefs.pdfFit === 'none' ? `scale(${viewPrefs.pdfZoom})` : 'scale(1)',
                filter: pdfDarkInvert ? 'invert(1) hue-rotate(180deg)' : undefined,
              }}
            >
              <iframe title="pdf" src={pdfUrl} className="editor-pdf-iframe" />
            </div>
          ) : (
            <div className="editor-pdf-browser-hint">
              <p className="editor-pdf-browser-hint__text">已选择在浏览器中查看 PDF。</p>
              <a className="editor-pdf-browser-hint__link" href={pdfUrl} target="_blank" rel="noreferrer">
                在新标签页打开 PDF
              </a>
            </div>
          )
        ) : (
          <div className="editor-pdf-placeholder">编译成功后在此预览 PDF</div>
        )}
      </div>
    </div>
  )

  return (
    <div
      className={`editor-shell ${narrow ? 'editor-shell--narrow' : ''}${pdfPresentationActive ? ' editor-shell--pdf-presentation' : ''}`}
    >
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        className="sr-only"
        aria-hidden
        onChange={(e) => {
          void importZip(e.target.files?.[0] || null)
          e.target.value = ''
        }}
      />
      <input
        ref={uploadSingleInputRef}
        type="file"
        className="sr-only"
        aria-hidden
        onChange={(e) => {
          void uploadSingleProjectFile(e.target.files?.[0] || null)
          e.target.value = ''
        }}
      />
      <input
        ref={insertImageInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-hidden
        onChange={(e) => {
          void insertImageFromLocalFile(e.target.files?.[0] || null)
          e.target.value = ''
        }}
      />

      <div className="editor-chrome-top" ref={chromeTopRef}>
        <EditorTopBar
          projectName={projectName}
          role={role}
          collabLabel={awarenessLabel}
          topMenu={topMenu}
          setTopMenu={setTopMenu}
          fileMenu={fileMenuDropdown}
          editMenu={editMenuDropdown}
          insertMenu={insertMenuDropdown}
          viewMenu={viewMenuDropdown}
          formatMenu={formatMenuDropdown}
          helpMenu={helpMenuDropdown}
          onCollaboration={() => {
            setDrawerOpen(true)
            setTopMenu(null)
          }}
          collaborationDisabled={false}
        />
      </div>

      <EditorSubToolbar
        sidebarCollapsed={!leftPanelOpen}
        onToggleSidebar={toggleLeftPanel}
        hideSidebarToggle={narrow}
        breadcrumb={breadcrumb}
        onBreadcrumbRename={readOnly ? undefined : () => void renameActiveFile()}
        editorMode={editorMode}
        onEditorMode={setEditorMode}
        readOnly={readOnly}
        onSave={() => void save()}
        onJumpError={jumpToLogLine}
        jumpErrorDisabled={!compileLog}
        onToggleLog={() => toggleLogPanel(!logPanelOpen)}
        logOpen={logPanelOpen}
        compiling={compilingUi}
        compilePrefs={compilePrefs}
        onCompilePrefs={setCompilePrefsPersist}
        onRecompile={() => void compile()}
        onRecompileFromScratch={() => void compile({ clean: true })}
        showBreadcrumb={viewPrefs.showBreadcrumbs}
      />

      {agentProposals.length > 0 ? (
        <div className="editor-agent-proposals-banner" role="status">
          <span className="editor-agent-proposals-banner__text">
            智能体建议修改 {agentProposals.length} 个文件（尚未写入项目，可对比后接受或撤销）
          </span>
          <span className="editor-agent-proposals-banner__actions">
            <button
              type="button"
              className="editor-agent-proposals-banner__btn"
              onClick={() => setAgentProposalPanelOpen(true)}
              disabled={readOnly}
            >
              查看前后对比
            </button>
            <button
              type="button"
              className="editor-agent-proposals-banner__btn editor-agent-proposals-banner__btn--primary"
              onClick={() => void acceptAgentProposals()}
              disabled={readOnly}
            >
              全部接受
            </button>
            <button type="button" className="editor-agent-proposals-banner__btn" onClick={rejectAgentProposals}>
              全部撤销
            </button>
          </span>
        </div>
      ) : null}

      {!narrow && viewPrefs.showEquationPreview && equationSnippet ? (
        <div className="editor-equation-preview" role="status" aria-live="polite">
          <span className="editor-equation-preview__label">公式预览</span>
          <code className="editor-equation-preview__code">{equationSnippet}</code>
        </div>
      ) : null}

      {narrow && (
        <div className="editor-mobile-bar" role="tablist" aria-label="移动端视图">
          <button
            type="button"
            className={mobilePane === 'files' ? 'is-on' : ''}
            onClick={() => setMobilePane('files')}
          >
            文件
          </button>
          <button
            type="button"
            className={mobilePane === 'code' ? 'is-on' : ''}
            onClick={() => setMobilePane('code')}
          >
            编辑
          </button>
          <button
            type="button"
            className={mobilePane === 'pdf' ? 'is-on' : ''}
            onClick={() => setMobilePane('pdf')}
          >
            PDF
          </button>
        </div>
      )}

      <div className="editor-work">
        {!narrow && (
          <div className="editor-left-chrome" ref={leftChromeRef}>
            <EditorLeftRail
              activeTool={leftTool}
              panelOpen={leftPanelOpen}
              onTool={selectLeftTool}
              onTogglePanel={toggleLeftPanel}
              helpOpen={helpOpen}
              onToggleHelp={() => setHelpOpen((h) => !h)}
              onCloseFlyouts={() => setHelpOpen(false)}
              onOpenSettingsModal={() => {
                setHelpOpen(false)
                setSettingsModalSection('editor')
              }}
              onHelpDoc={() => setHelpOpen(false)}
              onHelpAbout={() => {
                setHelpOpen(false)
                window.alert(
                  '什么是 TexPad？\n\nTexPad 是在线 LaTeX 编辑与项目管理工具，支持在浏览器中写作与编译。\n\n按「确定」关闭。',
                )
              }}
              onHelpBlog={() => setHelpOpen(false)}
              onHelpContact={() => {
                setHelpOpen(false)
                window.alert(
                  '联系我们\n\n邮箱：mobtgzhang@outlook.com\nGitHub：https://github.com/mobtgzhang\n\n按「确定」关闭。',
                )
              }}
              onHelpHotkeys={() => {
                setHelpOpen(false)
                setHotkeysOpen(true)
              }}
            />
            <div
              className={`editor-left-panel ${!leftPanelOpen ? 'editor-left-panel--collapsed' : ''}`}
              style={leftPanelOpen ? { width: leftPanelWidth } : undefined}
            >
              {leftPanelOpen ? leftPanelBody : null}
            </div>
          </div>
        )}

        {!narrow && leftPanelOpen && (
          <div
            className="editor-left-outer-gutter"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整文件树与编辑区宽度"
            tabIndex={0}
            onMouseDown={onLeftPanelResizeMouseDown}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault()
                setLeftPanelWidth((w) => {
                  const n = e.key === 'ArrowLeft' ? Math.max(180, w - 12) : Math.min(560, w + 12)
                  localStorage.setItem('texpad_left_panel_w', String(n))
                  return n
                })
              }
            }}
          />
        )}

        <div className="editor-center" ref={splitRef}>
          {((!narrow && viewPrefs.layoutMode !== 'pdf') || (narrow && mobilePane === 'code')) && (
            <div
              className="editor-split-left"
              style={{
                flex: narrow
                  ? '1 1 auto'
                  : viewPrefs.layoutMode === 'split'
                    ? `${splitRatio} 1 0`
                    : '1 1 0',
                minWidth: 200,
                display: !narrow && viewPrefs.layoutMode === 'pdf' ? 'none' : undefined,
              }}
            >
              {editorBlock}
            </div>
          )}
          {!narrow && viewPrefs.layoutMode === 'split' && (
            <div
              className="editor-split-gutter"
              role="separator"
              aria-orientation="vertical"
              aria-label="调整编辑区与 PDF 宽度"
              tabIndex={0}
              onMouseDown={onSplitMouseDown}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault()
                  setSplitRatio((r) => {
                    const n = e.key === 'ArrowLeft' ? Math.max(0.18, r - 0.02) : Math.min(0.82, r + 0.02)
                    localStorage.setItem('texpad_split_ratio', String(n))
                    return n
                  })
                }
              }}
            />
          )}
          {((!narrow && viewPrefs.layoutMode !== 'editor') || (narrow && mobilePane === 'pdf')) && (
            <div
              className="editor-split-right"
              style={{
                flex: narrow ? '1 1 auto' : viewPrefs.layoutMode === 'split' ? `${1 - splitRatio} 1 0` : '1 1 0',
                minWidth: 200,
                display: !narrow && viewPrefs.layoutMode === 'editor' ? 'none' : undefined,
              }}
            >
              {pdfBlock}
            </div>
          )}
        </div>

        {(!narrow || mobilePane === 'files') && narrow && (
          <div className="editor-mobile-files">{sidebarInner}</div>
        )}
      </div>

      <div className={`editor-log-dock ${logPanelOpen ? 'is-open' : ''}`} style={{ height: logPanelOpen ? logPanelHeight : 0 }}>
        <button
          type="button"
          className="editor-log-handle"
          onMouseDown={onLogResizeMouseDown}
          aria-label="拖拽调整日志高度"
        />
        <div className="editor-log-head">
          <span>编译日志</span>
          <span className="editor-log-head-actions">
            <button
              type="button"
              className="editor-log-copy"
              onClick={() => {
                if (!compileLog) return
                void navigator.clipboard.writeText(compileLog).then(
                  () => setMsg('已复制编译日志'),
                  () => setMsg('复制失败，请手动全选复制'),
                )
                window.setTimeout(() => setMsg(''), 2500)
              }}
              disabled={!compileLog}
            >
              复制全文
            </button>
            <button type="button" onClick={() => toggleLogPanel(false)} aria-label="折叠日志">
              ▼
            </button>
          </span>
        </div>
        <pre className="editor-log-body">{compileLog || '编译日志将显示在这里。'}</pre>
      </div>

      {msg && <div className="editor-toast" role="status">{msg}</div>}

      <EditorSettingsModal
        open={settingsModalSection !== null}
        initialSection={settingsModalSection ?? 'editor'}
        onClose={() => setSettingsModalSection(null)}
        themePref={themePrefState}
        onThemePref={applyEditorThemePref}
        engine={engine}
        onEngine={setEngine}
        readOnly={readOnly}
        prefs={editorPrefs}
        onPrefsChange={(p) => setEditorPrefs(p)}
        projectId={projectId}
        agentPrefs={agentPrefs}
        onPatchAgentPrefs={patchAgentPrefs}
        onSamplingPreset={applySamplingPreset}
        activeSamplingPreset={activeSamplingPreset}
        compilePrefs={compilePrefs}
        onCompilePrefsChange={setCompilePrefsPersist}
        mainTexPath={mainPath}
        mainTexOptions={mainTexOptions}
        onMainTexPath={(p) => void setMainTex(p)}
        viewPrefs={viewPrefs}
        onPatchViewPrefs={patchViewPrefs}
        appUiTheme={appUiTheme}
      />

      {agentModalOpen ? (
        <>
          <div
            className="editor-settings-scrim editor-agent-modal-scrim"
            aria-hidden
            onClick={() => setAgentModalOpen(false)}
          />
          <div
            className="editor-agent-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="editor-agent-modal-title"
          >
            <div className="editor-agent-modal__head">
              <h2 id="editor-agent-modal-title" className="editor-agent-modal__title">
                智能体对话
              </h2>
              <button
                type="button"
                className="editor-settings-close"
                onClick={() => setAgentModalOpen(false)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className="editor-agent-modal__body">
              <EditorAgentPanel
                readOnly={readOnly}
                messages={agentMessages}
                input={agentInput}
                onInput={setAgentInput}
                sending={agentSending}
                onSend={() => void sendAgentMessage()}
                pendingImages={agentPendingImages}
                onPendingImages={setAgentPendingImages}
                showWelcomeChrome={agentWelcomeChrome}
                emptyHint="在下方描述目标或问题；可附带图片。智能体会结合项目上下文与工具链作答，并可在设置中调整模型与采样。"
                inputPlaceholder="想对当前项目做什么？"
                quickActions={agentQuickActions}
              />
            </div>
          </div>
        </>
      ) : null}

      {agentProposalPanelOpen && agentProposals.length > 0 ? (
        <>
          <div
            className="editor-settings-scrim"
            aria-hidden
            onClick={() => setAgentProposalPanelOpen(false)}
          />
          <div
            className="editor-agent-proposals-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="editor-agent-proposals-title"
          >
            <div className="editor-agent-proposals-dialog__head">
              <h2 id="editor-agent-proposals-title" className="editor-agent-proposals-dialog__title">
                智能体修改对比
              </h2>
              <button
                type="button"
                className="editor-settings-close"
                onClick={() => setAgentProposalPanelOpen(false)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className="editor-agent-proposals-dialog__body">
              {agentProposals.map((fp) => {
                const cap = 24_000
                const b = fp.before.length > cap ? `${fp.before.slice(0, cap)}\n\n…（已截断）` : fp.before
                const a = fp.after.length > cap ? `${fp.after.slice(0, cap)}\n\n…（已截断）` : fp.after
                return (
                  <details key={fp.path} className="editor-agent-proposals-file" open>
                    <summary className="editor-agent-proposals-file__path">{fp.path}</summary>
                    <div className="editor-agent-proposals-diffgrid">
                      <div className="editor-agent-proposals-diffcol">
                        <div className="editor-agent-proposals-difflabel">修改前</div>
                        <pre className="editor-agent-proposals-pre">{b}</pre>
                      </div>
                      <div className="editor-agent-proposals-diffcol">
                        <div className="editor-agent-proposals-difflabel">修改后</div>
                        <pre className="editor-agent-proposals-pre">{a}</pre>
                      </div>
                    </div>
                  </details>
                )
              })}
            </div>
            <div className="editor-agent-proposals-dialog__foot">
              <button
                type="button"
                className="editor-drawer-primary"
                disabled={readOnly}
                onClick={() => void acceptAgentProposals()}
              >
                全部接受并写入
              </button>
              <button type="button" className="editor-agent-proposals-banner__btn" onClick={rejectAgentProposals}>
                全部撤销
              </button>
            </div>
          </div>
        </>
      ) : null}

      {wordCountOpen ? (
        <>
          <div className="editor-settings-scrim" aria-hidden onClick={() => setWordCountOpen(false)} />
          <div className="editor-wordcount-dialog" role="dialog" aria-modal="true" aria-labelledby="wc-title">
            <div className="editor-wordcount-dialog__head">
              <h2 id="wc-title" className="editor-wordcount-dialog__title">
                字数统计
              </h2>
              <button type="button" className="editor-settings-close" onClick={() => setWordCountOpen(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="editor-wordcount-dialog__body">
              <p className="editor-wordcount-path">{activePath || '—'}</p>
              {(() => {
                const v = editorInstRef.current?.getModel()?.getValue() ?? ''
                const lines = v.length === 0 ? 0 : v.split('\n').length
                const chars = v.length
                const noSpace = v.replace(/\s/g, '').length
                const words = v.trim() ? v.trim().split(/\s+/).length : 0
                return (
                  <ul className="editor-wordcount-list">
                    <li>
                      <span>行数</span> <strong>{lines}</strong>
                    </li>
                    <li>
                      <span>字数（按空白分词）</span> <strong>{words}</strong>
                    </li>
                    <li>
                      <span>字符（含空格）</span> <strong>{chars}</strong>
                    </li>
                    <li>
                      <span>字符（不含空格）</span> <strong>{noSpace}</strong>
                    </li>
                  </ul>
                )
              })()}
            </div>
          </div>
        </>
      ) : null}

      <EditorSideDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        role={role}
        shares={shares}
        members={members}
        membersBusy={membersBusy}
        onRefreshMembers={() => void refreshMembers()}
        onAddMember={(em, mr) => addProjectMember(em, mr)}
        onRemoveMember={(uid) => removeProjectMember(uid)}
        onCreateGuestLink={() => createGuestCollaborationLink()}
        onRevokeShare={(tok) => void revokeShare(tok)}
      />

      <EditorHotkeysModal open={hotkeysOpen} onClose={() => setHotkeysOpen(false)} />
    </div>
  )
}

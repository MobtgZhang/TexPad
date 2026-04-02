const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')

/** 与 `api()` 一致：空 `VITE_API_BASE` 时用当前页面 origin（含协议与 host） */
export function apiHttpOrigin(): string {
  const b = BASE
  if (!b) return `${window.location.protocol}//${window.location.host}`
  try {
    return new URL(b).origin
  } catch {
    return `${window.location.protocol}//${window.location.host}`
  }
}

/** 编译通知等 WebSocket，与 REST 同源，避免分域名部署时连错主机 */
export function apiWebSocketOrigin(): string {
  const u = new URL(apiHttpOrigin())
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return u.origin
}

export function getToken(): string | null {
  return localStorage.getItem('texpad_token')
}

export function setToken(t: string | null) {
  if (t) localStorage.setItem('texpad_token', t)
  else localStorage.removeItem('texpad_token')
}

function headers(init?: HeadersInit): HeadersInit {
  const h: Record<string, string> = { Accept: 'application/json' }
  const t = getToken()
  if (t) h.Authorization = `Bearer ${t}`
  return { ...h, ...(init as Record<string, string> | undefined) }
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    const err = (data as { error?: string })?.error || res.statusText
    throw new Error(err)
  }
  return data as T
}

export async function api<T>(path: string, opt: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...opt, headers: headers(opt.headers) })
  return parseResponse<T>(res)
}

/** POST multipart (do not set Content-Type; browser sets boundary). */
export async function apiForm<T>(path: string, form: FormData): Promise<T> {
  const h: Record<string, string> = { Accept: 'application/json' }
  const t = getToken()
  if (t) h.Authorization = `Bearer ${t}`
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: h, body: form })
  return parseResponse<T>(res)
}

export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(`${BASE}${path}`, { headers: headers() })
  if (!res.ok) throw new Error(await res.text())
  return res.blob()
}

/** 2xx with empty or JSON body; throws Error with server message */
export async function apiAgentModels(
  projectId: string,
  body: { llm_base_url?: string; llm_api_key?: string },
): Promise<{ models: string[]; error?: string }> {
  return api(`/api/v1/projects/${projectId}/agent/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function apiOk(path: string, opt: RequestInit = {}): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { ...opt, headers: headers(opt.headers) })
  if (res.ok) return
  const text = await res.text()
  let msg = res.statusText
  if (text) {
    try {
      const j = JSON.parse(text) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      msg = text
    }
  }
  throw new Error(msg)
}

/** GET collab Yjs state; null if 204 / empty */
export async function getCollabState(projectId: string, filePath: string): Promise<Uint8Array | null> {
  const res = await fetch(
    `${BASE}/api/v1/projects/${projectId}/collab/state?path=${encodeURIComponent(filePath)}`,
    { headers: headers() },
  )
  if (res.status === 204) return null
  if (!res.ok) throw new Error(await res.text())
  const buf = await res.arrayBuffer()
  if (buf.byteLength === 0) return null
  return new Uint8Array(buf)
}

export async function putCollabState(projectId: string, filePath: string, data: Uint8Array): Promise<void> {
  const h = headers({ 'Content-Type': 'application/octet-stream' }) as Record<string, string>
  const res = await fetch(
    `${BASE}/api/v1/projects/${projectId}/collab/state?path=${encodeURIComponent(filePath)}`,
    { method: 'PUT', headers: h, body: new Blob([data as BlobPart]) },
  )
  if (!res.ok) throw new Error(await res.text())
}

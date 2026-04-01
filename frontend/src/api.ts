const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')

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

export async function api<T>(path: string, opt: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...opt, headers: headers(opt.headers) })
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

export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(`${BASE}${path}`, { headers: headers() })
  if (!res.ok) throw new Error(await res.text())
  return res.blob()
}

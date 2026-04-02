'use strict'

const http = require('http')
const { URL } = require('url')
const jwt = require('jsonwebtoken')
const WebSocket = require('ws')
const { setupWSConnection } = require('y-websocket/bin/utils.cjs')

const host = process.env.HOST || '0.0.0.0'
const port = parseInt(process.env.PORT || '18475', 10)
const jwtSecret = process.env.TEXPAD_JWT_SECRET || ''
const apiBase = (process.env.TEXPAD_API_URL || 'http://127.0.0.1:18473').replace(/\/$/, '')

function parseRoom (name) {
  const pad = '='.repeat((4 - (name.length % 4)) % 4)
  const b64 = name.replace(/-/g, '+').replace(/_/g, '/') + pad
  const json = Buffer.from(b64, 'base64').toString('utf8')
  const o = JSON.parse(json)
  if (!o || typeof o.p !== 'string' || typeof o.f !== 'string') {
    throw new Error('bad room')
  }
  return { projectId: o.p, filePath: o.f }
}

function safePath (p) {
  if (!p || typeof p !== 'string' || p.includes('..')) return null
  const t = p.trim().replace(/^\/+/, '')
  if (t === '' || t.startsWith('..')) return null
  return t
}

async function verifyProjectAccess (bearer, projectId) {
  const res = await fetch(`${apiBase}/api/v1/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${bearer}` }
  })
  if (!res.ok) return { ok: false }
  const j = await res.json()
  const role = j.role || ''
  if (role === 'viewer') return { ok: false, reason: 'viewer' }
  return { ok: true, role }
}

const wss = new WebSocket.Server({ noServer: true })

wss.on('connection', (ws, req, docName) => {
  setupWSConnection(ws, req, { docName })
})

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('texpad-collab')
})

server.on('upgrade', async (request, socket, head) => {
  if (!jwtSecret) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n')
    socket.destroy()
    return
  }

  let url
  try {
    url = new URL(request.url || '/', 'http://localhost')
  } catch {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
    socket.destroy()
    return
  }

  const token = url.searchParams.get('token')
  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }

  let payload
  try {
    payload = jwt.verify(token, jwtSecret)
  } catch {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }

  const roomEncoded = decodeURIComponent((url.pathname || '/').replace(/^\//, ''))
  if (!roomEncoded) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
    socket.destroy()
    return
  }

  let projectId
  let filePath
  try {
    const r = parseRoom(roomEncoded)
    projectId = r.projectId
    filePath = safePath(r.filePath)
    if (!filePath) throw new Error('path')
  } catch {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
    socket.destroy()
    return
  }

  try {
    const access = await verifyProjectAccess(token, projectId)
    if (!access.ok) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
  } catch (e) {
    console.error('collab auth', e)
    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
    socket.destroy()
    return
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    const fakeReq = { url: '/' + roomEncoded + (url.search || '') }
    wss.emit('connection', ws, fakeReq, roomEncoded)
  })
})

server.listen(port, host, () => {
  console.log(`texpad-collab on ${host}:${port} api=${apiBase}`)
})

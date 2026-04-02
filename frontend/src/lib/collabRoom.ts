/** Room id for y-websocket (must match services/collab/server.cjs). */
export function makeCollabRoom(projectId: string, filePath: string): string {
  const s = JSON.stringify({ p: projectId, f: filePath })
  const utf8 = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < utf8.length; i++) bin += String.fromCharCode(utf8[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

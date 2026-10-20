// A stand-in cf-dam for the Mac install check: pairs the agent after a few polls, records the folders
// it offers, and keeps it paused so it never scans. Writes what it saw to the file given as argv[2].
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'

const out = process.argv[2]
const seen = { paired: false, folders: null, volumes: null, platform: null }
let polls = 0

createServer(async (req, res) => {
  let text = ''
  for await (const chunk of req) text += chunk
  const body = text ? JSON.parse(text) : {}
  const send = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }
  switch (`${req.method} ${req.url}`) {
    case 'POST /api/agent/pair/start':
      seen.platform = body.platform
      return send(200, { deviceCode: 'device', userCode: 'TEST-CODE', interval: 1, expiresIn: 600, verificationUrl: 'http://localhost:8799/sources' })
    case 'POST /api/agent/pair/poll':
      // Long enough for the check to read the code off the status page first.
      if (++polls < 20) return send(202, { status: 'pending' })
      seen.paired = true
      return send(200, { status: 'approved', apiKey: 'stub-key', sourceId: 'stub-source' })
    case 'POST /api/agent/folders':
      seen.folders = body.folders
      seen.volumes = body.volumes
      writeFileSync(out, JSON.stringify(seen, null, 2))
      return send(200, { ok: true })
    case 'POST /api/agent/heartbeat':
      return send(200, { paused: true, rescan: false })
    case 'GET /api/agent/config':
      return send(200, { source: { id: 'stub-source', name: 'Mac check', paused: true }, roots: [], knownRoots: [], scanIntervalMinutes: 60, defaultExcludes: [] })
    default:
      return send(404, { error: 'not_found' })
  }
}).listen(8799)

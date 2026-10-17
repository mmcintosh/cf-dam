/** The status page on the LAN (http://nas:8790): the pairing code, and what the agent is doing. */
import { createServer, type Server } from 'node:http'
import type { Progress } from './pipeline.ts'

export interface StatusView {
  name: string
  version: string
  url: string
  phase: 'starting' | 'pairing' | 'idle' | 'scanning' | 'paused' | 'error'
  pairingCode: string | null
  progress: Progress
  done: number
  failed: number
  lastScanAt: string | null
  message: string | null
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export function page(v: StatusView): string {
  const p = v.progress
  const body =
    v.phase === 'pairing'
      ? `<p>Open <a href="${esc(v.url)}/sources?code=${esc(v.pairingCode)}">${esc(v.url)}/sources</a> and enter this code:</p><p class="code">${esc(v.pairingCode)}</p>`
      : `<dl>
          <dt>State</dt><dd>${esc(v.phase)}${v.phase === 'scanning' && p.root ? ` · ${esc(p.root)}` : ''}</dd>
          <dt>Indexed</dt><dd>${v.done.toLocaleString()} photos</dd>
          <dt>This scan</dt><dd>${p.found.toLocaleString()} found · ${p.queued.toLocaleString()} new or changed · ${p.sent.toLocaleString()} sent · ${p.failed.toLocaleString()} failed · ${p.missing.toLocaleString()} missing</dd>
          ${p.current ? `<dt>Now</dt><dd>${esc(p.current)}</dd>` : ''}
          <dt>Last full scan</dt><dd>${esc(v.lastScanAt ?? 'not yet')}</dd>
          ${p.lastError ? `<dt>Last error</dt><dd>${esc(p.lastError)}</dd>` : ''}
        </dl>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="10"><title>cf-dam agent · ${esc(v.name)}</title>
<style>
  :root { color-scheme: dark; --bg: #090b10; --text: #eceef3; --muted: #9aa2b1; --accent: #8aa4ff; }
  @media (prefers-color-scheme: light) { :root { color-scheme: light; --bg: #f5f6f9; --text: #10131a; --muted: #5a6273; --accent: #4a68f0; } }
  body { margin: 0; padding: 32px 16px; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 1.3rem; margin: 0 0 4px; } .muted { color: var(--muted); }
  .code { font: 700 2.4rem ui-monospace, monospace; letter-spacing: 0.12em; color: var(--accent); }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; } dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
  a { color: var(--accent); }
</style></head><body><main>
<h1>cf-dam agent · ${esc(v.name)}</h1>
<p class="muted">Version ${esc(v.version)} · indexing for <a href="${esc(v.url)}">${esc(v.url)}</a>. Originals are only read, never changed.</p>
${v.message ? `<p>${esc(v.message)}</p>` : ''}
${body}
</main></body></html>`
}

export function serveStatus(port: number, view: () => StatusView): Server {
  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
      return
    }
    if (req.url === '/status.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(view()))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }).end(page(view()))
  })
  server.listen(port)
  return server
}

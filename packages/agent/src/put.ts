/**
 * PUT a part to the bucket with Node's own http, not fetch. Node's fetch gives up when the answer hasn't
 * begun 300 seconds after the request started, and sending the body counts: a 64 MiB part on a line slower
 * than about 1.8 Mbit/s could never be sent. Here only a stall ends it: nothing sent or received for a while.
 */
import http from 'node:http'
import https from 'node:https'
import type { FetchLike } from './api.ts'

/** Nothing taken from us for this long while sending: the line is stuck, not slow. */
export const STALL_MS = 3 * 60_000
/**
 * Once all of it is handed over, the system's send buffer (a few MB) still drains to the line, and then the
 * bucket answers: at 1 Mbit/s, 4 MB is half a minute. A line stuck at the very end is found after this.
 */
export const ANSWER_MS = 15 * 60_000

const agents = { http: new http.Agent({ keepAlive: true }), https: new https.Agent({ keepAlive: true }) }

export function bucketPut({ stallMs = STALL_MS, answerMs = ANSWER_MS } = {}): FetchLike {
  return (url, init) =>
    new Promise<Response>((resolve, reject) => {
      const target = new URL(url)
      const secure = target.protocol === 'https:'
      const body = toBytes(init?.body)
      const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined), 'content-length': String(body.byteLength) }
      const req = (secure ? https : http).request(target, { method: init?.method ?? 'PUT', headers, agent: secure ? agents.https : agents.http }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const answer = new Headers()
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) answer.set(k, Array.isArray(v) ? v.join(', ') : v)
          const status = res.statusCode ?? 0
          const text = Buffer.concat(chunks)
          resolve(new Response(status === 204 || status === 304 ? null : text, { status, headers: answer }))
        })
        res.on('error', reject)
      })
      // The socket's idle time, reset by each write that completes and each read: the part goes in small
      // pieces (one big write would count as idle until all of it was sent), so a slow line is never cut off.
      const stuck = (ms: number) => () => req.destroy(new Error(`Nothing moved for ${Math.round(ms / 1000)} seconds`))
      req.setTimeout(stallMs, stuck(stallMs))
      req.on('error', reject)
      let at = 0
      const more = () => {
        while (at < body.byteLength) {
          const piece = body.subarray(at, at + PIECE)
          at += piece.byteLength
          if (!req.write(piece)) return void req.once('drain', more)
        }
        req.setTimeout(answerMs, stuck(answerMs))
        req.end()
      }
      more()
    })
}

const PIECE = 64 * 1024

function toBytes(body: unknown): Uint8Array {
  if (body === undefined || body === null) return new Uint8Array()
  if (body instanceof Uint8Array) return body
  if (typeof body === 'string') return new TextEncoder().encode(body)
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  throw new Error('bucketPut sends bytes only')
}

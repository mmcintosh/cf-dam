import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { bucketPut } from '../src/put.ts'

let server: http.Server | undefined
const shut = () =>
  new Promise<void>((r) => {
    if (!server) return r()
    server.closeAllConnections()
    server.close(() => r())
  })
afterEach(shut)

function listen(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler)
  return new Promise((r) => server!.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(server!.address() as AddressInfo).port}/part`)))
}

describe('sending a part to the bucket', () => {
  it('keeps going on a slow line however long the part takes, so long as bytes move', async () => {
    let received = 0
    const url = await listen((req, res) => {
      // About 6 MB a second, for more than the system's buffers hold: the part takes the stall limit many times over.
      req.on('data', (c: Buffer) => {
        received += c.length
        req.pause()
        setTimeout(() => req.resume(), 10)
      })
      req.on('end', () => {
        res.writeHead(200, { ETag: '"abc"' })
        res.end()
      })
    })
    const started = Date.now()
    const res = await bucketPut({ stallMs: 300, answerMs: 10_000 })(url, { method: 'PUT', headers: { 'x-amz-checksum-sha256': 'x' }, body: new Uint8Array(24 * 1024 * 1024) })
    expect(Date.now() - started).toBeGreaterThan(1200)
    expect(res.status).toBe(200)
    expect(res.headers.get('ETag')).toBe('"abc"')
    expect(received).toBe(24 * 1024 * 1024)
  })

  it('gives up when nothing moves, and passes on what the bucket said', async () => {
    // Stuck part-way: the bucket stops taking bytes.
    let url = await listen((req) => req.pause())
    const started = Date.now()
    await expect(bucketPut({ stallMs: 300, answerMs: 60_000 })(url, { method: 'PUT', body: new Uint8Array(64 * 1024 * 1024) })).rejects.toThrow(/Nothing moved/)
    expect(Date.now() - started).toBeLessThan(10_000)
    // Stuck at the end: everything sent, no answer.
    await shut()
    url = await listen((req) => req.resume())
    await expect(bucketPut({ stallMs: 300, answerMs: 500 })(url, { method: 'PUT', body: new Uint8Array(1024) })).rejects.toThrow(/Nothing moved/)
    await shut()
    url = await listen((req, res) => {
      req.resume()
      req.on('end', () => {
        res.writeHead(403)
        res.end('<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>')
      })
    })
    const res = await bucketPut({ stallMs: 300, answerMs: 500 })(url, { method: 'PUT', body: new Uint8Array(10) })
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('<Code>AccessDenied</Code>')
  })
})

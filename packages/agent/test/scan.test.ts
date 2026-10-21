import { chmodSync, mkdirSync, mkdtempSync, renameSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { globToRegExp, matcher, plan, quickHash, walk } from '../src/scan.ts'
import type { FileRow } from '../src/state.ts'

describe('globs', () => {
  it('match names and paths the way people expect', () => {
    expect(globToRegExp('*.lrdata').test('Catalog Previews.lrdata')).toBe(true)
    expect(globToRegExp('._*').test('._IMG_1.CR3')).toBe(true)
    expect(globToRegExp('Exports/**').test('Exports/2019/a.jpg')).toBe(true)
    const m = matcher(['@eaDir', '#recycle', 'Exports/**'], [])
    expect(m.skipDir('2019/@eaDir')).toBe(true)
    expect(m.keepFile('#recycle/a.jpg')).toBe(false)
    expect(m.keepFile('Exports/web/a.jpg')).toBe(false)
    expect(m.keepFile('2019/a.jpg')).toBe(true)
    expect(matcher([], ['*.cr3']).keepFile('a.jpg')).toBe(false)
  })
})

describe('walking and planning', () => {
  it('finds photos, skips Synology clutter, and plans only what changed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'scan-'))
    mkdirSync(join(root, '2019', '@eaDir'), { recursive: true })
    writeFileSync(join(root, '2019', 'a.jpg'), 'aaaa')
    writeFileSync(join(root, '2019', 'b.CR3'), 'bbbbbb')
    writeFileSync(join(root, '2019', 'notes.txt'), 'x')
    writeFileSync(join(root, '2019', '@eaDir', 'SYNOPHOTO_THUMB_XL.jpg'), 'thumb')
    const { found, unreadable } = await walk(root, ['@eaDir'])
    expect(unreadable).toEqual([])
    expect([...found.keys()].sort()).toEqual(['2019/a.jpg', '2019/b.CR3'])

    const row = (path: string, extra: Partial<FileRow> = {}): FileRow => ({
      root_id: 'r', path, size: found.get(path)?.size ?? 1, mtime_ms: found.get(path)?.mtimeMs ?? 1, quick_hash: 'q', asset_id: 'x', status: 'done', error: null, attempts: 0, ...extra,
    })
    const known = new Map([['2019/a.jpg', row('2019/a.jpg')], ['gone.jpg', row('gone.jpg')]])
    const p = plan(found, known)
    expect(p.work.map((w) => w.file.path)).toEqual(['2019/b.CR3'])
    expect(p.gone.map((g) => g.path)).toEqual(['gone.jpg'])

    // A touched file is work again; one that failed three times is left alone until it changes.
    utimesSync(join(root, '2019', 'a.jpg'), new Date(), new Date(Date.now() + 5000))
    const { found: touched } = await walk(root, ['@eaDir'])
    expect(plan(touched, known).work.map((w) => w.file.path).sort()).toEqual(['2019/a.jpg', '2019/b.CR3'])
    const failing = new Map([['2019/b.CR3', row('2019/b.CR3', { status: 'error', attempts: 3 })]])
    expect(plan(found, failing).work.map((w) => w.file.path)).toEqual(['2019/a.jpg'])
  })

  it('doesn’t take files in a folder it couldn’t read for deleted', async () => {
    if (process.getuid?.() === 0) return // root reads everything
    const root = mkdtempSync(join(tmpdir(), 'scan-'))
    mkdirSync(join(root, '2019'))
    mkdirSync(join(root, '2020'))
    writeFileSync(join(root, '2019', 'a.jpg'), 'aaaa')
    writeFileSync(join(root, '2020', 'b.jpg'), 'bbbb')
    chmodSync(join(root, '2020'), 0o000)
    try {
      const { found, unreadable, denied } = await walk(root, [])
      expect([...found.keys()]).toEqual(['2019/a.jpg'])
      expect(unreadable).toEqual(['2020'])
      // Refused by the system, so the agent can say what to allow.
      expect(denied).toEqual(['2020'])
      const row = (path: string): FileRow => ({ root_id: 'r', path, size: 4, mtime_ms: 1, quick_hash: 'q', asset_id: 'x', status: 'done', error: null, attempts: 0 })
      const known = new Map(['2019/gone.jpg', '2020/b.jpg', '2020x/c.jpg'].map((p) => [p, row(p)]))
      expect(plan(found, known, unreadable).gone.map((g) => g.path)).toEqual(['2019/gone.jpg', '2020x/c.jpg'])
    } finally {
      chmodSync(join(root, '2020'), 0o755)
    }
  })

  it('fingerprints by size, head and tail, so a renamed file keeps its fingerprint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qh-'))
    const big = Buffer.alloc(3 * 1024 * 1024, 7)
    big[big.length - 1] = 9
    writeFileSync(join(dir, 'a.nef'), big)
    const before = await quickHash(join(dir, 'a.nef'), big.length)
    renameSync(join(dir, 'a.nef'), join(dir, 'renamed.nef'))
    expect(await quickHash(join(dir, 'renamed.nef'), big.length)).toBe(before)
    big[big.length - 1] = 8
    writeFileSync(join(dir, 'edited.nef'), big)
    expect(await quickHash(join(dir, 'edited.nef'), big.length)).not.toBe(before)
    expect(before).toMatch(/^[0-9a-f]{64}$/)
  })
})

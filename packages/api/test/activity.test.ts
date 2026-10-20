import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PAGE_SIZE } from '../src/routes/activity'
import { ADMIN, cookiesFrom, createHarness, createUser, setUpAdmin, signIn, type Harness } from './harness'

let h: Harness
let admin: string

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

interface Entry {
  id: string
  at: string
  action: string
  actor: { id: string; name: string | null; email: string | null } | null
  target: { type: string; id: string | null; name: string | null; email: string | null } | null
  details: Record<string, unknown> | null
}
interface Page {
  entries: Entry[]
  next: string | null
}

const page = async (query = '', cookie = admin) => (await (await h.fetch(`/api/activity${query}`, { cookie })).json()) as Page

describe('the activity log', () => {
  it('is for administrators only', async () => {
    await createUser(h, admin, { name: 'Ed', email: 'ed@example.com', password: 'editor password 1', roles: ['editor'] })
    const editor = cookiesFrom(await signIn(h, 'ed@example.com', 'editor password 1'))
    expect((await h.fetch('/api/activity', { cookie: editor })).status).toBe(403)
    expect((await h.fetch('/api/activity', { cookie: admin })).status).toBe(200)
  })

  it('names who did it and to whom, newest first, even after the person is deleted', async () => {
    const id = await createUser(h, admin, { name: 'Ed', email: 'ed@example.com', password: 'editor password 1', roles: ['editor'] })
    await signIn(h, 'ed@example.com', 'wrong wrong wrong')
    const { entries } = await page()
    expect(entries[0]).toMatchObject({ action: 'auth.sign_in_failed', actor: { id, name: 'Ed' }, target: { type: 'user', email: 'ed@example.com' } })
    expect(entries.find((e) => e.action === 'user.created')).toMatchObject({ actor: { email: ADMIN.email }, target: { id, name: 'Ed' } })
    const times = entries.map((e) => e.at)
    expect([...times].sort().reverse()).toEqual(times)

    await h.fetch(`/api/users/${id}`, { method: 'DELETE', cookie: admin })
    const after = await page()
    expect(after.entries[0]).toMatchObject({ action: 'user.deleted', target: { id, name: null }, details: { email: 'ed@example.com' } })
  })

  it('filters by kind and by person', async () => {
    const id = await createUser(h, admin, { name: 'Ed', email: 'ed@example.com', password: 'editor password 1', roles: ['editor'] })
    await signIn(h, 'ed@example.com', 'editor password 1')
    await signIn(h, ADMIN.email, ADMIN.password)

    const signIns = await page('?kind=sign-ins')
    expect(signIns.entries.length).toBeGreaterThan(0)
    expect(signIns.entries.every((e) => e.action.startsWith('auth.'))).toBe(true)
    const accounts = await page('?kind=accounts')
    expect(accounts.entries.map((e) => e.action)).toContain('user.created')
    expect(accounts.entries.every((e) => /^(account|user|policy|api_key|setup)\./.test(e.action))).toBe(true)

    const ed = await page(`?person=${id}`)
    expect(ed.entries.map((e) => e.action).sort()).toEqual(['auth.signed_in', 'user.created'])
    expect((await h.fetch('/api/activity?kind=everything', { cookie: admin })).status).toBe(400)
  })

  it('pages through everything without gaps or repeats', async () => {
    const now = Date.now()
    const statements = Array.from({ length: PAGE_SIZE + 7 }, (_, i) =>
      h.env.DB.prepare("INSERT INTO activity_log (id, user_id, action, created_at) VALUES (?, NULL, 'asset.uploaded', ?)")
        // Pairs share a timestamp, so the id breaks ties.
        .bind(`e${String(i).padStart(3, '0')}`, new Date(now - Math.floor(i / 2) * 1000).toISOString()),
    )
    await h.env.DB.batch(statements)
    const first = await page('?kind=photos')
    expect(first.entries).toHaveLength(PAGE_SIZE)
    expect(first.next).toBeTruthy()
    const second = await page(`?kind=photos&before=${encodeURIComponent(first.next!)}`)
    expect(second.next).toBeNull()
    const ids = [...first.entries, ...second.entries].map((e) => e.id)
    expect(new Set(ids).size).toBe(PAGE_SIZE + 7)
  })
})

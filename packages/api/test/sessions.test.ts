import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN, cookiesFrom, createHarness, createUser, json, setUpAdmin, type Harness } from './harness'

let h: Harness
let admin: string

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'

interface SessionJson {
  id: string
  userAgent: string | null
  ipAddress: string | null
  current: boolean
}

async function signInFrom(userAgent: string, ip?: string): Promise<string> {
  const res = await h.fetch('/api/auth/sign-in/email', { ...json({ email: ADMIN.email, password: ADMIN.password }), headers: { 'User-Agent': userAgent }, ip })
  expect(res.status).toBe(200)
  return cookiesFrom(res)
}

const list = async (cookie: string) => ((await (await h.fetch('/api/me/sessions', { cookie })).json()) as { sessions: SessionJson[] }).sessions
const signedIn = async (cookie: string) => (await h.fetch('/api/me', { cookie })).status === 200

describe('where you are signed in', () => {
  it('lists your sessions with browser and address, marking this one, and no tokens', async () => {
    const laptop = await signInFrom(SAFARI, '198.51.100.9')
    const sessions = await list(admin)
    expect(sessions).toHaveLength(2)
    expect(sessions.filter((s) => s.current)).toHaveLength(1)
    expect(sessions.find((s) => !s.current)).toMatchObject({ userAgent: SAFARI, ipAddress: '198.51.100.9' })
    expect(JSON.stringify(sessions)).not.toContain(laptop.split('=')[1]!.split('.')[0]!)
  })

  it('signs out one other browser, but not this one or someone else’s', async () => {
    const laptop = await signInFrom(SAFARI)
    const other = (await list(admin)).find((s) => !s.current)!
    const current = (await list(admin)).find((s) => s.current)!
    expect((await h.fetch(`/api/me/sessions/${current.id}`, { method: 'DELETE', cookie: admin })).status).toBe(409)
    expect((await h.fetch(`/api/me/sessions/${other.id}`, { method: 'DELETE', cookie: admin })).status).toBe(204)
    expect(await signedIn(laptop)).toBe(false)
    expect(await signedIn(admin)).toBe(true)

    await createUser(h, admin, { name: 'Ed', email: 'ed@example.com', password: 'editor password 1', roles: ['editor'] })
    const ed = cookiesFrom(await h.fetch('/api/auth/sign-in/email', json({ email: 'ed@example.com', password: 'editor password 1' })))
    const edSession = (await list(ed))[0]!
    expect((await h.fetch(`/api/me/sessions/${edSession.id}`, { method: 'DELETE', cookie: admin })).status).toBe(404)
    expect(await signedIn(ed)).toBe(true)
  })

  it('signs out everywhere else in one go', async () => {
    const one = await signInFrom(SAFARI)
    const two = await signInFrom('curl/8')
    const res = await h.fetch('/api/me/sessions/sign-out-others', { method: 'POST', cookie: admin })
    expect(await res.json()).toEqual({ ended: 2 })
    expect(await signedIn(one)).toBe(false)
    expect(await signedIn(two)).toBe(false)
    expect(await list(admin)).toHaveLength(1)
    const logged = await h.env.DB.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE action = 'account.signed_out_elsewhere'").first('n')
    expect(logged).toBe(1)
  })

  it('needs a browser session, not an API key', async () => {
    const { key } = (await (await h.fetch('/api/me/api-keys', { ...json({ name: 'k', scopes: ['assets:read'] }), cookie: admin })).json()) as { key: string }
    expect((await h.fetch('/api/me/sessions', { headers: { Authorization: `Bearer ${key}` } })).status).toBe(400)
  })
})

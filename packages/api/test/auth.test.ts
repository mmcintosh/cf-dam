import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN, cookiesFrom, createHarness, json, setUpAdmin, signIn, type Harness } from './harness'

let h: Harness
afterEach(async () => h.dispose())

describe('first-run setup', () => {
  beforeEach(async () => {
    h = await createHarness()
  })

  it('reports setup as needed on an empty database', async () => {
    const res = await h.fetch('/api/setup')
    expect(await res.json()).toEqual({ needed: true, tokenRequired: false, blocked: false })
  })

  it('creates the first admin, signs them in, and closes', async () => {
    const cookie = await setUpAdmin(h)
    const me = await h.fetch('/api/me', { cookie })
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({ email: ADMIN.email, roles: ['admin'], via: 'session' })

    const again = await h.fetch('/api/setup', json({ ...ADMIN, email: 'second@example.com' }))
    expect(again.status).toBe(409)
    expect(await (await h.fetch('/api/setup')).json()).toMatchObject({ needed: false })
  })

  it('rejects a short password and an invalid email', async () => {
    expect((await h.fetch('/api/setup', json({ ...ADMIN, password: 'short' }))).ok).toBe(false)
    expect((await h.fetch('/api/setup', json({ ...ADMIN, email: 'nope' }))).status).toBe(400)
  })
})

describe('setup token', () => {
  it('is required when configured, and checked', async () => {
    h = await createHarness({ SETUP_TOKEN: 'let-me-in' })
    expect((await h.fetch('/api/setup', json(ADMIN))).status).toBe(403)
    expect((await h.fetch('/api/setup', json({ ...ADMIN, token: 'wrong' }))).status).toBe(403)
    expect((await h.fetch('/api/setup', json({ ...ADMIN, token: 'let-me-in' }))).status).toBe(200)
  })
})

describe('sessions', () => {
  beforeEach(async () => {
    h = await createHarness()
    await setUpAdmin(h)
  })

  it('signs in with email and password', async () => {
    const res = await signIn(h, ADMIN.email, ADMIN.password)
    expect(res.status).toBe(200)
    const me = await h.fetch('/api/me', { cookie: cookiesFrom(res) })
    expect(await me.json()).toMatchObject({ email: ADMIN.email })
  })

  it('refuses a wrong password', async () => {
    expect((await signIn(h, ADMIN.email, 'not the password at all')).status).toBe(401)
  })

  it('refuses public sign-up while registration is closed', async () => {
    const res = await h.fetch(
      '/api/auth/sign-up/email',
      json({ name: 'Mallory', email: 'mallory@example.com', password: 'a long enough password' }),
    )
    expect(res.ok).toBe(false)
    const row = await h.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'mallory@example.com'").first<{ n: number }>()
    expect(row?.n).toBe(0)
  })

  it('stops a session working once sign-out runs', async () => {
    const cookie = cookiesFrom(await signIn(h, ADMIN.email, ADMIN.password))
    await h.fetch('/api/auth/sign-out', { method: 'POST', cookie })
    expect((await h.fetch('/api/me', { cookie })).status).toBe(401)
  })

  it('returns 401 without credentials', async () => {
    expect((await h.fetch('/api/me')).status).toBe(401)
  })
})

describe('rate limiting', () => {
  it('limits credential attempts per IP and leaves other IPs alone', async () => {
    h = await createHarness()
    await setUpAdmin(h)
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await signIn(h, ADMIN.email, 'wrong password!!', '203.0.113.7')).status)
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
    expect(statuses[5]).toBe(429)
    expect((await signIn(h, ADMIN.email, ADMIN.password, '203.0.113.8')).status).toBe(200)
  })
})

describe('CSRF', () => {
  it('refuses a cross-origin form post', async () => {
    h = await createHarness()
    const res = await h.fetch('/api/setup', {
      method: 'POST',
      body: 'name=x',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example' },
    })
    expect(res.status).toBe(403)
  })
})

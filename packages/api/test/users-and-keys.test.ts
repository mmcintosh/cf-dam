import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cookiesFrom, createHarness, json, setUpAdmin, signIn, type Harness } from './harness'

let h: Harness
let admin: string

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

const VIEWER = { name: 'Val Viewer', email: 'val@example.com', password: 'viewer password 123', roles: ['viewer'] }

async function createViewer(): Promise<{ id: string; cookie: string }> {
  const res = await h.fetch('/api/users', { ...json(VIEWER), cookie: admin })
  expect(res.status).toBe(201)
  const { user } = (await res.json()) as { user: { id: string } }
  return { id: user.id, cookie: cookiesFrom(await signIn(h, VIEWER.email, VIEWER.password)) }
}

describe('user administration', () => {
  it('creates a user with roles, who can then sign in', async () => {
    const viewer = await createViewer()
    const me = await h.fetch('/api/me', { cookie: viewer.cookie })
    expect(await me.json()).toMatchObject({ email: VIEWER.email, roles: ['viewer'], permissions: ['apikeys:manage', 'assets:read'] })
  })

  it('does not sign the admin in as the user they create', async () => {
    await createViewer()
    const me = await h.fetch('/api/me', { cookie: admin })
    expect(await me.json()).toMatchObject({ roles: ['admin'] })
  })

  it('refuses a duplicate email and unknown roles', async () => {
    await createViewer()
    expect((await h.fetch('/api/users', { ...json(VIEWER), cookie: admin })).status).toBe(409)
    expect((await h.fetch('/api/users', { ...json({ ...VIEWER, email: 'x@example.com', roles: ['god'] }), cookie: admin })).status).toBe(400)
  })

  it('forbids non-admins from managing users', async () => {
    const viewer = await createViewer()
    expect((await h.fetch('/api/users', { cookie: viewer.cookie })).status).toBe(403)
  })

  it('deactivation ends sessions and blocks sign-in', async () => {
    const viewer = await createViewer()
    const res = await h.fetch(`/api/users/${viewer.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: false }), cookie: admin })
    expect(res.status).toBe(200)
    expect((await h.fetch('/api/me', { cookie: viewer.cookie })).status).toBe(401)
    expect((await signIn(h, VIEWER.email, VIEWER.password)).ok).toBe(false)
  })

  it('keeps at least one active admin', async () => {
    const { users } = (await (await h.fetch('/api/users', { cookie: admin })).json()) as { users: { id: string }[] }
    const self = users[0]!.id
    const demote = await h.fetch(`/api/users/${self}`, { method: 'PATCH', body: JSON.stringify({ roles: ['viewer'] }), cookie: admin })
    expect(demote.status).toBe(409)
    const deactivate = await h.fetch(`/api/users/${self}`, { method: 'PATCH', body: JSON.stringify({ isActive: false }), cookie: admin })
    expect(deactivate.status).toBe(409)
  })
})

describe('API keys', () => {
  it('issues a key once, authenticates with it, and stops after revocation', async () => {
    const created = await h.fetch('/api/me/api-keys', { ...json({ name: 'NAS agent', scopes: ['assets:read', 'assets:upload'] }), cookie: admin })
    expect(created.status).toBe(201)
    const { key, record } = (await created.json()) as { key: string; record: { id: string; prefix: string } }
    expect(key.startsWith('cfdam_')).toBe(true)
    expect(key.startsWith(record.prefix)).toBe(true)

    const viaBearer = await h.fetch('/api/me', { headers: { Authorization: `Bearer ${key}` } })
    expect(await viaBearer.json()).toMatchObject({ via: 'api_key', permissions: ['assets:read', 'assets:upload'] })
    const viaHeader = await h.fetch('/api/me', { headers: { 'X-API-Key': key } })
    expect(viaHeader.status).toBe(200)

    const list = (await (await h.fetch('/api/me/api-keys', { cookie: admin })).json()) as { keys: { lastUsedAt: string | null }[] }
    expect(list.keys[0]!.lastUsedAt).not.toBeNull()
    expect(JSON.stringify(list)).not.toContain(key)

    expect((await h.fetch(`/api/me/api-keys/${record.id}`, { method: 'DELETE', cookie: admin })).status).toBe(204)
    expect((await h.fetch('/api/me', { headers: { Authorization: `Bearer ${key}` } })).status).toBe(401)
  })

  it('narrows to the key’s scopes: an admin key without users:manage cannot list users', async () => {
    const { key } = (await (await h.fetch('/api/me/api-keys', { ...json({ name: 'read only', scopes: ['assets:read'] }), cookie: admin })).json()) as { key: string }
    expect((await h.fetch('/api/users', { headers: { Authorization: `Bearer ${key}` } })).status).toBe(403)
  })

  it('refuses scopes the user does not hold', async () => {
    const viewer = await createViewer()
    const res = await h.fetch('/api/me/api-keys', { ...json({ name: 'escalate', scopes: ['users:manage'] }), cookie: viewer.cookie })
    expect(res.status).toBe(400)
  })

  it('refuses to mint a key with a key', async () => {
    const { key } = (await (await h.fetch('/api/me/api-keys', { ...json({ name: 'k', scopes: ['apikeys:manage'] }), cookie: admin })).json()) as { key: string }
    const res = await h.fetch('/api/me/api-keys', { ...json({ name: 'k2', scopes: ['apikeys:manage'] }), headers: { Authorization: `Bearer ${key}` } })
    expect(res.status).toBe(403)
  })

  it('rejects an unknown or expired key without falling back to the session', async () => {
    expect((await h.fetch('/api/me', { headers: { Authorization: 'Bearer cfdam_notarealkeyatall0000000000000000000000' }, cookie: admin })).status).toBe(401)
    const { key, record } = (await (await h.fetch('/api/me/api-keys', { ...json({ name: 'old', scopes: ['assets:read'] }), cookie: admin })).json()) as { key: string; record: { id: string } }
    await h.env.DB.prepare("UPDATE api_keys SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(record.id).run()
    expect((await h.fetch('/api/me', { headers: { 'X-API-Key': key } })).status).toBe(401)
  })
})

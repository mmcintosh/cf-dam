import { base32 } from '@better-auth/utils/base32'
import { createOTP } from '@better-auth/utils/otp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDamApi } from '../src/index'
import { ADMIN, cookiesFrom, createHarness, json, setUpAdmin, signIn, type Harness } from './harness'
import { SoftPasskey } from './webauthn'

let h: Harness
let admin: string

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

const EDITOR = { name: 'Ed Editor', email: 'ed@example.com', password: 'temporary password 1', roles: ['editor'] }
const OWN = 'my very own password'

const post = (path: string, body: unknown, cookie: string) => h.fetch(path, { ...json(body), cookie })
const put = (path: string, body: unknown, cookie: string) => h.fetch(path, { method: 'PUT', body: JSON.stringify(body), cookie })
const me = async (cookie: string) => (await (await h.fetch('/api/me', { cookie })).json()) as { setup: string | null }

/** Cookies from a response, added to the ones we already had (a later name replaces an earlier one). */
function merge(cookie: string, response: Response): string {
  const map = new Map(cookie.split('; ').filter(Boolean).map((c) => [c.slice(0, c.indexOf('=')), c]))
  for (const c of cookiesFrom(response).split('; ').filter(Boolean)) map.set(c.slice(0, c.indexOf('=')), c)
  return [...map.values()].join('; ')
}

async function createEditor(): Promise<string> {
  expect((await post('/api/users', EDITOR, admin)).status).toBe(201)
  return cookiesFrom(await signIn(h, EDITOR.email, EDITOR.password))
}

/** Turn codes on for whoever `cookie` is; returns their refreshed cookie. */
async function enableCodes(cookie: string, password: string): Promise<string> {
  const enabled = await post('/api/auth/two-factor/enable', { password }, cookie)
  const { totpURI } = (await enabled.json()) as { totpURI: string }
  const secret = new TextDecoder().decode(base32.decode(new URL(totpURI).searchParams.get('secret')!))
  const verified = await post('/api/auth/two-factor/verify-totp', { code: await createOTP(secret).totp() }, cookie)
  expect(verified.status).toBe(200)
  return merge(cookie, verified)
}

async function addPasskey(device: SoftPasskey, cookie: string): Promise<void> {
  const options = await h.fetch('/api/auth/passkey/generate-register-options', { cookie })
  expect(options.status).toBe(200)
  const res = await h.fetch('/api/auth/passkey/verify-registration', {
    ...json({ response: device.register((await options.json()) as { challenge: string; user: { id: string } }) }),
    cookie: merge(cookie, options),
  })
  expect(res.status).toBe(200)
}

async function passkeySignIn(device: SoftPasskey): Promise<Response> {
  const options = await h.fetch('/api/auth/passkey/generate-authenticate-options')
  return h.fetch('/api/auth/passkey/verify-authentication', {
    ...json({ response: device.authenticate((await options.json()) as { challenge: string }) }),
    cookie: cookiesFrom(options),
  })
}

describe('a temporary password', () => {
  it('must be replaced before anything else, and not with itself', async () => {
    const editor = await createEditor()
    expect(await me(editor)).toMatchObject({ setup: 'password' })
    const blocked = await h.fetch('/api/albums', { cookie: editor })
    expect(blocked.status).toBe(403)
    expect(await blocked.json()).toEqual({ error: 'setup_required', setup: 'password' })

    const same = await post('/api/auth/change-password', { currentPassword: EDITOR.password, newPassword: EDITOR.password }, editor)
    expect(same.status).toBe(400)
    expect(await same.json()).toMatchObject({ code: 'SAME_PASSWORD' })

    const changed = await post('/api/auth/change-password', { currentPassword: EDITOR.password, newPassword: OWN, revokeOtherSessions: true }, editor)
    expect(changed.status).toBe(200)
    const after = merge(editor, changed)
    expect(await me(after)).toMatchObject({ setup: null })
    expect((await h.fetch('/api/albums', { cookie: after })).status).toBe(200)
  })

  it('keeps every API route but /api/me closed until it is replaced', async () => {
    const editor = await createEditor()
    // Mounted at /api by src/fetch.ts. Sign-in, first-run setup, client galleries, client invites and the health
    // check are before sign-in; GET /api/me is how the pages learn there's a step to do.
    const open = new Set(['GET /me', 'GET /health', 'GET /'])
    const routes = createDamApi()
      .routes.filter((r) => r.method !== 'ALL' && !/^\/(auth|setup|public|invites)(\/|$)/.test(r.path) && !open.has(`${r.method} ${r.path}`))
    expect(routes.length).toBeGreaterThan(40)
    const answered: string[] = []
    for (const route of routes) {
      const path = '/api' + route.path.replace(/:([a-zA-Z]+)(\{[^}]*\})?/g, 'x').replace(/\*$/, 'x')
      const res = await h.fetch(path, { method: route.method, cookie: editor, ...(route.method === 'GET' ? {} : { body: '{}' }) })
      if (res.status !== 403) answered.push(`${route.method} ${route.path} → ${res.status}`)
    }
    expect(answered).toEqual([])
    // Every route, one after another: slow on a busy machine.
  }, 120_000)
})

describe('two-factor sign-in required', () => {
  it("won't be turned on by someone it would lock into setup", async () => {
    const refused = await put('/api/users/policy', { twoFactorRequiredFor: 'admins' }, admin)
    expect(refused.status).toBe(409)
    admin = await enableCodes(admin, ADMIN.password)
    expect((await put('/api/users/policy', { twoFactorRequiredFor: 'everyone' }, admin)).status).toBe(200)
    expect(await (await h.fetch('/api/users/policy', { cookie: admin })).json()).toEqual({ twoFactorRequiredFor: 'everyone' })
    expect((await put('/api/users/policy', { twoFactorRequiredFor: 'some' }, admin)).status).toBe(400)
  })

  it('sends someone without a code or passkey to set one up; a passkey counts', async () => {
    let editor = await createEditor()
    editor = merge(editor, await post('/api/auth/change-password', { currentPassword: EDITOR.password, newPassword: OWN }, editor))
    admin = await enableCodes(admin, ADMIN.password)
    expect((await put('/api/users/policy', { twoFactorRequiredFor: 'everyone' }, admin)).status).toBe(200)

    expect(await me(editor)).toMatchObject({ setup: 'two_factor' })
    expect((await h.fetch('/api/albums', { cookie: editor })).status).toBe(403)
    await addPasskey(new SoftPasskey(), editor)
    expect(await me(editor)).toMatchObject({ setup: null })
    expect((await h.fetch('/api/albums', { cookie: editor })).status).toBe(200)
  })

  it('applies to administrators only when set to them', async () => {
    let editor = await createEditor()
    editor = merge(editor, await post('/api/auth/change-password', { currentPassword: EDITOR.password, newPassword: OWN }, editor))
    admin = await enableCodes(admin, ADMIN.password)
    expect((await put('/api/users/policy', { twoFactorRequiredFor: 'admins' }, admin)).status).toBe(200)
    expect(await me(editor)).toMatchObject({ setup: null })
  })

  it('refuses a password-only sign-in when the second factor is a passkey', async () => {
    let editor = await createEditor()
    editor = merge(editor, await post('/api/auth/change-password', { currentPassword: EDITOR.password, newPassword: OWN }, editor))
    const device = new SoftPasskey()
    await addPasskey(device, editor)
    admin = await enableCodes(admin, ADMIN.password)
    expect((await put('/api/users/policy', { twoFactorRequiredFor: 'everyone' }, admin)).status).toBe(200)

    const sessions = async () => h.env.DB.prepare("SELECT COUNT(*) AS n FROM session s JOIN users u ON u.id = s.user_id WHERE u.email = 'ed@example.com'").first('n')
    const before = await sessions()
    const refused = await signIn(h, EDITOR.email, OWN)
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ code: 'USE_PASSKEY' })
    expect(cookiesFrom(refused)).toBe('')
    expect(await sessions()).toBe(before)
    // A wrong password still just says it's wrong.
    expect((await signIn(h, EDITOR.email, 'not it at all')).status).toBe(401)
    expect((await passkeySignIn(device)).status).toBe(200)
  })

  it("stops the API keys of someone who hasn't set it up", async () => {
    let editor = await createEditor()
    editor = merge(editor, await post('/api/auth/change-password', { currentPassword: EDITOR.password, newPassword: OWN }, editor))
    const { key } = (await (await post('/api/me/api-keys', { name: 'script', scopes: ['assets:read'] }, editor)).json()) as { key: string }
    const withKey = () => h.fetch('/api/albums', { headers: { Authorization: `Bearer ${key}` } })
    expect((await withKey()).status).toBe(200)
    admin = await enableCodes(admin, ADMIN.password)
    expect((await put('/api/users/policy', { twoFactorRequiredFor: 'everyone' }, admin)).status).toBe(200)
    expect((await withKey()).status).toBe(401)
  })
})

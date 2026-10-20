import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN, cookiesFrom, createHarness, json, setUpAdmin, type Harness } from './harness'
import { SoftPasskey } from './webauthn'

let h: Harness
let admin: string

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

/** Cookies from a response, added to the ones we already had (a later name replaces an earlier one). */
function merge(cookie: string, response: Response): string {
  const map = new Map(cookie.split('; ').filter(Boolean).map((c) => [c.slice(0, c.indexOf('=')), c]))
  for (const c of cookiesFrom(response).split('; ').filter(Boolean)) map.set(c.slice(0, c.indexOf('=')), c)
  return [...map.values()].join('; ')
}

async function addPasskey(device: SoftPasskey, cookie = admin): Promise<Response> {
  const options = await h.fetch('/api/auth/passkey/generate-register-options', { cookie })
  if (!options.ok) return options
  const withChallenge = merge(cookie, options)
  return h.fetch('/api/auth/passkey/verify-registration', {
    ...json({ response: device.register((await options.json()) as { challenge: string; user: { id: string } }), name: '1Password' }),
    cookie: withChallenge,
  })
}

/** Sign in with the passkey and nothing else; returns the response and its cookies. */
async function signInWith(device: SoftPasskey, verified = true): Promise<{ response: Response; cookie: string }> {
  const options = await h.fetch('/api/auth/passkey/generate-authenticate-options')
  expect(options.status).toBe(200)
  const response = await h.fetch('/api/auth/passkey/verify-authentication', {
    ...json({ response: device.authenticate((await options.json()) as { challenge: string }, verified) }),
    cookie: cookiesFrom(options),
  })
  return { response, cookie: cookiesFrom(response) }
}

describe('passkeys', () => {
  it('adds one to a fresh session and signs in with it alone', async () => {
    const device = new SoftPasskey()
    expect((await addPasskey(device)).status).toBe(200)
    const listed = (await (await h.fetch('/api/auth/passkey/list-user-passkeys', { cookie: admin })).json()) as { name: string; backedUp: boolean }[]
    expect(listed.map((p) => p.name)).toEqual(['1Password'])

    const { response, cookie } = await signInWith(device)
    expect(response.status).toBe(200)
    const me = (await (await h.fetch('/api/me', { cookie })).json()) as { email: string }
    expect(me.email).toBe(ADMIN.email)
  })

  it('refuses a passkey that did not confirm the person (no fingerprint, face or unlock)', async () => {
    const device = new SoftPasskey()
    await addPasskey(device)
    const { response, cookie } = await signInWith(device, false)
    expect(response.status).toBe(401)
    expect(((await response.json()) as { message: string }).message).toContain('confirm it is you')
    expect((await h.fetch('/api/me', { cookie })).status).toBe(401)
  })

  it('refuses a passkey made for another site, and one nobody added', async () => {
    const elsewhere = new SoftPasskey('localhost', 'https://evil.example')
    // The plugin answers a wrong origin with a 500; what matters is that nothing is stored.
    expect((await addPasskey(elsewhere)).ok).toBe(false)
    expect(await h.env.DB.prepare('SELECT COUNT(*) AS n FROM passkey').first('n')).toBe(0)
    const stranger = (await signInWith(new SoftPasskey())).response
    expect(stranger.status).toBe(401)
    expect(((await stranger.json()) as { code: string }).code).toBe('PASSKEY_NOT_FOUND')
  })

  it('needs a recent sign-in to add one', async () => {
    const old = new Date(Date.now() - 20 * 60_000).toISOString()
    await h.env.DB.prepare('UPDATE session SET created_at = ?').bind(old).run()
    const response = await addPasskey(new SoftPasskey())
    expect(response.status).toBe(403)
    expect(((await response.json()) as { code: string }).code).toBe('SESSION_NOT_FRESH')
  })

  it('stops working for a deactivated user', async () => {
    const device = new SoftPasskey()
    await addPasskey(device)
    expect((await signInWith(device)).response.status).toBe(200)
    await h.env.DB.prepare('UPDATE users SET is_active = 0').run()
    const { cookie } = await signInWith(device)
    expect((await h.fetch('/api/me', { cookie })).status).toBe(401)
  })
})

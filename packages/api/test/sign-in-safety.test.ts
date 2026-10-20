import { base32 } from '@better-auth/utils/base32'
import { createOTP } from '@better-auth/utils/otp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOCKOUT } from '../src/auth/guard'
import { ADMIN, cookiesFrom, createHarness, json, setUpAdmin, signIn, type Harness } from './harness'
import { SoftPasskey } from './webauthn'

let h: Harness
let admin: string

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

const WRONG = 'not the password at all'

async function activity(action: string) {
  const { results } = await h.env.DB.prepare('SELECT user_id, details, ip_address FROM activity_log WHERE action = ? ORDER BY created_at').bind(action).all<{
    user_id: string | null
    details: string | null
    ip_address: string | null
  }>()
  return results.map((r) => ({ ...r, details: r.details ? (JSON.parse(r.details) as Record<string, unknown>) : null }))
}

/** Cookies from a response, added to the ones we already had (a later name replaces an earlier one). */
function merge(cookie: string, response: Response): string {
  const map = new Map(cookie.split('; ').filter(Boolean).map((c) => [c.slice(0, c.indexOf('=')), c]))
  for (const c of cookiesFrom(response).split('; ').filter(Boolean)) map.set(c.slice(0, c.indexOf('=')), c)
  return [...map.values()].join('; ')
}

async function addPasskey(device: SoftPasskey): Promise<void> {
  const options = await h.fetch('/api/auth/passkey/generate-register-options', { cookie: admin })
  const response = await h.fetch('/api/auth/passkey/verify-registration', {
    ...json({ response: device.register((await options.json()) as { challenge: string; user: { id: string } }), name: 'Laptop' }),
    cookie: merge(admin, options),
  })
  expect(response.status).toBe(200)
}

async function passkeySignIn(device: SoftPasskey): Promise<Response> {
  const options = await h.fetch('/api/auth/passkey/generate-authenticate-options')
  return h.fetch('/api/auth/passkey/verify-authentication', {
    ...json({ response: device.authenticate((await options.json()) as { challenge: string }) }),
    cookie: cookiesFrom(options),
  })
}

/** Turn phone codes on for the admin; returns a code maker. */
async function enableCodes(): Promise<() => Promise<string>> {
  const enabled = await h.fetch('/api/auth/two-factor/enable', { ...json({ password: ADMIN.password }), cookie: admin })
  expect(enabled.status).toBe(200)
  const { totpURI } = (await enabled.json()) as { totpURI: string }
  const secret = new TextDecoder().decode(base32.decode(new URL(totpURI).searchParams.get('secret')!))
  const code = () => createOTP(secret).totp()
  const verified = await h.fetch('/api/auth/two-factor/verify-totp', { ...json({ code: await code() }), cookie: admin })
  expect(verified.status).toBe(200)
  // Turning codes on replaces the session.
  admin = merge(admin, verified)
  return code
}

describe('password lockout', () => {
  it(`locks password sign-in after ${LOCKOUT.maxFailures} wrong passwords in a row, then lets the right one in once it lapses`, async () => {
    // The last try carries an IP (the others don't, or the per-IP limit would answer first).
    for (let i = 0; i < LOCKOUT.maxFailures; i++) expect((await signIn(h, ADMIN.email, WRONG, i === LOCKOUT.maxFailures - 1 ? '203.0.113.7' : undefined)).status).toBe(401)

    const locked = await signIn(h, ADMIN.email, ADMIN.password)
    expect(locked.status).toBe(403)
    expect(await locked.json()).toMatchObject({ code: 'ACCOUNT_LOCKED' })
    expect(cookiesFrom(locked)).toBe('')

    const failed = await activity('auth.sign_in_failed')
    expect(failed).toHaveLength(LOCKOUT.maxFailures)
    expect(failed.at(-1)).toMatchObject({ details: { failures: LOCKOUT.maxFailures }, ip_address: '203.0.113.7' })
    expect(await activity('auth.locked')).toHaveLength(1)

    await h.env.DB.prepare('UPDATE users SET locked_until = ?').bind(new Date(Date.now() - 1000).toISOString()).run()
    expect((await signIn(h, ADMIN.email, ADMIN.password)).status).toBe(200)
    const row = await h.env.DB.prepare('SELECT failed_sign_ins, locked_until FROM users').first()
    expect(row).toEqual({ failed_sign_ins: 0, locked_until: null })
  })

  it('starts counting again after a right password', async () => {
    for (let i = 0; i < LOCKOUT.maxFailures - 1; i++) await signIn(h, ADMIN.email, WRONG)
    expect((await signIn(h, ADMIN.email, ADMIN.password)).status).toBe(200)
    for (let i = 0; i < LOCKOUT.maxFailures - 1; i++) await signIn(h, ADMIN.email, WRONG)
    expect((await signIn(h, ADMIN.email, ADMIN.password)).status).toBe(200)
  })

  it('still lets a passkey in while passwords are locked', async () => {
    const device = new SoftPasskey()
    await addPasskey(device)
    for (let i = 0; i < LOCKOUT.maxFailures; i++) await signIn(h, ADMIN.email, WRONG)
    expect((await signIn(h, ADMIN.email, ADMIN.password)).status).toBe(403)

    const response = await passkeySignIn(device)
    expect(response.status).toBe(200)
    expect((await h.fetch('/api/me', { cookie: cookiesFrom(response) })).status).toBe(200)
  })

  it("doesn't count, lock or log emails that have no account", async () => {
    for (let i = 0; i < LOCKOUT.maxFailures + 2; i++) expect((await signIn(h, 'nobody@example.com', WRONG)).status).toBe(401)
    expect(await activity('auth.sign_in_failed')).toEqual([])
    expect(await activity('auth.locked')).toEqual([])
  })

  it('matches the email whatever its case', async () => {
    for (let i = 0; i < LOCKOUT.maxFailures; i++) expect((await signIn(h, ADMIN.email.toUpperCase(), WRONG)).status).toBe(401)
    expect((await signIn(h, ADMIN.email, ADMIN.password)).status).toBe(403)
  })
})

describe('sign-ins in the activity log', () => {
  it('records each sign-in with how it was done', async () => {
    await h.env.DB.prepare('DELETE FROM activity_log').run()
    expect((await signIn(h, ADMIN.email, ADMIN.password, '198.51.100.4')).status).toBe(200)
    const device = new SoftPasskey()
    await addPasskey(device)
    expect((await passkeySignIn(device)).status).toBe(200)

    const signedIn = await activity('auth.signed_in')
    expect(signedIn.map((e) => e.details?.method)).toEqual(['password', 'passkey'])
    expect(signedIn[0]).toMatchObject({ ip_address: '198.51.100.4' })
  })

  it('records a password and code sign-in once, when the code is checked', async () => {
    const code = await enableCodes()
    await h.env.DB.prepare('DELETE FROM activity_log').run()

    const first = await signIn(h, ADMIN.email, ADMIN.password)
    expect(await first.json()).toMatchObject({ twoFactorRedirect: true })
    expect(await activity('auth.signed_in')).toEqual([])

    const second = await h.fetch('/api/auth/two-factor/verify-totp', { ...json({ code: await code() }), cookie: cookiesFrom(first) })
    expect(second.status).toBe(200)
    expect((await activity('auth.signed_in')).map((e) => e.details?.method)).toEqual(['password+code'])
  })

  it('records account changes: codes on, a passkey added, the password changed', async () => {
    await enableCodes()
    await addPasskey(new SoftPasskey())
    const changed = await h.fetch('/api/auth/change-password', {
      ...json({ currentPassword: ADMIN.password, newPassword: 'a brand new long password' }),
      cookie: admin,
    })
    expect(changed.status).toBe(200)
    expect(await activity('account.two_factor_on')).toHaveLength(1)
    expect(await activity('account.passkey_added')).toHaveLength(1)
    expect(await activity('account.password_changed')).toHaveLength(1)
  })
})

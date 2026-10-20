import { base32 } from '@better-auth/utils/base32'
import { createOTP } from '@better-auth/utils/otp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOCKOUT } from '../src/auth/guard'
import { cookiesFrom, createHarness, json, setUpAdmin, signIn, type Harness } from './harness'

let h: Harness
let admin: string

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

const EDITOR = { name: 'Ed Editor', email: 'ed@example.com', password: 'editor password 123', roles: ['editor'] }
const NEW_PASSWORD = 'a temporary password'

interface UserJson {
  id: string
  twoFactorEnabled: boolean
  passkeys: number
  sessions: number
  mustChangePassword: boolean
  lockedUntil: string | null
}

async function createEditor(): Promise<{ id: string; cookie: string }> {
  const res = await h.fetch('/api/users', { ...json(EDITOR), cookie: admin })
  expect(res.status).toBe(201)
  const { user } = (await res.json()) as { user: UserJson }
  expect(user.mustChangePassword).toBe(true)
  return { id: user.id, cookie: cookiesFrom(await signIn(h, EDITOR.email, EDITOR.password)) }
}

const post = (path: string, body: unknown = {}, cookie = admin) => h.fetch(path, { ...json(body), cookie })
const signedIn = async (cookie: string) => (await h.fetch('/api/me', { cookie })).status === 200

async function action(name: string) {
  return h.env.DB.prepare('SELECT user_id, target_id, details FROM activity_log WHERE action = ?').bind(name).all<{ user_id: string; target_id: string; details: string }>()
}

describe('recovering someone else’s sign-in', () => {
  it('sets a temporary password: the old one stops working, they are signed out, and must change it', async () => {
    const editor = await createEditor()
    await h.env.DB.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').bind(editor.id).run()
    const res = await post(`/api/users/${editor.id}/password`, { password: NEW_PASSWORD })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { user: UserJson }).user).toMatchObject({ mustChangePassword: true, sessions: 0 })
    expect(await signedIn(editor.cookie)).toBe(false)
    expect((await signIn(h, EDITOR.email, EDITOR.password)).status).toBe(401)
    expect((await signIn(h, EDITOR.email, NEW_PASSWORD)).status).toBe(200)
    expect((await action('user.password_reset')).results).toHaveLength(1)
  })

  it('refuses a short temporary password', async () => {
    const editor = await createEditor()
    expect((await post(`/api/users/${editor.id}/password`, { password: 'short' })).status).toBe(400)
  })

  it('resets phone codes, and passkeys when asked, signing them out', async () => {
    const editor = await createEditor()
    const enabled = await post('/api/auth/two-factor/enable', { password: EDITOR.password }, editor.cookie)
    const { totpURI } = (await enabled.json()) as { totpURI: string }
    const secret = new TextDecoder().decode(base32.decode(new URL(totpURI).searchParams.get('secret')!))
    expect((await post('/api/auth/two-factor/verify-totp', { code: await createOTP(secret).totp() }, editor.cookie)).status).toBe(200)
    await h.env.DB.prepare(
      "INSERT INTO passkey (id, name, public_key, user_id, credential_id, counter, device_type, backed_up) VALUES ('pk', 'Phone', 'x', ?, 'cred', 0, 'singleDevice', 0)",
    )
      .bind(editor.id)
      .run()

    const kept = (await (await post(`/api/users/${editor.id}/two-factor/reset`)).json()) as { user: UserJson }
    expect(kept.user).toMatchObject({ twoFactorEnabled: false, passkeys: 1, sessions: 0 })
    const gone = (await (await post(`/api/users/${editor.id}/two-factor/reset`, { passkeys: true })).json()) as { user: UserJson }
    expect(gone.user).toMatchObject({ twoFactorEnabled: false, passkeys: 0 })

    // The password alone signs in again: no code is asked for.
    const res = await signIn(h, EDITOR.email, EDITOR.password)
    expect(await res.json()).not.toHaveProperty('twoFactorRedirect')
    expect(await h.env.DB.prepare('SELECT COUNT(*) AS n FROM two_factor').first('n')).toBe(0)
  })

  it('unlocks a locked password early', async () => {
    const editor = await createEditor()
    for (let i = 0; i < LOCKOUT.maxFailures; i++) await signIn(h, EDITOR.email, 'wrong wrong wrong')
    const listed = (await (await h.fetch('/api/users', { cookie: admin })).json()) as { users: UserJson[] }
    expect(listed.users.find((u) => u.id === editor.id)?.lockedUntil).toBeTruthy()
    expect((await signIn(h, EDITOR.email, EDITOR.password)).status).toBe(403)

    const res = await post(`/api/users/${editor.id}/unlock`)
    expect(((await res.json()) as { user: UserJson }).user.lockedUntil).toBeNull()
    expect((await signIn(h, EDITOR.email, EDITOR.password)).status).toBe(200)
  })

  it('signs them out everywhere', async () => {
    const editor = await createEditor()
    const second = cookiesFrom(await signIn(h, EDITOR.email, EDITOR.password))
    expect(await signedIn(editor.cookie)).toBe(true)
    expect((await post(`/api/users/${editor.id}/sign-out`)).status).toBe(200)
    expect(await signedIn(editor.cookie)).toBe(false)
    expect(await signedIn(second)).toBe(false)
  })

  it('does none of it to yourself, and only for people managers', async () => {
    const me = (await (await h.fetch('/api/me', { cookie: admin })).json()) as { id: string }
    for (const path of ['password', 'two-factor/reset', 'unlock', 'sign-out']) {
      expect((await post(`/api/users/${me.id}/${path}`, { password: NEW_PASSWORD })).status).toBe(409)
    }
    expect((await h.fetch(`/api/users/${me.id}`, { method: 'DELETE', cookie: admin })).status).toBe(409)

    const editor = await createEditor()
    expect((await post(`/api/users/${me.id}/sign-out`, {}, editor.cookie)).status).toBe(403)
    expect((await h.fetch(`/api/users/${me.id}`, { method: 'DELETE', cookie: editor.cookie })).status).toBe(403)
  })
})

describe('deleting a person', () => {
  it('keeps what they made, ends their sign-ins and logs who they were', async () => {
    const editor = await createEditor()
    const album = await post('/api/albums', { name: 'Herons' }, editor.cookie)
    expect(album.status).toBe(201)
    await post('/api/me/api-keys', { name: 'script', scopes: ['assets:read'] }, editor.cookie)

    expect((await h.fetch(`/api/users/${editor.id}`, { method: 'DELETE', cookie: admin })).status).toBe(204)
    expect(await signedIn(editor.cookie)).toBe(false)
    expect((await signIn(h, EDITOR.email, EDITOR.password)).status).toBe(401)
    expect(await h.env.DB.prepare("SELECT created_by FROM albums WHERE name = 'Herons'").first()).toEqual({ created_by: null })
    for (const table of ['session', 'account', 'api_keys', 'user_roles']) {
      expect(await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(editor.id).first('n')).toBe(0)
    }
    const { results } = await action('user.deleted')
    expect(results).toHaveLength(1)
    expect(JSON.parse(results[0]!.details)).toMatchObject({ email: EDITOR.email, roles: ['editor'] })
    expect((await h.fetch(`/api/users/${editor.id}`, { method: 'DELETE', cookie: admin })).status).toBe(404)
  })
})

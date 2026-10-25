import { afterEach, describe, expect, it } from 'vitest'
import { findProblems } from '../src/catalog/alerts'
import { OMITTED_TABLES } from '../src/catalog/backups'
import type { MailBinding } from '../src/mail/mailer'
import { getMailSettings, mailSweep, queueMail, sendDueMail } from '../src/mail/outbox'
import { renderMail } from '../src/mail/templates'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

/** Records what it's asked to send; `fail` makes it throw the binding's error with that code. */
class FakeMail implements MailBinding {
  sent: Parameters<MailBinding['send']>[0][] = []
  fail: string | null = null
  send = async (message: Parameters<MailBinding['send']>[0]) => {
    if (this.fail) throw Object.assign(new Error(`refused: ${this.fail}`), { code: this.fail })
    this.sent.push(message)
    return { messageId: `m${this.sent.length}` }
  }
}

let h: Harness
afterEach(async () => {
  await h?.dispose()
})

const FROM = 'cf-dam@mail.example.com'
async function withMail(extra: Record<string, string> = {}) {
  const mail = new FakeMail()
  h = await createHarness({ MAIL: mail, MAIL_FROM: FROM, ...extra })
  const admin = await setUpAdmin(h)
  return { mail, admin }
}
const put = (admin: string, body: Record<string, unknown>) => h.fetch('/api/mail', { method: 'PUT', body: JSON.stringify(body), cookie: admin })
const rows = async () => (await h.env.DB.prepare('SELECT kind, to_address, status, params, attempts, error FROM mail_outbox ORDER BY created_at').all<Record<string, string | number>>()).results

describe('email (plans/PLAN-E-v2.md)', () => {
  it('stays off without the binding, and nothing breaks', async () => {
    h = await createHarness()
    const admin = await setUpAdmin(h)
    expect(await (await h.fetch('/api/mail', { cookie: admin })).json()).toMatchObject({ available: false, ready: false })
    expect((await put(admin, { on: true })).status).toBe(409)
    expect(await queueMail(h.env, { kind: 'test', to: 'a@example.com', language: 'en' })).toBeNull()
    expect(await rows()).toEqual([])
    expect(await mailSweep(h.env)).toBe(0)
  })

  it('turns on with the address links are built from, and sends a test at once', async () => {
    const { mail, admin } = await withMail()
    // Nothing is queued until an administrator turns it on.
    expect(await queueMail(h.env, { kind: 'test', to: 'a@example.com', language: 'en' })).toBeNull()
    expect((await put(admin, { studio: 'Hansen <Studio>\r\nBcc: x@evil.example', replyTo: 'Studio@Example.com' })).status).toBe(200)
    expect((await put(admin, { replyTo: 'not an address' })).status).toBe(400)
    expect((await put(admin, { on: true })).status).toBe(200)
    expect(await getMailSettings(h.env.DB)).toMatchObject({ on: true, origin: 'http://localhost', replyTo: 'studio@example.com' })

    const test = await h.fetch('/api/mail/test', { method: 'POST', cookie: admin })
    expect(test.status).toBe(200)
    expect(mail.sent).toHaveLength(1)
    const sent = mail.sent[0]!
    expect(sent.from).toEqual({ email: FROM, name: 'Hansen <Studio> Bcc: x@evil.example' })
    expect(sent.to).toBe('ada@example.com')
    expect(sent.replyTo).toBe('studio@example.com')
    expect(sent.subject).not.toMatch(/[\r\n]/)
    // Names are escaped in the HTML.
    expect(sent.html).toContain('Hansen &lt;Studio&gt;')
    expect(sent.html).not.toContain('<Studio>')
    expect(sent.text).toContain('http://localhost/')
    expect(await rows()).toMatchObject([{ kind: 'test', status: 'sent' }])
  })

  it('queues, sends, and forgets the link once sent', async () => {
    const { mail, admin } = await withMail()
    await put(admin, { on: true })
    await queueMail(h.env, { kind: 'test', to: 'b@example.com', language: 'de', params: { link: 'http://localhost/secret-token' } })
    expect(await rows()).toMatchObject([{ status: 'queued' }])
    expect(await sendDueMail(h.env)).toBe(1)
    expect(mail.sent[0]!.subject).toBe('Test-E-Mail von cf-dam')
    expect(mail.sent[0]!.html).toContain('http://localhost/secret-token')
    const [row] = await rows()
    expect(row).toMatchObject({ status: 'sent' })
    expect(row!.params).not.toContain('secret-token')
  })

  it('retries what may work later, gives up on what never will, and stops when the sender is refused', async () => {
    const { mail, admin } = await withMail()
    await put(admin, { on: true })
    const due = () => h.env.DB.prepare("UPDATE mail_outbox SET next_attempt_at = '2000-01-01T00:00:00Z' WHERE status = 'queued'").run()

    mail.fail = 'E_RATE_LIMIT_EXCEEDED'
    await queueMail(h.env, { kind: 'test', to: 'c@example.com', language: 'en', params: { link: 'http://localhost/x' } })
    for (let i = 0; i < 3; i++) {
      await sendDueMail(h.env)
      await due()
    }
    expect(await rows()).toMatchObject([{ status: 'failed', attempts: 3 }])
    expect((await rows())[0]!.params).not.toContain('localhost/x')

    mail.fail = 'E_VALIDATION_ERROR'
    await queueMail(h.env, { kind: 'test', to: 'd@example.com', language: 'en' })
    await sendDueMail(h.env)
    expect((await rows())[1]).toMatchObject({ status: 'failed', attempts: 1 })

    mail.fail = 'E_SENDER_NOT_VERIFIED'
    await queueMail(h.env, { kind: 'test', to: 'e@example.com', language: 'en' })
    await queueMail(h.env, { kind: 'test', to: 'f@example.com', language: 'en' })
    await sendDueMail(h.env)
    expect((await rows()).slice(2)).toMatchObject([{ status: 'queued', attempts: 0 }, { status: 'queued', attempts: 0 }])
    expect((await getMailSettings(h.env.DB)).stopped).toMatchObject({ code: 'E_SENDER_NOT_VERIFIED' })
    // Stopped: nothing more is queued or sent, and an alert says why.
    expect(await queueMail(h.env, { kind: 'test', to: 'g@example.com', language: 'en' })).toBeNull()
    expect((await findProblems(h.env.DB)).findings.map((f) => f.key)).toContain('mail.stopped')

    // A test that gets through starts it again.
    mail.fail = null
    expect((await h.fetch('/api/mail/test', { method: 'POST', cookie: admin })).status).toBe(200)
    expect((await getMailSettings(h.env.DB)).stopped).toBeNull()
    expect(await sendDueMail(h.env)).toBe(2)
    expect(mail.sent.map((m) => m.to)).toEqual(['ada@example.com', 'e@example.com', 'f@example.com'])
  })

  it('on staging, emails only the allow list', async () => {
    const { mail, admin } = await withMail({ MAIL_ALLOW_TO: 'ada@example.com, @studio.example' })
    await put(admin, { on: true })
    await queueMail(h.env, { kind: 'test', to: 'client@gmail.example', language: 'en', params: { link: 'http://localhost/t' } })
    await queueMail(h.env, { kind: 'test', to: 'me@studio.example', language: 'en' })
    await sendDueMail(h.env)
    expect(mail.sent.map((m) => m.to)).toEqual(['me@studio.example'])
    expect((await rows())[0]).toMatchObject({ status: 'dropped', params: '{}' })
  })

  it('drops a message past its link’s life, and puts back one cut short', async () => {
    const { mail, admin } = await withMail()
    await put(admin, { on: true })
    await queueMail(h.env, { kind: 'test', to: 'h@example.com', language: 'en', params: { link: 'http://localhost/old' }, ttlMs: 1 })
    await new Promise((r) => setTimeout(r, 5))
    await sendDueMail(h.env)
    expect(mail.sent).toEqual([])
    expect((await rows())[0]).toMatchObject({ status: 'dropped', error: 'expired' })
    expect((await rows())[0]!.params).not.toContain('old')

    await queueMail(h.env, { kind: 'test', to: 'i@example.com', language: 'en' })
    await h.env.DB.prepare("UPDATE mail_outbox SET status = 'sending', next_attempt_at = '2000-01-01T00:00:00Z' WHERE to_address = 'i@example.com'").run()
    await mailSweep(h.env)
    expect(mail.sent.map((m) => m.to)).toEqual(['i@example.com'])
  })

  it('keeps the outbox out of backups and goes with the person', async () => {
    const { admin } = await withMail()
    expect(OMITTED_TABLES).toHaveProperty('mail_outbox')
    await put(admin, { on: true })
    const user = await h.env.DB.prepare('SELECT id FROM users LIMIT 1').first<{ id: string }>()
    const other = await h.fetch('/api/users', { ...json({ name: 'Eve Editor', email: 'eve@example.com', password: 'a long enough password', roles: ['editor'] }), cookie: admin })
    const eve = ((await other.json()) as { user: { id: string } }).user.id
    await queueMail(h.env, { kind: 'test', to: 'eve@example.com', userId: eve, language: 'en' })
    await queueMail(h.env, { kind: 'test', to: 'ada@example.com', userId: user!.id, language: 'en' })
    expect((await h.fetch(`/api/users/${eve}`, { method: 'DELETE', cookie: admin })).status).toBeLessThan(300)
    expect((await rows()).map((r) => r.to_address)).toEqual(['ada@example.com'])
  })

  it('writes every kind in every language, plain text beside the HTML', () => {
    for (const lang of ['en', 'es', 'de', 'fr', 'it'] as const) {
      const r = renderMail('test', lang, { studio: 'S & S', link: 'https://dam.example.com/' })
      expect(r.subject).toBeTruthy()
      expect(r.html).toContain('S &amp; S')
      expect(r.text).toContain('https://dam.example.com/')
      expect(r.html).not.toMatch(/\{[a-z]+\}/)
    }
    // A link that isn't a web address never becomes a button.
    expect(renderMail('test', 'en', { studio: 'S', link: 'javascript:alert(1)' }).html).not.toContain('javascript:')
  })
})

describe('forgot your password (plans/PLAN-E-v2.md §4)', () => {
  const ask = (email: string, ip?: string) => h.fetch('/api/auth/request-password-reset', { ...json({ email }), ...(ip ? { ip } : {}) })

  it('emails a one-time link, ends every session, and clears a lockout and an old invite', async () => {
    const { mail, admin } = await withMail()
    await put(admin, { on: true })
    // Someone guessed wrong ten times: the owner needs the reset most.
    await h.env.DB.prepare("UPDATE users SET locked_until = '2999-01-01T00:00:00Z', must_change_password = 1, failed_sign_ins = 4 WHERE email = 'ada@example.com'").run()

    expect((await ask('nobody@example.com')).status).toBe(200)
    expect((await ask('ada@example.com')).status).toBe(200)
    expect((await rows()).map((r) => r.kind)).toEqual(['reset'])
    await sendDueMail(h.env)
    const link = /http:\/\/localhost\/reset-password\?token=([A-Za-z0-9_-]+)/.exec(mail.sent[0]!.text)
    expect(link).not.toBeNull()
    expect((await rows())[0]!.params).not.toContain(link![1])

    const reset = (token: string) => h.fetch('/api/auth/reset-password', json({ newPassword: 'a brand new long password', token }))
    expect((await reset(link![1]!)).status).toBe(200)
    expect((await reset(link![1]!)).status).toBe(400)
    // Signed out everywhere; the lockout and the temporary-password flag are gone.
    expect((await h.fetch('/api/me', { cookie: admin })).status).toBe(401)
    const user = await h.env.DB.prepare("SELECT locked_until, must_change_password, failed_sign_ins FROM users WHERE email = 'ada@example.com'").first()
    expect(user).toEqual({ locked_until: null, must_change_password: 0, failed_sign_ins: 0 })
    expect(await h.env.DB.prepare("SELECT action FROM activity_log WHERE action = 'account.password_reset'").first()).toBeTruthy()
    expect((await rows()).map((r) => r.kind)).toEqual(['reset', 'passwordChanged'])
    expect((await h.fetch('/api/auth/sign-in/email', json({ email: 'ada@example.com', password: 'a brand new long password' }))).status).toBe(200)
  })

  it('sends nothing for a deactivated account or with email off, and limits each address', async () => {
    const { admin } = await withMail()
    await ask('ada@example.com')
    expect(await rows()).toEqual([])
    await put(admin, { on: true })
    await h.env.DB.prepare("UPDATE users SET is_active = 0 WHERE email = 'ada@example.com'").run()
    expect((await ask('ada@example.com')).status).toBe(200)
    expect(await rows()).toEqual([])
    await h.env.DB.prepare("UPDATE users SET is_active = 1 WHERE email = 'ada@example.com'").run()
    // Three an hour for one address, from anywhere; the same for an address with no account.
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) expect((await ask('Ada@Example.com', ip)).status).toBe(200)
    expect((await ask('ada@example.com', '4.4.4.4')).status).toBe(429)
    for (const ip of ['5.5.5.5', '6.6.6.6', '7.7.7.7']) expect((await ask('ghost@example.com', ip)).status).toBe(200)
    expect((await ask('ghost@example.com', '8.8.8.8')).status).toBe(429)
  })
})


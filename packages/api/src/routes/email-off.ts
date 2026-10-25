/**
 * "Don't email me about this gallery" (mail/gallery-mail.ts): the link in a gallery email, signed for one member and
 * one gallery. GET only shows the page that asks (mail scanners open links); POST turns them off, which is also what
 * a mail app's one-click unsubscribe sends (RFC 8058). No sign-in: the signature is the key.
 */
import { Hono } from 'hono'
import type { DamEnv } from '../env'
import { emailsOffValid, setGalleryEmails } from '../mail/gallery-mail'

export const emailOffRoutes = new Hono<DamEnv>()

const read = (c: { req: { query: (k: string) => string | undefined } }) => ({ s: c.req.query('s') ?? '', u: c.req.query('u') ?? '', k: c.req.query('k') ?? '' })

emailOffRoutes.get('/', (c) => {
  const url = new URL(c.req.url)
  return c.redirect(`/email-off${url.search}`, 303)
})

emailOffRoutes.post('/', async (c) => {
  const { s, u, k } = read(c)
  if (!s || !u || !k || !(await emailsOffValid(c.env, s, u, k))) return c.json({ error: 'invalid_link' }, 400)
  const ok = await setGalleryEmails(c.env.DB, s, u, false)
  if (!ok) return c.json({ error: 'not_found' }, 404)
  const share = await c.env.DB.prepare('SELECT title, name FROM shares WHERE id = ?').bind(s).first<{ title: string; name: string }>()
  return c.json({ ok: true, gallery: share?.title || share?.name || '' })
})

/**
 * What each email says, in the recipient's language (plans/PLAN-E-v2.md §3). One plain layout: the studio's name, a
 * heading, a few paragraphs, a button with the same link written out under it, and why they got it. HTML and text come
 * from the same parts. No images, no tracking. Every value is escaped: names and gallery titles are typed by people.
 */
import { createFormat, getT, type Translate, type UiLanguage } from '@cf-dam/i18n'
import { alertSentence, type AlertText } from '../catalog/alerts'

export type MailKind = 'test' | 'reset' | 'passwordChanged' | 'invite' | 'teamInvite' | 'galleryReady' | 'closingSoon' | 'finished' | 'alert'

export interface MailParams {
  /** The studio's name, from Setup → Email. */
  studio: string
  /** A link the message is about (an https address built from the pinned origin). */
  link?: string
  [key: string]: string | number | undefined
}

interface Parts {
  subject: string
  heading: string
  paragraphs: string[]
  button?: { label: string; url: string }
  /** Why they got it, at the foot. */
  why: string
}

/** An ISO date, written the reader's way. */
const day = (lang: UiLanguage, iso: unknown) => (typeof iso === 'string' && iso ? createFormat(lang).date(iso) : '')

const KINDS: Record<MailKind, (p: MailParams, t: Translate, lang: UiLanguage) => Parts> = {
  test: (p, t) => ({
    subject: t('mail.test.subject', { studio: p.studio }),
    heading: t('mail.test.heading'),
    paragraphs: [t('mail.test.body', { studio: p.studio })],
    ...(p.link ? { button: { label: t('mail.test.button'), url: p.link } } : {}),
    why: t('mail.test.why'),
  }),
  reset: (p, t) => ({
    subject: t('mail.reset.subject', { studio: p.studio }),
    heading: t('mail.reset.heading'),
    paragraphs: [t('mail.reset.body')],
    ...(p.link ? { button: { label: t('mail.reset.button'), url: p.link } } : {}),
    why: t('mail.reset.why'),
  }),
  invite: (p, t, lang) => ({
    subject: p.gallery ? t('mail.invite.subjectGallery', { studio: p.studio, gallery: String(p.gallery) }) : t('mail.invite.subject', { studio: p.studio }),
    heading: t('mail.invite.heading', { name: String(p.name ?? '') }),
    paragraphs: [
      p.gallery ? t('mail.invite.bodyGallery', { studio: p.studio, gallery: String(p.gallery) }) : t('mail.invite.body', { studio: p.studio }),
      t('mail.invite.until', { date: day(lang, p.until) }),
    ],
    ...(p.link ? { button: { label: t('mail.invite.button'), url: p.link } } : {}),
    why: t('mail.invite.why', { studio: p.studio }),
  }),
  teamInvite: (p, t, lang) => ({
    subject: t('mail.team.subject', { studio: p.studio }),
    heading: t('mail.invite.heading', { name: String(p.name ?? '') }),
    paragraphs: [t('mail.team.body', { studio: p.studio, by: String(p.by ?? '') }), t('mail.team.until', { date: day(lang, p.until) })],
    ...(p.link ? { button: { label: t('mail.team.button'), url: p.link } } : {}),
    why: t('mail.team.why', { studio: p.studio }),
  }),
  galleryReady: (p, t, lang) => ({
    subject: t('mail.gallery.subject', { studio: p.studio, gallery: String(p.gallery ?? '') }),
    heading: t('mail.invite.heading', { name: String(p.name ?? '') }),
    paragraphs: [
      t('mail.gallery.body', { studio: p.studio, gallery: String(p.gallery ?? '') }),
      ...(p.message ? [String(p.message)] : []),
      ...(p.until ? [t('mail.gallery.until', { date: day(lang, p.until) })] : []),
    ],
    ...(p.link ? { button: { label: t('mail.gallery.button'), url: p.link } } : {}),
    why: t('mail.gallery.why', { studio: p.studio }),
  }),
  closingSoon: (p, t, lang) => ({
    subject: t('mail.closing.subject', { gallery: String(p.gallery ?? ''), date: day(lang, p.until) }),
    heading: t('mail.invite.heading', { name: String(p.name ?? '') }),
    paragraphs: [t('mail.closing.body', { studio: p.studio, gallery: String(p.gallery ?? ''), date: day(lang, p.until) })],
    ...(p.link ? { button: { label: t('mail.gallery.button'), url: p.link } } : {}),
    why: t('mail.gallery.why', { studio: p.studio }),
  }),
  finished: (p, t) => ({
    subject: t('mail.finished.subject', { who: String(p.who ?? ''), gallery: String(p.gallery ?? '') }),
    heading: t('mail.finished.heading'),
    paragraphs: [t('mail.finished.body', { who: String(p.who ?? ''), gallery: String(p.gallery ?? '') })],
    ...(p.link ? { button: { label: t('mail.finished.button'), url: p.link } } : {}),
    why: t('mail.finished.why'),
  }),
  alert: (p, t) => {
    let texts: (AlertText | { message: string })[] = []
    try {
      texts = JSON.parse(String(p.texts ?? '[]')) as typeof texts
    } catch {
      texts = []
    }
    return {
      subject: t('mail.alert.subject', { studio: p.studio, count: texts.length }),
      heading: t('mail.alert.heading'),
      paragraphs: texts.map((x) => ('key' in x ? alertSentence(x, t) : x.message)),
      ...(p.link ? { button: { label: t('mail.alert.button'), url: p.link } } : {}),
      why: t('mail.alert.why'),
    }
  },
  passwordChanged: (p, t) => ({
    subject: t('mail.changed.subject', { studio: p.studio }),
    heading: t('mail.changed.heading'),
    paragraphs: [t('mail.changed.body', { studio: p.studio })],
    why: t('mail.changed.why'),
  }),
}

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Escaped, with line breaks kept. */
const paragraph = (value: string) => escapeHtml(value).replace(/\r?\n/g, '<br>')

/** Only web links go into a button. */
const webLink = (url: string): string | null => {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

export interface Rendered {
  subject: string
  html: string
  text: string
  /** List-Unsubscribe, for an email that can be turned off (one click, RFC 8058; https only). */
  headers?: Record<string, string>
}

export function renderMail(kind: MailKind, lang: UiLanguage, params: MailParams): Rendered {
  const t = getT(lang)
  const parts = KINDS[kind](params, t, lang)
  const url = parts.button ? webLink(parts.button.url) : null
  // "Don't email me about this gallery": a page that asks first (mail scanners open links), and the one-click header.
  const off = typeof params.offLink === 'string' ? webLink(params.offLink) : null
  const offPage = off ? off.replace('/api/public/email-off?', '/email-off?') : null
  const button = url
    ? `<p style="margin:28px 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 22px;border-radius:8px;background:#3b5bdb;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(parts.button!.label)}</a></p>
<p style="margin:0 0 16px;color:#555;font-size:13px">${escapeHtml(t('mail.layout.orCopy'))}<br><a href="${escapeHtml(url)}" style="color:#3b5bdb;word-break:break-all">${escapeHtml(url)}</a></p>`
    : ''
  const html = `<!doctype html>
<html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(parts.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f6">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;line-height:1.5">
<p style="margin:0 0 24px;font-weight:650;font-size:15px;color:#555">${escapeHtml(params.studio)}</p>
<div style="background:#ffffff;border-radius:12px;padding:28px 24px">
<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(parts.heading)}</h1>
${parts.paragraphs.map((p) => `<p style="margin:0 0 14px">${paragraph(p)}</p>`).join('\n')}
${button}
</div>
<p style="margin:20px 4px 0;color:#777;font-size:12px">${paragraph(parts.why)}</p>
${offPage ? `<p style="margin:8px 4px 0;font-size:12px"><a href="${escapeHtml(offPage)}" style="color:#777">${escapeHtml(t('mail.gallery.off'))}</a></p>` : ''}
</div>
</body></html>`
  const text = [
    params.studio,
    '',
    parts.heading,
    '',
    ...parts.paragraphs.flatMap((p) => [p, '']),
    ...(url ? [`${parts.button!.label}: ${url}`, ''] : []),
    '--',
    parts.why,
    ...(offPage ? [`${t('mail.gallery.off')}: ${offPage}`] : []),
  ].join('\n')
  const headers = off?.startsWith('https:') ? { 'List-Unsubscribe': `<${off}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined
  return { subject: parts.subject, html, text, ...(headers ? { headers } : {}) }
}


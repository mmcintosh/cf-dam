/**
 * What each email says, in the recipient's language (plans/PLAN-E-v2.md §3). One plain layout: the studio's name, a
 * heading, a few paragraphs, a button with the same link written out under it, and why they got it. HTML and text come
 * from the same parts. No images, no tracking. Every value is escaped: names and gallery titles are typed by people.
 */
import { getT, type Translate, type UiLanguage } from '@cf-dam/i18n'

export type MailKind = 'test'

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

const KINDS: Record<MailKind, (p: MailParams, t: Translate) => Parts> = {
  test: (p, t) => ({
    subject: t('mail.test.subject', { studio: p.studio }),
    heading: t('mail.test.heading'),
    paragraphs: [t('mail.test.body', { studio: p.studio })],
    ...(p.link ? { button: { label: t('mail.test.button'), url: p.link } } : {}),
    why: t('mail.test.why'),
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
}

export function renderMail(kind: MailKind, lang: UiLanguage, params: MailParams): Rendered {
  const t = getT(lang)
  const parts = KINDS[kind](params, t)
  const url = parts.button ? webLink(parts.button.url) : null
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
  ].join('\n')
  return { subject: parts.subject, html, text }
}


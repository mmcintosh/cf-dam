/**
 * A safe place to go after signing in (`/login?next=`): a path on this site, never another one. The browser's URL
 * parser drops tabs and line breaks and reads a backslash as a slash, so `/\t/evil.example` and `/\evil.example`
 * would both leave the site: the path is parsed as the browser will, and must stay on this origin.
 */
export function safeNext(raw: string | null, origin = 'https://cf-dam.invalid'): string {
  if (!raw || !raw.startsWith('/') || /[\u0000-\u001F\u007F\\]/.test(raw) || raw.startsWith('//')) return '/'
  try {
    const url = new URL(raw, origin)
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : '/'
  } catch {
    return '/'
  }
}

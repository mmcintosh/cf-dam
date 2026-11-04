/**
 * Just enough XML for S3 responses. Workers have no DOMParser, and S3 replies are flat and
 * predictable, so tag extraction is sufficient. Not a general XML parser.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return ENTITIES[entity.toLowerCase()] ?? match
  })
}

/**
 * Characters XML 1.0 can't carry at all, not even escaped: control characters other than tab, line
 * feed and carriage return, lone surrogates, U+FFFE and U+FFFF. A reader refuses the whole document
 * over one of them, so they're dropped (they come from pasted text and old files, never on purpose).
 */
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export function escapeXml(text: string): string {
  return text.replace(NOT_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/**
 * For an attribute's value. A reader turns a raw tab or line break inside an attribute into a space
 * (XML's attribute-value normalisation), so they're written as character references: a two-line
 * instruction comes back as two lines.
 */
export function escapeXmlAttribute(text: string): string {
  return escapeXml(text).replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;')
}

/** Text of every `<tag>…</tag>` in `xml`, decoded. */
export function xmlValues(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  return [...xml.matchAll(pattern)].map((m) => decodeEntities(m[1] ?? ''))
}

export function xmlValue(xml: string, tag: string): string | null {
  return xmlValues(xml, tag)[0] ?? null
}

/** Raw inner XML of every `<tag>…</tag>` block, for nested records such as `<Contents>`. */
export function xmlBlocks(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  return [...xml.matchAll(pattern)].map((m) => m[1] ?? '')
}

/**
 * IPTC Core: the fields photographers use for credit, rights, contact and place. One list drives
 * reading (from IPTC-IIM and XMP via exifr), editing, presets, search and the XMP sidecar.
 */
import { escapeXml } from '../storage/xml'
import { randomId } from '../lib/crypto'
import { nowIso } from '../lib/time'

export interface IptcField {
  key: IptcKey
  column: string
  label: string
  group: 'Description' | 'Rights' | 'Contact' | 'Location' | 'Workflow'
  max: number
  /** Long text gets a textarea. */
  long?: boolean
}

export type IptcKey =
  | 'headline'
  | 'creator'
  | 'creatorTitle'
  | 'credit'
  | 'source'
  | 'copyright'
  | 'usageTerms'
  | 'copyrightUrl'
  | 'contactEmail'
  | 'contactPhone'
  | 'contactUrl'
  | 'jobId'
  | 'instructions'
  | 'sublocation'
  | 'city'
  | 'state'
  | 'country'
  | 'countryCode'

export const IPTC_FIELDS: readonly IptcField[] = [
  { key: 'headline', column: 'headline', label: 'Headline', group: 'Description', max: 300 },
  { key: 'creator', column: 'creator', label: 'Creator', group: 'Rights', max: 200 },
  { key: 'creatorTitle', column: 'creator_title', label: "Creator's job title", group: 'Rights', max: 200 },
  { key: 'credit', column: 'credit', label: 'Credit line', group: 'Rights', max: 300 },
  { key: 'source', column: 'source', label: 'Source', group: 'Rights', max: 300 },
  { key: 'copyright', column: 'copyright', label: 'Copyright notice', group: 'Rights', max: 500 },
  { key: 'usageTerms', column: 'usage_terms', label: 'Usage terms', group: 'Rights', max: 2000, long: true },
  { key: 'copyrightUrl', column: 'copyright_url', label: 'Copyright URL', group: 'Rights', max: 500 },
  { key: 'contactEmail', column: 'contact_email', label: 'Email', group: 'Contact', max: 200 },
  { key: 'contactPhone', column: 'contact_phone', label: 'Phone', group: 'Contact', max: 100 },
  { key: 'contactUrl', column: 'contact_url', label: 'Website', group: 'Contact', max: 500 },
  { key: 'sublocation', column: 'sublocation', label: 'Sublocation', group: 'Location', max: 200 },
  { key: 'city', column: 'city', label: 'City', group: 'Location', max: 200 },
  { key: 'state', column: 'state', label: 'State / province', group: 'Location', max: 200 },
  { key: 'country', column: 'country', label: 'Country', group: 'Location', max: 200 },
  { key: 'countryCode', column: 'country_code', label: 'Country code', group: 'Location', max: 3 },
  { key: 'jobId', column: 'job_id', label: 'Job identifier', group: 'Workflow', max: 200 },
  { key: 'instructions', column: 'instructions', label: 'Instructions', group: 'Workflow', max: 2000, long: true },
]

const BY_KEY = new Map(IPTC_FIELDS.map((f) => [f.key, f]))
export const isIptcKey = (key: string): key is IptcKey => BY_KEY.has(key as IptcKey)
/**
 * The place fields a GPS lookup fills, and each one's bit in assets.place_gps, which marks the ones it
 * did fill (migration 0023). A marked field is the lookup's: anything else may write over it.
 */
export const GPS_PLACE_BITS: Partial<Record<IptcKey, number>> = { city: 1, state: 2, country: 4, countryCode: 8 }

export type IptcValues = Partial<Record<IptcKey, string | null>>

const text = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) return text(value[0])
  if (value && typeof value === 'object' && 'value' in value) return text((value as { value: unknown }).value)
  return null
}

/** IPTC Core from what exifr parsed (IPTC-IIM and XMP merged). XMP wins where both exist. */
export function iptcFromRaw(raw: Record<string, unknown>): IptcValues {
  const contact = (raw.CreatorContactInfo ?? {}) as Record<string, unknown>
  const values: IptcValues = {
    headline: text(raw.Headline),
    // IPTC By-line first (Lightroom writes it and XMP's creator together); the agent uses the same order.
    creator: text(raw.Byline) ?? text(raw.creator) ?? text(raw.Artist),
    creatorTitle: text(raw.AuthorsPosition) ?? text(raw.BylineTitle),
    credit: text(raw.Credit),
    source: text(raw.Source),
    copyright: text(raw.rights) ?? text(raw.CopyrightNotice) ?? text(raw.Copyright),
    usageTerms: text(raw.UsageTerms),
    copyrightUrl: text(raw.WebStatement),
    contactEmail: text(contact.CiEmailWork),
    contactPhone: text(contact.CiTelWork),
    contactUrl: text(contact.CiUrlWork),
    jobId: text(raw.TransmissionReference) ?? text(raw.OriginalTransmissionReference),
    instructions: text(raw.Instructions) ?? text(raw.SpecialInstructions),
    sublocation: text(raw.Location) ?? text(raw.Sublocation),
    city: text(raw.City),
    state: text(raw.State),
    country: text(raw.Country),
    countryCode: text(raw.CountryCode),
  }
  return clean(values)
}

/** Trim, cap lengths and drop unknown keys. Empty strings become null (clearing the field). */
export function clean(values: Record<string, unknown>): IptcValues {
  const out: IptcValues = {}
  for (const [key, value] of Object.entries(values)) {
    if (!isIptcKey(key) || value === undefined) continue
    const field = BY_KEY.get(key)!
    if (value === null) out[key] = null
    else if (typeof value === 'string') out[key] = value.trim() ? value.trim().slice(0, field.max) : null
  }
  return out
}

/** Validate an edit from the API. Throws a message for the first bad field. */
export function parseIptcPatch(body: Record<string, unknown>): IptcValues {
  const patch: IptcValues = {}
  for (const field of IPTC_FIELDS) {
    const value = body[field.key]
    if (value === undefined) continue
    if (value !== null && typeof value !== 'string') throw new Error(`${field.key} must be text or null.`)
    if (typeof value === 'string' && value.length > field.max) throw new Error(`${field.label} is longer than ${field.max} characters.`)
    patch[field.key] = value === null ? null : value
  }
  return clean(patch)
}

/**
 * SQL to write values to an asset. `fillOnly` sets only fields that are empty (file imports, presets
 * applied gently); a place filled in from GPS counts as empty. Whatever is written to a place field
 * is no longer the GPS lookup's.
 */
export function iptcUpdate(db: D1Database, assetIds: string | string[], values: IptcValues, opts: { fillOnly?: boolean } = {}): D1PreparedStatement | null {
  const sets: string[] = []
  const params: unknown[] = []
  let notGps = 0
  for (const [key, value] of Object.entries(values) as [IptcKey, string | null][]) {
    const column = BY_KEY.get(key)!.column
    const bit = GPS_PLACE_BITS[key]
    if (opts.fillOnly) {
      if (value === null) continue
      sets.push(bit ? `${column} = CASE WHEN COALESCE(${column}, '') = '' OR place_gps & ${bit} THEN ? ELSE ${column} END` : `${column} = COALESCE(NULLIF(${column}, ''), ?)`)
    } else {
      sets.push(`${column} = ?`)
    }
    params.push(value)
    notGps |= bit ?? 0
  }
  if (sets.length === 0) return null
  if (notGps) sets.push(`place_gps = place_gps & ~${notGps}`)
  return db
    .prepare(`UPDATE assets SET ${sets.join(', ')}, updated_at = ? WHERE id IN (SELECT value FROM json_each(?))`)
    .bind(...params, nowIso(), JSON.stringify([assetIds].flat()))
}

/** An asset row's IPTC values, keyed for the API. */
export function iptcJson(row: Record<string, unknown>): Record<IptcKey, string | null> {
  const out = {} as Record<IptcKey, string | null>
  for (const field of IPTC_FIELDS) out[field.key] = (row[field.column] as string | null | undefined) ?? null
  return out
}

/** Words for full-text search: place names into `place`, people and job into `people`. */
export function iptcSearchText(row: Record<string, unknown>): { place: string; extra: string } {
  const pick = (...columns: string[]) => columns.map((c) => row[c]).filter((v): v is string => typeof v === 'string' && v !== '').join(' ')
  return { place: pick('sublocation', 'city', 'state', 'country'), extra: pick('headline', 'creator', 'credit', 'source', 'job_id') }
}

/** XMP for the IPTC fields: attributes for simple values, elements for structures and lang-alts. */
export function iptcXmp(row: Record<string, unknown>): { attributes: string[]; elements: string[] } {
  const v = (column: string) => (typeof row[column] === 'string' && row[column] ? (row[column] as string) : null)
  const attr = (name: string, column: string) => (v(column) ? `    ${name}="${escapeXml(v(column)!)}"` : '')
  const alt = (value: string) => `<rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(value)}</rdf:li></rdf:Alt>`
  const attributes = [
    attr('photoshop:Headline', 'headline'),
    attr('photoshop:AuthorsPosition', 'creator_title'),
    attr('photoshop:Credit', 'credit'),
    attr('photoshop:Source', 'source'),
    attr('photoshop:TransmissionReference', 'job_id'),
    attr('photoshop:Instructions', 'instructions'),
    attr('photoshop:City', 'city'),
    attr('photoshop:State', 'state'),
    attr('photoshop:Country', 'country'),
    attr('Iptc4xmpCore:Location', 'sublocation'),
    attr('Iptc4xmpCore:CountryCode', 'country_code'),
    attr('xmpRights:WebStatement', 'copyright_url'),
  ].filter(Boolean)
  const contact = [
    v('contact_email') && `<Iptc4xmpCore:CiEmailWork>${escapeXml(v('contact_email')!)}</Iptc4xmpCore:CiEmailWork>`,
    v('contact_phone') && `<Iptc4xmpCore:CiTelWork>${escapeXml(v('contact_phone')!)}</Iptc4xmpCore:CiTelWork>`,
    v('contact_url') && `<Iptc4xmpCore:CiUrlWork>${escapeXml(v('contact_url')!)}</Iptc4xmpCore:CiUrlWork>`,
  ].filter(Boolean)
  const elements = [
    v('creator') ? `   <dc:creator><rdf:Seq><rdf:li>${escapeXml(v('creator')!)}</rdf:li></rdf:Seq></dc:creator>` : '',
    v('copyright') ? `   <dc:rights>${alt(v('copyright')!)}</dc:rights>` : '',
    v('usage_terms') ? `   <xmpRights:UsageTerms>${alt(v('usage_terms')!)}</xmpRights:UsageTerms>` : '',
    contact.length ? `   <Iptc4xmpCore:CreatorContactInfo rdf:parseType="Resource">${contact.join('')}</Iptc4xmpCore:CreatorContactInfo>` : '',
  ].filter(Boolean)
  return { attributes, elements }
}

// ── Presets ──────────────────────────────────────────────────────────────────

export interface Preset {
  id: string
  name: string
  fields: IptcValues
  applyToUploads: boolean
}

interface PresetRow {
  id: string
  name: string
  fields: string
  apply_to_uploads: number
}

const presetJson = (row: PresetRow): Preset => {
  let fields: IptcValues = {}
  try {
    fields = clean(JSON.parse(row.fields) as Record<string, unknown>)
  } catch {
    fields = {}
  }
  return { id: row.id, name: row.name, fields, applyToUploads: row.apply_to_uploads === 1 }
}

export async function listPresets(db: D1Database): Promise<Preset[]> {
  const { results } = await db.prepare('SELECT id, name, fields, apply_to_uploads FROM metadata_presets ORDER BY name').all<PresetRow>()
  return results.map(presetJson)
}

export async function getPreset(db: D1Database, id: string): Promise<Preset | null> {
  const row = await db.prepare('SELECT id, name, fields, apply_to_uploads FROM metadata_presets WHERE id = ?').bind(id).first<PresetRow>()
  return row ? presetJson(row) : null
}

export async function savePreset(db: D1Database, input: { id?: string; name: string; fields: IptcValues; applyToUploads: boolean; userId: string }): Promise<Preset> {
  const now = nowIso()
  const fields = JSON.stringify(Object.fromEntries(Object.entries(clean(input.fields)).filter(([, v]) => v !== null)))
  const id = input.id ?? randomId()
  await db
    .prepare(
      `INSERT INTO metadata_presets (id, name, fields, apply_to_uploads, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, fields = excluded.fields, apply_to_uploads = excluded.apply_to_uploads, updated_at = excluded.updated_at`,
    )
    .bind(id, input.name, fields, input.applyToUploads ? 1 : 0, input.userId, now, now)
    .run()
  return (await getPreset(db, id))!
}

/** Apply a preset's fields to assets. Without `overwrite`, only empty fields are filled. */
export function presetStatements(db: D1Database, preset: Preset, assetIds: string[], overwrite: boolean): D1PreparedStatement[] {
  const statement = assetIds.length > 0 ? iptcUpdate(db, assetIds, preset.fields, { fillOnly: !overwrite }) : null
  return statement ? [statement] : []
}

/** Presets marked "apply to new uploads", filling empty fields only. */
export async function applyUploadPresets(db: D1Database, assetIds: string[]): Promise<void> {
  const presets = (await listPresets(db)).filter((p) => p.applyToUploads)
  const statements = presets.flatMap((p) => presetStatements(db, p, assetIds, false))
  if (statements.length > 0) await db.batch(statements)
}

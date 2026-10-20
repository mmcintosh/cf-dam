/**
 * The keyword tree. Tags are keywords; a keyword may have a parent, like Lightroom's keyword list.
 *
 * - `path` is the lower-cased key of the full path ('places|europe|norway|bergen') and is unique;
 *   `full_path` is how it displays ('Places|Europe|Norway|Bergen'); `name_key` is the keyword's own
 *   name lower-cased ('bergen'). Keys are always lower-cased here, in JS: SQLite's lower() and
 *   NOCASE only fold A–Z, so they're never used to compare keywords.
 * - "At or below a keyword" is a range on `path` (`p` itself, or `p|` up to `p}`: '}' follows '|'),
 *   which the unique index answers directly.
 * - Filtering on a keyword includes everything below it; search sees a keyword's ancestors and
 *   synonyms; export follows Lightroom's rules (include on export, export parents, export synonyms).
 * - People type paths with '>', '|' or '›' between levels: `Places > Norway > Oslo`.
 */
import { randomId } from '../lib/crypto'
import { nowIso } from '../lib/time'

export interface KeywordRow {
  id: string
  name: string
  name_key: string
  parent_id: string | null
  path: string
  full_path: string
  include_on_export: number
  export_parents: number
  export_synonyms: number
  synonyms: string
  created_at: string
}

export interface Keyword {
  id: string
  name: string
  parentId: string | null
  /** Display path, levels joined with ' › '. */
  path: string
  includeOnExport: boolean
  exportParents: boolean
  exportSynonyms: boolean
  synonyms: string[]
}

export class KeywordConflict extends Error {}

const SEPARATORS = /\s*(?:>|\||›)\s*/
const DISPLAY_SEPARATOR = ' › '

export function normalizeName(name: string): string | null {
  const clean = name.normalize('NFKC').replace(/\s+/g, ' ').trim()
  return clean.length > 0 && clean.length <= 80 ? clean : null
}

/** One level's name: a separator inside it becomes '/' (as Lightroom's '|' in a name would). */
export const cleanKeywordName = (name: string) => normalizeName(name.replace(/[|>›]/g, '/'))

/** `Places > Norway > Oslo` → ['Places', 'Norway', 'Oslo']. Empty levels are dropped. */
export function splitPath(input: string): string[] {
  return input
    .split(SEPARATORS)
    .map(normalizeName)
    .filter((n): n is string => n !== null)
    .slice(0, 12)
}

const keyOf = (names: string[]) => names.join('|').toLowerCase()
export const displayPath = (fullPath: string) => fullPath.split('|').join(DISPLAY_SEPARATOR)
/** SQL: keyword `t` is `f` or below it, as an index range on `t.path`. */
export const AT_OR_BELOW = (t: string, f: string) => `(${t}.path = ${f}.path OR (${t}.path >= ${f}.path || '|' AND ${t}.path < ${f}.path || '}'))`
/** SQL and bindings: column `path` is the keyword with key `key`, or below it. */
export const atOrBelow = (key: string, column = 'path') => ({ sql: `(${column} = ? OR (${column} >= ? AND ${column} < ?))`, params: [key, `${key}|`, `${key}}`] })
/**
 * SQL: the ids of every keyword at or below the keywords chosen by `from` (a SELECT of ids), walking
 * parent links: a few rows per keyword, rather than a comparison of every keyword with every other.
 */
export const SUBTREE = (from: string) => `WITH RECURSIVE under(root, id) AS (SELECT id, id FROM (${from}) UNION ALL SELECT under.root, t.id FROM tags t JOIN under ON t.parent_id = under.id)`

export function keywordJson(row: KeywordRow): Keyword {
  let synonyms: string[] = []
  try {
    const parsed = JSON.parse(row.synonyms) as unknown
    if (Array.isArray(parsed)) synonyms = parsed.filter((s): s is string => typeof s === 'string')
  } catch {
    synonyms = []
  }
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    path: displayPath(row.full_path),
    includeOnExport: row.include_on_export === 1,
    exportParents: row.export_parents === 1,
    exportSynonyms: row.export_synonyms === 1,
    synonyms,
  }
}

/** Make sure every level of a path exists; returns the id of the last. */
export async function ensurePath(db: D1Database, names: string[]): Promise<string> {
  if (names.length === 0) throw new Error('Empty keyword path.')
  const now = nowIso()
  const statements: D1PreparedStatement[] = []
  for (let i = 0; i < names.length; i++) {
    const level = names.slice(0, i + 1)
    const parentKey = i === 0 ? null : keyOf(names.slice(0, i))
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO tags (id, name, name_key, parent_id, path, full_path, created_at)
           VALUES (?, ?, ?, (SELECT id FROM tags WHERE path = ?), ?, ?, ?)`,
        )
        .bind(randomId(), names[i], names[i]!.toLowerCase(), parentKey, keyOf(level), level.join('|'), now),
    )
  }
  await db.batch(statements)
  const row = await db.prepare('SELECT id FROM tags WHERE path = ?').bind(keyOf(names)).first<{ id: string }>()
  return row!.id
}

/**
 * The keyword someone means by `input`. A path is taken as written (and created). A plain name means
 * the top-level keyword of that name, else the only (or most used) keyword with that name anywhere in
 * the tree, else a new top-level keyword.
 */
export async function resolveKeyword(db: D1Database, input: string): Promise<string | null> {
  const names = splitPath(input)
  if (names.length === 0) return null
  if (names.length > 1) return ensurePath(db, names)
  const existing = await db
    .prepare(
      `SELECT t.id FROM tags t WHERE t.name_key = ?
       ORDER BY (t.parent_id IS NULL) DESC, (SELECT COUNT(*) FROM asset_tags at WHERE at.tag_id = t.id) DESC, t.path
       LIMIT 1`,
    )
    .bind(keyOf(names))
    .first<{ id: string }>()
  return existing?.id ?? ensurePath(db, names)
}

/**
 * resolveKeyword for many inputs at once, in two round trips however many there are: one to look up
 * plain names, one batch that creates every missing level (parents first) and reads back the ids.
 * Returns input → keyword id; inputs that hold no name are left out.
 */
export async function resolveKeywords(db: D1Database, inputs: string[]): Promise<Map<string, string>> {
  const parsed = new Map<string, string[]>()
  for (const input of new Set(inputs)) {
    const names = splitPath(input)
    if (names.length > 0) parsed.set(input, names)
  }
  const out = new Map<string, string>()
  if (parsed.size === 0) return out

  // Plain names: the keyword of that name that resolveKeyword would choose.
  const plain = [...new Set([...parsed.values()].filter((n) => n.length === 1).map(keyOf))]
  const named = new Map<string, string>()
  if (plain.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT name_key, id FROM (
           SELECT t.name_key, t.id, ROW_NUMBER() OVER (
             PARTITION BY t.name_key ORDER BY (t.parent_id IS NULL) DESC, (SELECT COUNT(*) FROM asset_tags at WHERE at.tag_id = t.id) DESC, t.path
           ) AS n
           FROM tags t WHERE t.name_key IN (SELECT value FROM json_each(?))
         ) WHERE n = 1`,
      )
      .bind(JSON.stringify(plain))
      .all<{ name_key: string; id: string }>()
    for (const r of results) named.set(r.name_key, r.id)
  }

  // Everything else is a path, created as needed. One INSERT per depth, so each level's parent exists
  // (made by this batch or already there) when the level below looks it up.
  const wanted = new Map<string, string[]>()
  for (const names of parsed.values()) if (!(names.length === 1 && named.has(keyOf(names)))) wanted.set(keyOf(names), names)
  const ids = new Map(named)
  if (wanted.size > 0) {
    const levels = new Map<string, { id: string; name: string; name_key: string; parent: string | null; path: string; full_path: string; depth: number }>()
    for (const names of wanted.values()) {
      for (let i = 0; i < names.length; i++) {
        const path = keyOf(names.slice(0, i + 1))
        if (levels.has(path)) continue
        levels.set(path, {
          id: randomId(),
          name: names[i]!,
          name_key: names[i]!.toLowerCase(),
          parent: i === 0 ? null : keyOf(names.slice(0, i)),
          path,
          full_path: names.slice(0, i + 1).join('|'),
          depth: i,
        })
      }
    }
    const now = nowIso()
    const depths = Math.max(...[...levels.values()].map((l) => l.depth)) + 1
    const results = await db.batch([
      ...Array.from({ length: depths }, (_, depth) =>
        db
          .prepare(
            `INSERT OR IGNORE INTO tags (id, name, name_key, parent_id, path, full_path, created_at)
             SELECT json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.name_key'),
                    (SELECT id FROM tags WHERE path = json_extract(value, '$.parent')), json_extract(value, '$.path'), json_extract(value, '$.full_path'), ?
             FROM json_each(?)`,
          )
          .bind(now, JSON.stringify([...levels.values()].filter((l) => l.depth === depth))),
      ),
      db.prepare('SELECT id, path FROM tags WHERE path IN (SELECT value FROM json_each(?))').bind(JSON.stringify([...wanted.keys()])),
    ])
    for (const r of results[results.length - 1]!.results as { id: string; path: string }[]) ids.set(r.path, r.id)
  }
  for (const [input, names] of parsed) {
    const id = ids.get(keyOf(names))
    if (id) out.set(input, id)
  }
  return out
}

/** Every keyword the inputs could mean (for removing and filtering): each path, or all keywords with that name. One query. */
export async function matchKeywords(db: D1Database, inputs: string | string[]): Promise<string[]> {
  const parsed = [inputs].flat().map(splitPath).filter((n) => n.length > 0)
  if (parsed.length === 0) return []
  const { results } = await db
    .prepare('SELECT id FROM tags WHERE path IN (SELECT value FROM json_each(?)) OR name_key IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(parsed.filter((n) => n.length > 1).map(keyOf)), JSON.stringify(parsed.filter((n) => n.length === 1).map(keyOf)))
    .all<{ id: string }>()
  return results.map((r) => r.id)
}

/**
 * SQL fragment and binding for "asset `a` has a keyword at or below `input`" (the library's tag
 * filter): a path as written, or a plain name meaning every keyword of that name.
 */
export function keywordFilterSql(input: string): { sql: string; params: unknown[] } {
  const names = splitPath(input)
  const key = keyOf(names)
  if (names.length > 1) {
    const range = atOrBelow(key, 't.path')
    return { sql: `a.id IN (SELECT at.asset_id FROM tags t JOIN asset_tags at ON at.tag_id = t.id WHERE ${range.sql})`, params: range.params }
  }
  return {
    sql: `a.id IN (SELECT at.asset_id FROM tags f JOIN tags t ON ${AT_OR_BELOW('t', 'f')} JOIN asset_tags at ON at.tag_id = t.id WHERE f.name_key = ?)`,
    params: [key],
  }
}

/** The same for one keyword by id (facet links, saved searches): exact, and unaffected by renames. */
export function keywordIdFilterSql(id: string): { sql: string; params: unknown[] } {
  return {
    sql: `a.id IN (SELECT at.asset_id FROM tags f JOIN tags t ON ${AT_OR_BELOW('t', 'f')} JOIN asset_tags at ON at.tag_id = t.id WHERE f.id = ?)`,
    params: [id],
  }
}

export async function getKeyword(db: D1Database, id: string): Promise<KeywordRow | null> {
  return db.prepare('SELECT * FROM tags WHERE id = ?').bind(id).first<KeywordRow>()
}

export interface KeywordNode extends Keyword {
  /** Photos with this keyword itself. */
  count: number
  /** Photos with this keyword or any below it. */
  total: number
}

/**
 * The whole tree with counts, for the keyword manager and autocomplete. Ordered by path. Counts come
 * from the sweep's snapshot (catalog/stats.ts) once there is one: counted live, they read every
 * keyword of every photo (33 s at 1.4 million photos).
 */
export async function keywordTree(db: D1Database): Promise<KeywordNode[]> {
  const snapshot = await db.prepare("SELECT value FROM settings WHERE key = 'stats'").first<{ value: string }>()
  if (snapshot) {
    const { keywords } = JSON.parse(snapshot.value) as { keywords: Record<string, { own: number; total: number }> }
    const { results } = await db.prepare('SELECT * FROM tags ORDER BY path').all<KeywordRow>()
    return results.map((row) => ({ ...keywordJson(row), count: keywords[row.id]?.own ?? 0, total: keywords[row.id]?.total ?? 0 }))
  }
  const [rows, counts] = await db.batch([
    db.prepare('SELECT * FROM tags ORDER BY path'),
    db.prepare(
      `${SUBTREE('SELECT id FROM tags')}
       SELECT under.root AS id, COUNT(DISTINCT CASE WHEN under.id = under.root THEN at.asset_id END) AS count, COUNT(DISTINCT at.asset_id) AS total
       FROM under JOIN asset_tags at ON at.tag_id = under.id JOIN assets a ON a.id = at.asset_id AND a.deleted_at IS NULL
       GROUP BY under.root`,
    ),
  ])
  const byId = new Map(((counts?.results ?? []) as { id: string; count: number; total: number }[]).map((r) => [r.id, r]))
  return ((rows?.results ?? []) as KeywordRow[]).map((row) => ({
    ...keywordJson(row),
    count: byId.get(row.id)?.count ?? 0,
    total: byId.get(row.id)?.total ?? 0,
  }))
}

/** Asset ids carrying `id` or anything below it (to reindex after a rename or move). */
async function assetsUnder(db: D1Database, row: KeywordRow): Promise<string[]> {
  const range = atOrBelow(row.path, 't.path')
  const { results } = await db
    .prepare(`SELECT DISTINCT at.asset_id FROM tags t JOIN asset_tags at ON at.tag_id = t.id WHERE ${range.sql}`)
    .bind(...range.params)
    .all<{ asset_id: string }>()
  return results.map((r) => r.asset_id)
}

/** Rename and/or move a keyword (with everything below it). Returns the assets whose search text changed. */
export async function moveKeyword(db: D1Database, id: string, change: { name?: string; parentId?: string | null }): Promise<string[]> {
  const row = await getKeyword(db, id)
  if (!row) throw new KeywordConflict('No such keyword.')
  const name = change.name !== undefined ? cleanKeywordName(change.name) : row.name
  if (!name) throw new KeywordConflict('A keyword needs a name.')
  // '' is top level, as null is (it used to be stored as a parent that doesn't exist: a 500).
  const parentId = change.parentId !== undefined ? change.parentId || null : row.parent_id
  let parentPath = ''
  let parentFull = ''
  if (parentId) {
    const parent = await getKeyword(db, parentId)
    if (!parent) throw new KeywordConflict('No such parent keyword.')
    if (parent.path === row.path || parent.path.startsWith(`${row.path}|`)) throw new KeywordConflict('A keyword cannot move inside itself.')
    parentPath = `${parent.path}|`
    parentFull = `${parent.full_path}|`
  }
  const newPath = `${parentPath}${name.toLowerCase()}`
  const newFull = `${parentFull}${name}`
  if (newFull === row.full_path && parentId === row.parent_id) return []
  if (newPath !== row.path && (await db.prepare('SELECT 1 FROM tags WHERE path = ?').bind(newPath).first())) {
    throw new KeywordConflict(`“${displayPath(newFull)}” already exists. Merge into it instead.`)
  }
  const affected = await assetsUnder(db, row)
  const range = atOrBelow(row.path)
  await db.batch([
    db.prepare('UPDATE tags SET name = ?, name_key = ?, parent_id = ? WHERE id = ?').bind(name, name.toLowerCase(), parentId, id),
    // Every keyword at or below: swap the old prefix for the new one, in both forms. Lengths are
    // SQLite's own (characters), never JS's (UTF-16 units, which count an emoji twice).
    db
      .prepare(`UPDATE tags SET path = ? || substr(path, length(?) + 1), full_path = ? || substr(full_path, length(?) + 1) WHERE ${range.sql}`)
      .bind(newPath, row.path, newFull, row.full_path, ...range.params),
  ])
  return affected
}

/**
 * Merge `id` into `intoId`: its photos get `intoId`, its children move under `intoId` (merging with
 * same-named children there), and it is deleted. Returns affected assets.
 */
export async function mergeKeyword(db: D1Database, id: string, intoId: string): Promise<string[]> {
  if (id === intoId) return []
  const [row, into] = await Promise.all([getKeyword(db, id), getKeyword(db, intoId)])
  if (!row || !into) throw new KeywordConflict('No such keyword.')
  if (into.path.startsWith(`${row.path}|`)) throw new KeywordConflict('Cannot merge a keyword into one below it.')
  const affected = new Set(await assetsUnder(db, row))
  // Step aside first: merging People › Smith into People, its child People › Smith › Smith takes
  // its place, which it couldn't while this one still held the path.
  await db.prepare("UPDATE tags SET path = '~merging~' || id WHERE id = ?").bind(id).run()
  try {
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, source, created_at) SELECT asset_id, ?, source, created_at FROM asset_tags WHERE tag_id = ?').bind(intoId, id),
      db.prepare('DELETE FROM asset_tags WHERE tag_id = ?').bind(id),
    ])
    const { results: children } = await db.prepare('SELECT id, name_key FROM tags WHERE parent_id = ?').bind(id).all<{ id: string; name_key: string }>()
    for (const child of children) {
      const twin = await db.prepare('SELECT id FROM tags WHERE path = ? AND id != ?').bind(`${into.path}|${child.name_key}`, child.id).first<{ id: string }>()
      if (twin) for (const a of await mergeKeyword(db, child.id, twin.id)) affected.add(a)
      else for (const a of await moveKeyword(db, child.id, { parentId: intoId })) affected.add(a)
    }
    // Deleting cascades to children: only once there are none.
    const gone = await db.prepare('DELETE FROM tags WHERE id = ? AND NOT EXISTS (SELECT 1 FROM tags WHERE parent_id = ?)').bind(id, id).run()
    if (gone.meta.changes === 0) throw new KeywordConflict('Some keywords below it could not be moved; nothing below it was deleted.')
  } catch (error) {
    await db.prepare('UPDATE tags SET path = ? WHERE id = ?').bind(row.path, id).run()
    throw error
  }
  return [...affected]
}

/** Delete a keyword and everything below it, from every photo. Returns affected assets. */
export async function deleteKeyword(db: D1Database, id: string): Promise<string[]> {
  const row = await getKeyword(db, id)
  if (!row) return []
  const affected = await assetsUnder(db, row)
  const range = atOrBelow(row.path)
  await db.batch([
    db.prepare(`DELETE FROM asset_tags WHERE tag_id IN (SELECT id FROM tags WHERE ${range.sql})`).bind(...range.params),
    db.prepare(`DELETE FROM tags WHERE ${range.sql}`).bind(...range.params),
  ])
  return affected
}

export async function updateKeywordOptions(
  db: D1Database,
  id: string,
  options: { includeOnExport?: boolean; exportParents?: boolean; exportSynonyms?: boolean; synonyms?: string[] },
): Promise<string[]> {
  const row = await getKeyword(db, id)
  if (!row) throw new KeywordConflict('No such keyword.')
  const sets: string[] = []
  const params: unknown[] = []
  const flag = (column: string, value: boolean | undefined) => {
    if (value === undefined) return
    sets.push(`${column} = ?`)
    params.push(value ? 1 : 0)
  }
  flag('include_on_export', options.includeOnExport)
  flag('export_parents', options.exportParents)
  flag('export_synonyms', options.exportSynonyms)
  if (options.synonyms !== undefined) {
    sets.push('synonyms = ?')
    params.push(JSON.stringify([...new Set(options.synonyms.map(normalizeName).filter((s): s is string => s !== null))].slice(0, 50)))
  }
  if (sets.length === 0) return []
  await db.prepare(`UPDATE tags SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run()
  // Synonyms are searchable, so the photos need reindexing when they change.
  return options.synonyms !== undefined ? assetsUnder(db, row) : []
}

interface AssetKeyword {
  full_path: string
  include_on_export: number
  export_parents: number
  export_synonyms: number
  synonyms: string
}

async function assetKeywords(db: D1Database, assetId: string): Promise<AssetKeyword[]> {
  const { results } = await db
    .prepare(
      `SELECT t.full_path, t.include_on_export, t.export_parents, t.export_synonyms, t.synonyms
       FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id = ? ORDER BY t.path`,
    )
    .bind(assetId)
    .all<AssetKeyword>()
  return results
}

const parseSynonyms = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

/**
 * What search should match for each asset's keywords: each keyword, its ancestors and its synonyms.
 * One query for any number of assets.
 */
export async function searchTerms(db: D1Database, assetIds: string[]): Promise<Map<string, string>> {
  const terms = new Map(assetIds.map((id) => [id, new Set<string>()]))
  if (assetIds.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT at.asset_id, t.full_path, t.synonyms FROM asset_tags at JOIN tags t ON t.id = at.tag_id
         WHERE at.asset_id IN (SELECT value FROM json_each(?)) ORDER BY t.path`,
      )
      .bind(JSON.stringify(assetIds))
      .all<{ asset_id: string; full_path: string; synonyms: string }>()
    for (const k of results) {
      const set = terms.get(k.asset_id)!
      for (const level of k.full_path.split('|')) set.add(level)
      for (const s of parseSynonyms(k.synonyms)) set.add(s)
    }
  }
  return new Map([...terms].map(([id, set]) => [id, [...set].join(' ')]))
}

/**
 * Keywords as Lightroom writes them: `subjects` is the flat list (dc:subject) and `hierarchical` the
 * full paths (lr:hierarchicalSubject), so Lightroom rebuilds the same tree when it reads the XMP.
 */
export async function exportKeywords(db: D1Database, assetId: string): Promise<{ subjects: string[]; hierarchical: string[] }> {
  const rows = await assetKeywords(db, assetId)
  const { results: all } = rows.length
    ? await db.prepare('SELECT full_path, include_on_export FROM tags').all<{ full_path: string; include_on_export: number }>()
    : { results: [] }
  const exportable = new Map(all.map((r) => [r.full_path.toLowerCase(), r.include_on_export === 1]))
  const subjects = new Set<string>()
  const hierarchical = new Set<string>()
  for (const k of rows) {
    hierarchical.add(k.full_path)
    const levels = k.full_path.split('|')
    if (k.include_on_export === 1) subjects.add(levels[levels.length - 1]!)
    if (k.export_parents === 1) {
      for (let i = 1; i < levels.length; i++) {
        const ancestor = levels.slice(0, i).join('|')
        if (exportable.get(ancestor.toLowerCase()) !== false) subjects.add(levels[i - 1]!)
      }
    }
    if (k.export_synonyms === 1) for (const s of parseSynonyms(k.synonyms)) subjects.add(s)
  }
  return { subjects: [...subjects], hierarchical: [...hierarchical] }
}

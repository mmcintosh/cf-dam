/**
 * The keyword tree. Tags are keywords; a keyword may have a parent, like Lightroom's keyword list.
 *
 * - `path` is the lower-cased key of the full path ('places|europe|norway|bergen') and is unique;
 *   `full_path` is how it displays ('Places|Europe|Norway|Bergen').
 * - Filtering on a keyword includes everything below it; search sees a keyword's ancestors and
 *   synonyms; export follows Lightroom's rules (include on export, export parents, export synonyms).
 * - People type paths with '>', '|' or '›' between levels: `Places > Norway > Oslo`.
 */
import { randomId } from '../lib/crypto'
import { nowIso } from '../lib/time'

export interface KeywordRow {
  id: string
  name: string
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
/** SQL: keyword `t` is `f` or below it. */
export const AT_OR_BELOW = (t: string, f: string) => `(${t}.path = ${f}.path OR substr(${t}.path, 1, length(${f}.path) + 1) = ${f}.path || '|')`

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
          `INSERT OR IGNORE INTO tags (id, name, parent_id, path, full_path, created_at)
           VALUES (?, ?, (SELECT id FROM tags WHERE path = ?), ?, ?, ?)`,
        )
        .bind(randomId(), names[i], parentKey, keyOf(level), level.join('|'), now),
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
      `SELECT t.id FROM tags t WHERE t.path = ? OR t.name = ? COLLATE NOCASE
       ORDER BY (t.parent_id IS NULL) DESC, (SELECT COUNT(*) FROM asset_tags at WHERE at.tag_id = t.id) DESC, t.path
       LIMIT 1`,
    )
    .bind(keyOf(names), names[0])
    .first<{ id: string }>()
  return existing?.id ?? ensurePath(db, names)
}

/** Every keyword `input` could mean (for removing and filtering): the path, or all keywords with that name. */
export async function matchKeywords(db: D1Database, input: string): Promise<string[]> {
  const names = splitPath(input)
  if (names.length === 0) return []
  const { results } = await db
    .prepare(names.length > 1 ? 'SELECT id FROM tags WHERE path = ?' : 'SELECT id FROM tags WHERE path = ? OR name = ? COLLATE NOCASE')
    .bind(...(names.length > 1 ? [keyOf(names)] : [keyOf(names), names[0]]))
    .all<{ id: string }>()
  return results.map((r) => r.id)
}

/** SQL fragment and binding for "asset `a` has a keyword at or below `input`" (the library's tag filter). */
export function keywordFilterSql(input: string): { sql: string; params: unknown[] } {
  const names = splitPath(input)
  const key = keyOf(names)
  return {
    sql: `a.id IN (SELECT at.asset_id FROM asset_tags at JOIN tags t ON t.id = at.tag_id
                   JOIN tags f ON ${AT_OR_BELOW('t', 'f')}
                   WHERE ${names.length > 1 ? 'f.path = ?' : '(f.path = ? OR f.name = ? COLLATE NOCASE)'})`,
    params: names.length > 1 ? [key] : [key, names[0] ?? ''],
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

/** The whole tree with counts, for the keyword manager and autocomplete. Ordered by path. */
export async function keywordTree(db: D1Database): Promise<KeywordNode[]> {
  const [rows, counts] = await db.batch([
    db.prepare('SELECT * FROM tags ORDER BY path'),
    db.prepare(
      `SELECT f.id, COUNT(DISTINCT CASE WHEN t.id = f.id THEN a.id END) AS count, COUNT(DISTINCT a.id) AS total
       FROM tags f JOIN tags t ON ${AT_OR_BELOW('t', 'f')}
       JOIN asset_tags at ON at.tag_id = t.id JOIN assets a ON a.id = at.asset_id AND a.deleted_at IS NULL
       GROUP BY f.id`,
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
  const { results } = await db
    .prepare(`SELECT DISTINCT at.asset_id FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE t.path = ? OR substr(t.path, 1, ?) = ?`)
    .bind(row.path, row.path.length + 1, `${row.path}|`)
    .all<{ asset_id: string }>()
  return results.map((r) => r.asset_id)
}

/** Rename and/or move a keyword (with everything below it). Returns the assets whose search text changed. */
export async function moveKeyword(db: D1Database, id: string, change: { name?: string; parentId?: string | null }): Promise<string[]> {
  const row = await getKeyword(db, id)
  if (!row) throw new KeywordConflict('No such keyword.')
  const name = change.name !== undefined ? normalizeName(change.name.replace(/[|>›]/g, '/')) : row.name
  if (!name) throw new KeywordConflict('A keyword needs a name.')
  const parentId = change.parentId !== undefined ? change.parentId : row.parent_id
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
  const prefixLength = row.path.length
  await db.batch([
    db.prepare('UPDATE tags SET name = ?, parent_id = ? WHERE id = ?').bind(name, parentId, id),
    // Every keyword at or below: swap the old prefix for the new one, in both forms.
    db
      .prepare(
        `UPDATE tags SET path = ? || substr(path, ?), full_path = ? || substr(full_path, ?)
         WHERE path = ? OR substr(path, 1, ?) = ?`,
      )
      .bind(newPath, prefixLength + 1, newFull, row.full_path.length + 1, row.path, prefixLength + 1, `${row.path}|`),
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
  const { results: children } = await db.prepare('SELECT id, name FROM tags WHERE parent_id = ?').bind(id).all<{ id: string; name: string }>()
  for (const child of children) {
    const twin = await db.prepare('SELECT id FROM tags WHERE parent_id = ? AND name = ? COLLATE NOCASE').bind(intoId, child.name).first<{ id: string }>()
    if (twin) for (const a of await mergeKeyword(db, child.id, twin.id)) affected.add(a)
    else for (const a of await moveKeyword(db, child.id, { parentId: intoId })) affected.add(a)
  }
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, source, created_at) SELECT asset_id, ?, source, created_at FROM asset_tags WHERE tag_id = ?').bind(intoId, id),
    db.prepare('DELETE FROM asset_tags WHERE tag_id = ?').bind(id),
    db.prepare('DELETE FROM tags WHERE id = ?').bind(id),
  ])
  return [...affected]
}

/** Delete a keyword and everything below it, from every photo. Returns affected assets. */
export async function deleteKeyword(db: D1Database, id: string): Promise<string[]> {
  const row = await getKeyword(db, id)
  if (!row) return []
  const affected = await assetsUnder(db, row)
  const under = `path = ? OR substr(path, 1, ?) = ?`
  const bind = [row.path, row.path.length + 1, `${row.path}|`]
  await db.batch([
    db.prepare(`DELETE FROM asset_tags WHERE tag_id IN (SELECT id FROM tags WHERE ${under})`).bind(...bind),
    db.prepare(`DELETE FROM tags WHERE ${under}`).bind(...bind),
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

/** What search should match for an asset's keywords: each keyword, its ancestors and its synonyms. */
export async function searchTerms(db: D1Database, assetId: string): Promise<string> {
  const terms = new Set<string>()
  for (const k of await assetKeywords(db, assetId)) {
    for (const level of k.full_path.split('|')) terms.add(level)
    for (const s of parseSynonyms(k.synonyms)) terms.add(s)
  }
  return [...terms].join(' ')
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

/**
 * Migrations in code, for what SQL can't do. They run in order with the SQL files (see migrate.ts).
 */
import { cleanKeywordName } from '../catalog/keywords'
import type { Migration } from './migrate'

interface TagRow {
  id: string
  name: string
  parent_id: string | null
  path: string
  full_path: string
  name_key: string
  created_at: string
}

interface Fixed {
  id: string
  name: string
  name_key: string
  path: string
  full_path: string
  parent_id: string | null
}

/**
 * Keyword keys as the app computes them. Until now they were lower-cased by SQLite, which only folds
 * A–Z, so 'ÖSTERREICH' and 'österreich' were two keywords, and a lookup for one missed the other.
 * Names that still hold a level separator ('>', '›', '|') get '/' instead, as a rename would give.
 * Keywords that turn out to be the same are merged: the photos of each go to one of them (the one
 * already right, else the oldest), and their children with them. Search is redone for the photos.
 */
export async function repairKeywordKeys(db: D1Database): Promise<void> {
  const { results: rows } = await db.prepare('SELECT id, name, parent_id, path, full_path, name_key, created_at FROM tags').all<TagRow>()
  const byId = new Map(rows.map((r) => [r.id, r]))
  const children = new Map<string | null, TagRow[]>()
  for (const r of rows) {
    const parent = r.parent_id && byId.has(r.parent_id) ? r.parent_id : null
    children.set(parent, [...(children.get(parent) ?? []), r])
  }

  const keeperOf = new Map<string, string>() // key → id
  const fullOf = new Map<string, string>() // id → display path
  const changes: Fixed[] = []
  const merges: { from: string; into: string }[] = []

  const visit = (parentId: string | null, parentFull: string | null, newParent: string | null) => {
    const fixed = (r: TagRow) => {
      const name = cleanKeywordName(r.name) ?? r.name
      const full = parentFull === null ? name : `${parentFull}|${name}`
      return { name, full, key: full.toLowerCase() }
    }
    // The one already right keeps its id; otherwise the oldest.
    const siblings = [...(children.get(parentId) ?? [])].sort((a, b) => {
      const right = Number(fixed(b).key === b.path) - Number(fixed(a).key === a.path)
      return right || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    })
    for (const r of siblings) {
      const { name, full, key } = fixed(r)
      const keeper = keeperOf.get(key)
      if (keeper) {
        merges.push({ from: r.id, into: keeper })
        visit(r.id, fullOf.get(keeper)!, keeper)
        continue
      }
      keeperOf.set(key, r.id)
      fullOf.set(r.id, full)
      const want: Fixed = { id: r.id, name, name_key: name.toLowerCase(), path: key, full_path: full, parent_id: newParent }
      if (want.name !== r.name || want.name_key !== r.name_key || want.path !== r.path || want.full_path !== r.full_path || want.parent_id !== r.parent_id) changes.push(want)
      visit(r.id, full, r.id)
    }
  }
  visit(null, null, null)
  if (changes.length === 0 && merges.length === 0) return

  const touched = JSON.stringify([...changes.map((c) => c.id), ...merges.map((m) => m.from)])
  const mergeJson = JSON.stringify(merges)
  await db.batch([
    // Photos of the keywords that change are searched for by their new names: let the sweep reindex them.
    db.prepare('DELETE FROM assets_fts WHERE asset_id IN (SELECT asset_id FROM asset_tags WHERE tag_id IN (SELECT value FROM json_each(?)))').bind(touched),
    // Out of the way first: paths are unique, and the new ones may be taken by rows not yet moved.
    db.prepare("UPDATE tags SET path = '~repair~' || id WHERE id IN (SELECT value FROM json_each(?))").bind(touched),
    db
      .prepare(
        `INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, source, created_at)
         SELECT at.asset_id, json_extract(j.value, '$.into'), at.source, at.created_at FROM asset_tags at JOIN json_each(?) j ON at.tag_id = json_extract(j.value, '$.from')`,
      )
      .bind(mergeJson),
    db.prepare("DELETE FROM asset_tags WHERE tag_id IN (SELECT json_extract(value, '$.from') FROM json_each(?))").bind(mergeJson),
    db
      .prepare(
        `UPDATE tags SET name = json_extract(j.value, '$.name'), name_key = json_extract(j.value, '$.name_key'), path = json_extract(j.value, '$.path'),
           full_path = json_extract(j.value, '$.full_path'), parent_id = json_extract(j.value, '$.parent_id')
         FROM json_each(?) j WHERE tags.id = json_extract(j.value, '$.id')`,
      )
      .bind(JSON.stringify(changes)),
    // Merged keywords have no children left (they moved with the rest), so nothing cascades.
    db.prepare("DELETE FROM tags WHERE id IN (SELECT json_extract(value, '$.from') FROM json_each(?))").bind(mergeJson),
  ])
}

export const CODE_MIGRATIONS: Migration[] = [{ name: '0018_keyword_keys', run: repairKeywordKeys }]

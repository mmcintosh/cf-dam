/**
 * Face boxes, detection only (plans/PLAN-FN2-v2.md in cf-dam-docs). A face is a box and a score on the photo's
 * unedited, upright preview, found by BlazeFace in the helper or a browser tab (never here: the Worker doesn't decode
 * pixels for this). Nothing else is kept: no facial points, no face prints, no matching. Naming a face tags the photo
 * with the person (`asset_people.how = 'face'`), as FN1 does by hand.
 *
 * The switch (Setup → AI review → Find faces) pauses; Remove all deletes. Every write that stores boxes is one guarded
 * batch: it goes through only while faces are on, under the epoch the writer was given, for the preview the boxes were
 * found on, and with the photo's boxes as the writer last saw them, so a pause, a new preview or a name given meanwhile
 * is never overwritten. Boxes never reach clients: not in gallery JSON, share APIs, downloads or XMP.
 */
import { BadRequest } from '../lib/http'
import { say } from '../lib/language'
import { nowIso } from '../lib/time'
import { FACE_MODEL } from './face-detect'
import { markUnindexed } from './search'

export { FACE_MODEL }

/** Whether this install has face finding at all, chosen when deploying (FACES=1, PLAN-FN2-v2 §14). */
export const facesInstalled = (env: { FACES?: string }) => env.FACES === '1'

const MODELS = new Set([FACE_MODEL])
export const MAX_FACES = 100
/** Photos a browser tab or helper is handed at once, and may send back at once. */
export const FACE_BATCH = 20
const CLAIM_MS = 10 * 60_000
const MAX_TRIES = 3
/** A carried-over name needs this much overlap between the old box and the new. */
const CARRY_IOU = 0.5

export interface FaceBox {
  x: number
  y: number
  w: number
  h: number
  score: number
}

export interface FacesSetting {
  on: boolean
  epoch: number
  /** Set while Remove all is deleting: detector boxes from before this epoch go. */
  removeBefore: number | null
}

export async function facesSetting(db: D1Database): Promise<FacesSetting> {
  const { results } = await db.prepare("SELECT key, value FROM settings WHERE key IN ('faces.on', 'faces.epoch', 'faces.remove_before')").all<{ key: string; value: string }>()
  const get = (key: string) => results.find((r) => r.key === key)?.value
  const removeBefore = Number(get('faces.remove_before'))
  return { on: get('faces.on') === '1', epoch: Number(get('faces.epoch') ?? 1), removeBefore: Number.isInteger(removeBefore) && removeBefore > 0 ? removeBefore : null }
}

const upsert = (db: D1Database, key: string, value: string) =>
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(key, value, nowIso())

/** Turn Find faces on or off (off pauses: nothing found so far is touched). Every flip changes the epoch. */
export async function setFacesOn(db: D1Database, on: boolean): Promise<FacesSetting> {
  await db.batch([
    upsert(db, 'faces.on', on ? '1' : '0'),
    db.prepare("UPDATE settings SET value = CAST(value AS INTEGER) + 1, updated_at = ? WHERE key = 'faces.epoch'").bind(nowIso()),
  ])
  return facesSetting(db)
}

export interface FaceCounts {
  boxes: number
  named: number
  photos: number
  toLook: number
}

/** For the Setup panel and Remove all's confirmation. */
export async function faceCounts(db: D1Database): Promise<FaceCounts> {
  const [boxes, todo] = await db.batch<{ boxes: number; named: number; photos: number } | { n: number }>([
    db.prepare("SELECT COUNT(*) AS boxes, COUNT(person_id) AS named, COUNT(DISTINCT asset_id) AS photos FROM faces WHERE source = 'detector'"),
    // Capped: the panel says "more than 10,000".
    db.prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM assets WHERE faces_state IS NULL AND deleted_at IS NULL LIMIT 10001)'),
  ])
  const b = boxes!.results[0] as { boxes: number; named: number; photos: number }
  return { boxes: b.boxes, named: b.named, photos: b.photos, toLook: (todo!.results[0] as { n: number }).n }
}

/**
 * Remove all face boxes the detector found, named ones too (names stay on the photos as tags). Only while faces are
 * off, so nothing is found again while it runs. The sweep does the deleting (`removeSlice`).
 */
export async function removeAllFaces(db: D1Database): Promise<FaceCounts | 'on'> {
  const setting = await facesSetting(db)
  if (setting.on) return 'on'
  const counts = await faceCounts(db)
  await db.batch([
    db.prepare("UPDATE settings SET value = CAST(value AS INTEGER) + 1, updated_at = ? WHERE key = 'faces.epoch'").bind(nowIso()),
    db.prepare("INSERT INTO settings (key, value, updated_at) SELECT 'faces.remove_before', value, ? FROM settings WHERE key = 'faces.epoch' ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(nowIso()),
  ])
  return counts
}

const SLICE = 2000

/**
 * One slice of Remove all, for the sweep: up to 2,000 boxes, then the photos they were on are looked at again next
 * time faces are on, and a tag whose face is gone stays as an ordinary tag. Returns how many boxes went; when nothing
 * is left, Remove all is finished. Three statements, one batch each side of the read.
 */
export async function removeSlice(db: D1Database): Promise<number | null> {
  const { removeBefore } = await facesSetting(db)
  if (removeBefore === null) return null
  const gone = await db
    .prepare("DELETE FROM faces WHERE id IN (SELECT id FROM faces WHERE source = 'detector' AND epoch < ? LIMIT ?) RETURNING asset_id")
    .bind(removeBefore, SLICE)
    .all<{ asset_id: string }>()
  const assets = JSON.stringify([...new Set(gone.results.map((r) => r.asset_id))])
  const [, reset] = await db.batch([
    db
      .prepare("UPDATE asset_people SET how = 'hand' WHERE how = 'face' AND asset_id IN (SELECT value FROM json_each(?)) AND NOT EXISTS (SELECT 1 FROM faces f WHERE f.asset_id = asset_people.asset_id AND f.person_id = asset_people.person_id)")
      .bind(assets),
    // Photos looked at before Remove all (boxes found or not) are looked at again.
    db
      .prepare("UPDATE assets SET faces_state = NULL, faces_tries = 0 WHERE id IN (SELECT id FROM assets WHERE faces_state IN ('done', 'failed') AND faces_epoch < ? LIMIT ?)")
      .bind(removeBefore, SLICE),
  ])
  if (gone.results.length === 0 && reset!.meta.changes === 0) {
    await db.prepare("DELETE FROM settings WHERE key = 'faces.remove_before' AND value = ?").bind(String(removeBefore)).run()
  }
  return gone.results.length
}

// ── What the detectors send ────────────────────────────────────────────────────────────────────────────────────────

const FRAME = /^(\d{1,5})x(\d{1,5}):(\d{1,9})$/
const BOX_KEYS = new Set(['x', 'y', 'w', 'h', 'score'])

/** "width x height : bytes" of the unedited preview the boxes were found on. */
export function parseFrame(value: unknown): string {
  if (typeof value !== 'string' || !FRAME.test(value)) throw new BadRequest('frame is "<width>x<height>:<bytes>" of the preview the faces were found on.')
  return value
}

const dims = (frame: string) => frame.slice(0, frame.indexOf(':'))

/** Up to 100 boxes, each four whole per-mille numbers inside the picture and a score, and nothing else (no keypoints). */
export function parseBoxes(value: unknown): FaceBox[] {
  if (!Array.isArray(value) || value.length > MAX_FACES) throw new BadRequest(`faces is a list of up to ${MAX_FACES} boxes.`)
  return value.map((raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BadRequest('Each face is { x, y, w, h, score }.')
    const box = raw as Record<string, unknown>
    if (Object.keys(box).some((k) => !BOX_KEYS.has(k))) throw new BadRequest('Each face is { x, y, w, h, score } and nothing else.')
    const n = (k: string, min: number, max: number) => {
      const v = box[k]
      if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new BadRequest(`${k} is a whole number from ${min} to ${max}.`)
      return v
    }
    const b = { x: n('x', 0, 999), y: n('y', 0, 999), w: n('w', 1, 1000), h: n('h', 1, 1000), score: n('score', 0, 1000) }
    if (b.x + b.w > 1000 || b.y + b.h > 1000) throw new BadRequest('A face must lie inside the picture.')
    return b
  })
}

export function parseModel(value: unknown): string {
  if (typeof value !== 'string' || !MODELS.has(value)) throw new BadRequest(`model is ${FACE_MODEL}.`)
  return value
}

export interface FoundFaces {
  assetId: string
  /** The boxes, or null when the preview couldn't be read. */
  faces: FaceBox[] | null
  frame: string | null
  /** The helper looking again at an older photo renders it afresh: its frame matches by size, and the file by fingerprint. */
  quickHash?: string | null
}

export function parseFound(value: unknown): FoundFaces[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > FACE_BATCH) throw new BadRequest(`photos is a list of 1 to ${FACE_BATCH}.`)
  return value.map((raw) => {
    const item = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    if (typeof item.assetId !== 'string' || item.assetId.length > 64) throw new BadRequest('Each photo needs its assetId.')
    if (item.failed === true) return { assetId: item.assetId, faces: null, frame: null }
    return {
      assetId: item.assetId,
      faces: parseBoxes(item.faces),
      frame: parseFrame(item.frame),
      quickHash: typeof item.quickHash === 'string' && item.quickHash.length <= 128 ? item.quickHash : null,
    }
  })
}

interface StoredFace {
  id: number
  asset_id: string
  x: number
  y: number
  w: number
  h: number
  source: string
  frame: string | null
  person_id: number | null
  set_aside: number
  named_by: string | null
  updated_at: string
}

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const inter = ix * iy
  return inter / (a.w * a.h + b.w * b.h - inter)
}
const centreInside = (a: FaceBox, b: { x: number; y: number; w: number; h: number }) => {
  const cx = a.x + a.w / 2
  const cy = a.y + a.h / 2
  return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h
}
const aspect = (frame: string) => {
  const m = FRAME.exec(frame)!
  return Number(m[1]) / Number(m[2])
}

export interface StoreResult {
  assetId: string
  status: 'stored' | 'failed' | 'stale' | 'off' | 'gone'
}

/**
 * Store what a detector found for up to 20 photos, each in its own guarded statements (one batch for all). `epoch` is
 * the one the writer was given; `owns` limits a helper to its own photos. Names and set-asides carry over to the new
 * box that overlaps the old one most, but only when the picture kept its shape (the same file, rendered again); after a
 * re-crop the old boxes go, and their names stay as tags on the photo.
 */
export async function storeFound(db: D1Database, found: FoundFaces[], model: string, epoch: number, owns?: { connectionId: string }): Promise<StoreResult[]> {
  const ids = JSON.stringify([...new Set(found.map((f) => f.assetId))])
  const [assetsRead, facesRead] = await db.batch<
    { id: string; faces_frame: string | null; quick_hash: string | null; mime_type: string; deleted_at: string | null; ok: number } | StoredFace
  >([
    db
      .prepare(
        `SELECT a.id, a.faces_frame, a.quick_hash, a.mime_type, a.deleted_at,
           ${owns ? 'EXISTS (SELECT 1 FROM asset_locations l WHERE l.asset_id = a.id AND l.connection_id = ?)' : '1'} AS ok
         FROM assets a WHERE a.id IN (SELECT value FROM json_each(?))`,
      )
      .bind(...(owns ? [owns.connectionId, ids] : [ids])),
    db.prepare('SELECT id, asset_id, x, y, w, h, source, frame, person_id, set_aside, named_by, updated_at FROM faces WHERE asset_id IN (SELECT value FROM json_each(?))').bind(ids),
  ])
  const assets = new Map((assetsRead!.results as { id: string; faces_frame: string | null; quick_hash: string | null; mime_type: string; deleted_at: string | null; ok: number }[]).map((a) => [a.id, a]))
  const stored = facesRead!.results as StoredFace[]
  const now = nowIso()
  const statements: D1PreparedStatement[] = []
  const guards: { assetId: string; index: number; failed: boolean }[] = []
  const results: StoreResult[] = []
  for (const f of found) {
    const asset = assets.get(f.assetId)
    if (!asset || !asset.ok || asset.deleted_at || !asset.mime_type.startsWith('image/')) {
      results.push({ assetId: f.assetId, status: 'gone' })
      continue
    }
    const token = crypto.randomUUID()
    const mine = stored.filter((s) => s.asset_id === f.assetId)
    const latest = mine.reduce((m, s) => (s.updated_at > m ? s.updated_at : m), '')
    const live = `(SELECT value FROM settings WHERE key = 'faces.on') = '1' AND (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'faces.epoch') = ?`
    const unchanged = `COALESCE((SELECT MAX(updated_at) FROM faces WHERE asset_id = ?), '') = ?`
    if (f.faces === null) {
      guards.push({ assetId: f.assetId, index: statements.length, failed: true })
      statements.push(
        db
          .prepare(
            `UPDATE assets SET faces_tries = faces_tries + 1, faces_claimed_at = NULL,
               faces_state = CASE WHEN faces_tries + 1 >= ? THEN 'failed' ELSE faces_state END, faces_epoch = ?
             WHERE id = ? AND faces_state IS NULL AND ${live}`,
          )
          .bind(MAX_TRIES, epoch, f.assetId, epoch),
      )
      continue
    }
    // The frame must be the photo's current preview: exactly, or for a helper's fresh render of an unchanged file, by size.
    const frameOk = asset.faces_frame === null || asset.faces_frame === f.frame || (Boolean(f.quickHash) && f.quickHash === asset.quick_hash && dims(asset.faces_frame) === dims(f.frame!))
    if (!frameOk) {
      results.push({ assetId: f.assetId, status: 'stale' })
      continue
    }
    const frame = asset.faces_frame ?? f.frame!
    // Boxes not from the detector (from files; later by hand) stay, and a detector box over one isn't stored twice.
    const others = mine.filter((s) => s.source !== 'detector')
    const boxes = f.faces.filter((b) => !others.some((o) => centreInside(b, o) || overlap(b, o) >= 0.3))
    // Names and set-asides carry over, best overlap first, only when the picture kept its shape.
    const old = mine.filter((s) => s.source === 'detector' && (s.person_id !== null || s.set_aside === 1) && s.frame && Math.abs(aspect(s.frame) / aspect(frame) - 1) < 0.005)
    const pairs = old.flatMap((o) => boxes.map((b, i) => ({ o, i, iou: overlap(o, b) }))).filter((p) => p.iou >= CARRY_IOU).sort((a, b) => b.iou - a.iou)
    const carried = new Map<number, StoredFace>()
    const usedOld = new Set<number>()
    for (const p of pairs) {
      if (carried.has(p.i) || usedOld.has(p.o.id)) continue
      carried.set(p.i, p.o)
      usedOld.add(p.o.id)
    }
    const rows = boxes.map((b, i) => {
      const o = carried.get(i)
      return { ...b, person: o?.person_id ?? null, aside: o?.set_aside ?? 0, by: o?.named_by ?? null }
    })
    const mark = `(SELECT faces_claimed_at FROM assets WHERE id = ?) = ?`
    guards.push({ assetId: f.assetId, index: statements.length, failed: false })
    statements.push(
      db
        .prepare(`UPDATE assets SET faces_claimed_at = ?, faces_frame = ?, faces_state = 'done', faces_tries = 0, faces_epoch = ? WHERE id = ? AND ${live} AND ${unchanged}`)
        .bind(token, frame, epoch, f.assetId, epoch, f.assetId, latest),
      db.prepare(`DELETE FROM faces WHERE asset_id = ? AND source = 'detector' AND ${mark}`).bind(f.assetId, f.assetId, token),
      db
        .prepare(
          `INSERT INTO faces (asset_id, x, y, w, h, score, model, source, frame, epoch, person_id, set_aside, named_by, created_at, updated_at)
           SELECT ?, json_extract(value, '$.x'), json_extract(value, '$.y'), json_extract(value, '$.w'), json_extract(value, '$.h'),
             json_extract(value, '$.score'), ?, 'detector', ?, ?, json_extract(value, '$.person'), json_extract(value, '$.aside'),
             json_extract(value, '$.by'), ?, ?
           FROM json_each(?) WHERE ${mark}`,
        )
        .bind(f.assetId, model, frame, epoch, now, now, JSON.stringify(rows), f.assetId, token),
      // A name whose face went (the picture changed shape) stays as an ordinary tag.
      db
        .prepare(
          `UPDATE asset_people SET how = 'hand' WHERE asset_id = ? AND how = 'face'
             AND NOT EXISTS (SELECT 1 FROM faces f WHERE f.asset_id = asset_people.asset_id AND f.person_id = asset_people.person_id) AND ${mark}`,
        )
        .bind(f.assetId, f.assetId, token),
      db.prepare(`UPDATE assets SET faces_claimed_at = NULL WHERE id = ? AND faces_claimed_at = ?`).bind(f.assetId, token),
    )
  }
  if (statements.length) {
    const outcome = await db.batch(statements)
    for (const g of guards) results.push({ assetId: g.assetId, status: outcome[g.index]!.meta.changes === 1 ? (g.failed ? 'failed' : 'stored') : await whyRefused(db, g.assetId, epoch) })
  }
  return found.map((f) => results.find((r) => r.assetId === f.assetId)!)
}

/** Off (paused, or another epoch), or something about the photo changed while the boxes were being found. */
async function whyRefused(db: D1Database, _assetId: string, epoch: number): Promise<'off' | 'stale'> {
  const setting = await facesSetting(db)
  return !setting.on || setting.epoch !== epoch ? 'off' : 'stale'
}

/**
 * A new preview was stored (renditions.ts): the photo is looked at again if its picture changed. `frame` is the
 * unedited preview's "width x height : bytes". Videos are never looked at.
 */
export function previewStored(db: D1Database, assetId: string, frame: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE assets SET faces_frame = ?, faces_tries = 0, faces_claimed_at = NULL,
         faces_state = CASE WHEN mime_type LIKE 'video/%' THEN 'skip' ELSE NULL END
       WHERE id = ? AND faces_frame IS NOT ?`,
    )
    .bind(frame, assetId, frame)
}

export interface Claimed {
  assetId: string
  frame: string | null
}

/**
 * Hand out photos to look at, marked as claimed so another tab or helper isn't given them for ten minutes: in an album
 * or a job (a browser tab), or a helper's own (`connectionId`). Photos with no preview yet are skipped until one comes.
 */
export async function claimFaces(db: D1Database, scope: { albumId: string } | { jobId: string } | { connectionId: string }, limit = FACE_BATCH): Promise<Claimed[]> {
  const now = nowIso()
  const stale = new Date(Date.now() - CLAIM_MS).toISOString()
  const [where, bind] =
    'albumId' in scope
      ? ['a.id IN (SELECT asset_id FROM album_items WHERE album_id = ?)', scope.albumId]
      : 'jobId' in scope
        ? ['a.id IN (SELECT ai.asset_id FROM album_items ai JOIN albums al ON al.id = ai.album_id WHERE al.job_id = ?)', scope.jobId]
        : ["a.id IN (SELECT asset_id FROM asset_locations WHERE connection_id = ? AND state = 'present')", scope.connectionId]
  const { results } = await db
    .prepare(
      `UPDATE assets SET faces_claimed_at = ?
       WHERE id IN (
         SELECT a.id FROM assets a
         WHERE a.faces_state IS NULL AND a.deleted_at IS NULL AND a.mime_type LIKE 'image/%' AND ${where}
           AND (a.faces_claimed_at IS NULL OR a.faces_claimed_at < ?)
           AND EXISTS (SELECT 1 FROM renditions r WHERE r.asset_id = a.id AND r.name = 'preview')
         ORDER BY a.created_at DESC LIMIT ?)
       RETURNING id, faces_frame`,
    )
    .bind(now, bind, stale, Math.min(limit, 200))
    .all<{ id: string; faces_frame: string | null }>()
  return results.map((r) => ({ assetId: r.id, frame: r.faces_frame }))
}

// ── Naming ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type FaceChoice = { personId: number } | { setAside: boolean } | { clear: true }

/**
 * Name faces (one person for all of them), set them aside, or clear them. Naming tags each photo with the person
 * (`how = 'face'`, unless it was tagged already); a tag whose last face lost the name goes, if it came from a face.
 * Returns how many faces changed.
 */
export async function chooseFaces(db: D1Database, faceIds: number[], choice: FaceChoice, actorId: string | null): Promise<number> {
  if (faceIds.length === 0 || faceIds.length > 200) throw new BadRequest('Choose 1 to 200 faces.')
  const ids = JSON.stringify([...new Set(faceIds)])
  if ('personId' in choice && !(await db.prepare('SELECT 1 AS here FROM people WHERE id = ?').bind(choice.personId).first())) throw new BadRequest(say('err.noPerson'))
  const before = await db.prepare('SELECT asset_id FROM faces WHERE id IN (SELECT value FROM json_each(?))').bind(ids).all<{ asset_id: string }>()
  if (before.results.length === 0) return 0
  const now = nowIso()
  const set =
    'personId' in choice
      ? db.prepare('UPDATE faces SET person_id = ?, set_aside = 0, named_by = ?, updated_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(choice.personId, actorId, now, ids)
      : 'setAside' in choice
        ? db.prepare('UPDATE faces SET person_id = NULL, set_aside = ?, named_by = ?, updated_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(choice.setAside ? 1 : 0, actorId, now, ids)
        : db.prepare('UPDATE faces SET person_id = NULL, named_by = NULL, updated_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(now, ids)
  const photos = JSON.stringify([...new Set(before.results.map((r) => r.asset_id))])
  const [changed] = await db.batch([
    set,
    ...('personId' in choice
      ? [
          db
            .prepare("INSERT OR IGNORE INTO asset_people (asset_id, person_id, how, created_at) SELECT DISTINCT asset_id, ?, 'face', ? FROM faces WHERE id IN (SELECT value FROM json_each(?))")
            .bind(choice.personId, now, ids),
          db.prepare("UPDATE assets SET facet_people = 'one' WHERE id IN (SELECT value FROM json_each(?)) AND facet_people = 'none' AND facet_people_by IS NULL").bind(photos),
        ]
      : []),
    // Tags that came from a face no face on the photo carries any more.
    db
      .prepare(
        `DELETE FROM asset_people WHERE how = 'face' AND asset_id IN (SELECT value FROM json_each(?))
           AND NOT EXISTS (SELECT 1 FROM faces f WHERE f.asset_id = asset_people.asset_id AND f.person_id = asset_people.person_id)`,
      )
      .bind(photos),
  ])
  await markUnindexed(db, JSON.parse(photos) as string[])
  return changed!.meta.changes
}

export interface FaceJson {
  id: number
  x: number
  y: number
  w: number
  h: number
  source: string
  personId: number | null
  name: string | null
  setAside: boolean
}

/** A photo's boxes on its current preview, for the photo page (viewers too: names are shown to anyone who sees photos). */
export async function photoFaces(db: D1Database, assetId: string): Promise<FaceJson[]> {
  const { results } = await db
    .prepare(
      `SELECT f.id, f.x, f.y, f.w, f.h, f.source, f.person_id, p.name, f.set_aside
       FROM faces f JOIN assets a ON a.id = f.asset_id LEFT JOIN people p ON p.id = f.person_id
       WHERE f.asset_id = ? AND (f.source != 'detector' OR f.frame = a.faces_frame)
       ORDER BY f.x`,
    )
    .bind(assetId)
    .all<{ id: number; x: number; y: number; w: number; h: number; source: string; person_id: number | null; name: string | null; set_aside: number }>()
  return results.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, source: r.source, personId: r.person_id, name: r.name, setAside: r.set_aside === 1 }))
}

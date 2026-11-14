/**
 * One failing stage of the sweep doesn't skip the rest (review B12): it opens its own alert, and the backup and the
 * look for problems still run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSweep } from '../src/catalog/sweeper'
import { createHarness, setUpAdmin, type Harness } from './harness'

let h: Harness

beforeEach(async () => {
  h = await createHarness()
  await setUpAdmin(h)
})
afterEach(async () => {
  vi.useRealTimers()
  await h.dispose()
})

/** The catalog, except that any statement containing `fragment` throws. */
function breaking(db: D1Database, fragment: string): D1Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') {
        return (sql: string) => {
          if (sql.includes(fragment)) throw new Error(`broken on purpose: ${fragment}`)
          return target.prepare(sql)
        }
      }
      const value = Reflect.get(target, prop)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

describe('a sweep stage that throws', () => {
  const stages: [string, string][] = [
    ['process', "id = (SELECT id FROM assets WHERE status = 'queued'"],
    ['index', 'WHERE indexed_at IS NULL AND deleted_at IS NULL'],
    ['hash', 'a.phash IS NULL AND a.deleted_at IS NULL'],
  ]
  for (const [stage, fragment] of stages) {
    it(`opens its own alert and leaves the rest of the run alone (${stage})`, async () => {
      // A minute when the sweep looks for problems.
      vi.useFakeTimers({ toFake: ['Date'] })
      const now = new Date()
      now.setUTCMinutes(10, 0, 0)
      vi.setSystemTime(now)
      const result = await runSweep({ ...h.env, DB: breaking(h.env.DB, fragment) })
      expect(result.backup.started).toBeTruthy()
      expect(result.alerts).not.toBeNull()
      const alert = await h.env.DB.prepare('SELECT kind FROM alerts WHERE key = ? AND resolved_at IS NULL').bind(`sweep:${stage}`).first<{ kind: string }>()
      expect(alert?.kind).toBe('sweep.failed')
    }, 60_000)
  }
})

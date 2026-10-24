/**
 * The Images binding, counted. Cloudflare Images bills each unique transformation (source image and options) per
 * calendar month, beyond an allowance; every image Images produces here adds one to this month's count in `usage`,
 * which the Storage page shows and an alert watches (catalog/alerts.ts). The count is an upper bound: repeats of
 * the same transformation in a month are billed once. `info()` is free and isn't counted.
 */
import type { DamBindings } from '../env'
import { nowIso } from './time'

/** Settings key: alert when a month's count reaches this; 0 turns the alert off. */
export const IMAGES_ALERT_KEY = 'images.alert_at'
/** 80% of the free 5,000 a month on the Images Free plan. */
export const DEFAULT_IMAGES_ALERT = 4000

const month = () => nowIso().slice(0, 7)

export async function noteImageOps(db: D1Database, count = 1): Promise<void> {
  await db
    .prepare("INSERT INTO usage (month, kind, n) VALUES (?, 'images', ?) ON CONFLICT (month, kind) DO UPDATE SET n = n + excluded.n")
    .bind(month(), count)
    .run()
}

export async function imageUsage(db: D1Database): Promise<{ month: string; count: number; alertAt: number }> {
  const row = await db
    .prepare("SELECT (SELECT n FROM usage WHERE month = ? AND kind = 'images') AS n, (SELECT value FROM settings WHERE key = ?) AS alert_at")
    .bind(month(), IMAGES_ALERT_KEY)
    .first<{ n: number | null; alert_at: string | null }>()
  const alertAt = row?.alert_at === null || row?.alert_at === undefined ? DEFAULT_IMAGES_ALERT : Number(row.alert_at)
  return { month: month(), count: row?.n ?? 0, alertAt: Number.isFinite(alertAt) && alertAt >= 0 ? alertAt : DEFAULT_IMAGES_ALERT }
}

/** env.IMAGES, with each `output()` counted. Undefined when the deployment has no Images binding. */
export function countedImages(env: DamBindings): ImagesBinding | undefined {
  const images = env.IMAGES
  if (!images) return undefined
  const wrap = <T extends object>(transformer: T): T =>
    new Proxy(transformer, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target)
        if (typeof value !== 'function') return value
        if (prop === 'output') {
          return async (...args: unknown[]) => {
            const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args)
            // Counting must never break making the image.
            await noteImageOps(env.DB).catch((error) => console.warn('[images] could not count', error))
            return result
          }
        }
        // transform() and draw() return the transformer to chain on: keep counting it.
        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown).apply(target, args)
          return result && typeof result === 'object' && 'output' in result ? wrap(result) : result
        }
      },
    })
  return new Proxy(images, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target)
      if (prop === 'input') return (...args: unknown[]) => wrap((value as (...a: unknown[]) => object).apply(target, args))
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

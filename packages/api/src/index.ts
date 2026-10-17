import { Hono } from 'hono'

/** Cloudflare bindings the API reads. Each becomes required as the feature that uses it lands. */
export interface DamBindings {
  DB?: D1Database
  MEDIA_BUCKET?: R2Bucket
}

export const API_VERSION = '0.0.0'

/** The DAM's JSON API, mounted by the app Worker at `/api`. */
export function createDamApi() {
  const api = new Hono<{ Bindings: DamBindings }>()

  api.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'cf-dam',
      version: API_VERSION,
      bindings: {
        db: c.env?.DB !== undefined,
        mediaBucket: c.env?.MEDIA_BUCKET !== undefined,
      },
    }),
  )

  return api
}

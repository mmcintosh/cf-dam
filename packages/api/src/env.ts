import type { Principal } from './auth/principal'

/** Cloudflare bindings and vars the API reads. */
export interface DamBindings {
  DB: D1Database
  MEDIA_BUCKET?: R2Bucket
  /** Rate-limit counters. Optional: without it, rate limiting is skipped. */
  CACHE_KV?: KVNamespace
  /** Signs Better Auth sessions and encrypts 2FA secrets. Required. */
  BETTER_AUTH_SECRET?: string
  /** Pins the public origin (e.g. https://dam.example.com). Unset, it is taken from each request. */
  BETTER_AUTH_URL?: string
  /** Required to create the first admin anywhere but localhost. */
  SETUP_TOKEN?: string
  /** Encrypts stored storage credentials. Falls back to BETTER_AUTH_SECRET when unset. */
  STORAGE_ENCRYPTION_KEY?: string
  /** Cloudflare Images, for thumbnails and previews. Without it, only embedded thumbnails are used. */
  IMAGES?: ImagesBinding
  /** Workers AI, for tags, alt text and captions. Without it, AI review is off. */
  AI?: Ai
  /** Static assets (Astro's public/ files): the place list for filling in city and country from GPS. */
  ASSETS?: Fetcher
}

export interface DamVariables {
  principal?: Principal
}

export type DamEnv = { Bindings: DamBindings; Variables: DamVariables }

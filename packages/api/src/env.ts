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
  /** "1" offers the pseudo-language (accented, longer English) for testing translations. Staging only. */
  I18N_PSEUDO?: string
  /** Encrypts stored storage credentials. Falls back to BETTER_AUTH_SECRET when unset. */
  STORAGE_ENCRYPTION_KEY?: string
  /** Cloudflare Images, for thumbnails and previews. Without it, only embedded thumbnails are used. */
  IMAGES?: ImagesBinding
  /** Workers AI, for tags, alt text and captions. Without it, AI review is off. */
  AI?: Ai
  /**
   * TypeSafe's Jev, for library facets such as people (catalog/jev-facets.ts). Without it, nothing is sent and the
   * People filter stays empty. Photos go to api.typesafe.ai: revisit before release (cf-dam-docs HANDOFF §19).
   */
  TYPESAFE_API_KEY?: string
  /**
   * Vectorize, for search by meaning (catalog/meaning.ts): 1,024 dimensions, cosine. Without it, that
   * search is absent.
   */
  VECTORS?: Vectorize
  /**
   * Cloudflare Queues, the fast lane for background work (catalog/work.ts). Without it, the sweep does
   * all of it, once a minute.
   */
  WORK?: Queue<import('./catalog/work').WorkMessage>
  /** Static assets (Astro's public/ files): the place list for filling in city and country from GPS. */
  ASSETS?: Fetcher
  /** Tests only: a smaller archive part size (bytes; S3 takes parts down to 5 MiB) than the 64 MiB used. */
  ARCHIVE_PART_BYTES?: string
}

export interface DamVariables {
  principal?: Principal
  /** On agent routes: the calling agent's source. */
  source?: import('./catalog/agents').SourceRow
}

export type DamEnv = { Bindings: DamBindings; Variables: DamVariables }

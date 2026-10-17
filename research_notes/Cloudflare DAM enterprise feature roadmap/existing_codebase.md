# cf-dam: inventory of the existing codebase

Surveyed read-only on 2026-10-16 at `main` @ `56b083d`. All paths are relative to `/home/siddhartha/Infowall/dam/cf-dam`. Line numbers are as of that commit.

## 1. Summary

- This is a working single-Worker DAM at the "Phase 2d" stage: about 8.3k lines of TypeScript, Astro and Svelte across 100 tracked files, written in one day (2026-10-16, 8 commits).
- **Built:**
  - Auth: Better Auth with PBKDF2 passwords, TOTP 2FA, RBAC and scoped API keys.
  - A storage abstraction over the R2 binding and S3 (via aws4fetch), covering all 7 S3 storage classes, Glacier restore, and presigned multipart uploads.
  - Metadata extraction from EXIF, IPTC and XMP (read-only, using `exifr`).
  - WebP thumbnail and preview renditions through the Cloudflare Images binding.
  - FTS5 search, tags, flat albums.
  - Cataloguing an existing bucket in place.
  - A per-minute cron sweep.
- **Not built:** AI, sidecar writing, rights or expiry tracking, usage tracking, sharing or galleries, webhooks, MCP, versioning, lifecycle policies, the NAS agent, Queues, Workflows, Durable Objects or Vectorize.
- **Notable defect:** the `IMAGES` binding that renditions depend on is declared in the API types and the test config, but it is **missing from the deployable `wrangler.jsonc`**. As configured, a deployed instance makes no thumbnails (see §9).

## 2. Stack, versions, license

| Item | Value | Source |
|---|---|---|
| Runtime | One Cloudflare Worker. A Hono entry serves `/api/*` and hands every other path to Astro | `src/fetch.ts:1-42`, `wrangler.jsonc` `main` |
| Astro | 7.4.0 (`output: 'server'`) | `package.json`, `astro.config.mjs` |
| Adapter | `@astrojs/cloudflare` 14.4.0 (uses `@astrojs/cloudflare/hono` `cf()` and `astro/hono` middleware chain) | `src/fetch.ts:2-3,22-28` |
| UI | Svelte 5.57.2 islands via `@astrojs/svelte` 9.1.0 | `package.json`, `svelte.config.js` |
| API framework | Hono 4.13.13 | `packages/api/package.json` |
| Auth library | better-auth 1.7.10 (twoFactor plugin) | `packages/api/src/auth/auth.ts` |
| S3 signing | aws4fetch 1.0.20 (SigV4, `retries: 0`) | `packages/api/src/storage/s3.ts:99-103` |
| Metadata | exifr 7.1.3 | `packages/api/src/catalog/metadata.ts:7` |
| QR codes for 2FA | uqr 0.1.3 | `package.json` |
| Wrangler | 4.151.1 | devDeps |
| TypeScript | 6.0.3 | devDeps |
| Tests | Vitest 5.0.5 with `wrangler.getPlatformProxy` (real workerd D1, KV, R2 and Images). `@cloudflare/vitest-pool-workers` is not used | `packages/api/test/harness.ts:17-33` |
| compatibility_date | `2026-10-12`, `nodejs_compat` | `wrangler.jsonc` |
| Node | >=22 (CI uses Node 24) | `package.json`, `.github/workflows/ci.yml` |
| License | Apache-2.0. NOTICE credits code derived from the Infowall CMS, which derives from SonicJS (MIT) | `LICENSE`, `NOTICE` |
| CI | GitHub Actions: `npm ci` → `check` → `test`, with a RustFS S3 service container that does real SigV4 → `build`, plus a gitleaks job | `.github/workflows/ci.yml` |
| Deploy | README has a "Deploy to Cloudflare" button. Bindings have no IDs, so Wrangler provisions them. Migrations run at runtime because the button never runs `d1 migrations apply` | `README.md`, `wrangler.jsonc` comments, `packages/api/src/db/migrate.ts:1-10` |

**Monorepo (npm workspaces `packages/*`):**
- **Root (`cf-dam`):** the deployable Worker and the Astro front end (`src/`).
- **`packages/api` (`@cf-dam/api`):** the whole JSON API and domain logic. It exports `createDamApi()`, `ensureMigrated`, `runSweep`, `resolvePrincipal` and the server-side read helpers used by Astro pages (`packages/api/src/index.ts:16-22,78-81`).
- There is no NAS agent package yet. It appears as "Phase 5" in the nav.

**Secrets and vars** (`packages/api/src/env.ts:3-18`, `.dev.vars.example`):

| Name | Status | Purpose |
|---|---|---|
| `BETTER_AUTH_SECRET` | Required | |
| `SETUP_TOKEN` | Required off localhost | Creates the first admin |
| `BETTER_AUTH_URL` | Optional | Pins the origin |
| `STORAGE_ENCRYPTION_KEY` | Optional | Falls back to the auth secret |

## 3. Cloudflare bindings

`wrangler.jsonc` declares the following:

| Binding | Type | Used for |
|---|---|---|
| `DB` | D1 (`cf-dam`) | Everything relational, including sessions (deliberately not KV: `auth.ts:58-60`) |
| `MEDIA_BUCKET` | R2 (`cf-dam-media`) | The built-in "r2" storage connection for originals (Standard and Infrequent Access), and **all renditions** (`storage/connections.ts:236-239`) |
| `CACHE_KV` | KV | Only the per-IP auth rate limiter (`auth/rate-limit.ts`). Optional: without it the limiter is skipped |
| `triggers.crons` | `* * * * *` | `scheduled()` calls `runSweep` (`src/fetch.ts:31-41`) |
| `observability` | enabled | Logs |

**Declared in code but absent from `wrangler.jsonc`:**
- `IMAGES` (Cloudflare Images binding). It is typed in `env.ts:17` and used by `catalog/renditions.ts`, but it only appears in the test config `packages/api/test/wrangler.test.jsonc`. The generated `worker-configuration.d.ts:4-10` confirms that `Env` lacks `IMAGES`.

**Absent entirely:**
- Workers AI
- Vectorize
- Queues (the README architecture diagram mentions "Workers AI · Queues" but neither is bound)
- Durable Objects
- Workflows
- Hyperdrive
- Analytics Engine
- Email sending
- Browser Rendering
- Service bindings
- Rate-limit binding
- R2 event notifications

## 4. Data model (D1)

Runtime migrator: `packages/api/src/db/migrate.ts`.
- SQL files are bundled with `import.meta.glob` (lines 17-21).
- Statements are split on semicolons at line ends (32-46). This means **no triggers with bodies**.
- Each migration runs as one `db.batch` transaction and is recorded in `_migrations` (49-69).
- `ensureMigrated` runs once per isolate on the first request (75-83; invoked in `src/fetch.ts:14-17` and in `scheduled`).

Conventions: ISO-8601 TEXT timestamps, INTEGER 0/1 booleans, idempotent DDL (`0001_auth.sql:1-8`).

### 0001_auth.sql (`packages/api/src/db/migrations/0001_auth.sql`)

| Table | Key columns | Lines |
|---|---|---|
| `users` | id, name, email UNIQUE, email_verified, image, is_active, last_login_at, two_factor_enabled | 11-22 |
| `account` (Better Auth) | user_id, provider_id, account_id, OAuth token columns, password (hash) | 24-38 |
| `session` | token UNIQUE, expires_at, ip_address, user_agent | 42-51 |
| `verification` | identifier, value, expires_at (single-use values, kept in D1 for atomic consume) | 55-62 |
| `two_factor` | secret, backup_codes, failed_verification_count NOT NULL DEFAULT 0, locked_until | 67-75 |
| `roles` / `permissions` / `role_permissions` / `user_roles` | RBAC | 80-106 |
| `api_keys` | prefix, key_hash (SHA-256) UNIQUE, scopes (JSON array), expires_at, last_used_at, revoked_at | 111-123 |
| `settings` | key/value. Only seed: `auth.registration_open=false` | 125-129, 175-176 |
| `activity_log` | user_id, action, target_type, target_id, details JSON, ip_address, created_at | 131-142 |

Seeded permissions (145-155): `assets:read|upload|edit|delete`, `ai:run`, `lifecycle:manage`, `sources:manage`, `apikeys:manage`, `users:manage`, `settings:manage`.

System roles (157-173):
- **admin:** everything.
- **editor:** assets:* + ai:run + apikeys:manage.
- **viewer:** assets:read + apikeys:manage.

### 0002_assets.sql (`packages/api/src/db/migrations/0002_assets.sql`)

| Table | Key columns | Lines |
|---|---|---|
| `storage_connections` | provider (`r2-binding` or `s3`), endpoint, region, bucket, prefix, force_path_style, auth_mode, role_arn, access_key_id, secret_sealed (AES-GCM), storage_classes JSON, default_class, is_default. The `r2` row is seeded | 6-24, seed 27-31 |
| `assets` | owner_id, filename, title, caption, **alt**, mime_type, size, sha256, sha256_verified, width/height/orientation, captured_at (camera wall clock) + captured_offset, camera_make/model, lens, focal_length, aperture, exposure_time, iso, gps_lat/lng, rating, **metadata (full JSON of parsed EXIF/IPTC/XMP)**, status (`uploading`, `queued`, `processing`, `ready`, `error`), error, deleted_at (soft delete) | 36-68, indexes 69-74 |
| `asset_locations` | PK (asset_id, connection_id), key, storage_class, state (`pending`, `present`, `archived`, `restoring`, `restored`, `gone`), restore_expires_at, size, etag. The schema allows multiple copies per asset (one per connection) | 77-89 |
| `renditions` | PK (asset_id, name), key, mime_type, width, height, size, source (`worker`, `client`, `embedded`) | 93-104 |
| `uploads` | multipart_id, mode (`direct` or `proxied`), storage_class, part_size, part_count, size, created_by, expires_at | 108-123 |
| `tags` | name UNIQUE COLLATE NOCASE (flat, no hierarchy) | 125-129 |
| `asset_tags` | source (`user`, `import`, `ai`) | 131-138 |
| `albums` | name, description, cover_asset_id, created_by (flat, no nesting, no ACL) | 140-148 |
| `album_items` | position, added_at | 150-157 |
| `assets_fts` (FTS5, porter unicode61) | asset_id UNINDEXED, filename, title, caption, tags, camera, place. The index is maintained by the application, not triggers | 161-170 |

**Tables that do not exist:**
- Rights, licenses or releases (model and property)
- Embargo or expiry dates
- Usage, downloads or analytics
- Shares, galleries or public links
- Collections and smart collections
- Saved searches
- Asset versions
- Custom metadata fields or schemas
- Shoots, events or projects
- AI suggestions or review queue
- Embeddings
- Webhooks
- Jobs
- Lifecycle policies
- NAS agents or sources
- Sidecar records
- Comments or approvals
- Faces or people
- Per-asset or per-album permissions or tenancy

## 5. Features by commit

### Commit subjects (oldest to newest)

1. `551012c` Scaffold one-Worker app: Hono entry serves the JSON API and hands other paths to Astro 7
2. `b5ae859` Phase 0: app at repo root for the Deploy button, Svelte 5, Apache-2.0 LICENSE and NOTICE, CI
3. `7573bbf` Phase 1: accounts, roles, two-factor sign-in and API keys
4. `8f3c0df` Integration tests get a 30s timeout: real D1/KV plus 100k-round PBKDF2 outgrow Vitest's 5s default when files run in parallel
5. `15c4c05` Phase 2a: storage layer, R2 binding and S3 via aws4fetch in every storage class
6. `0ceadb4` Phase 2b: assets, uploads to any connection and class, metadata, renditions, search, albums
7. `ddc2af6` Phase 2c: library, uploader, asset page, storage settings and albums
8. `56b083d` Phase 2d: catalogue an existing bucket in place, and a sweep that finishes restores

### 5.1 Auth and accounts (Phase 1)

- **Identity** is Better Auth on D1, with `database: db` (`auth/auth.ts:60`). A fresh instance is built per request (`auth.ts:42`).
- **Email and password:**
  - Minimum password length is 12 (`auth.ts:114-121`).
  - Hashes are PBKDF2-SHA256 at 100k iterations, the workerd ceiling, stored as `pbkdf2:<iter>:<salt>:<hash>` (`auth/password.ts:10-33`).
- **TOTP 2FA:**
  - Backup codes are supported.
  - The account locks after 5 failures for 15 minutes (`auth.ts:154`).
  - `trustDeviceMaxAge: 0` closes the trusted-device bypass (`auth.ts:157`).
- **Hardening that came from Infowall:**
  - `validateSchema: false` because D1 refuses `sqlite_master` (`auth.ts:132`).
  - Verification values are stored in the DB for atomic consume (`auth.ts:106`).
  - Better Auth's own rate limiter is off (`auth.ts:125`).
- **Account rules:**
  - Sign-up is closed unless the request carries an explicit `allowSignUp` (setup or admin) or the setting `auth.registration_open` is true (`auth.ts:161-170`).
  - Deactivated users get no session (`auth.ts:174-182`).
  - `last_login_at` is updated on each sign-in.
- **Principal** (`auth/principal.ts`):
  - Credentials come from a session cookie or an API key (`Authorization: Bearer cfdam_…` or `X-API-Key`; lines 32-41).
  - An API key's permissions are the owner's grants intersected with the key's scopes (line 74).
  - An invalid key never falls back to the cookie.
  - `is_active` is re-checked on every request.
- **API keys** (`auth/api-keys.ts`):
  - Format is `cfdam_` plus 40 base62 characters (line 10, 68).
  - Only the SHA-256 is stored, with a display prefix.
  - Keys support expiry and revocation, and `last_used_at` is updated via waitUntil.
  - A key cannot mint keys (`routes/me.ts:34`).
  - Scopes must be ones the creator holds (`me.ts:40-41`).
- **RBAC** (`auth/roles.ts`):
  - Grants load in one query.
  - The last active admin is protected (`roles.ts:75-88`; enforced in `routes/users.ts:119-124`).
  - Roles and permissions are seeded only. There is no API to create custom roles.
- **Rate limits** are per IP on KV and read-decided (`auth/rate-limit.ts`):
  - Sign-in: 5 per minute.
  - Sign-up: 3 per minute.
  - Email sends: 3 per minute.
  - 2FA verify: 5 per minute.
  - Password or email change: 5 per minute.
  - Setup: 5 per minute.
  - Paths are matched exactly (lines 60-91).
- **First-run setup:**
  - Open only while there are no users. Off localhost it requires `SETUP_TOKEN`, compared in constant time (`routes/setup.ts:18-79`).
  - Astro middleware redirects everything to `/setup` until an admin exists (`src/middleware.ts:26-29`).
- **Web hardening:**
  - Hono `csrf()` origin check on the API (`packages/api/src/index.ts:32`).
  - Security headers on every response: CSP still allows `script-src 'unsafe-inline'` for Astro hydration (noted as tracked); also HSTS, XFO DENY, nosniff (`lib/security-headers.ts:7,10-27`).
- **Audit:** best-effort writes to `activity_log` (`lib/activity.ts:14-35`) for these actions:
  - `setup.admin_created`, `user.created`, `user.updated`
  - `api_key.created`, `api_key.revoked`
  - `asset.uploaded`, `asset.deleted`, `asset.storage_class_changed`, `asset.restore_requested`
  - `storage.connection_created`, `storage.imported`

  There is **no read API or UI** for the log. Metadata edits (PATCH asset), album changes and downloads are **not** logged.
- **Not present:**
  - SSO, OAuth or SAML. The `account` table could hold OAuth links, but no providers are configured.
  - Email delivery. There is no mailer, so password reset and email verification cannot work.
  - Passkeys.
  - Org or tenant model.

### 5.2 Storage layer (Phase 2a)

- **Interface:** one `StorageProvider` interface (`storage/types.ts:93-116`) with:
  - put, head, get (with byte range), delete, list
  - multipart create, uploadPart, complete, abort
  - optional `presignPart`, `presignGet`, `setStorageClass`, `restore`
  - `test()`

  Capabilities flags are presign, storageClasses, restore and changeClass (82-91).
- **R2Provider** (`storage/r2.ts`):
  - Uses the Worker binding, with STANDARD and STANDARD_IA mapped to R2 Standard and InfrequentAccess (lines 18-29).
  - It cannot presign (capabilities 33-38), so uploads to R2 are proxied through the Worker.
  - It streams parts with `FixedLengthStream` (97-109).
- **S3Provider** (`storage/s3.ts`, aws4fetch):
  - Handles virtual-hosted and path-style addressing (90-97).
  - Supports all 7 classes, from STANDARD through DEEP_ARCHIVE (`types.ts:10-18`). `ARCHIVE_CLASSES` = GLACIER and DEEP_ARCHIVE (`types.ts:22`).
  - Lists with ListObjectsV2 using a hand-rolled XML extractor (`storage/xml.ts`).
  - Presigns PUT for parts and GET with `response-content-disposition` (237-253).
  - Changes class in place via CopyObject (255-280). Objects over 5 GiB are refused: "multipart copy, which is not supported yet" (265-267).
  - Restores from Glacier with Expedited, Standard or Bulk tiers and parses `x-amz-restore` (57-64, 282-295).
  - `test()` writes, reads and deletes a probe object.
- **Connections** (`storage/connections.ts`):
  - The built-in `r2` connection is always present. The admin adds S3 connections (`createS3Connection` 143-180).
  - AWS endpoints default to all classes; other S3-compatible endpoints default to STANDARD only (112-114).
  - Endpoints must be https, except localhost (129-141).
  - Credentials are sealed with AES-256-GCM, using a key derived by HKDF from `STORAGE_ENCRYPTION_KEY` or `BETTER_AUTH_SECRET` (`storage/secret-box.ts:26-54`).
  - `AuthMode` declares `'oidc-role' | 'agent'`, and there is a `role_arn` column, but only `access-key` works ("not supported yet", line 213).
  - Deletion is refused while the connection holds originals; the built-in connection cannot be deleted (190-199).
- **UI presets:** AWS S3, R2's S3 API, Backblaze B2, Wasabi and custom. The UI generates the CORS rule needed for direct browser uploads (`src/components/Connections.svelte:27-28,129,215`).

### 5.3 Uploads (Phase 2b and 2c)

The protocol is documented in `catalog/uploads.ts:1-11`.

- **Create:** `POST /api/uploads` creates the asset (`status='uploading'`), a `pending` location, and an `uploads` row, and starts the multipart upload (102-159).
  - Part size is at least 16 MiB, at most 10,000 parts, and an object can be up to 5 TiB (20-23).
  - **Direct mode:** parts go to presigned S3 URLs with a 1-hour TTL.
  - **Proxied mode:** for R2, parts go through the Worker. Parts are at most 95 MB, so uploads cap at about 950 GB (24-29).
  - Uploads expire after 7 days (30).
- **Storage key layout:** `<prefix>/originals/YYYY/MM/<assetId>/<filename>` (line 127).
- **Dedupe:** by client-supplied SHA-256, which returns 409 `duplicateOf` (109-113). The server **never verifies** the hash. `sha256_verified` is never written anywhere.
- **Complete:** verifies the size with HEAD and deletes the object plus the asset row on mismatch (230-239). It then sets the location to `present` and the asset to `processing`, and runs `processAsset` via `waitUntil` (`routes/uploads.ts:94-95`).
- **Client renditions:** `PUT /api/uploads/:id/renditions/{thumb|preview}` accepts at most 4 MB, re-encoded through Images (`catalog/renditions.ts:101-113`). This is for originals sent straight to Glacier, or larger than 70 MB.
- **MIME type:** taken from the extension map, which includes RAW formats (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2), mp4/mov, pdf and xmp (72-78).
- **Browser client** (`src/lib/uploader.ts`):
  - SHA-256 is computed in the browser for files up to 512 MB (34, 108). Larger files skip dedupe.
  - 3 concurrent parts (31), each retried 4 times with backoff.
  - Part URLs are fetched in batches of 50.
  - OffscreenCanvas WebP previews are made in the browser when the Worker can't read the original (126-132).
  - The UI is drag and drop, with a connection and class picker (`src/components/Uploader.svelte`).
- **Not present:**
  - tus or resumable-across-sessions uploads.
  - Folder upload with structure preservation.
  - Server-side verification of the hash.
  - Upload of a sidecar paired with its original.

### 5.4 Metadata extraction (Phase 2b)

- **Where it runs:** in the Worker, `catalog/process.ts`. Only the first 512 KiB of the original is read, using a range GET (`metadata.ts:10`, `process.ts:57-62`). This works for huge S3 objects.
- **Library:** `exifr.parse` with TIFF, EXIF, GPS, IPTC and XMP enabled; ICC is off; `reviveValues:false` keeps the camera's wall clock (`metadata.ts:87-101`).
- **Normalized fields:**
  - Dimensions and orientation
  - capturedAt and offset
  - Make, model and lens
  - Focal length, aperture, exposure time and ISO
  - GPS in decimal degrees
  - Rating
  - Title (ObjectName, title or Headline)
  - Caption
  - Keywords (IPTC Keywords, XMP subject, and HierarchicalSubject split on `|`, up to 200)
  - Copyright and creator (`metadata.ts:12-37, 65-75, 107-130`)
- **Persistence:** `COALESCE` so values a user already set win (`process.ts:21-44`). The full parse goes into the `assets.metadata` JSON column, along with copyright and creator (line 40). Keywords become tags with `source='import'` (line 43).
- **Gaps:**
  - Copyright and creator are not columns and are not searchable.
  - There are no IPTC Core or Extension fields: usage terms, credit line, rights URL, model or property release, location hierarchy, event, persons.
  - **Nothing is ever written back.** There is no XMP sidecar generation or embedding, even though the README promises "Keywords and captions are written back to XMP sidecars".
  - Existing `.xmp` sidecars in a bucket are imported as separate assets (their MIME type maps to `application/rdf+xml`). They are not paired with their image or parsed into it.

### 5.5 Renditions (Phase 2b)

- **Named sizes only** (`catalog/renditions.ts:10-13`). Both are WebP, stored in the built-in R2 bucket at `renditions/<assetId>/<name>.webp` (25):
  - `thumb`: 480 px long edge, quality 78.
  - `preview`: 2048 px long edge, quality 82.
- **Generation:** through the **Images binding** (`images.input().transform().output()`, 48-58). The preview is made from the original, then the thumb from the preview (64-79).
- **Limits and fallbacks:**
  - Originals over 70 MB are not transformed (21).
  - The renderable types are JPEG, PNG, WebP, AVIF, GIF, HEIC/HEIF and TIFF (`metadata.ts:134-143`).
  - For RAW, the JPEG embedded in the header is extracted with `exifr.thumbnail` and becomes the thumb only, with `source='embedded'` (`process.ts:74-78`).
  - If `env.IMAGES` is missing, generation silently returns null (renditions.ts:69) and client renditions are rejected (106).
- **Serving:** `GET /api/assets/:id/renditions/:name`, which needs `assets:read`, sends `Cache-Control: private, max-age=86400` and streams through the Worker (`routes/assets.ts:105-119`). There is no CDN or public URL, no signed URL, and no watermark.
- **Not present:**
  - Video poster frames or transcodes.
  - PDF previews.
  - Custom or on-the-fly sizes. These are deliberately excluded, citing transform-cost abuse in the Infowall audit.
  - Crops or focal points.
  - AVIF output.
  - Watermarking.

### 5.6 Search, tags, albums (Phase 2b and 2c)

- **Index:** FTS5 over filename (also indexed with separators split into words), title, caption, tags and camera/lens (`catalog/search.ts:13-41`).
  - `place` is always `''` (line 36).
  - `alt` and `metadata` are not indexed.
- **Query sanitization:** each word becomes a quoted prefix term, at most 12 terms (47-55).
- **List filters** (`catalog/assets.ts:168-233`): q, tag, camera (exact model), album, from/to on captured_at, and sort by captured or added. Paging is offset-based, at most 200 per page.
  - The library page only exposes q, tag and sort (`src/pages/index.astro:9-19`).
  - There are no facets, rating filter, map view or saved searches.
- **Tags** are flat; `GET /api/tags` returns the top 500 by count. There is no rename, merge, synonym or hierarchy.
- **Albums** are flat and global, with no per-album permissions, nesting or smart albums. Endpoints cover CRUD, add/remove items (500 per call), and cover selection (`routes/albums.ts`).
- **Front end:**
  - The grid uses justified rows in pure CSS with tier badges: Hot, Warm, Cold, Deep archive (`src/components/AssetGrid.astro`, `TierBadge.astro:8-16`).
  - Cmd/Ctrl+K focuses search (`AppLayout.astro`).
  - The asset page shows preview, facts and GPS coordinates as text (`src/pages/assets/[id].astro:56`); there is no map or reverse geocoding.
  - The asset page also has an editor for title, caption, alt, rating, tags and album (`AssetEditor.svelte`), and a storage panel (`StoragePanel.svelte`).

### 5.7 Tiering and restores (Phase 2b, 2c, 2d)

All operations are per asset and manual:
- **Class change:** `POST /api/assets/:id/storage-class` (`routes/assets.ts:160-181`). The UI warns about minimum-stay billing (`StoragePanel.svelte:131`).
- **Restore:** `POST /api/assets/:id/restore` with days 1-30 and tier Expedited, Standard or Bulk (183-205).
- **Refresh:** `POST /api/assets/:id/refresh` re-reads state with HEAD and can mark a location `gone` (208-230).
- **Reprocess:** `POST /api/assets/:id/reprocess` (233-239).
- **Downloading an archived original** returns 409 until it is restored (122-129).
- **Downloads** use a presigned GET with a 300-second TTL for S3, or stream for R2 (134-147). Originals are always served as attachments.

Not present:
- **Lifecycle policies:** no rules engine, no bulk moves. The nav shows "Lifecycle — Phase 6" (`src/layouts/AppLayout.astro:27`).
- **Replication:** no copying an asset to a second connection, even though `asset_locations` supports one row per connection.

### 5.8 Catalogue in place and the sweep (Phase 2d)

- **Import:** `POST /api/connections/:id/import` with `{prefix?, cursor?}` lists one page of up to 1000 objects (`routes/connections.ts:82-105`, `catalog/importer.ts:28-71`).
  - It skips keys already known for that connection, folder markers and the probe object (24-26).
  - It creates assets with `status='queued'`, or `ready` plus location `archived` for Glacier objects.
  - Nothing is copied.
  - The UI loops through cursors (`Connections.svelte:89-103`).
- **Sweep:** `runSweep` runs every minute from cron (`catalog/sweeper.ts:24-68`).
  1. It claims and processes up to 25 queued assets within a 20-second budget (14-16, 28-42). That caps throughput at roughly 25 × 1440 ≈ 36k assets a day.
  2. It checks up to 50 `restoring` locations with HEAD and marks them `restored` with `restore_expires_at` (44-65).
- There are no Queues or Workflows, no retry or backoff for `error` assets, and no dead-letter handling.

### 5.9 Frontend pages

| Page | Contents |
|---|---|
| `/setup`, `/login` | First-run setup and sign-in (`SetupForm.svelte`, `LoginForm.svelte`), including the 2FA step |
| `/` | Library and uploader |
| `/assets/[id]` | Asset page |
| `/albums`, `/albums/[id]` | Albums |
| `/settings/storage` | Connections and import |
| `/admin/users` | People admin (`UsersAdmin.svelte`) |
| `/account` | Password, 2FA enrolment with QR, API keys (`ChangePassword.svelte`, `TwoFactor.svelte`, `ApiKeys.svelte`) |

Page permission gates are in `src/middleware.ts:15-20`. Nav placeholders: "NAS agents — Phase 5" and "Lifecycle — Phase 6" (`AppLayout.astro:26-27`).

## 6. API surface (all under `/api`, `packages/api/src/index.ts:34-66`)

### Unauthenticated

| Method and path | Permission | Purpose |
|---|---|---|
| GET `/health` | none | Version and binding presence |
| GET/POST `/auth/*` | none | Better Auth (sign-in/up/out, get-session, two-factor/*, change-password…), rate-limited |
| GET/POST `/setup` | none | First admin |

### Authenticated (`authenticate()` middleware)

| Method and path | Permission |
|---|---|
| GET `/me` | signed in |
| GET/POST `/me/api-keys`, DELETE `/me/api-keys/:id` | `apikeys:manage` (POST requires a session) |
| GET/POST `/users`, PATCH `/users/:id` | `users:manage` |
| GET `/roles` | `users:manage` |
| GET `/connections` | `assets:upload` |
| POST `/connections`, POST `/connections/:id/test`, POST `/connections/:id/import`, POST `/connections/:id/default`, DELETE `/connections/:id` | `sources:manage` |
| POST `/uploads`, POST `/uploads/:id/part-urls`, PUT `/uploads/:id/parts/:part`, PUT `/uploads/:id/renditions/:name`, POST `/uploads/:id/complete`, DELETE `/uploads/:id` | `assets:upload` (and owner of the upload) |
| GET `/assets` (q, tag, camera, album, from, to, sort, limit, offset), GET `/assets/:id` | `assets:read` |
| PATCH `/assets/:id` (title, caption, alt, rating 0-5, tags) | `assets:edit` |
| DELETE `/assets/:id` (soft) | `assets:delete` |
| GET `/assets/:id/renditions/:name`, GET `/assets/:id/original` | `assets:read` |
| POST `/assets/:id/storage-class`, POST `/assets/:id/restore` | `lifecycle:manage` |
| POST `/assets/:id/refresh` | `assets:read` |
| POST `/assets/:id/reprocess` | `assets:edit` |
| GET `/albums`, GET `/albums/:id` | `assets:read` |
| POST `/albums`, PATCH/DELETE `/albums/:id`, POST/DELETE `/albums/:id/items` | `assets:edit` |
| GET `/tags` | `assets:read` |

Unused permissions: `ai:run` and `settings:manage` are seeded but no route checks them. There is no OpenAPI spec, no API versioning beyond `API_VERSION='0.1.0'`, no bulk endpoints (other than album items), no batch edit, no export, and no public or unauthenticated delivery endpoints.

## 7. Tests

**Setup:** Vitest 5 with `getPlatformProxy` against `packages/api/test/wrangler.test.jsonc`, which binds D1, KV, R2 **and IMAGES**.
- Each harness gets a fresh in-memory database (`test/harness.ts`).
- Timeout is 30 seconds; the fs module cache is off so new migrations are picked up (`vitest.config.ts`).
- Fixtures: `camera.jpg` (made with sharp, with EXIF and GPS) and `gradient.png`.

There are **66 test cases in 8 files.** The S3-dependent suites are `skipIf(!S3_TEST_ENDPOINT)`; CI runs them against RustFS.

| File | Tests | Coverage |
|---|---|---|
| `auth.test.ts` | 11 | setup, setup token, sessions, closed registration, sign-out, 401, rate limiting, CSRF |
| `users-and-keys.test.ts` | 11 | user admin, deactivation, last admin, API key issue/scope/revoke/expiry, no key-mints-key |
| `assets.test.ts` | 14 | R2 upload → EXIF → WebP renditions → FTS; search by camera/filename/tag; dedupe; size mismatch; SVG as download; client preview; archived 409; soft delete; viewer permissions; upload privacy; albums; S3 connection test/presigned upload/in-use protection |
| `import-and-sweep.test.ts` | 2 | catalogue in place and sweep processing; sweep finishing a restore |
| `storage-s3.unit.test.ts` | 15 | addressing, class headers, class change, archived guard, 200-with-Error, restore, presign, multipart, list (injected fetch) |
| `storage-s3.integration.test.ts` | 7 | real SigV4 put/head/range/list/delete, multipart (proxied and presigned), presigned download, abort, bad credentials |
| `migrate.test.ts` | 4 | statement split, ordering, idempotency, admin seed |
| `secret-box.test.ts` | 2 | AES-GCM round trip, tamper |

There are no front-end or E2E tests in the repo. The Phase 2c commit body mentions manual Playwright checks.

## 8. Design decisions worth keeping

- **One Worker, one-click deploy.** Bindings have no IDs and migrations run at runtime. Every migration must be idempotent and must avoid trigger bodies (`migrate.ts:1-10,26-31`).
- **Better Auth owns identity; cf-dam owns authorization.** API keys are capped by the owner's permissions.
- **Renditions always live in the built-in R2 bucket**, so the catalog stays viewable whatever tier the original is in (`0002_assets.sql:91-92`).
- **Named rendition sizes only**, to prevent transform-cost abuse (`renditions.ts:1-5`).
- **Metadata reads use a head-of-file range GET** (512 KiB), never a full download.
- **Hot filter fields are promoted to columns; the full parse stays in a JSON column.** User edits beat file metadata via COALESCE.
- **Bytes bypass the Worker for S3** (presigned). R2 uploads are proxied because the binding can't presign. R2's S3 endpoint can be added as an S3 connection to get presigning.
- **Credentials are sealed at rest.** The connection test is a real write, read and delete.
- **Originals are always attachments** with a safe Content-Disposition. Only raster types are served inline (`metadata.ts:146`).
- **The cron sweep is the only background executor.** There is no Queue.

## 9. Bugs and inconsistencies noticed (read-only observation)

1. **`IMAGES` binding missing from `wrangler.jsonc`.**
   - It is only in `packages/api/test/wrangler.test.jsonc`, and generated `Env` lacks it (`worker-configuration.d.ts:4-10`).
   - Deployed as configured, `generateRenditions` returns null (`renditions.ts:69`), embedded thumbnails are skipped, and browser-made previews are rejected (`renditions.ts:106`).
   - Result: no thumbnails or previews in production.
2. **Restored Glacier originals are never processed.**
   - `processAsset` treats any location whose `storage_class` is GLACIER or DEEP_ARCHIVE as unreadable (`process.ts:53`), whatever its `state`. A restored object keeps its archive class.
   - This contradicts the comments "restoring one later lets it be processed" (`importer.ts:7`) and "Run processing again… e.g. after a restore" (`routes/assets.ts:232`).
3. **`sha256_verified` is never set.** Dedupe trusts the client hash, and objects added by the importer have no hash at all.
4. **Expired `uploads` are never cleaned up.** There is an index on `expires_at`, but the sweeper ignores it. Abandoned multipart parts and assets stuck in `uploading` accumulate.
5. **`restored` never reverts to `archived`** after `restore_expires_at`. Only a manual refresh fixes it.
6. **Soft delete leaves the original and renditions in storage.** There is no purge, trash or restore-from-trash.
7. **`activity_log` is write-only**, with no reader. The `auth.registration_open` setting has no API or UI to toggle it.
8. **README overstates things.** It still says "Status: early scaffold. Nothing here is usable yet", yet lists Workers AI and Queues in the architecture diagram, which are not bound.
9. **`place` FTS column is always empty**, and `alt` text is not searchable.

## 10. Gaps against the enterprise target

| Target capability | Status in code |
|---|---|
| AI alt text and descriptions | **Absent.** The `assets.alt` column and manual edit exist; the `ai:run` permission and `asset_tags.source='ai'` are reserved. No Workers AI binding, no suggestion or review tables, no approve/dismiss flow (the README promises one) |
| AI auto-tagging, shoot/event grouping | **Absent.** No shoot, event, project or job entity; no clustering by time or GPS; no embeddings or Vectorize; no face or people model |
| Semantic or visual search | **Absent.** FTS5 keyword search only |
| EXIF/IPTC/XMP read | **Partial.** exifr, head-of-file only. A minimal normalized set; rights fields only in the JSON blob |
| XMP sidecar write and embed | **Absent.** Read-only. `.xmp` files are imported as standalone assets, not paired |
| Rights, licensing, expiration | **Absent.** No license, usage terms, model or property release, embargo or expiry columns; no expiry alerts or blocking |
| Usage tracking | **Absent.** Downloads and rendition views are not logged; no analytics |
| Multi-destination storage (R2 + S3) | **Strong foundation.** Built-in R2 plus any number of S3 connections and all classes; the schema supports multiple copies. **Missing:** replication or copy-between-connections, lifecycle policies (Phase 6), STS/OIDC role auth (`oidc-role` declared, unsupported), multipart copy over 5 GiB, bucket event notifications, checksum or fixity audits |
| Catalogue in place / NAS | **Partial.** Bucket import exists. The NAS agent is "Phase 5" (agent auth mode declared, unsupported) |
| Sharing, client galleries, proofing (PhotoShelter core) | **Absent.** No public links, expiring links, password galleries, watermarks, download permissions, favorites or selects, client accounts |
| Delivery and CDN | **Absent.** Renditions are private and streamed through the Worker; no public or edge-cached delivery, no on-the-fly transforms |
| Webhooks and events | **Absent** |
| API keys / MCP / integrations | **API keys done** (scoped, hashed). No OpenAPI, no MCP server, no OAuth apps, no Lightroom or Photo Mechanic plugins |
| Versioning | **Absent.** One original per asset; no version history, no metadata history |
| Audit log | **Partial.** Written for key actions (not metadata edits, album changes or downloads); no viewer, export or retention |
| Collections and organization | **Basic.** Flat albums and tags. No nested folders or collections, smart collections, saved searches, hierarchical keywords or controlled vocabularies |
| Custom metadata schemas | **Absent** |
| Bulk operations | **Minimal.** Album add/remove only; no batch edit, batch move or restore, or export |
| Video and documents | **Minimal.** MIME types are recognised; no poster frames, transcodes or PDF previews |
| Workflow, approvals, comments | **Absent** |
| Multi-tenancy / org / SSO | **Absent.** Single tenant, global ACL, email and password plus TOTP only; no SAML or OIDC; no email delivery |
| Background processing at scale | **Weak.** A per-minute cron at about 25 assets per run. No Queues, Workflows or DO coordination; no retries for `error` assets |
| Observability, admin | Workers observability is on. No jobs dashboard, storage or usage reports, or cost view |

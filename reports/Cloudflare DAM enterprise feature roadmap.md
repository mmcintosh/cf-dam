# Harden cf-dam, then outgrow PhotoShelter in phases

cf-dam already has the hard, boring parts of an enterprise DAM: a single Cloudflare Worker with hardened auth, scoped API keys, a storage layer that reaches R2 and every S3 storage class, metadata extraction and catalogue-in-place. It is not yet safe to deploy, though. As configured, production makes **no thumbnails** because the `IMAGES` binding is missing from `wrangler.jsonc`. Restored Glacier originals are never processed, upload hashes are never verified, and deleted assets leave orphaned objects in storage. The recommendation is a short **fix-first phase (2e)** followed by five build phases, ordered so that the first user gets value without ever putting their archive at risk. **Phase 3** builds a metadata spine: a Shoot/Job entity, field-level provenance, XMP sidecars, rights and release records, and a remote MCP server so the owner's AI tools can write alt text into the index. **Phase 4** adds a NAS agent and Mac bridges, with verified copies on R2 and on S3 Deep Archive. **Phase 5** adds AI enrichment and semantic search. **Phase 6** adds galleries, proofing, signed delivery and rights enforcement, and is the point at which PhotoShelter can be cancelled. **Phase 7** is enterprise identity, governance and provenance. The economics are lopsided in the DAM's favour. A working photographer's 5 TB archive costs roughly **$70 a month** with one copy on R2 and one in Deep Archive, against PhotoShelter Pro at $45 a month for only 500 GB, and against enterprise SaaS DAM contracts with medians of $25K–$50K a year. The sharpest risks are legal rather than technical: face recognition under BIPA and Texas CUBI, the restriction on EU-domiciled users of Llama's multimodal models, the PLUS permission clause, InsightFace's non-commercial model weights, AI-provider retention terms, and CMI-stripping liability if renditions drop rights metadata.

## A sound spine with nine defects that block production

The inventory covers `main` at `56b083d` (2026-10-16): about 8.3k lines of TypeScript, Astro and Svelte across eight commits. The solid foundations are these:

- **Auth.** Better Auth on D1 uses PBKDF2 at the workerd ceiling of 100k iterations, TOTP with lockout, no trusted-device bypass, closed registration, and per-IP rate limits on KV.
- **API keys.** Only the SHA-256 is stored. A key's permissions are its scopes intersected with the owner's grants, and a key cannot mint another key.
- **Storage.** `StorageProvider` covers the R2 binding and aws4fetch S3 across all seven classes, with Glacier restore, presigned multipart and credentials sealed with AES-GCM.
- **Uploads.** Multipart uploads are presigned for S3 and proxied for R2, which cannot presign.
- **Metadata.** Extraction reads only the first 512 KiB of a file with a range GET.
- **Renditions.** Thumb and preview are named WebP sizes, always stored in R2 so the catalog stays browsable whatever tier the original is in.
- **Search and organisation.** FTS5 search, flat tags and albums.
- **Catalogue in place.** An existing bucket can be catalogued without copying, driven by a per-minute cron sweep.
- **Tests.** 66 tests run against real workerd D1, KV, R2 and Images, plus RustFS for real SigV4.

Several design decisions are worth carrying forward unchanged:

- one Worker with a one-click deploy and runtime migrations;
- Better Auth owns identity while cf-dam owns authorization;
- named rendition sizes only, to prevent transform-cost abuse;
- hot fields promoted to columns, with the full parse kept as JSON;
- user edits beat file metadata via `COALESCE`.

The defects come from the same inventory and were spot-checked against the working tree. All but the last row belong in Phase 2e.

| # | Defect (evidence) | Consequence | Fix in Phase 2e |
|---|---|---|---|
| 1 | `IMAGES` binding declared in `env.ts` and in `test/wrangler.test.jsonc` but **absent from `wrangler.jsonc`** | Deployed instances produce no thumbnails or previews. `generateRenditions` silently returns null and client renditions are rejected | Add the binding. Add a CI test that the deploy config binds everything the test config binds. Make `/health` report "degraded" when it is missing |
| 2 | `processAsset` treats any GLACIER/DEEP_ARCHIVE `storage_class` as unreadable, whatever the location's `state` (`catalog/process.ts` ~l.52) | Restored originals are never processed, which contradicts comments in `importer.ts` and `routes/assets.ts` | Decide readability from `state ∈ {present, restored}` plus class. Re-enqueue on restore |
| 3 | `sha256_verified` is never written. Dedupe trusts the client hash, and importer assets have no hash | The integrity promise is hollow. A client can poison dedupe | Verify server-side (see the S3 egress note below) |
| 4 | Expired `uploads` are never swept | Abandoned multipart parts and assets stuck in `uploading` pile up | The sweeper aborts the multipart upload, deletes the row and asset, and adds S3 `AbortIncompleteMultipartUpload` lifecycle guidance |
| 5 | `restored` never reverts to `archived` after `restore_expires_at` | Downloads are offered for objects that are no longer readable | Revert in the sweep |
| 6 | Soft delete leaves originals and renditions in storage, with no trash or purge | Orphaned objects keep costing money, and erasure requests can't be honoured | Add a trash with a retention window and a purge job across every location, rendition and FTS row, audited |
| 7 | `activity_log` is write-only. Metadata edits, album changes and downloads are not logged | There is no audit trail a buyer would accept | Add a read API and UI, and log edits and downloads |
| 8 | The README says "early scaffold… nothing usable", draws Workers AI and Queues that are not bound, and promises XMP write-back that does not exist | Users and contributors are misled | Rewrite it to match reality |
| 9 | The `place` FTS column is always empty and `alt` is not indexed | Location and accessibility search fail | Index `alt` and the IPTC location fields now. Reverse geocoding comes later |
| 10 | The cron sweep handles about 25 assets a minute (≈36k a day), with no retries or dead-letter queue | The importer stalls on a real archive | Move the work to a Queue with a DLQ, and keep cron only as the scheduler |
| 11 | Existing `.xmp` files are imported as standalone assets (`application/rdf+xml`) | Lightroom sidecars are orphaned from their images | Pair them on import using both the `basename.xmp` and `basename.ext.xmp` rules |
| 12 | There is no mailer | Password reset and email verification cannot work, and gallery invites will need email later | Add Cloudflare Email Sending |
| 13 | Latent mismatches: `MAX_TRANSFORM_BYTES` is 70 MB and TIFF is listed as renderable, but Cloudflare documents a **20 MB input limit for the Images binding and no TIFF input** ([Images limits](https://developers.cloudflare.com/images/get-started/limits/)) | Large JPEGs and TIFFs likely fail silently. Verify against a real binding | Cap Worker transforms at 20 MB. Route TIFF and larger files to agent previews or a Container |

Two security hygiene items join the list. First, the CSP still allows `script-src 'unsafe-inline'` (`lib/security-headers.ts:22`), and Astro 6+ can replace that with hash-based `security.csp` ([Astro config reference](https://docs.astro.build/en/reference/configuration-reference/)). Second, user-supplied S3 endpoints are an SSRF surface, so the Worker should add the `global_fetch_strictly_public` compatibility flag ([Workers compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)). Currently only `nodejs_compat` is set.

There is also one trap in fixing defect 3. Hashing an S3 original by reading it through the Worker costs **AWS internet egress at $0.09/GB** ([AWS Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/us-east-1/index.json)), and archived objects can't be read at all. R2 originals can be re-hashed for free. S3 originals should be verified with S3's own checksums, which include SHA-256 ([AWS S3 integrity](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html)), sent by the uploader. Better still, the NAS agent should hash the file before upload.

One piece of work is already in flight. The working tree holds an **uncommitted keyless-AWS feature**: migration `0003_keyless_aws.sql`, `storage/oidc.ts` and `routes/well-known.ts`. With it, cf-dam acts as its own OIDC issuer: it publishes a JWKS and exchanges five-minute tokens at STS via `AssumeRoleWithWebIdentity`, so no long-lived AWS secret is stored. This closes the inventory's "`oidc-role` declared but unsupported" gap, and Phase 4's AWS cold tier depends on it, so it should land in Phase 2e. One review note: the discovery route falls back to the request origin when `BETTER_AUTH_URL` is unset. Keyless connections should therefore require a pinned origin, so that the issuer AWS trusts never drifts between a `workers.dev` hostname and a custom domain.

## Target architecture: D1 is the index of record, XMP is the contract, R2 is hot, S3 is cold

The end state stays one deployable Worker. Optional capabilities light up when their binding exists, the same pattern the code already uses for `IMAGES` and `CACHE_KV`. Heavy or slow work moves onto Cloudflare's job primitives, and bytes never flow through the Worker when they can avoid it.

```
 Mac desktop client                         NAS agent (unprivileged container)
 LrC Lua plug-in, read-only .lrcat copy     scan + hash (XXH3, SHA-256, MD5), copy ledger
 NeoFinder AppleScript, XMP read/write      rclone rcd (loopback), embedded-JPEG previews
        |  HTTPS, device token                      |  presigned multipart PUTs (R2 S3 API, S3)
        v                                           v
 +------------------------------ Cloudflare account ------------------------------+
 | cf-dam Worker: Hono /api, Astro UI, /mcp (OAuth 2.1), /d/* signed delivery      |
 |   D1 catalog + provenance + rights  | KV: OAuth grants, rate counters, cache     |
 |   Queues: ingest, replicate, notify (+DLQs) <- R2 object-create/delete events   |
 |   Workflows: asset pipeline, restore, export, expiry, purge                     |
 |   Containers (on demand): exiftool, libvips/LibRaw, ffmpeg, TrustMark           |
 |   Images binding (named renditions) | Workers AI + AI Gateway | Vectorize       |
 |   Analytics Engine (delivery telemetry) | Email Sending                         |
 |   R2 media: originals/ (bucket-locked), renditions/, sidecars                   |
 |   R2 private: releases/, audit/ (hash-chained, locked)                          |
 +--------------------------------------------------------------------------------+
        | STS AssumeRoleWithWebIdentity (cf-dam is the OIDC issuer)
        v
 AWS: S3 bucket with Versioning + Object Lock -> DEEP_ARCHIVE or GLACIER_IR
      opt-in only: Bedrock, Rekognition        External opt-in: Anthropic API, Stripe
```

Three source-of-truth rules hold the design together, and they settle a tension with the earlier integration research.

**D1 is authoritative for the index and for who-wrote-what.** Every editable field has a provenance row. **XMP is the interchange contract** with Lightroom Classic and NeoFinder. The DAM reads it on ingest, and it writes it as sidecars (and, where opted in, embedded) with a last-writer policy based on `xmp:MetadataDate` and mtime checks, because LrC's "Read Metadata from Files" overwrites catalog values. **The NAS agent's ledger is authoritative for which bytes exist where on the NAS and on offline drives**, and it syncs into an extended `asset_locations`. The earlier report's "editorial truth lives in XMP" still holds at the workstation boundary. In the cloud, though, XMP cannot carry provenance, licences with territory × channel × term, or review status, so D1 has to lead and the sidecar becomes the faithful export ([IPTC 2025.1](http://www.iptc.org/std/photometadata/specification/IPTC-PhotoMetadata-2025.1.html)).

The job backbone replaces the cron sweep:

1. R2 `object-create` notifications go to a Queue. A `CompleteMultipartUpload` fires one, so an agent upload needs no callback ([R2 event notifications](https://developers.cloudflare.com/r2/buckets/event-notifications/)).
2. The consumer starts one Workflow per asset with these steps: metadata, renditions, sidecar, AI describe, embed, index, replicate.
3. Workflows' `step.sleep` of up to 365 days suits 12–48-hour Deep Archive restores ([Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)).
4. Containers handle what a 128 MB isolate cannot. A 45 MP RAW demosaiced to 16-bit RGB is about 270 MB, and the largest standard Container is 4 vCPU / 12 GiB / 20 GB disk ([Containers pricing](https://developers.cloudflare.com/containers/pricing/)).

Event delivery semantics are undocumented, so every consumer must be idempotent and keyed by ETag or hash.

Delivery moves to a **separate cookieless hostname**. It serves `/d/<asset>/<rendition>?exp&sig` tokens: HMAC over asset, rendition, expiry, principal and disposition, with a key id so keys can rotate. Unlike R2 presigned URLs, these can be revoked. Presigned URLs also cannot use custom domains and last up to seven days ([R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)).

The new tables fall into nine groups. All of them must respect the runtime migrator's rules: idempotent DDL and **no trigger bodies**, because `migrate.ts` splits on semicolons. The same constraint means an append-only audit log must be enforced in code plus an R2 hash chain, not with the D1 `RAISE(ABORT)` triggers the security research suggested.

| Domain | New tables or columns | Phase |
|---|---|---|
| Jobs and ingest | `jobs`, `job_items`, `agents`/`devices`, `volumes`, `root_mappings` (`/volume1/Photos` ↔ `/Volumes/Photos`) | 2e, 4 |
| Shoots | `shoots` (client, event type, window, venue, `event_uri`), `shoot_templates` (IPTC fields with variables), `shoot_people` (roster), `moments` | 3 |
| Metadata and provenance | `metadata_value` (field, lang, value, source, model, model_version, prompt_hash, confidence, status, reviewer), append-only `metadata_event`, `vocabularies`, hierarchical `tags.parent_id`, `sidecars` (naming, packet hash, written_at), `placement_alt` (with `is_decorative`) | 3 |
| Rights and releases | `parties`, `licenses` (type, start, end, `sell_off_until`, contract key), `license_constraints` (territory, channel, media, exclusivity), `asset_licenses`, `people` (minor flag, guardian), `releases` (private R2 key, scope, expiry), `release_assets`, cached `asset_rights_status` | 3 (record), 6 (enforce) |
| Usage | `usages` (integration, URL, placement, `last_verified_at`), `downloads` (declared use), `asset_usage_observed` (daily roll-ups), `web_sightings` | 3, 6, 7 |
| Delivery | nested `collections`, `galleries`, `shares`/`share_grants` (view vs download, max size, expiry, PIN hash, count, watermark, `revoked_at`), `favorite_lists`, `comments`, `orders`/`price_sheets` | 6 |
| Locations and durability | `asset_locations` + `verified_at`, `verify_method`, `checksum`, `lock_until`, `min_retention_until`, offline/NAS kinds; `fixity_checks`; `holds`; `lifecycle_policies` | 4 |
| Governance | `audit_events` (actor type, before/after diff, `prev_hash`, `hash`), `webhooks`, `webhook_deliveries` | 2e, 4, 6 |
| AI | `ai_runs` (model, tokens, cost, prompt hash), `embeddings` (vector id, model, version), `perceptual_hashes` (PDQ) | 5 |

A sizing caution applies to D1's hard 10 GB per-database cap ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)). Field-level provenance multiplies rows. A rough estimate of 15 editable fields × 2 versions × 250k assets is 7.5M rows, around 1.5 GB, which is comfortable. At 1M assets it climbs toward 6 GB. So keep camera EXIF in the existing JSON column rather than in `metadata_value`. Plan per-tenant D1 databases (50,000 are allowed per account) or Postgres via Hyperdrive for large brand tenants.

## Six phases, from fix-first to the enterprise tier

The phases are numbered to continue from the repo's existing "Phase 2a–2d". The nav placeholders "NAS agents — Phase 5" and "Lifecycle — Phase 6" (`AppLayout.astro:26-27`) map to Phase 4 below and should be renumbered. The order follows one principle: **become the catalog of record first and the delivery platform last.** PhotoShelter stays as the delivery front end, fed from the DAM, until Phase 6 replaces it. That way the photographer never runs a week without client galleries.

### Phase 2e: make the baseline true

This phase fixes defects 1–13, lands keyless AWS, introduces the first Queue, and adds minimal OSS hygiene. That hygiene means SECURITY.md, Dependabot or Renovate, SHA-pinned Actions and an OpenSSF Scorecard run, on top of the existing gitleaks job ([OpenSSF Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md)). The Apache-2.0 licence should stay. A DCO-or-CLA decision is due before outside contributions arrive.

| | |
|---|---|
| **Features** | Working renditions in production. Restore → process. Server-side hash verification. Upload cleanup. Trash and purge. Audit read UI. Sidecar pairing on import. Queue-driven processing with retries. Email. Hash-based CSP. Strict public fetch. Honest README |
| **Bindings and services** | `IMAGES` in `wrangler.jsonc`; `INGEST_QUEUE` plus DLQ; `send_email`; `global_fetch_strictly_public`. AWS: IAM OIDC provider plus a least-privilege role (the in-flight work) |
| **Data model** | `purge_after` on assets; `jobs`/`job_items`; `audit_events` superseding `activity_log` reads; `sidecars` for paired `.xmp` |
| **Key risks** | Hashing S3 originals costs egress, so use S3 checksums. Migrator limits rule out trigger-based immutability. Every new binding must stay optional to protect the one-click deploy |
| **Exit test** | A fresh Deploy-button instance uploads a JPEG, a RAW and a TIFF. Each gets correct previews or a clear fallback, a verified hash, an audit trail, and a clean purge that leaves no objects behind |

### Phase 3: metadata spine — shoots, provenance, sidecars, rights records and MCP

This is the phase that answers most of the brief directly. The mature tools all derive shoot metadata from **human context applied to a batch**, not from AI guessing. Photo Mechanic stamps IPTC templates at ingest, with variables such as `{serial}` and code replacements that map a camera serial to a photographer ([Camera Bits](https://docs.camerabits.com/support/solutions/articles/48000223660)). Bynder and Canto apply metadata presets or templates at upload ([Bynder presets](https://support.bynder.com/hc/en-us/articles/360013931319); [Canto templates](https://support.canto.com/hc/en-us/articles/23001734858385-Create-Metadata-Templates)).

So every upload batch, agent watch folder or CLI import belongs to a **Shoot**. A Shoot can be chosen, created from a calendar entry, or suggested from a folder name such as `2026-06-14_Smith-Jones_Wedding`. Its template is inherited by every asset and written to `Iptc4xmpExt:Event`, plus an `EventId` set to a stable URL of the Shoot record. The IPTC spec explicitly allows a persistent calendar-entry URL in that field ([IPTC 2025.1](http://www.iptc.org/std/photometadata/specification/IPTC-PhotoMetadata-2025.1.html)). Assets outside the Shoot's time window are flagged "unassigned" rather than guessed. Fields applied from templates are recorded as `template` provenance, not `ai`.

Promote the IPTC fields the brief needs to columns:

- alt text (`AltTextAccessibility`, with its **250-character limit** enforced in the UI and in prompts);
- extended description, headline and caption;
- creator, credit and copyright;
- `xmpRights:UsageTerms` and `WebStatement`;
- `plus:Licensor`, model and property release status and IDs, and `plus:DataMining`;
- Location Created/Shown;
- Person Shown;
- Digital Source Type.

Do not use Digital Source Type or the four 2025.1 AI fields to flag AI-written captions. Those fields describe how the *pixels* were made, so a camera original stays `digitalCapture` even if every caption came from a model.

Sidecars come from a small, deterministic **TypeScript XMP serializer** that covers dc, photoshop, Iptc4xmpCore/Ext, xmp, xmpRights and plus, plus a custom `damai` namespace for per-field provenance. Publish an ExifTool config file for that namespace, because ExifTool writes custom namespaces only when they are defined in its config ([ExifTool XMP tags](https://exiftool.org/TagNames/XMP.html)). CI should round-trip every generated sidecar through `exiftool -j`.

Naming follows the tools' conventions. RAW files get `basename.xmp`, which is what Lightroom, Capture One and Photo Mechanic expect. `basename.ext.xmp` is an option, and it avoids the `IMG_1.CR3`/`IMG_1.JPG` collision ([darktable manual](https://docs.darktable.org/usermanual/5.6/en/overview/sidecar-files/sidecar-import/)). When a sidecar already exists, the DAM parses and merges it, keeps the original packet, and patches only the fields it owns.

Originals stay byte-identical by default. Lightroom's habit of writing into JPEG and DNG files and touching mtimes has broken users' backups ([Adobe community](https://community.adobe.com/t5/lightroom-classic-discussions/enabling-quot-automatically-write-changes-to-xmp-quot-changes-orig-file-creation-modification-dates/m-p/12558644/highlight/true)). In the cloud, sidecars sit beside their originals in R2 and replicate with them. On the NAS, the Phase 4 agent writes them under the conflict policy.

Rights are **recorded** here and **enforced** in Phase 6. Embedded IPTC/PLUS fields can carry a summary, but they cannot represent several overlapping licences across territory, channel and term. That needs the relational `licenses`/`license_constraints` model, with ODRL/RightsML as an optional interchange format ([IPTC RightsML](https://www.iptc.org/standards/rightsml/)). A daily cron runs staged expiry notices at 90, 30 and 7 days, following Veeva's 90-day report pattern ([Veeva Vault](https://commercial.veevavault.help/en/gr/1117055/)), and records a `sell_off_until` grace date. Release PDFs go in a private R2 prefix that only rights admins can read, because they hold personal data and ID photos. A `usages` API (`POST/GET/DELETE /api/assets/:id/usages`) mirrors Bynder's Asset Tracker of create, list and delete calls ([Bynder Asset Tracker](https://support.bynder.com/hc/articles/360013933619)). A periodic verifier HEAD-checks each recorded URL so records don't go stale.

The **remote MCP server** is how "the user's AI tools write alt text and descriptions into the index". Cloudflare's 2026 guidance is the stateless `createMcpHandler()` wrapped by `workers-oauth-provider`, with tokens in KV. `McpAgent` is marked deprecated ([Cloudflare remote MCP](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)). The OAuth library is MIT-licensed and implements PKCE, dynamic client registration and protected-resource metadata. However, it "advertises the required scopes but doesn't enforce them", so every tool handler must check scope and ownership ([workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider)).

Expose about ten goal-oriented tools, grouped by scope:

- `dam:read`: `search_assets`, `get_asset` (placement-aware alt, provenance, short-lived signed rendition URL), `view_image`, `list_shoots`/`get_shoot`.
- `dam:write_metadata`: `propose_metadata`, which writes rows with status `suggested` and source `mcp:<client>`.
- A separate scope: `apply_metadata`.
- `dam:export`: `write_sidecars`.

Delete, share and publish tools are excluded by default. This mirrors Bynder's hosted MCP, which "does not create new access" and filters results by permissions, rights and expiry ([Bynder MCP](https://api.bynder.com/page/mcp)). An OpenAPI spec for the REST API serves scripts and agents that don't speak MCP.

| | |
|---|---|
| **Features** | Shoots with templates, variables, serial→photographer map and folder-name parsing. Moment clustering by time gap (the 20–30 min threshold is an unvalidated proposal). Full IPTC Core/Ext and PLUS columns. Field-level provenance with a review status. Sidecar read, pair, merge and write. Hierarchical keywords and vocabularies with tag merge and rename. Licence, release and people records. Expiry alerts. Usage API. Placement-aware alt. MCP server. OpenAPI |
| **Bindings and services** | `OAUTH_KV`; Workflows (`ASSET_PIPELINE`) for sidecar regeneration; a private R2 bucket or prefix for releases; Email for expiry notices |
| **Data model** | Shoots, metadata/provenance, rights/releases and usage groups from the table above |
| **Key risks** | LrC conflict overwrites (use the `MetadataDate` policy). Whether LrC, Photo Mechanic and Capture One preserve the unknown `damai` namespace on rewrite is **unverified**, so D1 stays authoritative. MCP tools return attacker-controllable caption and filename text, so mark it as untrusted data in tool descriptions. PLUS permission clause (see the risks section). D1 growth from provenance rows |
| **Exit test** | Import a real wedding with Lightroom sidecars. Every frame inherits the Shoot. Claude Desktop, connected through MCP, proposes alt text for 50 frames. The owner accepts them in one pass. Regenerated sidecars round-trip through ExifTool, and LrC reads them without clobbering newer catalog edits |

### Phase 4: ingest from the Mac and the NAS, with verified copies on two clouds

The earlier integration research already settled the shape of ingest, so it is only summarised here. A **thin, unprivileged, multi-arch container agent on the photographer's existing NAS** owns the byte ledger. It keys assets by content hash: XXH3 or XXH64 for speed, SHA-256 for fixity, and MD5 to match NeoFinder's FileCheck. It drives an embedded `rclone rcd` bound to loopback, because rc access "is equivalent to shell access" ([rclone rc](https://rclone.org/rc/)). It extracts embedded JPEG previews, because a typical Synology has no iGPU.

A **macOS desktop client** owns the tool bridges:

- the XMP contract (`dc:subject`, `lr:hierarchicalSubject`, `xmp:Rating` including −1, colour-label text mapping, `mwg-rs` regions, and embedded XMP in ARW/ORF/RW2, which NeoFinder 9 writes in place);
- a read-only import of a closed `.lrcat` copy through lrcat-extractor, whose coverage of LrC 15 catalogs is **untested**;
- a Lua plug-in that talks to the DAM over `LrHttp`;
- NeoFinder re-catalog calls over AppleScript.

Moves are always copy, then verify, then delete. The DAM flags NFD/NFC and case collisions rather than renaming files. Those conclusions are taken as given here; the cloud-side work is what's new.

That cloud-side work starts with authenticating agents. `AuthMode` already declares `'agent'`, and enrolment would use per-device tokens or Cloudflare Access service tokens. The Worker then issues batches of presigned `UploadPart` URLs straight to **R2's S3 endpoint**. The R2 binding cannot presign, so the code's suggestion of adding R2's S3 API as a connection becomes the default for agents. The agent resumes after interruption with ListParts. The `CompleteMultipartUpload` event starts the ingest Workflow, and R2's default rule that aborts incomplete uploads after seven days defines the resume window ([R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)).

Uploads through a Worker or Tunnel are capped at 100 MB on Free/Pro zones ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)), so direct-to-S3-endpoint uploads are the only viable path for RAW and video. The agent also supplies previews through the existing `PUT /uploads/:id/renditions` path, so cloud rendition generation never needs a RAW decoder.

Copies follow the redundancy pattern from the platform research:

1. **R2 is primary.** Originals move to Infrequent Access by lifecycle rule. That costs $0.01/GB-month against $0.015 for Standard, with a 30-day minimum ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)).
2. **A replicator Queue consumer** writes each original to an S3 bucket with **Versioning and Object Lock**, directly into `DEEP_ARCHIVE` (or `GLACIER_IR` for faster disaster recovery). It uses the keyless OIDC role, limited to `s3:PutObject` with no delete ([S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)).
3. **An R2 bucket lock** on `originals/`, with an Age rule of 30–90 days, means a leaked token or a bug cannot delete recent originals. Lock rules override lifecycle rules ([R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)).

R2 still has no documented object versioning ([R2 changelog](https://developers.cloudflare.com/r2/reference/changelog/)). Write-once keys provide "versioning by construction" instead.

Deletes must **not** be mirrored blindly to S3. Erasure goes through the app, which records "erasure pending until retention expiry" and replays a tombstone ledger on any restore. A nightly Workflow exports D1 to a locked R2 prefix and to S3, because D1 Time Travel lasts only 30 days and restores in place ([D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)). A fixity sampler re-hashes N objects a day. The asset page shows 3-2-1 status computed from *verified* copies only.

Phase 4 also gives the agent its interim **PhotoShelter publish target**. The API v4 limit of one upload per minute makes it an always-on job for the NAS rather than for a laptop ([PhotoShelter API v4](https://engineering.photoshelter.com/psapi-v4-doc/photoshelter.json)).

| | |
|---|---|
| **Features** | NAS agent (Compose) and macOS client. Device enrolment. Resumable direct multipart to R2 and S3 with client-sent checksums. Shoot assignment from folders. Agent-supplied previews. R2→S3 replication into Deep Archive with Object Lock. R2 bucket locks. Lifecycle rules (Standard→IA, abort multipart). Fixity sampling. D1 export. Bulk restore via Workflows. Offline drives as locations. 3-2-1 dashboard. PhotoShelter publish |
| **Bindings and services** | R2 event notifications → `INGEST_QUEUE`, `REPLICATE_QUEUE` (+DLQs); `RESTORE` and `EXPORT` Workflows; an R2 S3-API token; optionally a Container for objects over 5 GiB, because `setStorageClass` refuses multipart copy and Workers have 128 MB. AWS: a versioned, Object Lock bucket, the OIDC role, and an `AbortIncompleteMultipartUpload` lifecycle rule |
| **Data model** | `agents`, `volumes`, `root_mappings`, `copy_jobs`, extended `asset_locations`, `fixity_checks`, `holds`, `lifecycle_policies` |
| **Key risks** | Event delivery guarantees are unstated, so consumers must be idempotent. Deep Archive has a 180-day minimum and costly restores. The Deep Archive storage price is inferred from the Intelligent-Tiering Deep Archive tier ($0.00099/GB-month), so verify it. Same-key R2 writes are limited to 1/s. LrC shows files as missing after moves. lrcat-extractor coverage is unknown. How a Photographers-plan user gets a PhotoShelter API key is unresolved |
| **Exit test** | Pull the NAS's network cable mid-shoot. The agent resumes, every original reaches R2 and S3 with matching SHA-256, a deliberate delete of a recent original fails against the lock, and a test restore from Deep Archive completes and verifies |

### Phase 5: AI enrichment and semantic search

Built-in AI comes after provenance exists, so that model output arrives as suggestions rather than as facts. Each Workflow "describe" step sends the **existing ~1,000–1,600 px preview**, never the full-resolution original, because Claude's high-resolution tier caps at 4,784 visual tokens and extra pixels only cost money ([Anthropic vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)). Claude does not read embedded metadata, so the prompt text carries the context: Shoot name, client and date, moment label, a reverse-geocoded place, house style, and *human-confirmed* roster names. The prompt also gives two explicit instructions: use only those names, and never infer race, religion, health, orientation or age beyond broad terms.

The model returns JSON with alt text (≤250 characters, no "photo of"), a caption, an extended description, a headline, keywords, and a confidence score for each field. These land as `suggested` and are not exported to sidecars or public galleries until accepted, or until the owner enables auto-accept for a field above a threshold. The review queue offers accept-all per Shoot or per moment, keyboard approve, and filters such as "no alt", "AI unreviewed", "low confidence" and "mentions a person". It also highlights proper nouns that are not in the Shoot context, since those are likely hallucinations.

The default choice is **Claude Haiku 5.5 through the Message Batches API for imports**, with Sonnet 5.5 as a quality toggle for hero selects, all routed through AI Gateway for logging, caching, rate limits and fallback ([AI Gateway](https://developers.cloudflare.com/ai-gateway/)). The alternative is a privacy mode on Workers AI, where Cloudflare neither trains on nor retains the content. No independent 2026 benchmark compares these models on photo captioning, so pick using an in-house eval on 100–200 of the photographer's own frames.

Semantic search starts with text embeddings of caption, alt, keywords, event and place, using Workers AI's bge-m3 or qwen3-embedding-0.6b at $0.012 per million tokens. These go into Vectorize and are fused with FTS5. Workers AI has **no image-embedding model** ([Workers AI models](https://developers.cloudflare.com/workers-ai/models/)). True "find similar" therefore needs an external multimodal embedder later. Voyage multimodal-3.5 is listed at about $0.60 per billion pixels, a third-party listing. AI Search's multimodal mode is the other option, but it caps at 1M files per instance and starts billing on 1 November 2026 ([AI Search limits](https://developers.cloudflare.com/ai-search/platform/limits-pricing/)). PDQ perceptual hashes, 256 bits with a match threshold of Hamming distance ≤31 and a WASM build available, give near-duplicate detection at ingest ([ThreatExchange PDQ](https://github.com/facebook/ThreatExchange/tree/main/pdq)).

| | |
|---|---|
| **Features** | Vision describe step. Review queue. Per-field auto-accept thresholds. Cost caps per job. Hybrid search. Near-duplicate detection. Moment clustering refined by GPS. Reverse geocoding (no provider was researched) |
| **Bindings and services** | `AI` (Workers AI), an AI Gateway, a `VECTORIZE` index, the Anthropic key as a secret (Secrets Store is still open beta), Workflows |
| **Data model** | `ai_runs`, `embeddings`, `perceptual_hashes`, `moments` |
| **Key risks** | Hallucinated specifics. Inference of sensitive attributes. Llama's EU restriction. Retention terms (Batch is not ZDR-eligible). Haiku 5.5 refusals have no server-side fallback, so handle `stop_reason: "refusal"`. Image-token accounting on Workers AI is undocumented |
| **Exit test** | A 1,000-frame wedding is described for under $1. Fewer than a set percentage of alts need edits on the eval set. "First dance" returns the right frames without a keyword match |

### Phase 6: delivery, proofing and rights enforcement — the PhotoShelter cut-over

This is PhotoShelter parity plus the proofing basics the gallery market has converged on. PhotoShelter for Photographers sells $10/$25/$45 plans with 4 GB, 100 GB and 500 GB of storage, an 8–10% transaction fee on sales, unlimited public, private and password galleries, and proofing only on Standard and above ([PhotoShelter for Photographers](https://go.photoshelter.com/photographers/)). Photographers' complaints centre on stagnation, login friction and fees ([Picflow](https://picflow.com/compare/client-gallery/photoshelter); [Trustpilot](https://www.trustpilot.com/review/www.photoshelter.com)).

The permission model to replicate has these parts:

- nested collections containing galleries;
- four access modes: public, unlisted, password, and named-email list;
- **separate view and download permissions**;
- per-grant maximum download size, expiry, PIN and download count;
- dynamic watermarks on previews, switched off for finals.

Proofing adds multiple named favourite lists, a selection limit, per-image comments, and export of selections as filenames, CSV or a Lightroom collection through the plug-in. Pic-Time's reminder emails at 7, 4 and 1 days before expiry and its automatic offline behaviour set the expiry bar ([Pic-Time help](https://help.pic-time.com/en/articles/7905685-how-do-i-set-the-expiration-date-for-my-client-galleries)).

Delivery is a streaming, store-only ZIP64 (optionally split), single-file Range-capable signed links, branded invites, a custom domain, and server-rendered SEO portfolio pages with a sitemap and alt text from IPTC, which keeps the "my archive shows up in Google" value. Digital sales use **Stripe Checkout and Stripe Tax on the photographer's own account at 0% commission**. Stripe Connect matters only for a hosted multi-tenant service ([Stripe destination charges](https://docs.stripe.com/connect/destination-charges)). Print labs come later, because WHCC's Order Submit API requires contacting WHCC and ships largely to the US and Canada only ([WHCC developer docs](https://developer.whcc.com/docs)).

The PhotoShelter importer walks collections and galleries through API v4. It downloads "Original file" rather than "JPEG – original size", so that embedded IPTC survives, recreates shares, and emits a per-gallery count report. Then the subscription can end.

Rights enforcement is where a Cloudflare DAM can beat the incumbents cheaply. Brandfolder's Smart CDN stops serving an embed when its asset expires, though it may stay cached for up to 24 hours ([Brandfolder Smart CDN](https://help.smartsheet.com/articles/2482927-Embedding-Assets-with-Smart-CDN)). AEM auto-unpublishes expired assets, and users report that this **breaks links on live sites** ([AEM community](https://experienceleaguecommunities.adobe.com/t5/adobe-experience-manager/why-are-asset-links-breaking-on-sites-when-asset-expiration/td-p/726855)).

cf-dam's delivery Worker should apply a configurable action per licence or collection:

- notify only;
- hide from portals;
- block downloads;
- revoke share links;
- swap the public URL to a placeholder, or return 451/410 (a design suggestion with no sourced convention behind it).

It should also post webhooks to CMS integrations, following Aprimo's "DAM Rules" pattern of outbound HTTP calls when rights lapse ([Aprimo developer](https://developers.aprimo.com/?p=2591)). Every rendition request writes one Analytics Engine data point. Index on asset id, with blobs for preset, referrer host, share id and country, and no raw IPs. 10M data points a month are included, then $0.25 per million, with three-month retention ([Analytics Engine pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)). Daily roll-ups into D1 keep long-lived "first seen / last seen on domain" records. Referrers are often stripped, so treat referrer-based usage as a lower bound.

One rule is non-negotiable: **delivered files keep their rights metadata**. Cloudflare Images keeps EXIF copyright by default but applies metadata options to JPEG output only. Other formats, including the WebP the code renders today, always discard metadata ([Images features](https://developers.cloudflare.com/images/optimization/features/)). Removing copyright management information, including terms of use, can create liability under 17 U.S.C. §1202 ([Cornell LII](https://www.law.cornell.edu/uscode/text/17/1202)). So client downloads should be JPEG with metadata kept, or should have XMP injected by an ExifTool Container job. The result is cached in R2, keyed by asset and metadata-version hash.

| | |
|---|---|
| **Features** | Nested collections, galleries and shares. Proofing. Watermark presets. ZIP and signed links. Invites and reminders. Custom domain and portfolio. Turnstile on password galleries and bulk ZIPs. Stripe digital sales with simple licence tiers. Download-time usage-terms acceptance with declared use. Expiry actions. Webhooks. Delivery analytics. Metadata-preserving exports. PhotoShelter importer and full data export |
| **Bindings and services** | A second hostname route; an `ANALYTICS` dataset; Email; Turnstile; WAF or rate-limit rules (the binding is per-location and "permissive", so it can't be the only control); Stripe secrets; an ExifTool Container; Cloudflare for SaaS custom hostnames if multi-tenant |
| **Data model** | Delivery group, `downloads`, `asset_usage_observed`, `webhooks`/`webhook_deliveries`, export cache |
| **Key risks** | Abuse of public endpoints. Signed-link leakage (mitigated by revocation). Resuming multi-GB ZIPs (split them). Hard-unpublishing a licensee's page (use `sell_off_until`). Telemetry counts as personal data in the EU if IPs are kept. Hosting public galleries means operating a DMCA agent |
| **Exit test** | A real client receives a password gallery, favourites 40 frames under a 50-frame limit, and the selects reach Lightroom. A purchased download carries copyright, usage terms and alt. Expiring a licence swaps a test embed to a placeholder within minutes |

### Phase 7: enterprise tier and differentiators

This phase turns a photographer's DAM into one a studio, newsroom or brand team can buy.

**Identity.** Better Auth already offers `@better-auth/sso` (OIDC and SAML 2.0 with DNS domain verification) and `@better-auth/passkey`. Its **SCIM plugin explicitly does not work on D1**, because D1 lacks interactive transactions ([Better Auth SCIM](https://better-auth.com/docs/plugins/scim.md)). The pure-Cloudflare answer is a hand-written SCIM 2.0 endpoint built on D1 `batch()`. Cloudflare Access can serve as an optional front door, but it does not forward SCIM downstream, and the app must validate the `Cf-Access-Jwt-Assertion` header ([Cloudflare One SCIM](https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/scim/)). Whether `samlify` works on Workers is unverified.

**Authorization.** Grow from seeded roles to org roles plus per-collection grants stored as Zanzibar-shaped relationship tuples in D1. Evaluate ABAC attributes (rights status, embargo, region) in code, or later in `cedar-wasm`, which does no I/O ([Cedar](https://github.com/cedar-policy/cedar)).

**Tenancy and residency.** Create one D1 database and one R2 bucket per tenant, in an `eu` or `us` jurisdiction fixed at creation ([R2 data location](https://developers.cloudflare.com/r2/reference/data-location/)).

**Provenance.**

- Read and display C2PA manifests, which Adobe does in AEM's Content Credentials tab ([AEM docs](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/assets/assets-view/content-credentials)).
- Sign exports with c2pa-rs. It can now sign in WASM builds, but it has never been demonstrated inside Workers.
- Embed per-licensee Adobe TrustMark watermarks. TrustMark is MIT-licensed with a 100-bit payload, but its encoder is Python or ONNX, so it would run in a Container ([adobe/trustmark](https://github.com/adobe/trustmark)).
- Act as a C2PA Soft Binding resolver (`/matches/byBinding`), so stripped copies can be traced back ([C2PA Soft Binding API](https://spec.c2pa.org/specifications/specifications/2.3/softbinding/Decoupled.html)).

**Open-web monitoring.** Bing's search APIs were retired on 11 August 2025, which leaves Google Vision Web Detection at $3.50 per 1,000 ([Cloud Vision pricing](https://cloud.google.com/vision/pricing)) and TinEye at $0.01–0.04 per search ([TinEye](https://blog.tineye.com/new-image-search-pricing/)). The DAM classifies `pagesWithMatchingImages` against known licensees, drafts DMCA notices without sending them, and exports cases to Pixsy or Copytrack. Those services take roughly 30–50% of recoveries and publish no APIs.

**Also in this phase:** approvals and status, version history, custom metadata schemas, smart collections and saved searches, brand portals, video proxies through ffmpeg in a Container, CMS plug-ins that report usages, Basin for long-term analytics, a shared-responsibility matrix and SOC 2 / ISO 27001 control mapping for buyers, signed releases with an SBOM, and **opt-in face recognition as a plugin**, covered below.

| | |
|---|---|
| **Bindings and services** | Per-tenant D1 and R2; Containers (TrustMark, c2pa-rs, ffmpeg); optional Hyperdrive and Postgres once a tenant exceeds about 10 GB; Basin; Rekognition (plugin only) |
| **Data model** | `orgs`, `memberships`, relationship tuples, `approvals`, `asset_versions`, `custom_fields`, `saved_searches`, `web_sightings`, `face_consents` (plugin) |
| **Key risks** | SAML on Workers. SCIM correctness without transactions. C2PA in WASM. TrustMark survival on social platforms (no independent benchmark exists). Biometric law. Bundle size and Deploy-button complexity |

## Enterprise feature map: table stakes and differentiators

Tiering follows the synthesis in the enterprise research. Table stakes are what buyers expect before they will look at a product. Differentiators are where Adobe, Aprimo, Bynder, Orange Logic and Brandfolder compete. The tiering is synthesised from vendor documentation, not published by an analyst.

| Capability | Tier | cf-dam today | Phase |
|---|---|---|---|
| Bulk web and API upload, resumable multipart | Table stakes | Built (web, 3 parallel parts, no cross-session resume) | 2e, 4 |
| EXIF/IPTC/XMP extraction | Table stakes | Partial: minimal set, rights only in a JSON blob | 3 |
| Shoot/event metadata templates at ingest | Table stakes for photo tools | Absent | 3 |
| Custom fields and controlled vocabularies | Table stakes | Absent | 3 (vocabularies), 7 (schemas) |
| XMP sidecars and two-way sync, write-back on download | Differentiator (ResourceSpace, Canto) | Absent, though the README claims it | 3 (sidecars), 6 (embed on export) |
| AI auto-tagging and natural-language search | Table stakes | Absent | 5 |
| AI alt text with field provenance and human review | Differentiator | Absent (`alt` column, `ai:run` permission reserved) | 3 (provenance, MCP), 5 (built-in) |
| Visual similarity, near-duplicate, reverse image | Differentiator | Absent | 5 (PDQ, text embeddings), 7 (multimodal) |
| Face recognition | Differentiator, high legal risk | Absent | 7, opt-in plugin only |
| Collections, faceted search, saved searches | Table stakes | Flat albums, no facets | 6 (nested), 7 (smart, saved) |
| Version history | Table stakes | Absent (one original per asset) | 7 (immutability groundwork in 4) |
| Approval status (draft, approved, expired) | Table stakes | Absent | 7 |
| Expiry date and visibility of expired assets | Table stakes | Absent | 3 (records, alerts), 6 (enforce) |
| Enforcement at distribution (expiry kills embeds; territory and channel windows; releases with expiry) | Differentiator | Absent | 6 |
| Download and view logs | Table stakes | Absent (downloads not logged) | 2e (audit), 6 (analytics) |
| "Where used" via delivery analytics and CMS usage API | Differentiator | Absent | 3 (API), 6 (telemetry), 7 (plug-ins, web sightings) |
| Share links, renditions, CDN URLs | Table stakes | Absent (renditions private, streamed through the Worker) | 6 |
| Client galleries, proofing, watermarks | Table stakes for photographers | Absent | 6 |
| Commerce at 0% commission | Differentiator against PhotoShelter's 8–10% | Absent | 6 (digital), 7 (print labs, rights-managed calculator) |
| RBAC | Table stakes | Built (seeded roles, no custom roles) | 7 (custom, per-collection) |
| SSO (OIDC/SAML), SCIM | Table stakes for enterprise | Absent; SCIM blocked on D1 | 7 |
| ABAC / rights-aware visibility | Differentiator | Absent | 7 |
| MFA and passkeys | Table stakes | TOTP built; passkeys absent | 7 (can move earlier) |
| Activity log | Table stakes | Partial, write-only | 2e |
| Immutable audit, legal hold, retention | Differentiator | Absent | 4 (hash chain, holds), 7 (policy UI) |
| Multi-tier storage, replication, fixity | Differentiator for a photo DAM | Strong foundation: all classes, manual, no replication | 4 |
| Catalogue in place | Differentiator | Built for buckets | 4 (NAS) |
| REST API and webhooks | Table stakes | REST built; no OpenAPI or webhooks | 3 (OpenAPI), 6 (webhooks) |
| Remote MCP that inherits permissions | Differentiator, heading to table stakes | Absent | 3 |
| Lightroom and desktop integration | Differentiator | Absent | 4 |
| C2PA display and preservation, invisible watermarks | Differentiator | Absent | 7 |
| Video posters and proxies | Table stakes | MIME types only | 7 |
| Full data export and portability | Table stakes for buyers | Absent | 4 (D1 export), 6 (full export) |
| Data residency | Table stakes in the EU | Absent | 7 |
| SOC 2 / ISO 27001 | Table stakes for SaaS vendors | n/a; open source publishes a shared-responsibility matrix | 7 |

Three readings of this map shape the roadmap. **Auto-tagging is commoditised.** Aprimo now criticises rivals' "isolated task-based features such as auto-tagging" ([BusinessWire, Mar 2026](https://secure.businesswire.com/news/home/20260316927462/en/Aprimo-Unveils-Agentic-Digital-Asset-Management-DAM-System-to-Govern-Content-for-the-AI-Driven-Enterprise)). The defensible AI feature is therefore *provenance plus review*, not tagging itself. **Permission-respecting MCP** shipped at Bynder, at Aprimo (May 2026) and at Cloudinary (beta) ([Bynder MCP](https://api.bynder.com/page/mcp)). It costs cf-dam little and belongs early. **Enforcement, not storage, is the rights differentiator**: Orange Logic argues that most DAMs "only store rights as metadata" ([Orange Logic](https://www.orangelogic.com/dam-blog/10-top-drm-solutions-and-the-impact-of-digital-rights-management-in-dam-systems), vendor marketing). An edge Worker that sits in every delivery path is the cheapest place to enforce rights.

## AI pricing, faces and licences carry the sharpest edges

### Model prices come from two different sources and must not be mixed

The two research streams quoted Claude prices from different channels and for different model versions.

The AI notes used **Anthropic's first-party pricing page**, checked 2026-10-16 ([Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)):

| Model | Input / output per MTok | Notes |
|---|---|---|
| Haiku 5.5 | **$0.10 / $0.50** | Prompts ≤100k tokens; $0.50 / $2.50 beyond |
| Sonnet 5.5 | **$2 / $10** | |
| Opus 5.5 | **$4 / $20** | |

The Batch API halves all of these. The Claude API skill's cached model table, dated 2026-10-06, independently gives the same base prices and model IDs (`claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`). It also lists Sonnet 5 at $2/$10 first-party.

The platform notes instead cited **Amazon Bedrock**, checked 2026-10-16 ([Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)):

- Claude Sonnet 5 at a standard **$3 / $15**;
- a $2 / $10 promotion that ended on 31 August 2026;
- batch "50% lower" for select models;
- no readable Bedrock prices for Sonnet 5.5 or Haiku 5.5.

The platform notes' figure of about "$1,000 a year to describe 100k assets with Claude Sonnet" is therefore **Sonnet 5 on Bedrock**. It is not Sonnet 5.5 direct, which works out to about $700 a year, or $350 with batch.

One smaller conflict is also unresolved. The AI notes list Sonnet 5.5 cache hits at $0.10 per MTok, while the skill's table lists $0.20. Treat cache pricing as unverified.

Estimated cost per 1,000 images. The arithmetic assumes about 2,000 input tokens (preview plus prompt) and 300 output tokens per image:

| Route (source, date) | Standard | Batch | Caveat |
|---|---|---|---|
| Claude Haiku 5.5, Anthropic API (2026-10-16) | ≈ $0.35 | ≈ $0.18 | Whether Haiku 5.5 is in the high-resolution image tier is unconfirmed |
| Claude Sonnet 5.5, Anthropic API | ≈ $7.00 | ≈ $3.50 | |
| Claude Opus 5.5, Anthropic API | ≈ $14 | ≈ $7 | Anthropic's own example: a 1000×1000 image is ≈ $5.18 per 1,000 for image input alone |
| Claude Sonnet 5, Bedrock (2026-10-16) | ≈ $10.50 | ≈ $5.25 if eligible | Different model version and channel |
| Workers AI Llama 3.2 11B Vision ($0.049 / $0.676) | ≈ $0.20–0.50 | n/a | Image-token accounting is undocumented. EU restriction |
| Workers AI Llama 4 Scout ($0.27 / $0.85) | ≈ $0.60–0.80 | n/a | EU restriction |
| Rekognition DetectLabels | $1.00 | n/a | Labels only, no prose ([Rekognition pricing](https://aws.amazon.com/rekognition/pricing/)) |
| Google Vision label detection | $1.50 | n/a | Search-summary figure; labels only |

The striking result is that **Haiku 5.5 now costs about the same as the cheapest Workers AI vision model**, while producing LLM-quality prose. That removes the cost argument for Llama. The remaining case for Workers AI is privacy, not price.

### Retention terms decide which AI route a tenant may use

Workers AI does not train on customer content and does not retain inputs or outputs beyond what you direct it to store. Routing a request through AI Gateway to a third party subjects that request to the third party's terms ([Workers AI privacy](https://developers.cloudflare.com/workers-ai/platform/privacy/)).

Anthropic's commercial default deletes API inputs and outputs within 30 days, and Zero Data Retention (ZDR) is available by arrangement. Three constraints matter here ([Claude API data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)):

- **the Batch API (29-day retention) and the Files API are not ZDR-eligible**;
- Covered Models (Fable 5 and 5.1, Mythos 5 and 5.1) *require* 30-day retention;
- on Bedrock, AWS is the processor. Bedrock's own retention terms were not fetched.

For the photographer's own archive, batch Haiku with disclosure is fine. For brand or client tenants who are promised ZDR, use synchronous calls under a ZDR agreement, or Workers AI, and never Covered Models.

### Licence gotchas that would otherwise surface late

- **Llama vision.** The Llama 3.2, 3.3 and 4 AUPs restrict the rights granted to *EU-domiciled* companies and individuals for the multimodal models, though non-EU companies may ship products containing them to EU users ([Meta Llama FAQ](https://www.llama.com/faq/)). An EU-based photographer or self-hoster should not default to Llama vision. The licences of the non-Llama Workers AI vision models (Mistral Small 3.1, Gemma 3, Qwen) were not verified.
- **PLUS.** Organisations may use the PLUS License Data Format free for their own images. However, including a PLUS standard in an application "sold or licensed to third parties", or using the PLUS name or logo, needs advance permission ([PLUS LDF Downloads](https://ns.useplus.com/ldf-Downloads)). Open-source distribution is not clearly covered either way. Writing the IPTC-specified `plus:` XMP properties is low-risk. Before *bundling* the LDF vocabularies, ask PLUS.
- **InsightFace.** The code is MIT, but the popular model packs such as buffalo_l are "non-commercial research purposes only". YuNet plus SFace (Apache-2.0) are permissive but less accurate ([InsightFace licensing](https://www.insightface.ai/solutions/face-recognition-licensing)).
- **Metadata engines.** Exiv2 is believed to be GPL, and ExifTool's licence was not verified, so audit both before shipping them inside an Apache-2.0 distribution or Container image. TrustMark (MIT) and workers-oauth-provider (MIT) are clean. PDQ's official licence and Voyage and Cohere's first-party prices were not verified.

### Face recognition stays out of the core

The legal exposure is concrete:

- **Illinois BIPA** carries $1,000 (negligent) or $5,000 (reckless) per violation. The 2024 amendment limits recovery to one per person, and the Seventh Circuit applied it retroactively in April 2026 ([Paul Hastings](https://www.paulhastings.com/insights/ph-privacy/7th-circuit-confirms-bipa-amendment-has-retroactive-application)).
- **Texas CUBI** carries $25,000 per violation. It produced Meta's $1.4B settlement over photo-tagging face geometry and Google's $1.375B settlement ([FindBiometrics](https://findbiometrics.com/meta-to-pay-1-4b-in-texas-biometric-privacy-lawsuit); [CSLawReport](https://www.cslawreport.com/21169961/texas-ags-billiondollar-settlement-with-google-highlights-biometric-data-use-compliance-considerations.thtml)).
- **GDPR** makes photos biometric data once they are processed to uniquely identify someone ([Recital 51](https://gdpr-info.eu/recitals/no-51/)).
- **The EU AI Act** has banned biometric categorisation that infers sensitive traits since February 2025 ([Orrick](https://www.orrick.com/en/insights/2025/04/eu-commission-publishes-guidelines-on-the-prohibited-ai-practices-under-the-ai-act)).

Wedding and event photographers routinely shoot Illinois and Texas residents. Even "cluster similar faces" with stored vectors probably counts as capturing face geometry.

The roadmap therefore relies on **roster-based people tagging**: keyboard-fast assignment from the Shoot's roster, which Claude supports by refusing to name people at all. It also reads Lightroom's human-drawn `mwg-rs` regions. Treating those regions as non-biometric is an inference, not legal advice.

Any face matching ships only as an off-by-default plugin with these safeguards:

- per-person written consent records linked to the release entity;
- matching against enrolled people only, with unknown faces discarded;
- geofencing or extra notice for Illinois, Texas, Washington and the EU;
- a published retention schedule;
- erasure that cascades to face templates;
- a backend of Rekognition collections (about $0.001 per image plus $0.00001 per stored face per month) or a commercially licensed model.

Counsel should review it before release.

## Costs: tens of dollars a month for a photographer, hundreds at 20 TB

The first user's library size is unknown. The table below therefore uses an **illustrative 5 TB / 250k-asset archive** (about 0.5 TB of renditions) and recomputes the platform research's 20 TB / 1M-asset model from the same unit prices ([R2 pricing](https://developers.cloudflare.com/r2/pricing/); [AWS Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json); [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/); [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)).

| Line item | 5 TB / 250k (illustrative) | 20 TB / 1M (platform model) |
|---|---|---|
| Renditions, R2 Standard at $0.015 | ≈ $7.50/mo | ≈ $30/mo |
| Originals, R2 IA at $0.01 (Standard $0.015) | ≈ $50/mo ($75) | ≈ $200/mo ($300) |
| Cold copy, S3 Deep Archive at ≈ $0.00099 (inferred rate) | ≈ $5/mo + ≈ $8–13 one-time requests | ≈ $20/mo + ≈ $50 one-time |
| Workers Paid base, D1 (within 5 GB included), Queues, Workflows | ≈ $5–15/mo | ≈ $5–30/mo |
| Vectorize, 1024-dim | ≈ $2/mo | ≈ $11/mo |
| AI backfill, one-time | Haiku 5.5 batch ≈ $45; Sonnet 5.5 batch ≈ $875 | Haiku ≈ $180; Sonnet ≈ $3,500 |
| Rendition backfill, one-time | Agent previews ≈ $0; Containers ≈ $44; Images binding ≈ $250 | Containers ≈ $175; Images up to $1,500 *per month* if re-transformed |
| **Steady-state monthly** | **≈ $70** (IA) to ≈ $95 (Standard) | **≈ $300–350** vs ≈ $550–1,000+ S3-primary with delivery egress |

Four traps sit behind those totals:

1. **Images bills $0.50 per 1,000 unique transformations per calendar month** ([Images pricing](https://developers.cloudflare.com/images/pricing/)). Pre-generate renditions, preferably from agent previews or in a Container, rather than transforming on the fly at scale. Agent-supplied previews currently pass through Images for re-encoding, which re-incurs that cost.
2. **Restores from AWS cost money.** Restoring 5 TB from Deep Archive costs about $13 in bulk retrieval and about $450 in egress. For 20 TB it is about $50 plus $1,743. Restores also take up to 48 hours, and objects carry a 180-day minimum. Deep Archive is insurance, not a working tier.
3. **R2 IA** bills a full 30 days on early delete and charges $0.01/GB to read.
4. **Containers** bill provisioned memory while warm.

On value, the full archive costs more than PhotoShelter Pro's $45 a month. But PhotoShelter caps at 500 GB, purges data after cancellation, and holds no independent copy. A selects-only delivery footprint on cf-dam costs about $15 a month. Enterprise SaaS DAMs carry Vendr medians of about $25K (Brandfolder), $41K (Bynder) and $50K (Aprimo) a year before implementation. Those figures are relayed by a competing vendor ([Masset, Jul 2026](https://www.getmasset.com/resources/blog/dam-pricing-2026)).

## Build what differentiates, embed what is solved

| Component | Decision | Reason |
|---|---|---|
| Asset index, provenance, rights engine, expiry actions, signed delivery, ZIP streaming | **Build** | These are the product. Each is small on Workers primitives |
| XMP sidecar serializer | **Build** (TypeScript) | Fixed namespaces, deterministic, CI round-trip against ExifTool |
| Embedding metadata into JPEG/TIFF/DNG exports | **Embed** native ExifTool in a Container | ExifTool-WASM has a 7–10 s cold start and the isolate has 128 MB ([go-exiftool-wasm](https://pkg.go.dev/github.com/lbe/go-exiftool-wasm)). Licence audit pending |
| EXIF read | **Keep** exifr | Works with range reads |
| RAW decode, large renditions, video | **Embed** LibRaw, libvips, ffmpeg in Containers; agent previews first | Images rejects RAW and TIFF |
| Job orchestration | **Use** Queues + Workflows | Replaces the cron sweep |
| Search | **Use** D1 FTS5 + Vectorize; not AI Search | AI Search caps at 1M files and charges $2/GB-month |
| Vision, embeddings | **Integrate** Claude and Workers AI via AI Gateway | Choose with an in-house eval |
| SSO, passkeys | **Embed** Better Auth plugins | Already the identity layer |
| SCIM | **Build** on D1 `batch()` | The Better Auth plugin can't run on D1 |
| OAuth and MCP | **Embed** workers-oauth-provider + `createMcpHandler` | Enforce scopes yourself |
| Authorization | **Build** tuples now; Cedar-WASM later | No I/O, so it fits Workers |
| Perceptual hashing | **Embed** PDQ (WASM) | Licence to verify |
| C2PA, invisible watermark | **Embed** c2pa-rs and TrustMark in Containers | Workers support is unproven |
| Face recognition | **Do not build**; optional plugin calling Rekognition or a licensed model | Legal risk; InsightFace weights are non-commercial |
| Reverse image search, enforcement | **Integrate** Google Web Detection and TinEye; **export** to Pixsy and Copytrack | Recovery services publish no APIs |
| Payments, print | **Integrate** Stripe Checkout + Tax now; WHCC later | 0% commission; WHCC needs a partnership |
| NAS transfers, LrC catalog, manifests | **Embed** rclone, lrcat-extractor and xxHash; build the ledger and bridges | Per the earlier integration research |

## Conclusion

The roadmap's main insight is that cf-dam's next step is not a feature but a *contract*. Shoot records, field-level provenance and XMP sidecars together form one layer, and that one layer serves the brief's AI requirement (MCP proposals that land as reviewable suggestions), its shoot-tagging requirement (templates, not guesses), its sidecar requirement, and its rights requirement (licence records that delivery can enforce later). Built in that order, AI never writes unattributed facts, sidecars never carry unreviewed text, and every later phase reads from a model that already knows who said what. The second insight concerns cost, which no longer separates the AI options. With Haiku 5.5 at roughly Workers AI's price, the real choice between Claude and Workers AI is about retention and licence terms, which means it is a per-tenant policy setting rather than an architecture decision.

The plan's real deadline sits in Phase 2e. A DAM whose README overstates it, whose production instance makes no thumbnails, and whose deletes leak storage cannot be trusted with a photographer's archive, however good its roadmap. Fixing those defects, landing keyless AWS, and making every new binding optional (so the one-click deploy survives Queues, Workflows, Vectorize and Containers) is a short piece of work. It is also what turns the rest of the plan from a feature list into something a working photographer can hand their archive to.

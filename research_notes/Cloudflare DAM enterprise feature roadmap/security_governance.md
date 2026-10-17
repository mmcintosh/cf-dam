# Security, Governance, Data Durability and Compliance for a Cloudflare-native OSS Photo DAM (R2/D1/KV/Queues/DO + S3/Glacier tier)

Research date: 2026-10-16. Sources are official vendor docs unless noted. Items labelled "(inference)" are my reasoning, not vendor statements. Project context taken from the local repo: the app already depends on `better-auth` ^1.7, `hono`, Astro 7 + Svelte 5, and the repo LICENSE is **Apache-2.0** (with a NOTICE file) — see `/home/siddhartha/Infowall/dam/cf-dam/package.json` and `/home/siddhartha/Infowall/dam/cf-dam/LICENSE`.

---

## 1. AuthN/AuthZ: passkeys, SSO (OIDC/SAML), SCIM, sessions, API keys/PATs, OAuth for third-party/AI tools, RBAC vs ABAC, authorization engines on Workers

### Takeaway
Better Auth (already in the repo) covers most of the v1 and "teams" identity surface on Workers — passkeys (`@better-auth/passkey`), API keys with KV secondary storage (`@better-auth/api-key`), OIDC + SAML SSO (`@better-auth/sso`) — but its **SCIM plugin explicitly does not work on D1** because D1 lacks interactive transactions; Cloudflare Access can act as an SSO/SCIM front door but does **not** forward SCIM to downstream apps. For third-party/AI-tool access, Cloudflare's `workers-oauth-provider` (MIT, 1.x) provides OAuth 2.1 + MCP authorization but leaves scope enforcement and tenancy checks to the app. Authorization should start as RBAC-on-collections with explicit share grants (Zanzibar-style relationship tuples in D1), keeping Cedar (WASM) as a feasible later option.

### Cited Findings
**Passkeys / API keys / SSO via Better Auth**
- Since Better Auth 1.4 the passkey plugin is a separate package, `@better-auth/passkey`; the API key plugin is `@better-auth/api-key`, and 1.4 added secondary-storage support for API keys (KV-style store) and made API-key "mock sessions" disabled by default — [Better Auth 1.4 blog](https://canary.better-auth.com/blog/1-4)
- `@better-auth/sso` "supports OpenID Connect (OIDC), OAuth2 providers, and SAML 2.0"; OIDC registration auto-fetches/validates the discovery document; SAML acts as SP with replay protection, InResponseTo/timestamp validation, algorithm checks and size limits; it references `samlify` ("samlify has nothing to verify SAML responses against" without a cert/metadata) — [Better Auth SSO plugin](https://better-auth.com/docs/plugins/sso)
- SSO domain verification is opt-in (`domainVerification.enabled`) via DNS TXT; providers are untrusted until verified, and verification "is also required for automatic organization assignment"; `organizationProvisioning` supports `defaultRole`/`getRole`; only org owners/admins can bind a provider to an org — [Better Auth SSO plugin](https://better-auth.com/docs/plugins/sso)
- The SSO page notes the resolver requires "native database transactions and transaction async-context support" and does not discuss Workers/edge — [Better Auth SSO plugin](https://better-auth.com/docs/plugins/sso)
- **SCIM blocker:** "Cloudflare D1 does not support the interactive transactions required by the SCIM plugin." / "SCIM resource requests require a database adapter with native interactive transaction support." SCIM authenticates with a high-entropy bearer token; "A SCIM Group grants no application permission unless you configure a role projection"; provisioning "does not create a sign-in method or grant application access" — [Better Auth SCIM plugin](https://better-auth.com/docs/plugins/scim.md)
- Community guidance (third-party, verify): Better Auth instances on Workers must be built per request because D1 bindings only exist inside the handler; D1 is used via Drizzle/Kysely adapters — [search summary of community guides, e.g. tessl/jezweb better-auth skill](https://tessl.io/skills/github/jezweb/claude-skills/better-auth)

**Cloudflare Access as IdP front door**
- Cloudflare One supports SCIM for SAML/OIDC IdPs using SCIM 2.0; with deprovisioning enabled, removing a user "revokes their active Access sessions"; but "Access does not use SCIM group membership to evaluate a login" and "Cloudflare does not provision new users in Zero Trust when they are added to the identity provider"; the page does not describe forwarding SCIM to downstream applications — [Cloudflare One SCIM](https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/scim/)
- Apps behind Access must validate the `Cf-Access-Jwt-Assertion` header (cookie "is not guaranteed to be passed") against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, matching `kid`, `iss` and the application `aud` tag; keys rotate ~every 6 weeks with 7-day overlap; sample code uses `jose` on Workers; origins "should validate the token … to ensure that the request came from Access and not a malicious third party" — [Validate Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

**OAuth for third-party / AI tools**
- `workers-oauth-provider` (MIT, Cloudflare) "adds OAuth 2.1 authorization to HTTP APIs and remote MCP servers running on Cloudflare Workers"; implements PKCE (RFC 7636), Dynamic Client Registration (RFC 7591), Client ID Metadata Documents, token revocation (RFC 7009), RFC 9728 protected-resource metadata; follows MCP authorization spec 2026-07-28; requires KV bound as `OAUTH_KV`; "Tokens, codes and secrets are stored only as hashes"; "`props` are encrypted with a key only the token holder can unwrap"; supports split authorization-server/resource-server via Service Binding — [cloudflare/workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider)
- Critical caveat: "the library advertises the required scopes but doesn't enforce them"; "The handler owns authorization beyond that: scopes, ownership, tenancy." CIMD needs the `global_fetch_strictly_public` compat flag; Enterprise-Managed Authorization is experimental; migration guide covers 0.x→1.1 (1.x current) — [cloudflare/workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider)

**Authorization engines**
- Cedar ships an official `cedar-wasm` package ("WebAssembly interface for using Cedar with JavaScript and TypeScript") — [cedar-policy/cedar](https://github.com/cedar-policy/cedar)
- Janssen's Cedarling (built on Rust Cedar) is an embeddable WASM npm package "less than 2M in size"; it "never fetches data to make a decision" — the app supplies entities/tokens per request — [Cedarling overview](https://docs.jans.io/head/cedarling/cedarling-overview)

**Rate limiting auth endpoints**
- Workers Rate Limiting binding: `period` "Must be either `10` or `60`"; limits are "local to the Cloudflare location"; API is "permissive, eventually consistent, and intentionally designed to not be used as an accurate accounting system"; docs advise keying on user/API-key/tenant rather than IP — [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

### Inferences
- **v1 (single photographer/studio):** email+password (existing PBKDF2) plus passkeys as primary; TOTP as fallback; Better Auth DB sessions in D1 with short-lived cookie (`HttpOnly; Secure; SameSite=Lax`), session list + "sign out everywhere"; personal access tokens via `@better-auth/api-key` with explicit scopes (`assets:read`, `assets:write`, `admin`), prefix-identifiable, hashed at rest, expiry, last-used tracking. (inference)
- **Teams/brands tier:** OIDC/SAML via `@better-auth/sso` with DNS domain verification; enforce "SSO required" per org; SCIM needs either (a) a Postgres via Hyperdrive just for SCIM/identity, (b) a hand-written SCIM 2.0 endpoint that uses D1 `batch()` (atomic, non-interactive) instead of interactive transactions, or (c) Access-only lifecycle (session revocation) with JIT provisioning in-app. Option (b) is most aligned with a pure-Cloudflare stack. (inference)
- Cloudflare Access is attractive as an optional "enterprise front door" for self-hosters (IdP federation, device posture, session revocation) but the app must still validate the Access JWT and map `email`/groups claims to internal users; it cannot replace in-app SCIM for downstream group→role mapping. (inference)
- **AI tools / MCP:** put an MCP server behind `workers-oauth-provider`; enforce scopes in every handler; bind each grant to a user + org (tenant) in `props`; offer read-only scopes by default; log every tool call to the audit log. (inference)
- **AuthZ model:** start with RBAC roles at org level (Owner/Admin/Editor/Contributor/Viewer) + per-collection grants (user/group/link → role) stored as relationship tuples (`object, relation, subject`) in D1 — i.e., Zanzibar-shaped data without running OpenFGA. External guests = share-link principals with expiry, download permission, watermark flag. ABAC attributes (asset rights status, embargo date, region, usage license) evaluated in code or later in Cedar-WASM, which fits Workers because Cedar does no I/O. (inference)
- Rate limiting binding is too permissive for strict brute-force protection; combine with per-account lockout counters in D1/DO and WAF rate-limit rules. (inference)

### Gaps
- No official source found confirming OpenFGA or Oso (Oso Cloud/Polar) running *inside* a Worker; OpenFGA is a Go server, so it would be an external service (unverified).
- Did not verify Cedar-WASM bundle size/CPU against Workers limits or `samlify`'s full Workers compatibility (Node crypto/XML deps). Needs a spike.
- Enterprise buyer expectations for SCIM in DAMs (Bynder/Canto) could not be confirmed from vendor primary docs (see section 5).

---

## 2. Delivery security: signed URLs/HMAC, hotlinking, Cloudflare Images signed URLs, R2 presigned scoping, private buckets, watermarking

### Takeaway
Keep all R2 buckets private (no r2.dev, no public custom domain for originals); serve through a Worker that authorizes and issues short-lived HMAC tokens, or use WAF `is_timed_hmac_valid_v0()` on a custom domain (Pro+). R2 presigned URLs are per-object/per-method, max 7 days, unrevocable, and **do not work on custom domains**. Cloudflare Images signed URLs use HMAC-SHA256 with an `exp` parameter.

### Cited Findings
- R2 presigned URLs: expiry 1 s to 7 days (604,800 s); GET/HEAD/PUT/DELETE; "`POST` (multipart form uploads via HTML forms) is not currently supported"; the URL authorizes "anyone with the URL to perform a specific operation"; resource/operation/expiry are fixed by the signature; can be reused until expiry; "cannot be used with custom domains"; no documented revocation; PUT can bind `ContentType` (mismatch → 403); guidance: treat as bearer tokens, short expiry, configure CORS — [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- For authenticated access via custom domains, R2 docs point to WAF HMAC validation (Pro plan or higher) — [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- WAF `is_timed_hmac_valid_v0(secret, http.request.uri, lifetime, http.request.timestamp.sec, sep_len)`; token is `verify=<unix_ts>-<base64 MAC>` over path+timestamp; requires Pro/Business/Enterprise; Cloudflare suggests signing in Snippets/Workers and validating in WAF so invalid requests are blocked before cache/R2 — [Require valid HMAC token](https://developers.cloudflare.com/firewall/recipes/require-valid-hmac-token/); [WAF + Snippets for cache](https://developers.cloudflare.com/cache/interaction-cloudflare-products/waf-snippets/)
- Cloudflare Images private images: "When an image requires a signed URL, the image cannot be accessed without a token unless it is being requested for a variant set to always allow public access"; HMAC-SHA256 over path+query, `sig` param, `exp` Unix timestamp; "Signed URLs are generated server-side to protect your signing key"; store key with `wrangler secret put`; private images don't support custom paths — [Serve private images](https://developers.cloudflare.com/images/manage-images/serve-images/serve-private-images/)
- R2 durability page recommends bucket-scoped API tokens alongside bucket locks — [R2 durability](https://developers.cloudflare.com/r2/reference/durability/)

### Inferences
- **Recommended pattern (v1):** Worker route `/d/<assetId>/<rendition>?exp=…&sig=…` where sig = HMAC-SHA256(secret, `assetId|rendition|exp|principal|disposition`); Worker verifies, then streams from R2 binding with `Cache-Control: private` for originals and `public, max-age` only for public-share renditions keyed by tokenized URL. This allows revocation (key rotation or per-share `revoked_at` check in KV/D1), which presigned URLs cannot. (inference)
- Use presigned PUT URLs (with bound `Content-Type`, short expiry, size checked post-upload) only for direct browser→R2 uploads to the S3 endpoint; never hand out presigned GETs for originals to guests. (inference)
- Hotlink prevention: tokens are the real control; Referer checks are advisory only. Rotate signing keys via a key-id (`kid`) in the token so two keys can overlap. (inference)
- Watermarking: generate watermarked renditions at derivation time (Images `draw` overlays or Worker-side) for guest/external roles, and record the "watermark required" flag on the share link; never let guests fetch un-watermarked renditions by guessing rendition names (include rendition in signature). (inference)
- Set `Content-Disposition: attachment` for originals and non-image types, and `X-Content-Type-Options: nosniff` on every asset response (see section 6). (inference)

### Gaps
- Did not verify current Cloudflare Images pricing/limits for signed URLs with flexible variants or whether `requireSignedURLs` applies to Images transformations of R2-stored originals (transform-via-URL); the fetched page did not cover it.
- No primary source located on Bynder/Canto signed-URL TTL norms.

---

## 3. Data durability & DR: R2 durability/versioning, bucket locks, D1 Time Travel, replication to S3/Glacier, backing up D1/KV/DO, soft delete, fixity, restore drills

### Takeaway
R2 is designed for eleven 9s durability with synchronous writes, but durability does not protect against deletion; **R2 still has no documented native object versioning** (no 2026 changelog entry found), so protection comes from **bucket locks** (prefix rules: age/date/indefinite, override lifecycle), app-level immutable keys, and an independent copy in S3 (with Versioning + Object Lock, Glacier classes). D1 Time Travel gives 30-day PITR on paid plans (7 free), restore is destructive in place; DO SQLite has a 30-day PITR API; KV has no documented backup, so treat it as a cache.

### Cited Findings
**R2**
- "R2 is designed to provide 99.999999999% (eleven 9s) of annual durability"; 99.9% availability SLA; full replication and/or erasure coding across several data centers in one region; synchronous writes — R2 "do[es] not rely on asynchronous replication"; durability does not prevent intentional/accidental deletion — recommends bucket locks and bucket-scoped tokens — [R2 durability](https://developers.cloudflare.com/r2/reference/durability/)
- Bucket locks: "prevent the deletion and overwriting of objects in an R2 bucket for a specified period — or indefinitely"; apply to new and existing objects; Age (`maxAgeSeconds`), Date, or Indefinite conditions; per-prefix rules, strictest wins; up to 1,000 rules; "Bucket lock rules take precedence over lifecycle rules"; bucket can't be emptied while rules exist; configurable via dashboard, `wrangler r2 bucket lock add/set/list/remove`, or `PUT …/lock` (with `cf-r2-jurisdiction` header for jurisdiction buckets) — [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
- **Versioning status:** no official 2026 announcement of R2 object versioning found; the only version-related changelog entry (2022) concerns `x-amz-version-id` response headers on CopyObject; lifecycle rules cover expiration/abort-multipart, not versioning — [R2 changelog](https://developers.cloudflare.com/r2/reference/changelog/); [R2 changelog (product)](https://developers.cloudflare.com/changelog/product/r2/index.md). The bucket-locks page does not mention versioning — [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
- R2 event notifications: `object-create` (PutObject, CopyObject, CompleteMultipartUpload; includes overwrites) and `object-delete` (DeleteObject and `LifecycleDeletion`) sent to a Queue; message has `key`, `size`, `eTag` (no size/eTag on delete); up to 100 rules per bucket; 5,000 msg/s per queue; overlapping rules disallowed; page does not state delivery guarantee — [R2 event notifications](https://developers.cloudflare.com/r2/buckets/event-notifications/)

**AWS S3 / Glacier**
- S3 Object Lock is WORM; "works only in buckets that have S3 Versioning enabled"; Compliance mode: object version "can't be overwritten or deleted by any user, including the root user"; Governance mode bypassable with `s3:BypassGovernanceRetention`; legal hold has no expiry and is independent of retention; default bucket retention; new "variable retention" (event hold + duration) recommended for "a configurable recovery window against ransomware or accidental deletion"; simple DELETE inserts a delete marker, versioned DELETE on locked version → 403; assessed by Cohasset for SEC 17a-4/CFTC/FINRA — [S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)

**D1**
- Time Travel always on: 30 days (Workers Paid), 7 days (Free); "Bookmarks older than 30 days are invalid"; restore by timestamp or bookmark "overwrites the database in place", cancels in-flight queries, returns an undo bookmark; requires production backend; cannot yet clone/fork a database; for longer retention export to R2 via REST API + Workflows — [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

**Durable Objects**
- SQLite-backed DOs have a PITR API covering the past 30 days (SQL tables and KV put() data): `getBookmarkForTime`, `getCurrentBookmark`, `onNextSessionRestoreBookmark` then `ctx.abort()`; not available in local dev — [DO SQL storage API](https://developers.cloudflare.com/durable-objects/api/sql-storage/) (note: search returned this page via nonstandard ports/mirrors; verify against canonical URL)

### Inferences
- **Originals immutability model (v1):** content-addressed or write-once keys (`originals/<assetId>/<sha256>`); never overwrite; edits create new renditions/versions as new keys — this is "versioning by construction" since R2 has none. Apply an R2 bucket lock with an Age rule (e.g., 30–90 days) on `originals/` so a compromised token or bug cannot delete recent originals; app "trash" just marks rows deleted and a purge job deletes after retention expires (lock guarantees floor). (inference)
- **Second copy (ransomware/provider-failure):** R2 `object-create` notification → Queue → consumer Worker copies to S3 (aws4fetch, already in repo) into a bucket with Versioning + Object Lock (Governance for flexibility or Compliance for strict WORM; or variable retention); lifecycle to Glacier Flexible/Deep Archive for originals. Use separate AWS account / least-privilege IAM user with `s3:PutObject` only (no delete) for the replicator. Consumer must be idempotent (check ETag/sha256) since delivery guarantees are not documented. (inference)
- **Delete propagation & GDPR:** do *not* blindly mirror `object-delete` to S3; route erasure through the app so it can record "erasure pending until retention expiry" (see section 5). (inference)
- **D1:** Time Travel covers 30 days; add a nightly Workflow that exports D1 (SQL dump) to R2 under a locked prefix and to S3, keeping e.g. 12 monthly + 52 weekly; test restore into a *new* database (Time Travel restores in place only). (inference)
- **KV:** keep only derivable data (sessions, caches, rate counters, OAuth tokens are re-issuable); anything authoritative belongs in D1/DO. (inference)
- **Fixity:** store SHA-256 at ingest (computed in-Worker on stream) and the R2 ETag; a scheduled Cron/Workflow samples N objects/day, re-hashes from R2 and from S3 copy, and writes results to the audit log; alert on mismatch. This is the norm in digital preservation practice (inference; no primary source fetched).
- **Restore drills:** quarterly documented drill — restore D1 to a bookmark in a scratch DB, restore a sample of originals from S3/Glacier (note Glacier retrieval times/costs), and verify checksums; publish RPO/RTO in docs (e.g., RPO ≤ 1 h for metadata via Time Travel, ≤ replication lag for originals). (inference)

### Gaps
- R2 versioning: absence confirmed only by lack of documentation/changelog; cannot rule out an unannounced beta.
- R2 bucket lock does not appear to have per-object legal hold; whether Date retention JSON schema is documented elsewhere was not checked.
- KV backup/export tooling: no official backup feature found (not searched exhaustively).
- R2 Event Notification delivery semantics (at-least-once) not stated on the fetched page; Queues docs would need checking.
- Did not verify whether R2 natively stores/validates CRC32/SHA checksums (S3 additional checksums) — the durability page says nothing about checksums.

---

## 4. Audit & governance: immutable audit logs, retention, legal hold, admin action logging, data export

### Takeaway
Use a D1 append-only `audit_events` table as the queryable source of truth, plus periodic hash-chained batches written to an R2 prefix protected by a bucket lock (and/or S3 Object Lock) for tamper evidence; Workers Logpush (Paid plan) and Analytics Engine (3-month retention) are operational telemetry, not audit records.

### Cited Findings
- Workers Trace Events Logpush is on Workers Paid; enable with `logpush = true`; includes request/response metadata, `console.log()` output, exceptions; `logs` + `exceptions` have a combined 16,384-char limit before truncation/drop — [Workers Logpush](https://developers.cloudflare.com/workers/observability/logs/logpush/)
- Logpush does not work with jurisdiction-restricted R2 buckets; workaround is an S3-compatible Logpush endpoint — [R2 data location](https://developers.cloudflare.com/r2/reference/data-location/)
- Analytics Engine: "Data written to Workers Analytics Engine is stored for three months"; 250 data points per invocation; 16 KB blobs per data point — [Analytics Engine limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/)
- R2 bucket locks support Indefinite retention per prefix and override lifecycle rules — [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
- S3 legal hold "doesn't have an associated fixed amount of time and remains in effect until removed" — [S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)
- Cloudflare Secrets Store (account-level secrets, Workers + AI Gateway) is still "Available in open beta" — [Secrets Store](https://developers.cloudflare.com/secrets-store/)

### Inferences
- **Audit event schema (v1):** `id (ULID), ts, org_id, actor_type (user|api_key|oauth_client|system|share_link), actor_id, ip, ua, action (asset.download, asset.delete, share.create, role.grant, settings.storage.update, auth.login.failed …), target_type, target_id, before/after (JSON diff, no secrets), request_id, prev_hash, hash`. Enforce append-only in code (no UPDATE/DELETE path) and via D1 triggers that `RAISE(ABORT)` on UPDATE/DELETE (inference — SQLite triggers; verify D1 support).
- **Tamper evidence:** hourly Cron Worker writes a JSONL batch + chain head hash to `audit/YYYY/MM/DD/HH.jsonl` in an R2 bucket with an Age lock (e.g., 1–7 years per org policy) and replicates to S3 Object Lock. (inference)
- **Legal hold:** model as a D1 table `holds(scope: org|collection|asset|user, reason, created_by)` that blocks purge jobs; for strong guarantees copy held originals to an R2 `legal-hold/` prefix with an Indefinite lock rule, or set S3 legal hold on the replicated versions. (inference)
- **Retention policies:** per-org settings for trash retention (default 30 days), audit retention, share-link max TTL, rendition cache TTL; purge jobs log their own actions. (inference)
- **Customer data export:** "Export org" Workflow producing originals + sidecar XMP/JSON metadata + CSV of assets/collections/permissions + audit log JSONL into a ZIP or a target S3 bucket; this doubles as an exit/portability guarantee enterprise buyers ask for (inference).
- Admin/break-glass actions (impersonation, storage credential changes, role changes, API key creation) must be audited and surfaced in an org-admin UI. (inference)

### Gaps
- Did not verify D1 support for SQLite triggers with RAISE(ABORT) (likely, since D1 is SQLite, but unverified).
- Did not check Workers Logs (non-Logpush) retention periods or Logpush destination list in 2026.

---

## 5. Privacy/compliance: GDPR erasure vs immutable backups, residency, biometrics/face recognition, CCPA, children, AI providers, DPAs, SOC 2/ISO 27001 expectations, shared-responsibility

### Takeaway
Residency is achievable: R2 and D1 both support `eu`/`fedramp`/`us` jurisdictions, but only at creation (immutable). Face recognition creates GDPR Art. 9 special-category data (photos are only biometric when processed "through a specific technical means"), CPRA "sensitive personal information", and Illinois BIPA exposure (courts have applied BIPA to face geometry derived from photos) — so face features must be opt-in per org with explicit consent workflows and deletable templates. For AI: Workers AI does not train on or retain customer content; Anthropic API deletes inputs/outputs within 30 days by default, offers ZDR to approved customers, but **Covered Models (Fable 5/5.1, Mythos 5/5.1) require 30-day retention** and Batch/Files APIs are not ZDR-eligible. Enterprise DAM competitors advertise SOC 2 Type II + ISO 27001:2022.

### Cited Findings
**Residency**
- R2 jurisdictions `eu`, `fedramp`, `us`: "Jurisdictional Restrictions guarantee objects in a bucket are stored within a specific jurisdiction"; FedRAMP not self-serve; jurisdiction-specific S3 endpoint `<ACCOUNT_ID>.<JURISDICTION>.r2.cloudflarestorage.com`; Worker bindings need a `jurisdiction` field; jurisdiction cannot be changed after creation; location hints are "best effort and not a guarantee" and only honored on first creation — [R2 data location](https://developers.cloudflare.com/r2/reference/data-location/)
- D1: "Jurisdictions can only be set on database creation and cannot be added or updated after the database exists"; jurisdiction overrides location hints; read replicas "are only created within the jurisdiction" — [D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/)

**Biometrics / face recognition**
- GDPR Recital 51: processing of photographs "should not systematically be considered" special-category; photos are "covered by the definition of biometric data only when processed through a specific technical means" allowing unique identification/authentication — [GDPR Recital 51](https://gdpr-info.eu/recitals/no-51/)
- EDPB Guidelines 05/2022 (law enforcement scope): a person publishing their picture "is not sufficient" to allow processing into biometric templates without express consent; DPIA expected before FRT use — [Hunton summary of EDPB 05/2022](https://hunton.com/privacy-and-information-security-law/edpb-adopts-guidelines-on-facial-recognition-in-the-area-of-law-enforcement) (secondary source; guidance is law-enforcement-scoped)
- CPRA: sensitive personal information includes "biometric information used to identify a consumer"; consumers have "the right to limit a business's use and disclosure of their sensitive personal information" — [CPPA FAQ](https://cppa.ca.gov/faq.html)
- Illinois BIPA: "biometric identifier" includes a "scan of hand or face geometry" and excludes photographs, but federal courts (Monroy v. Shutterfly 2017; Onfido) held face-geometry data derived from photos can be a biometric identifier; private right of action; written release required — [Workplace Class Action blog](https://www.workplaceclassaction.com/2022/04/picture-this-illinois-federal-court-holds-that-bipa-applies-to-photographs/); [Mondaq](https://webiis10.mondaq.com/unitedstates/privacy-protection/1188272/breaking-federal-judge-in-illinois-affirms-that-bipa-extends-to-information-derived-from-photographs) (secondary legal commentary)

**AI providers**
- Workers AI: "Cloudflare does not use Customer Content processed by Workers AI to train AI models"; "Cloudflare does not retain inputs or outputs after they are no longer needed", except storage you direct (R2/KV/DO/Vectorize, AI Gateway logging/caching); operational metadata retained (no content); routing through AI Gateway to third parties means that provider "may process and retain the content under its own terms" — [Workers AI privacy](https://developers.cloudflare.com/workers-ai/platform/privacy/)
- Anthropic commercial default: "automatically delete inputs and outputs on our backend within 30 days of receipt or generation"; flagged Usage Policy violations retained up to 2 years (classifier scores up to 7 years); feedback 5 years; article updated July 1, 2026 — [Anthropic commercial retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
- Anthropic API doc: "Retained data is never used for model training without your express permission"; ZDR available by arrangement; Covered Models "Claude Fable 5.1, Claude Mythos 5.1, Claude Fable 5, and Claude Mythos 5 … require 30-day data retention; ZDR is therefore not available for any of them unless expressly authorized"; Batch (29-day retention), Files API, code execution not ZDR-eligible; prompt caching is eligible; even with ZDR, flagged content may be kept up to 2 years; on Bedrock/Vertex the cloud provider is processor — [Claude API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)

**Buyer expectations (vendor security pages)**
- Bynder lists SOC 2 Type II, ISO 27001:2022, ISO 27018:2019, ISO 22301:2019, GDPR/CCPA/HIPAA; encryption at rest for DB and S3; SSO/MFA and permissions in product; reports shared under NDA (some Bynder pages still cite ISO 27001:2013) — [Bynder security](https://www.bynder.com/en/security); [Bynder security datasheet](https://bynder.com/en/datasheets/bynder-security-datasheet); [Bynder support: Security and Compliance](https://support.bynder.com/hc/en-us/articles/360013873260-Bynder-Security-and-Compliance)
- Canto: annual SOC 2 (Type 2 reports to customers under NDA) and ISO 27001:2022; signs BAAs for ePHI; describes HIPAA as shared responsibility — [Canto security](https://www.canto.com/features/security/)

### Inferences
- **Erasure vs immutable backups:** document the standard approach — erase from primary immediately (D1 rows, R2 originals/renditions, search index, face templates), and let immutable copies (bucket-locked R2 prefixes, S3 Object Lock, D1 Time Travel 30 days, Glacier) expire on their schedule, while maintaining a "tombstone/erasure ledger" that is re-applied on any restore. Keep lock windows short (e.g., 30–90 days) for personal-data-bearing prefixes to bound the erasure lag; disclose in privacy docs. (inference)
- **Residency:** create per-org (or per-deployment) R2 bucket + D1 database in the chosen jurisdiction at onboarding; since jurisdiction is immutable, "move region" = migrate to new resources. Workers AI / Queues / KV residency was not verified — keep personal data out of KV for EU deployments. Remember Logpush can't target jurisdiction buckets. (inference)
- **Face recognition:** off by default; org-admin enable with DPIA template; per-person consent records (model releases are already a photography norm — link consent to the person entity); store embeddings separately, delete on withdrawal; geo-block or extra notice for Illinois/Texas/Washington users; never send face data to third-party AI without explicit configuration. (inference)
- **Children's images:** treat as heightened risk — default-off face recognition for collections tagged minors, restricted sharing, parental-consent fields on releases; GDPR Art. 8/COPPA mostly govern collecting data *from* children online, so the main lever is release management (inference; not sourced).
- **AI provider choice:** default AI tagging to Workers AI (no training, no retention) for privacy-preserving v1; make Anthropic/Bedrock opt-in per org with disclosure of 30-day retention, ZDR caveats, Covered Model retention; avoid Batch/Files APIs for customer images if ZDR is promised. (inference)
- **SOC 2/ISO for a self-hosted OSS project:** the project itself won't be certified; publish (a) a shared-responsibility matrix (Cloudflare/AWS: physical, infra, encryption at rest, platform availability; project: secure code, secure defaults, vuln disclosure, documentation; operator: IAM, SSO config, key rotation, backups/drills, retention settings, DPAs with Cloudflare/AWS/AI providers, incident response), (b) a CAIQ-lite/"security whitepaper" mapping features to SOC 2 CC6 (logical access), CC7 (monitoring), CC8 (change management), A1 (availability/backup) and ISO 27001 Annex A controls, (c) links to Cloudflare/AWS compliance reports. (inference; control family names from general knowledge, not fetched)

### Gaps
- Did not fetch Cloudflare or AWS DPA texts or sub-processor lists; did not verify Workers AI regional processing (EU residency of inference).
- No primary EDPB guidance found specifically on private-sector photo tagging/face clustering.
- Did not verify CCPA specifics on deletion vs backups or Texas CUBI / Washington biometric laws.
- Canto SSO/SCIM/audit-log/data-residency features only available from unverified third-party comparison sites.
- Bedrock data-retention terms for Claude were not fetched.

---

## 6. Application security: DAM-specific OWASP risks (SSRF, malicious files, SVG XSS, ZIP slip, metadata injection), sniffing, CSP, rate limiting, malware scanning

### Takeaway
The highest DAM-specific risks are URL import (SSRF), hostile files fed to parsers (decompression bombs, parser CVEs), active content (SVG/HTML/PDF) served from the app origin, archive extraction, and EXIF/IPTC/XMP strings rendered into HTML. Cloudflare-native mitigations: no image decoding in the Worker (delegate to Cloudflare Images / isolated containers), serve user files from a separate cookieless origin with `nosniff` + `Content-Disposition`, Astro's built-in hash-based CSP (`security.csp`, Astro 6+), and `global_fetch_strictly_public`. Native malware scanning (WAF content scanning) is Enterprise add-on only and limited to the first 50 MB.

### Cited Findings
- OWASP file upload: allowlist extensions after decoding; "don't trust the Content-Type header as it can be spoofed"; magic bytes not sufficient alone; generate filenames; set size limits incl. decompressed size; store outside webroot / different server; "decode and re-encode to an allowed image format"; AV/sandbox, CDR for PDF/Office; ZIP "not recommended since they can contain all types of files", guard decompression bombs — [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- OWASP SSRF: "Deny-lists are bypass-prone. Prefer allow-lists"; block localhost/RFC1918/link-local/metadata (169.254.169.254); validate resolved IPs (DNS rebinding); disable redirects; restrict to http/https; build the request yourself; enforce at network layer — [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- Workers `global_fetch_strictly_public` "will strictly route requests as if they were made on the public Internet"; without it, requests to the Worker's own zone go "to the zone's origin server, ignoring any Workers mapped to the URL" and bypass Cloudflare security settings — [Workers compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)
- WAF content scanning: "available to customers on an Enterprise plan with a paid add-on"; detects content objects regardless of Content-Type; scans "up to the first 50 MB of a request body"; fields `cf.waf.content_scan.has_malicious_obj`, `.has_failed`, `.has_encrypted_obj`, `.truncated`; "does not block or challenge requests on its own" — needs custom rules — [WAF malicious uploads](https://developers.cloudflare.com/waf/detections/malicious-uploads/)
- Astro `security.csp` (added 6.0.0): emits a CSP `<meta>` with SHA-256/384/512 hashes of page scripts/styles; `scriptDirective`/`styleDirective` with `hashes`, `resources`, `strictDynamic`; v7.1 adds `kind` for `-elem`/`-attr`; not supported in `dev`; external scripts need manual hashes; `<ClientRouter />` and Shiki unsupported; `'unsafe-inline'` disables hashes. `security.checkOrigin` (default true) returns 403 for cross-origin unsafe form posts on on-demand pages — [Astro configuration reference](https://docs.astro.build/en/reference/configuration-reference/)
- Workers Rate Limiting binding is per-location, permissive and eventually consistent — [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

### Inferences
- **URL import (SSRF):** run imports in a Queue consumer with `global_fetch_strictly_public`; allow only `https:`; manual redirect handling (`redirect: "manual"`, re-validate each hop, max 3); reject IP-literal hosts and private ranges; cap bytes streamed and timeout; never forward auth headers; for S3/R2 "connections" validate endpoints against an allowlist (the repo's storage-connection feature with user-supplied S3 endpoints is an SSRF vector). (inference)
- **Malicious files:** Workers should not decode images with WASM libvips on untrusted input inline in the request path; prefer Cloudflare Images transformations or a sandboxed Container for RAW/HEIC/TIFF/PSD; enforce max pixels (decompression bomb), max file size, magic-byte sniff vs extension, reject polyglots. (inference)
- **SVG/HTML/PDF:** never serve SVG originals inline from the app origin; rasterize SVG for previews; serve originals from a separate download hostname (no session cookies) with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'` on asset responses. (inference)
- **ZIP ingest:** stream-extract in a Queue consumer; normalize paths, reject `..`/absolute/symlink entries (ZIP slip), cap entry count, per-entry and total uncompressed size and compression ratio. (inference)
- **Metadata injection:** EXIF/IPTC/XMP fields (caption, keywords, filenames, copyright) are attacker-controlled — Svelte's default escaping handles text nodes, but avoid `{@html}`, sanitize in CSV exports (formula injection `=`, `+`, `-`, `@`), and cap lengths before indexing. (inference)
- **CSP:** enable Astro `security.csp` with `strictDynamic`; `img-src` limited to self + download host; `frame-ancestors 'none'` via response header (meta CSP cannot set `frame-ancestors` — general web knowledge, inference); test with `astro build && preview`.
- **Abuse on public galleries:** per-share-link and per-IP-range WAF rate limiting rules, Turnstile on password-protected galleries and bulk ZIP downloads, download quotas per link, signed tokens (section 2). (inference)
- **Malware scanning without Enterprise:** Queue consumer sends non-image uploads (PDF/Office/ZIP/video) to a ClamAV Container or external scanner; quarantine prefix until clean; images re-encoded for renditions anyway. (inference)

### Gaps
- No primary source fetched for SVG XSS, ZIP slip specifics, or libvips/ImageMagick CVE history; Cloudflare Containers suitability for ClamAV not verified.
- Did not verify whether Workers fetch can reach RFC1918 addresses at all (the compat-flag text did not mention private IPs).

---

## 7. Open-source project hygiene: license, SECURITY.md, dependency scanning, signed releases, SBOM, OpenSSF Scorecard

### Takeaway
The repo is already Apache-2.0, which maximizes adoption by studios/brands and allows commercial hosting without source-sharing obligations; AGPL §13 would force anyone offering a modified version over a network to offer source, which protects against closed SaaS forks but deters some enterprises. OpenSSF Scorecard's checks provide a ready-made hygiene checklist (SECURITY.md, Branch-Protection, Token-Permissions, Pinned-Dependencies, Signed-Releases, SBOM, SAST, Dependency-Update-Tool, Vulnerabilities).

### Cited Findings
- AGPL-3.0 §13: "if you modify the Program, your modified version must prominently offer all users interacting with it remotely through a computer network … an opportunity to receive the Corresponding Source of your version … from a network server at no charge" — [GNU AGPL-3.0 text](https://www.gnu.org/licenses/agpl-3.0.txt)
- Repo LICENSE is Apache License 2.0 with a NOTICE file — local file `/home/siddhartha/Infowall/dam/cf-dam/LICENSE` (repo inspection)
- OpenSSF Scorecard checks and risk: Dangerous-Workflow (Critical), Webhooks (Critical), Binary-Artifacts, Branch-Protection, Code-Review, Dependency-Update-Tool, Maintained, Signed-Releases ("cryptographic signatures or SLSA provenance"), Token-Permissions, Vulnerabilities (OSV) (High); Fuzzing, Packaging, Pinned-Dependencies, SAST, SBOM, Security-Policy (SECURITY.md with reporting contact) (Medium); CI-Tests, CII-Best-Practices, Contributors, License (Low) — [OpenSSF Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md)
- `workers-oauth-provider` itself is MIT-licensed (compatible dependency) — [cloudflare/workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider)

### Inferences
- **License:** staying Apache-2.0 is consistent with a "self-host first, grow to teams/brands" strategy and patent grant comfort for enterprises; if hosted-fork protection becomes a concern, options are AGPL for the server package only (relicensing requires contributor agreement/DCO + CLA history), or trademark policy + open-core. Decide before accepting outside contributions; adopt DCO or CLA now. (inference)
- **v1 hygiene checklist:** SECURITY.md (private vulnerability reporting via GitHub Security Advisories, supported versions, SLA), Dependabot/Renovate, CodeQL, `npm audit`/OSV-Scanner in CI, GitHub Actions with `permissions: read-all` default and SHA-pinned actions, branch protection + required review, OpenSSF Scorecard Action with badge. (inference)
- **Release integrity:** tag releases signed (Sigstore/gitsign), publish SLSA provenance via GitHub `attest-build-provenance`, attach CycloneDX/SPDX SBOM (`npm sbom` exists in npm ≥10 — general knowledge, verify), and document `wrangler deploy` from a verified tag. (inference)
- **Secure defaults in the product (often scored by buyers):** no default credentials, setup wizard forces admin passkey/MFA, private buckets only, secrets via `wrangler secret`/Secrets Store (beta), threat model doc. (inference)

### Gaps
- Did not fetch OpenSSF Best Practices badge criteria, SLSA levels, or npm provenance docs.
- Contributor license approach (DCO vs CLA) not researched.

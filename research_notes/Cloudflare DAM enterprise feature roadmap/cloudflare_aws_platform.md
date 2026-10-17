# Cloudflare developer platform (plus AWS complements) as a foundation for a photo DAM — late-2026 assessment

Research date: 2026-10-16. All Cloudflare figures come from developers.cloudflare.com pages fetched that day; each finding notes the page's "last updated" date where one was shown. AWS S3 and data-transfer prices come from the official AWS Price List API (us-east-1 offer files, publication date 2026-10-15), because the aws.amazon.com/s3/pricing HTML rate tables did not render for the fetch tool.

## Storage: R2 vs S3 tiers, R2 feature status, migration tools, cross-provider redundancy

### Takeaway
R2 Standard costs $0.015/GB-month and R2 Infrequent Access (IA) $0.01/GB-month, with zero egress. Objects can be up to about 5 TiB (multipart, 10,000 parts). R2 has lifecycle transitions to IA, event notifications to Queues, prefix-based bucket locks and EU/US/FedRAMP jurisdictions. It has no archive tier, so S3 Glacier Deep Archive ($0.00099/GB-month) is the natural cold-copy tier. The catch is that pulling data back out of AWS costs $0.09/GB in internet egress, plus retrieval fees.

### Cited Findings
**R2 pricing (page last updated Oct 1, 2026)**
- Standard: $0.015/GB-month storage, Class A $4.50/M, Class B $0.36/M, no retrieval fee, no minimum duration. IA: $0.01/GB-month, Class A $9.00/M, Class B $0.90/M, $0.01/GB retrieval, 30-day minimum storage duration. — [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- Free tier (Standard only): 10 GB-month, 1M Class A, 10M Class B per month. No egress charges for any storage class, whether through the Workers API, S3 API or r2.dev. DeleteObject, DeleteBucket and AbortMultipartUpload are free. 401 responses are not billed. IA is billed for the full 30 days even if an object is deleted early. — [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- Super Slurper and Sippy are free to use. You pay only the Class A operations on the R2 side plus whatever the source provider charges. — [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- The pricing page lists only Standard and IA. There is no archive or cold tier. — [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- Page error: the IA worked example prices 1,000 Class A writes at $9.00, which should be $0.009. Don't copy that example. — [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

**R2 limits**
- Unlimited storage and objects per bucket. 1,000,000 buckets per account. Key length 1,024 bytes. Object metadata 8,192 bytes. Max object size 5 TiB (footnote: 4.995 TiB). Max single-part upload 5 GiB. Max 10,000 parts. Concurrent writes to the same key limited to 1/sec (429 above that). 100 custom domains per bucket. REST API limited to 1,200 requests per 5 minutes. r2.dev is rate-limited and "not intended for production". The page is internally inconsistent: one footnote says 4.995 GiB for multipart where the table says TiB. — [R2 limits](https://developers.cloudflare.com/r2/platform/limits/)

**Presigned URLs**
- Supported for GET, HEAD, PUT and DELETE. Expiry 1 second to 7 days. POST policy (HTML form) uploads are not supported. Presigned URLs work only on the `<ACCOUNT_ID>.r2.cloudflarestorage.com` S3 domain, not custom domains. For authenticated delivery on custom domains, Cloudflare points to WAF HMAC validation, which needs Pro or higher. Signing a Content-Type into a PUT URL makes mismatched uploads fail with 403. — [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)

**Event notifications (page updated Apr 21, 2026)**
- Two event types: `object-create` (PutObject, CopyObject, CompleteMultipartUpload) and `object-delete` (DeleteObject, LifecycleDeletion). The only destination is Cloudflare Queues, consumed by a Worker or an HTTP pull consumer. Up to 100 rules per bucket, with prefix and suffix filters. Overlapping rules are rejected. Messages include key, size and eTag (size and eTag only on creates). Throughput is bounded by the 5,000 msg/s per-queue limit. The page does not state the delivery guarantee or GA status. — [R2 event notifications](https://developers.cloudflare.com/r2/buckets/event-notifications/)

**Lifecycle rules**
- Supported actions: expire (after N days or on a date), transition Standard→IA (each transition is a Class A op), and abort incomplete multipart uploads. Up to 1,000 rules per bucket, prefix-scoped (tag filters not mentioned). Processing usually completes within 24 hours. Every bucket has a default rule that aborts incomplete multipart uploads after 7 days. The page does not cover moving IA back to Standard. — [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)

**Bucket locks (page updated Apr 30, 2026)**
- Prevent deletion or overwrite for a duration, until a date, or indefinitely. Prefix-scoped, up to 1,000 rules, and they apply to existing objects too. When rules overlap, the strictest retention wins. Locks take precedence over lifecycle rules, and a bucket with lock rules can't be emptied. The page does not mention S3 Object Lock API compatibility (governance/compliance modes, legal hold). — [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)

**Data location**
- Location hints: wnam, enam, weur, eeur, apac, oc (best effort, set only at creation). Jurisdictions: `eu`, `us`, `fedramp` (FedRAMP is Enterprise, by request). Jurisdiction is fixed at bucket creation ("cannot be changed"). Workers bindings must name the jurisdiction. Logpush can't write to jurisdictional buckets. — [R2 data location](https://developers.cloudflare.com/r2/reference/data-location/)

**Migration**
- Super Slurper sources: S3, R2, GCS and any S3-compatible store (tested with B2, DigitalOcean Spaces, Scaleway, Wasabi). Objects over 1 TB are skipped. S3 Glacier Flexible and Deep Archive objects are skipped and logged (Glacier Instant Retrieval works), as are Intelligent-Tiering Deep Archive tier objects. Custom metadata is preserved. Overwrite or Skip is configurable. — [Super Slurper](https://developers.cloudflare.com/r2/data-migration/super-slurper/)
- Sippy does incremental, copy-on-read migration. Use it "to avoid upfront egress fees" or to serve hot objects from R2 without a full migration. — [R2 data migration](https://developers.cloudflare.com/r2/data-migration/)

**Data products: renamed to "Basin" (GA Oct 1, 2026)**
- Cloudflare Data Platform is now Basin. Pipelines became Basin Pipelines, R2 Data Catalog became Basin Catalog, and R2 SQL became Basin SQL. All three are GA, and existing configs keep working. Basin is built on Apache Iceberg and R2. Pipelines ingest up to 3 GB/s per stream with SQL transforms. Basin SQL supports joins, window functions, CTEs and JSON functions. Catalog jurisdiction support is still "planned". Pricing is usage-based, with no rates given in the post. — [Cloudflare blog: Basin](https://blog.cloudflare.com/cloudflare-basin)
- Old API paths are still supported but slated for future deprecation. New Wrangler families are proposed as `wrangler basin pipelines|catalog|sql`. — [Cloudflare Basin docs](https://developers.cloudflare.com/basin/); [The Register](https://www.theregister.com/a/5300618)
- Basin Catalog charges for catalog operations and compaction on top of R2 storage and operations. Rates are on a separate page I did not fetch. — [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

**S3 (us-east-1, AWS Price List API, published 2026-10-15)**
- Storage per GB-month:
  - Standard: $0.023 (first 50 TB), $0.022 (next 450 TB), $0.021 (above 500 TB)
  - Standard-IA: $0.0125
  - One Zone-IA: $0.01
  - Glacier Instant Retrieval: $0.004
  - Glacier Flexible Retrieval: $0.0036
  - Intelligent-Tiering Deep Archive Access tier: $0.00099
  - [AWS Price List, AmazonS3 us-east-1](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json)
- Requests per 1,000:
  - Standard: PUT/COPY/POST/LIST $0.005, GET $0.0004
  - Standard-IA: PUT $0.01, GET $0.001
  - Glacier Instant Retrieval: PUT $0.02, GET $0.01
  - PUT into Glacier: $0.03
  - Lifecycle transitions: $0.05 into Deep Archive, $0.02 into Glacier IR, $0.01 into Standard-IA
  - Expedited Glacier requests: $0.01 each
  - [AWS Price List, AmazonS3 us-east-1](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json)
- Retrieval per GB:
  - Standard-IA: $0.01
  - Glacier Instant Retrieval: $0.03
  - Glacier Flexible: Expedited $0.03, Standard $0.01, Bulk $0.00
  - Deep Archive: Standard $0.02, Bulk $0.0025
  - Restored copies are billed as staging storage at $0.021/GB-month.
  - Early-delete charges are pro-rated: Glacier IR before 90 days, Standard-IA before 30 days.
  - [AWS Price List, AmazonS3 us-east-1](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json)
- Minimum durations: 30 days for Standard-IA and One Zone-IA, 90 days for Glacier IR and Flexible, 180 days for Deep Archive. 128 KB minimum billable object size for Standard-IA, One Zone-IA and Glacier IR. — [S3 pricing page](https://aws.amazon.com/s3/pricing/)
- Internet egress from us-east-1: first 100 GB/month free (aggregated across all AWS services), then $0.09/GB for the first 10 TB, $0.085 for the next 40 TB, $0.07 for the next 100 TB, and $0.05 above 150 TB. S3 Transfer Acceleration costs $0.04/GB. — [AWS Price List, AWSDataTransfer us-east-1](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/us-east-1/index.json); [S3 pricing page](https://aws.amazon.com/s3/pricing/)
- Restore flow: Flexible Retrieval and Deep Archive objects need `RestoreObject` before a GET. Glacier IR objects can be read immediately.
  - Flexible Retrieval: Expedited 1–5 min (objects under 250 MB), Standard 3–5 h, Bulk 5–12 h.
  - Deep Archive: Standard within 12 h, Bulk within 48 h, no Expedited.
  - Batch Operations restores run at up to 1–2 PB/day per account. Restore requests are throttled at 1,000 TPS.
  - Provisioned capacity guarantees Expedited retrievals.
  - [S3 archive retrieval options](https://docs.aws.amazon.com/AmazonS3/latest/userguide/restoring-objects-retrieval-options.html)

### Inferences
- The Deep Archive storage-class row itself was missing from the price-list file. $0.00099/GB-month is the rate for the Intelligent-Tiering Deep Archive Access tier, which has historically matched Glacier Deep Archive's rate. Verify on the AWS console or calculator before quoting.
- R2 has no archive tier, so a "multi-tier" DAM on Cloudflare means R2 Standard (renditions, hot originals) plus R2 IA (warm originals), with an optional S3 Deep Archive cold copy. Because R2 egress is free and S3 ingress is free, replicating R2→S3 costs only the S3 PUT/lifecycle requests plus storage. Restoring S3→R2 costs AWS egress plus retrieval fees.
- Best-practice redundancy pattern:
  - Treat R2 as the primary.
  - Send `object-create` event notifications to a Queue; a consumer Worker (or Container, for objects too big to stream through 128 MB) copies to S3 with aws4fetch multipart PUTs straight into `DEEP_ARCHIVE` (or `GLACIER_IR` for faster DR).
  - Record the S3 ETag/version in D1.
  - Use bucket locks on the `originals/` prefix for ransomware and accidental-delete protection.
  - Note that Super Slurper can't read Deep Archive. A restore back to R2 must be RestoreObject → wait → copy, which is the "sweep that finishes restores" the repo already has (commit 56b083d).
- Presigned URLs can't use custom domains. Signed delivery through a custom domain needs Worker-side HMAC tokens (Workers fetching from the R2 binding) or WAF HMAC validation on Pro+.
- Basin is not a catalog database for the DAM. It fits analytics (download/view logs, audit trails as Iceberg tables queried with Basin SQL), not the transactional asset index.

### Gaps
- No native R2→S3 (or R2→R2 cross-jurisdiction) replication feature turned up in the pages I fetched. I didn't confirm whether one exists.
- R2 multipart part-size rules (minimum part size, equal-size requirement), presigning of UploadPart, and object versioning status were not on the fetched pages.
- Sippy's limitations (storage classes, size limits, supported sources) were not fetched.
- I didn't fetch Basin Catalog / Basin SQL rates.
- The R2 limits page conflicts with itself on multipart max (GiB vs TiB footnote).
- Event notification delivery semantics (at-least-once? ordering?) are not stated.

## Compute: Workers limits vs RAW/EXIF work, WASM libraries, Containers and Sandbox, Workflows, Queues, Durable Objects

### Takeaway
Workers (128 MB memory per isolate, up to 5 min CPU on Paid) handle EXIF/XMP parsing from range reads and orchestration, but not full-resolution RAW decoding or video. Cloudflare Containers and the Sandbox SDK went GA on Apr 13, 2026 (Workers Paid). Their largest standard instance is 4 vCPU / 12 GiB / 20 GB disk, which covers exiftool, libvips, LibRaw and ffmpeg. Workflows (10k–25k steps, 1 GB state, 365-day sleeps) and Queues (128 KB messages, 5k msg/s per queue) supply the job backbone. Durable Objects (10 GB SQLite each) suit per-library state, locks and websockets.

### Cited Findings
**Workers (page updated Oct 12, 2026)**
- Free: 10 ms CPU. Paid: 30 s CPU by default, configurable to 5 min.
- Memory is 128 MB per isolate on both plans.
- Subrequests: 50 on Free, 10,000 on Paid (configurable up to 10M).
- Worker size up to 64 MiB. Startup time limit 1 s.
- Cron, Durable Object alarm and Queue consumer invocations get 15 min of wall clock. HTTP wall clock is unlimited while the client stays connected.
- Request body size depends on the Cloudflare plan: Free and Pro 100 MB, Business 200 MB, Enterprise up to 5 GB self-serve (higher through support).
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- Conflict: the support "Error 413" page lists Enterprise as "500+ MB" rather than 5 GB. — [Error 413](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413)

**WASM libraries**
- wasm-vips compiles libvips to WebAssembly with Emscripten and is "still under early development". Out of the box it handles JPEG, PNG, WebP and TIFF (no RAW). The author's benchmark shows sharp 8.3x (JPEG), 3.6x (PNG) and 2.2x (WebP) faster than wasm-vips. — [wasm-vips GitHub](https://github.com/kleisauke/wasm-vips); [libvips blog](https://www.libvips.org/2020/09/01/libvips-for-webassembly.html)
- @colorhythm/libraw-wasm wraps LibRaw for browser and Node camera-RAW decoding. Its docs recommend running decoding in a Web Worker. — [libraw-wasm](https://github.com/colorhythm/libraw-wasm)
- @uswriting/exiftool runs ExifTool (13.42) via zeroperl, with no native binaries. — [@uswriting/exiftool README](https://cdn.jsdelivr.net/npm/@uswriting/exiftool@1.0.9/README.md); [zeroperl write-up](https://andrews.substack.com/p/zeroperl-sandboxed-perl-with-webassembly)
- A related Go project reports about 7–10 s to compile and instantiate the WASM and initialise Perl, and recommends keeping the process alive. — [go-exiftool-wasm](https://pkg.go.dev/github.com/lbe/go-exiftool-wasm)

**Containers and Sandbox SDK**
- Containers and the Sandbox SDK became GA on Apr 13, 2026 on Workers Paid, with higher concurrency limits, Active-CPU pricing and SSH access. — [Changelog: Containers and Sandboxes GA](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/)
- Pricing (page updated Oct 5, 2026). Workers Paid includes 25 GiB-hours of memory, 375 vCPU-minutes and 200 GB-hours of disk per month. Beyond that:
  - $0.0000025 per GiB-second of memory
  - $0.000020 per vCPU-second, billed on active CPU only
  - $0.00000007 per GB-second of disk
  - Billing is in 10 ms increments. Memory and disk are billed on provisioned size.
  - Egress: $0.025/GB in North America and Europe (1 TB included), $0.05 in Oceania, Korea and Taiwan, $0.04 elsewhere (500 GB included).
  - [Containers pricing](https://developers.cloudflare.com/containers/pricing/)
- Instance types:

  | Type | vCPU | Memory | Disk |
  |---|---|---|---|
  | lite | 1/16 | 256 MiB | 2 GB |
  | basic | 1/4 | 1 GiB | 4 GB |
  | standard-1 | 1/2 | 4 GiB | 8 GB |
  | standard-2 | 1 | 6 GiB | 12 GB |
  | standard-3 | 2 | 8 GiB | 16 GB |
  | standard-4 | 4 | 12 GiB | 20 GB |

  — [Containers pricing](https://developers.cloudflare.com/containers/pricing/)
- Account limits (page updated Oct 12, 2026, raisable): 6 TiB concurrent memory, 1,500 concurrent vCPU, 30 TB concurrent disk. Image storage 50 GB in total. Custom instance types go up to 4 vCPU, 12 GiB and 20 GB disk, with at least 3 GiB per vCPU. Snapshots up to 20 GB, retained 30 days. — [Containers limits](https://developers.cloudflare.com/containers/platform-details/limits/)
- Each container class is backed by a SQLite-backed Durable Object. A Worker routes to an instance by name with `getByName()`, and `startAndWaitForPort` boots the container on demand. Instances sleep after an inactivity timeout. — [Containers overview](https://developers.cloudflare.com/containers/)
- Cold starts: Cloudflare publishes no figure. A beta-era third party measured about 2–3 s. Another third party reports 180–320 ms for small Node/Python images (methodology unverified). — [Sliplane](https://sliplane.io/blog/cloudflare-released-containers-everything-you-need-to-know); [Digital Applied](https://www.digitalapplied.com/blog/cloudflare-containers-dockerized-workloads-edge-330-cities)
- Sandbox: full Linux microVMs (own kernel and network) for running commands and streaming output, file transfer, persistent workspaces and **R2 bucket mounting**, plus Dynamic Workers (JS, Python, WASM only). Its Durable Object scheduling policy is in "public beta". — [Sandbox SDK docs](https://developers.cloudflare.com/sandbox/)
- An `@cloudflare/sandbox@next` (SDK 1.0 preview) line exists alongside the stable package. This comes from the Cloudflare-provided skills available in this environment (sandbox-next / sandbox-stable), not from a fetched page.

**Workflows**
- Paid limits: 10,000 steps by default (configurable to 25,000). 30 s CPU per step by default (up to 5 min), unlimited wall time per step. 1 MiB per step result. 1 GB persisted state per instance. `step.sleep` up to 365 days. 50,000 concurrent instances. Creation rate 300/s per account and 100/s per Workflow. 2M queued instances. 30-day retention. 1 MiB event payload. — [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)
- The same page also mentions a "10,000 concurrent instance limit" in a note, which conflicts with the 50,000 in the table. — [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)

**Queues**
- 10,000 queues per account. 128 KB messages. Consumer batches up to 100 messages. `sendBatch` up to 100 messages or 256 KB. Max batch wait 60 s. 100 retries. 250 concurrent push consumers. 5,000 msg/s per queue. Retention up to 14 days (Free: 24 h). 25 GB backlog per queue. Consumers get 15 min wall clock and 30 s CPU by default (up to 5 min). Pull consumers' visibility timeout is 12 h. `delaySeconds` up to 24 h. — [Queues limits](https://developers.cloudflare.com/queues/platform/limits/)

**Durable Objects (SQLite-backed)**
- Unlimited objects. 10 GB storage per object on Paid; unlimited per account on Paid, 5 GB on Free. Key plus value up to 2 MB. Websocket messages up to 32 MiB. CPU per request 30 s by default (up to 5 min). SQL limits match D1 (100 columns, 2 MB rows, 100 bound params). Soft limit about 1,000 req/s per object. — [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)

### Inferences
- Rough memory arithmetic: a 45 MP RAW demosaiced to 16-bit RGB is about 270 MB of pixel data, more than the 128 MB isolate. RAW decode and full-resolution rendition generation therefore belong in a Container (standard-2 to standard-4) or Lambda.
- EXIF/XMP extraction (exifr, ExifReader) works in a Worker by range-reading the first ~64–512 KB from R2. Most RAW and JPEG metadata sits in the header, though some formats put XMP or makernotes deeper in the file.
- exiftool-wasm's multi-second init plus Perl memory makes it a poor fit for per-request Workers. Run native exiftool in a Container kept warm (`sleepAfter`) for batch metadata work.
- Rough per-asset Container cost: standard-2 (1 vCPU, 6 GiB) at 5 s per RAW is about 30 GiB-s × $0.0000025 + 5 vCPU-s × $0.00002 ≈ $0.000175, so about $175 per million RAWs before idle time. Memory is billed while provisioned, so warm idle time adds cost.
- Suggested job topology:
  1. An R2 `object-create` event goes to a Queue.
  2. The consumer Worker starts one Workflow per asset (steps: metadata → renditions via Container → AI describe → embed → index). This keeps each step under 1 MiB of output, with large artifacts stored in R2 by key.
  3. Workflows' 365-day `sleep` / waitForEvent pattern suits Glacier restores (12–48 h).
  4. Per-library (tenant) Durable Objects handle locks, upload sessions, websocket progress and counters.

### Gaps
- No official Containers cold-start figure, and no maximum instance count per class.
- No sourced benchmark of LibRaw-wasm or wasm-vips memory use for 24–60 MP RAWs inside a 128 MB isolate.
- Workflows pricing (it bills as Workers usage) and the waitForEvent timeout were not on the limits page.
- Queues DLQ configuration wasn't on the limits page. DLQs are documented elsewhere in Queues docs, which I didn't fetch.
- Sandbox-specific pricing beyond Containers pricing was not found.

## Database/index: D1 limits and scaling, Hyperdrive + Postgres, full-text search, Vectorize, AI Search

### Takeaway
D1 has a hard 10 GB per-database cap but allows 50,000 databases per account. It supports FTS5 and read replicas through the Sessions API at no extra charge. One D1 database comfortably holds a ~1M-asset catalog. At 10M assets you need per-tenant or sharded D1, or Postgres via Hyperdrive. Vectorize handles 20M vectors per index at up to 1536 dimensions, for a few dollars a month at this scale. AI Search now does multimodal (image) search but caps at 1M files per instance and starts billing Nov 1, 2026.

### Cited Findings
**D1**
- Limits: Paid databases cap at 10 GB, and the page says that "cannot be increased" (Free: 500 MB). 50,000 databases per account (raisable). 1 TB storage per account (raisable). 1,000 queries per Worker invocation. Rows/strings/BLOBs up to 2 MB. SQL statements up to 100 KB. 100 bound parameters. 100 columns. 30 s per query, which also caps a whole `batch()`. LIKE/GLOB patterns up to 50 bytes. Time Travel 30 days. Each database processes queries one at a time, and an overloaded queue returns an error. — [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- Pricing (Paid): 25B rows read per month included, then $0.001 per million. 50M rows written included, then $1.00 per million. 5 GB storage included, then $0.75/GB-month. Read replicas cost nothing extra. — [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- Extensions: FTS5 (including `fts5vocab`), JSON and math functions are supported. — [D1 SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- Read replication: requires the Sessions API (`withSession()`, `first-primary`, bookmarks). That API is Worker-binding only. Replicas exist in ENAM, WNAM, WEUR, EEUR, APAC and OC. Sessions give sequential consistency, including read-your-writes. The page doesn't state GA vs beta; its resource link is titled "d1-read-replication-beta". — [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)

**Hyperdrive**
- 25 configurations on Paid. About 100 origin connections per config on Paid (about 20 on Free). 60 s maximum statement duration. 50 MB maximum cached response. 15 s connect timeout and 10 min idle timeout. The page references only PostgreSQL. — [Hyperdrive limits](https://developers.cloudflare.com/hyperdrive/platform/limits/)

**Vectorize (page updated Aug 5, 2026)**
- 50,000 indexes on Paid. Up to 1536 dimensions (float32). 20,000,000 vectors per index. 10 KiB of metadata per vector. 10 metadata indexes per index, indexing 64 bytes per field. 50,000 namespaces per index. topK 50 when returning values or metadata, 100 otherwise. Upsert batches of 1,000 (Workers) or 5,000 (HTTP). — [Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/)
- Pricing (Paid): 50M queried dimensions per month included, then $0.01 per million. 10M stored dimensions included, then $0.05 per 100M. The worked example implies queried dimensions = (queries + stored vectors) × dimensions. — [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)

**AI Search**
- Workers binding, REST and MCP access. Hybrid (semantic plus keyword) search is on by default. Custom metadata filters. A multimodal embedding model enables image search, including searching with an image. OCR covers scans and images. — [AI Search overview](https://developers.cloudflare.com/ai-search/)
- Limits on Paid: 5,000 instances. 1M files per instance (500K with hybrid search). PDFs with OCR and text files up to 10 MiB; other formats up to 4 MiB. — [AI Search limits and pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/)
- Pricing (page updated Oct 1, 2026; billing starts Nov 1, 2026): each month includes 5M ingestion tokens, 10 GB-month, 1,000 semantic queries and 1,000 full-text queries. Beyond that:
  - Ingestion: $0.75 per million tokens
  - OCR: +$0.50 per million tokens
  - Storage: $2.00/GB-month
  - Semantic or hybrid queries: $0.75 per 1,000
  - Full-text queries: $0.10 per 1,000
  - [AI Search limits and pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/)
- Also on AWS: S3 Vectors costs $0.06/GB-month storage and $2.50 per million queries. — [S3 pricing page](https://aws.amazon.com/s3/pricing/)

### Inferences
- Sizing: at roughly 2–5 KB of metadata, keyword and FTS rows per asset, 1M assets is about 2–5 GB, which fits in one D1 database. 10M assets (20–50 GB) does not. Options:
  - One D1 database per library/tenant. 50,000 databases are allowed, which suits a multi-tenant PhotoShelter-style service.
  - Hash-sharding the asset table across N databases, with a small global directory database.
  - Moving the catalog to Postgres (Neon, Supabase, PlanetScale Postgres) via Hyperdrive, with tsvector/pg_trgm and pgvector. This makes sense once cross-library queries, complex faceting or more than 10 GB per tenant are needed.
- D1's serial per-database execution and 100 bound parameters favour batching. The 50-byte LIKE pattern limit means search should go through FTS5 rather than LIKE.
- At ~1M images, AI Search's $2/GB-month storage and 1M-file cap make it pricier and less controllable than Vectorize plus your own embeddings. It is good for document/caption RAG or a quick prototype of image search.
- Vectorize cost at 1M assets × 1024 dims with 100k queries/month: stored ≈ 1.02B dims, about $0.50/month. Queried ≈ (0.1M + 1M) × 1024 ≈ 1.13B dims, about $10.8/month. 10M vectors fits in one index (20M cap). Per-tenant isolation can use namespaces (50k) or metadata filters (10 indexed fields).

### Gaps
- D1 read replication GA status was not confirmed.
- Hyperdrive pricing and MySQL support were not on the limits page.
- I found no published FTS5 performance numbers on D1 at multi-GB scale.
- The AI Search page doesn't name its multimodal embedding model or dimensions.
- I didn't verify whether AI Search is still branded "formerly AutoRAG" (the fetched page doesn't mention that name).

## Images & video: Cloudflare Images, Media Transformations, Stream

### Takeaway
Cloudflare Images can transform R2-sourced images up to 100 MB (20 MB through the Images binding) and 100 MP into AVIF, WebP or JPEG. It accepts HEIC but not RAW or TIFF. You pay $0.50 per 1,000 unique transformations per calendar month, which gets expensive if a large catalog's thumbnails are re-transformed every month. Media Transformations only take inputs up to 100 MB and 10 min, so they suit proxies, not pro video originals. Stream costs $5 per 1,000 minutes stored and accepts uploads up to 30 GB.

### Cited Findings
- Images pricing (page updated Oct 12, 2026): 5,000 unique transformations per month free, then $0.50 per 1,000. Storage $5 per 100k images. Delivery $1 per 100k. A unique transformation is counted once per calendar month per original and parameter set. `format` doesn't count as a separate transformation. Transforming images stored outside Images (e.g. in R2) bills only transformations. — [Images pricing](https://developers.cloudflare.com/images/pricing/)
- Input formats: PNG, JPEG, GIF, WebP, SVG, HEIC, and AVIF (Enterprise only). No RAW or TIFF on that list.
  - Size limits: 100 MB for remote images, 10 MB for hosted uploads, 20 MB for Images binding `.input()`.
  - Dimension limits: 100 MP area, 12,000 px per side.
  - Animations over 50 MP are delivered untransformed.
  - [Images limits](https://developers.cloudflare.com/images/get-started/limits/); [HEIC support changelog](https://developers.cloudflare.com/changelog/post/heic-support)
- Outputs: auto, AVIF, WebP, progressive or baseline JPEG, and JSON (image info). JPEG XL is not listed. AVIF falls back to WebP or JPEG when an image is too large to encode quickly.
  - Metadata options: `copyright` (the default, which keeps only the EXIF copyright tag), `keep`, and `none`. They apply to JPEG output only; other output formats always discard metadata.
  - [Images features](https://developers.cloudflare.com/images/optimization/features/)
- Media Transformations: input by URL (e.g. R2), up to 100 MB and 10 min; the origin must support range requests.
  - Outputs: H.264 MP4 clips (1–60 s), jpg/png frames, spritesheets, AAC audio. Width and height 10–2000 px.
  - Pricing: $0.50 per 1,000 unique transformations, with 5,000 free per month shared with Image Transformations since Nov 1, 2025. A frame counts as 1; video or audio counts 1 per output second.
  - [Media Transformations](https://developers.cloudflare.com/stream/transform-videos/)
- Stream: $5 per 1,000 minutes stored (prepaid), $1 per 1,000 minutes delivered. Encoding and ingress are free. Maximum file 30 GB. Workers-binding media transformations are unbilled during beta and will later be billed per operation. — [Stream pricing](https://developers.cloudflare.com/stream/pricing/)

### Inferences
- A RAW pipeline still needs your own decoder (LibRaw or exiftool's embedded-preview extraction in a Container or Lambda). The decoder writes a large JPEG or TIFF master into R2, and Images or libvips makes the derivatives from that.
- Cost trap: 1M assets × 3 sizes, all viewed in one month, means up to 3M unique transformations, about $1,500/month, and that recurs monthly. For catalogs this size, pre-generate the standard renditions (thumb, preview, web) with libvips in a Container, store them in R2, and serve them from cache. Keep Images for ad-hoc sizes and crops.
- Images' `keep` metadata applies only to JPEG output. A DAM that needs IPTC/XMP/C2PA in delivered files must write metadata itself (exiftool) after rendering.
- For video: keep originals in R2/S3. Generate proxies and poster frames with ffmpeg in a Container (or MediaConvert/Lambda). Use Media Transformations on the proxy for quick clips and sprites. Use Stream only where adaptive-bitrate playback is needed.

### Gaps
- C2PA / Content Credentials preservation in Cloudflare Images was not found on the fetched pages. I couldn't confirm a "preserve Content Credentials" option.
- The GA status of Media Transformations and the Images binding wasn't stated on the fetched pages.

## AI: Workers AI vision and embedding models, AI Gateway, Bedrock, Rekognition

### Takeaway
Workers AI costs $0.011 per 1,000 neurons (10k free per day). It hosts several vision-capable LLMs, such as Llama 3.2 11B Vision at $0.049/$0.676 per M tokens and Llama 4 Scout at $0.27/$0.85. Its embedding models are text-only, with no hosted CLIP or image embedding. Image-to-vector search on Cloudflare therefore means caption-then-embed, AI Search's multimodal model, or a self-hosted CLIP in a Container. AI Gateway fronts Anthropic with caching (up to 1-month TTL), rate limiting, logging and fallback. Claude on Bedrock offers batch at 50% off.

### Cited Findings
- Workers AI: $0.011 per 1,000 neurons on Paid, with 10,000 neurons per day free. — [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- Vision-capable models, input/output price per M tokens:

  | Model | Input | Output |
  |---|---|---|
  | `@cf/meta/llama-3.2-11b-vision-instruct` | $0.049 | $0.676 |
  | `@cf/meta/llama-4-scout-17b-16e-instruct` | $0.27 | $0.85 |
  | `@cf/google/gemma-3-12b-it` | $0.345 | $0.556 |
  | `@cf/mistralai/mistral-small-3.1-24b-instruct` | $0.351 | $0.555 |
  | `@cf/moondream/moondream3.1-9B-A2B` | $0.30 | $1.00 |

  — [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- The model catalog also lists vision-input models `glm-5.3-flash`, `kimi-k2.6`, `qwen3.8-27b`, and `clef` / `clef-flash` / `clef-omni` (images and video; omni adds audio). `llava-1.5-7b-hf` is in beta. — [Workers AI models](https://developers.cloudflare.com/workers-ai/models/)
- Text embedding models, per M input tokens:

  | Model | Price |
  |---|---|
  | `@cf/baai/bge-small-en-v1.5` | $0.020 |
  | `@cf/baai/bge-base-en-v1.5` | $0.067 |
  | `@cf/baai/bge-large-en-v1.5` | $0.204 |
  | `@cf/baai/bge-m3` | $0.012 |
  | `@cf/pfnet/plamo-embedding-1b` | $0.019 |
  | `@cf/qwen/qwen3-embedding-0.6b` | $0.012 |

  `embeddinggemma-300m` is listed in beta. "No listed embedding model accepts images." `resnet-50` classification costs $2.51 per M images. — [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/); [Workers AI models](https://developers.cloudflare.com/workers-ai/models/)
- AI Gateway (page updated Apr 20, 2026): available on all plans. Supports Workers AI, Anthropic, Gemini, OpenAI, Replicate "and more", with analytics, logging, caching, rate limiting, and retry/fallback. — [AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- AI Gateway limits:
  - Gateways: 10 on Free, 20 on Paid.
  - Caching: 25 MB maximum cacheable request; cache TTL up to 1 month.
  - Unified Billing (Cloudflare-managed credentials): 200 requests per minute per gateway. This does not apply to BYOK.
  - Logs: gateways created on or after Sep 24, 2026 follow Workers Logs limits and pricing. Legacy gateways keep 10M logs per gateway (Paid) and 10 MB per log.
  - [AI Gateway limits](https://developers.cloudflare.com/ai-gateway/reference/limits/)
- Bedrock: Claude Sonnet 5 standard rate is $3/$15 per M tokens. A $2/$10 promotion ran through Aug 31, 2026 and has now ended. Batch inference is priced "50% lower" than on-demand for select models. Claude Sonnet 5.5 cache-read pricing drops 50% from Oct 7, 2026. — [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)
- Rekognition Image: Group 1 (IndexFaces, SearchFaces, CompareFaces) and Group 2 (DetectLabels, DetectText, DetectFaces, DetectModerationLabels, RecognizeCelebrities) cost $0.001 per image for the first 1M per month, sliding to $0.0004 (Group 1) or $0.00025 (Group 2) at volume.
  - Face vectors stored: about $0.00001 per month each.
  - Custom Labels: $1/h training, $4/h inference.
  - Video: label detection $0.10/min; content moderation $0.10/min.
  - Free tier: 1,000 images per month per group for 12 months.
  - These figures come from the worked examples, because the rate tables didn't render.
  - [Rekognition pricing](https://aws.amazon.com/rekognition/pricing/)

### Inferences
- Illustrative cost to AI-describe 100k assets per year, assuming about 1,500–1,900 input tokens per image (prompt plus image) and 200–300 output tokens:
  - Workers AI Llama 3.2 11B Vision: about $20/year.
  - Llama 4 Scout: about $55–60/year.
  - Claude Sonnet via Bedrock at $3/$15: about $1,000/year on-demand, about $500 with batch.
  - Rekognition DetectLabels: about $100/year for labels only.
  - Token counts per image vary by model and resolution, so treat these as order-of-magnitude estimates.
- Recommended search pipeline: vision LLM caption plus keywords → text embedding (bge-m3 or qwen3-embedding, $0.012/M tokens) → Vectorize, with FTS5 on captions and IPTC in D1 for hybrid search. For true image-to-image similarity, run an open CLIP/SigLIP model in a Container, or use AI Search's multimodal model.
- Put Claude (direct Anthropic API or Bedrock) behind AI Gateway for caching repeat prompts, per-tenant rate limits, logging and fallback to Workers AI. Use Bedrock or Anthropic batch for backfills.
- Face recognition (Rekognition face collections) raises biometric-privacy compliance issues (e.g. BIPA, GDPR) and should be opt-in per library.

### Gaps
- Per-token prices for glm-5.3-flash, kimi-k2.6, qwen3.8-27b and the clef models were not captured.
- No Cloudflare-hosted batch inference option was confirmed in the fetched pages.
- Exact Bedrock prices for current Claude models (Sonnet 5.5, Opus, Haiku), and whether Bedrock lists Claude cross-region inference, were not readable from the pricing page fetch.
- AI Gateway BYOK / stored-keys pricing and whether Bedrock is a supported provider were not stated on the fetched pages.

## Auth/security

### Takeaway
Of the security services asked about, I sourced only these: Secrets Store is still in open beta (Workers and AI Gateway only), and WAF HMAC token validation for signed delivery on custom domains needs Pro or higher. I did not verify Access/Zero Trust, Turnstile, WAF rate-limiting pricing or limits in this pass.

### Cited Findings
- Secrets Store is "Available in open beta" (page updated Aug 14, 2026). It integrates with Workers and AI Gateway, and is not available in the China Network. No pricing or limits are listed. — [Secrets Store](https://developers.cloudflare.com/secrets-store/)
- R2 presigned URLs don't work on custom domains. For custom-domain auth, Cloudflare points to WAF HMAC validation (Pro plan or higher). — [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- 401 (unauthorized) R2 requests are not billed, which limits cost from abusive unsigned hits. — [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

### Inferences
- Suggested layering:
  - Cloudflare Access in front of `/admin` and the desktop-agent enrollment endpoints.
  - Turnstile on public client-proofing, login and download forms.
  - Short-lived HMAC-signed URLs, issued by the Worker and checked in the Worker, for private delivery from custom domains.
  - Presigned S3-domain URLs only for direct uploads.
  - Worker-level secrets (or Secrets Store, once GA) for S3 keys used by aws4fetch.

### Gaps
- Cloudflare Access free-seat count and pricing, Turnstile limits, WAF rate-limiting rule allowances per plan, and Secrets Store GA date or pricing were not fetched.

## Ingest from Mac/NAS: direct-to-R2 multipart, resumability, Tunnel, Worker body limits

### Takeaway
Uploads proxied through a Worker or Tunnel are capped by the zone's request-body limit (100 MB on Free/Pro, 200 MB on Business). Large RAW and video files should go from a desktop or NAS agent straight to R2's S3 endpoint as multipart uploads: up to 5 GiB per single PUT, 10,000 parts, about 5 TiB per object. The Worker issues presigned URLs (up to 7 days) and records parts or sessions in D1 or a Durable Object for resumability.

### Cited Findings
- Request body limits: 100 MB on Free and Pro, 200 MB on Business. Enterprise is up to 5 GB self-serve per the Workers limits page, but "500+ MB" per the 413 support page (conflict). — [Workers limits](https://developers.cloudflare.com/workers/platform/limits/); [Error 413](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413)
- The body limit applies to proxied (orange-cloud) traffic. Secondhand sources say it also applies to Cloudflare Tunnel hostnames; I found no Tunnel-specific official statement. — [Cloudflare community](https://community.cloudflare.com/t/when-we-import-a-file-we-get-timeout-error/763524/2); [localtonet blog](https://localtonet.com/blog/cloudflare-tunnel-alternative)
- R2: 5 GiB maximum single-part upload, 10,000 parts, about 5 TiB maximum object. Same-key writes limited to 1/s. — [R2 limits](https://developers.cloudflare.com/r2/platform/limits/)
- Presigned PUT URLs last up to 7 days and work only on the S3 API domain; POST form uploads are not supported. — [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- Incomplete multipart uploads are aborted after 7 days by default (configurable with lifecycle rules). AbortMultipartUpload is free. — [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/); [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- A `CompleteMultipartUpload` fires an `object-create` event to a Queue, which can trigger ingest processing without the agent calling back. — [R2 event notifications](https://developers.cloudflare.com/r2/buckets/event-notifications/)

### Inferences
- Recommended agent flow:
  1. Authenticate the agent (Access service token or device token).
  2. The Worker creates the multipart upload and returns batches of presigned UploadPart URLs (UploadPart is an S3 PUT with `partNumber`/`uploadId` query parameters).
  3. The agent uploads parts in parallel (e.g. 16–64 MiB parts) and saves its state locally.
  4. On restart, the agent calls ListParts via the Worker and resumes.
  5. The Worker completes the upload, and the event notification kicks off the ingest Workflow.
- This gives tus-like resumability without running a tus server. The 7-day default abort rule defines the resume window.
- A NAS can run the same agent; this is better than serving files to Cloudflare over Tunnel, which is subject to the body cap and to home-uplink pull patterns. Tunnel is still useful for exposing a NAS-side admin or "pull on demand" service to Workers, or for Sippy-like lazy pulls of small files.

### Gaps
- Presigned UploadPart support and R2 part-size rules are not explicitly documented on the fetched presigned-URL page; test them.
- I found no maintained tus server for Workers/R2 in this pass.
- I found no official Cloudflare Tunnel body-size documentation.

## AWS complements: Glacier Deep Archive, Lambda, MediaConvert, Rekognition, Bedrock

### Takeaway
AWS is strongest here as the cold-archive tier (Deep Archive about $0.00099/GB-month, 12–48 h restores) and as heavier serverless compute: Lambda offers 10 GB memory, 10 GB /tmp, 15 min runs and 10 GB container images, versus Containers' 12 GiB. AWS also brings managed vision (Rekognition) and video transcoding (MediaConvert Basic tier from about $0.0075 per normalized minute). The cost of moving data from AWS back to Cloudflare is egress at $0.09/GB.

### Cited Findings
- Lambda:
  - Memory 128–10,240 MB; 1,769 MB equals one vCPU.
  - Runtime 15 min (90 min for Managed Instances async invocations).
  - /tmp 512 MB–10 GB. Container images up to 10 GB.
  - Payloads: 6 MB sync request/response, 200 MB streamed responses, 1 MB async.
  - Default concurrency 1,000. Network 625 Mbps per environment by default.
  - Also available: Durable functions (30,000 operations and 100 MB state per execution) and Lambda MicroVMs (up to 8 h per run).
  - [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- MediaConvert:
  - The AWS M&E blog lists Basic tier at $0.0075 (Tier 1) and $0.0053 (Tier 2) per normalized minute, Professional at $0.012 and $0.0096. The post is undated.
  - HD AVC single-pass multipliers are 2x at 30 fps or below, 2.5x at 30–60 fps, and 3x at 60–120 fps.
  - [AWS M&E blog](https://aws.amazon.com/blogs/media/optimize-costs-with-tiered-pricing-in-aws-elemental-mediaconvert); [MediaConvert pricing (FR)](https://aws.amazon.com/fr/mediaconvert/pricing/)
- Glacier and S3 storage, retrieval and egress figures are in the Storage section above. — [AWS Price List, AmazonS3 us-east-1](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json); [S3 archive retrieval options](https://docs.aws.amazon.com/AmazonS3/latest/userguide/restoring-objects-retrieval-options.html)
- Rekognition and Bedrock pricing is in the AI section above. — [Rekognition pricing](https://aws.amazon.com/rekognition/pricing/); [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)

### Inferences
- Lambda is a credible alternative to Containers for RAW/ffmpeg jobs when the source is already in S3 (no transfer cost in-region), or when you need more than 12 GiB or more than 20 GB of scratch space. Lambda reading from R2 costs nothing on the R2 side, though AWS bills Lambda compute.
- Containers keep everything on one platform: one bill, Worker-native routing, no IAM. Containers egress over the included 1 TB costs $0.025/GB, so write results to R2 through the binding or API path rather than shipping them out.
- 1 vCPU HD 30 fps output on MediaConvert Basic is about $0.015 per output minute (calculated from the multiplier). That is cheap for proxies, but it adds an S3 round trip.

### Gaps
- The current MediaConvert rate table and Lambda GB-second prices were not fetched from official live pages.
- The Deep Archive storage-class line was absent from the price-list file, so I'm relying on the Intelligent-Tiering Deep Archive Access tier rate (see Storage).

## Cost model sketch: 20 TB / 1M assets with renditions, 100k AI-described assets per year

### Takeaway
Storage dominates. Roughly 22 TB (20 TB originals plus ~2 TB renditions) costs about $330/month on all-R2 Standard and about $230/month with originals in R2 IA. Adding a full Deep Archive copy costs about $20/month, and that's the cheapest real redundancy. All-S3 Standard would be about $506/month plus egress for delivery. AI enrichment of 100k assets per year costs about $20–60 on Workers AI, about $100 on Rekognition, or about $500–1,000 with Claude Sonnet. Index (D1, Vectorize) costs stay in single or low double digits per month.

### Cited Findings
- Unit prices used:
  - R2 Standard $0.015/GB-month; R2 IA $0.01/GB-month with $0.01/GB retrieval. — [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
  - S3 Standard $0.023; Standard-IA $0.0125; Glacier IR $0.004; Deep Archive tier $0.00099 per GB-month. Lifecycle into Deep Archive $0.05 per 1,000 objects. Deep Archive retrieval $0.02/GB (Standard) or $0.0025/GB (Bulk). Egress $0.09/GB for the first 10 TB, then $0.085/GB. — [AWS Price List, AmazonS3 us-east-1](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json); [AWS Price List, AWSDataTransfer us-east-1](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/us-east-1/index.json)
  - D1 storage $0.75/GB-month over 5 GB. — [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
  - Vectorize $0.05 per 100M stored dimensions and $0.01 per M queried dimensions. — [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)
  - Images $0.50 per 1,000 unique transformations per month. — [Images pricing](https://developers.cloudflare.com/images/pricing/)
  - Containers rates. — [Containers pricing](https://developers.cloudflare.com/containers/pricing/)
  - Workers AI and Rekognition rates as above. — [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/); [Rekognition pricing](https://aws.amazon.com/rekognition/pricing/)

### Inferences
All figures are my arithmetic, assuming 22,000 GB in total (20,000 GB originals plus 2,000 GB renditions), 1M assets, US pricing, and $5/month for the Workers Paid base.

- **A. All-Cloudflare, R2 Standard:** 22,000 × $0.015 = about $330/month storage, and $0 egress for delivery.
- **B. Cloudflare tiered:** originals in R2 IA (20,000 × $0.01 = $200) plus renditions in R2 Standard (2,000 × $0.015 = $30), about $230/month. Lifecycle transition costs about 1M Class A at $4.50 per million, roughly $4.50 one-time. IA retrieval adds $0.01/GB when originals are downloaded (e.g. 1 TB/month ≈ $10).
- **C. B plus S3 Deep Archive cold copy:** +20,000 × $0.00099 ≈ $19.80/month, plus about $50 one-time for 1M lifecycle or PUT requests at $0.05 per 1,000. That's about $250/month for primary storage plus a geographically and provider-independent copy.
  - Full disaster restore of 20 TB from Deep Archive to R2: Bulk retrieval about $50, plus egress about 10,240 GB × $0.09 + 9,660 GB × $0.085 ≈ $1,743. Standard retrieval would be $400 instead of $50.
- **D. All-AWS, S3 Standard:** about $506/month storage. Delivering 5 TB/month to clients adds about $450 in egress, unless fronted by CloudFront at its own rates. S3 Standard-IA for originals (20,000 × $0.0125 = $250) plus Standard renditions ($46) comes to about $296/month before egress and retrieval.
- **Index:** D1 at about 3–5 GB for 1M assets falls mostly within the 5 GB included. Vectorize for 1M × 1024 dims with 100k queries/month is about $11/month.
- **Renditions:** pre-generating with Containers at about $0.000175 per RAW is about $175 for a 1M-asset backfill. On-demand Cloudflare Images could cost up to $1,500/month if 3M unique transformations happen each month, so pre-generation wins at this scale.
- **AI (100k assets/year):** Workers AI Llama 3.2 Vision about $20, Llama 4 Scout about $58, Rekognition labels about $100, Claude Sonnet ($3/$15) about $1,020 on-demand or about $510 batch. Text embeddings for captions cost a few cents at $0.012 per M tokens.
- **Rough monthly total, Cloudflare-centric (option C plus compute):** about $250 storage, about $5–30 Workers/D1/Queues/Workflows, about $11 Vectorize, low single-digit dollars per month of AI amortized, and Containers on demand. That's about $300–350/month at 20 TB / 1M assets, versus about $550–1,000+ for an S3-primary design once delivery egress is counted.

### Gaps
- The model assumes rendition sizes (~2 MB per asset) and token counts per image. Real values depend on rendition specs and vision-model image tokenization, and should be measured on sample libraries.
- Workers request and CPU charges, Workflows charges, and Queue operation pricing were not fetched, so they are lumped into an estimated range.
- AWS request costs for Glacier restores (per 1,000 RestoreObject requests for Deep Archive) were not isolated in the price-list extraction.

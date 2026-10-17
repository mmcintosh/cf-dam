# Data Movement from a NAS for an Open-Source Photo DAM (tools, protocols, destinations, safety)

Research date: 2026-10-16. Prices were read from vendor pages on that date unless noted. Some figures come from third-party 2026 guides, and those are flagged.

## Q1. Transfer engines a DAM could embed or drive (rclone, restic/Kopia/Borg, rsync/openrsync, Syncthing, Duplicacy)

### Takeaway
rclone is the strongest candidate to embed or drive. It has a full HTTP remote-control API with async jobs, stats, live bandwidth control and a Prometheus endpoint. It can also be built as a library (librclone, marked experimental) with C, Go, Python, Rust, PHP and Android bindings. It talks to S3, B2, Google Drive, Dropbox, OneDrive, SMB, SFTP, WebDAV and local disks, and each backend exposes its hash type and metadata capabilities. Dedupe backup tools (restic, Kopia, Borg) suit "backup" jobs but store data in opaque repositories, not as browsable files. rsync on macOS is no longer GNU rsync 3.x, so a DAM must not depend on the system rsync on Macs.

### Cited Findings
**rclone: remote control (rc) API**
- Running with `--rc` (or the standalone `rclone rcd`) starts an HTTP server on `localhost:5572` by default. It can be called with `rclone rc ...` or over plain HTTP with JSON. — [rclone rc docs](https://rclone.org/rc/)
- Security: the docs say access to the rc API "is equivalent to shell access as the user running rclone." There are no per-endpoint permissions. Recommended practice is a loopback bind, `--rc-user/--rc-pass` or htpasswd, and TLS via `--rc-cert/--rc-key`. `--rc-no-auth` should never be used on a non-loopback bind. — [rclone rc docs](https://rclone.org/rc/)
- Async jobs: `_async: true` (or the `Prefer: respond-async` header) returns a `jobid` immediately. `job/status` reports finished, success, error and output. `job/list`, `job/stop`, `job/stopgroup` and `job/batch` are also available. Finished jobs expire after `--rc-job-expire-duration`, 60s by default. — [rclone rc docs](https://rclone.org/rc/)
- Per-call options: `_config` and `_filter` set flags such as `checksum=true` for a single call, and `_group` sets the stats group. — [rclone rc docs](https://rclone.org/rc/)
- Monitoring and control: `core/stats` gives transfer stats per group. `core/bwlimit` sets or queries the bandwidth limit at runtime. `--rc-enable-metrics` exposes Prometheus `/metrics`. — [rclone rc docs](https://rclone.org/rc/)
- Operations: `operations/copyfile` (srcFs, srcRemote, dstFs, dstRemote), `sync/copy`, `sync/sync`, `sync/move` (deleteEmptySrcDirs) and `sync/bisync`, which takes dryRun, resync, conflictResolve and checkAccess. — [rclone rc docs](https://rclone.org/rc/)

**rclone: librclone**
- librclone is "a thin wrapper over the rclone RPC." It is built with cgo as a c-shared or c-archive library and exposes `RcloneInitialize`, `RcloneRPC(method, jsonInput)` (returns Output and Status), `RcloneFinalize` and `RcloneFreeString`. The interfaces are marked **experimental**. — [librclone README](https://github.com/rclone/rclone/tree/master/librclone)
- Bindings: Go directly; Android via gomobile (iOS untested); Python via ctypes (not on PyPI); Rust crate `librclone`; PHP via FFI. — [librclone README](https://github.com/rclone/rclone/tree/master/librclone)
- Caveats: `RcloneFinalize` does not cancel async jobs, so they must be cancelled manually. The library "does not yet use rclone's config and logging systems." Mount needs the `cmount` tag and WinFsp on Windows. — [librclone README](https://github.com/rclone/rclone/tree/master/librclone)

**rclone: backend capabilities (hash, modtime, case, metadata)**
| Backend | Hash | ModTime | Case-insensitive | Metadata |
|---|---|---|---|---|
| S3 (covers S3-compatible providers such as Wasabi, R2, iDrive e2) | md5 | R/W | No | RWU |
| B2 | sha1 | R/W | No | – |
| Google Drive | md5, sha1, sha256 | DR/W | No (duplicates allowed) | DRWU |
| Dropbox | dropbox (proprietary hash) | R/W | Yes | – |
| OneDrive | quickxor | DR/W | Yes | DRW |
| SMB | **none** | R/W | Yes | – |
| SFTP | md5, sha1 | DR/W | No | – |
| WebDAV | sha1 | R/W | No | – |
| Local | all hashes | DR/W | depends on OS | DRWU |
Source: [rclone overview](https://rclone.org/overview/)
- Key implication from the table: the **SMB backend has no hash support** and is case-insensitive, and Dropbox and OneDrive use their own hash types. There is no single end-to-end hash that works on every backend. — [rclone overview](https://rclone.org/overview/)
- Restricted characters: rclone swaps characters a backend doesn't allow for look-alike Unicode characters and reverses the swap on download. The behaviour is configurable per backend through an `encoding` option, and `Raw` disables it. On Windows, two different names can collapse to the same name. — [rclone overview](https://rclone.org/overview/)

**rclone: safety-relevant flags**
- By default, rclone compares size and modtime. `--checksum/-c` compares hash and size instead. — [rclone global flags](https://rclone.org/docs/)
- `--metadata/-M` copies metadata. On local backends that means "ownership, permissions, xattr etc." Without the flag, rclone preserves only modtime and MIME type where possible. Metadata is copied once and is not re-synced on an unchanged object. — [rclone global flags](https://rclone.org/docs/)
- `--immutable` never updates existing files and errors on a mismatch. `copy --immutable` also prevents deletion. — [rclone global flags](https://rclone.org/docs/)
- `--backup-dir` moves files that would be overwritten or deleted into a backup hierarchy on the same remote. — [rclone global flags](https://rclone.org/docs/)
- `--max-delete N` aborts the run when more than N deletes would happen. — [rclone global flags](https://rclone.org/docs/)
- `--bwlimit` accepts a timetable, for example `"08:00,512k;12:00,10M;...;23:00,off"`, with optional weekdays. Units are bytes/s, and separate UP:DOWN limits are supported. — [rclone global flags](https://rclone.org/docs/)
- `--check-first` runs all checks before any transfer, at the cost of more memory. — [rclone global flags](https://rclone.org/docs/)
- By default, rclone normalizes Unicode during sync, so the NFC and NFD forms of "é" compare equal. `--no-unicode-normalization` turns this off. The docs note that macOS in particular stores decomposed names. — [rclone global flags](https://rclone.org/docs/)
- `--track-renames` needs server-side copy or move on the destination, which avoids re-uploading files that were renamed or moved. — [rclone global flags](https://rclone.org/docs/)
- `--retries` (default 3) retries the whole sync. The docs say "`--retries 1` is recommended otherwise you'll transfer everything again on a retry" in some contexts. I found no general resume of a partially uploaded single file documented on this page. — [rclone global flags](https://rclone.org/docs/)

**rclone bisync**
- Introduced in v1.58. The docs call it "an advanced command, so use with care" and say to read the Limitations section first. The page I read does not call it either "stable" or "beta". — [rclone bisync](https://rclone.org/bisync/)
- Safety features: `--max-delete` aborts if more than 50% of files would be deleted (default). `--check-access` requires `RCLONE_TEST` sentinel files on both sides. `--resync` sets the baseline and never deletes. `--conflict-resolve` defaults to `none` (both versions kept and renamed). Lock files prevent overlapping runs. `--resilient`/`--recover` handle interruptions, and `--dry-run` is available. — [rclone bisync](https://rclone.org/bisync/)
- Limitations: without `--track-renames`, a renamed directory is treated as delete plus re-copy. Files that change mid-run can cause problems. Changing filters or `--compare` requires `--resync`. — [rclone bisync](https://rclone.org/bisync/)

**restic / Kopia / Borg / Duplicacy**
- Licenses: restic is BSD-2-Clause, Kopia is Apache-2.0, Borg is BSD (sources say BSD-3-Clause). — [StackHarbor comparison](https://stackharbor.com/en/knowledge-base/restic-borg-kopia-duplicacy-comparison/); [WZ-IT comparison](https://wz-it.com/en/blog/restic-borg-kopia-backup-comparison/)
- Duplicacy uses a non-OSI custom license. Forum reports say the CLI is free for personal use and commercial use needs a license. **This is unverified against Duplicacy's own license text.** — [StackHarbor comparison](https://stackharbor.com/en/knowledge-base/restic-borg-kopia-duplicacy-comparison/); [alternativeto (restic)](https://www.alternativeto.net/software/restic/)
- Backends: restic natively supports S3, B2, Azure, GCS and SFTP, and reaches other targets through rclone. Kopia and Duplicacy speak S3 natively. Borg needs SSH to a Borg server or a local repo, which makes it the weakest fit for object storage. — [StackHarbor comparison](https://stackharbor.com/en/knowledge-base/restic-borg-kopia-duplicacy-comparison/)
- Maturity (per a 2026 article): restic v0.19.1 and Kopia v0.23.1 are pre-1.0, and Borg is at 1.4.5. Pre-1.0 tools may change formats. — [WZ-IT comparison](https://wz-it.com/en/blog/restic-borg-kopia-backup-comparison/)
- Concurrency (one author's opinion): Duplicacy is lock-free, restic and Kopia have lock contention at scale, and Borg prohibits concurrent writers per repo. — [StackHarbor comparison](https://stackharbor.com/en/knowledge-base/restic-borg-kopia-duplicacy-comparison/)

**rsync / macOS openrsync**
- Apple replaced the old rsync 2.6.9 with **openrsync** (ISC license, from OpenBSD) because it could not comply with GPLv3 for rsync 3.x. On macOS 15.4, `/usr/bin/rsync` reports openrsync with protocol 29, "compatible with rsync 2.6.9". A wrapper dispatches to `rsync.samba` or `rsync.openrsync`, and reports say `rsync.samba` was removed in 15.4. — [mjtsai.com roundup (June 2025)](https://mjtsai.com/blog/?p=47989); [heise](https://heise.de/-10350663)
- openrsync accepts only a subset of rsync's options. Users reported broken scripts and lost advanced features. The usual advice is to install rsync 3.x from Homebrew or MacPorts. — [heise](https://heise.de/-10350663); [mjtsai.com](https://mjtsai.com/blog/?p=47989)

### Inferences
- **Embed vs build:** building a multi-cloud transfer engine with per-backend hashing, retries, multipart, OAuth for Drive, Dropbox and OneDrive, and character encoding would duplicate years of rclone work. The practical design is to ship or bundle an rclone binary run as `rcd` on loopback with auth, or in a sidecar container on the NAS, and drive it over the rc HTTP API. librclone is an option for in-process use, but its "experimental" label and the fact that it doesn't use rclone's config and logging systems argue for the rc daemon approach. rclone's MIT license (not re-verified in this session; widely known) fits that approach.
- Treat rclone as the "mirror/copy as browsable files" engine, which suits delivery, cloud drives and second NAS units. Treat restic or Kopia as optional "versioned, deduplicated, encrypted backup" engines. Their repositories aren't browsable by other photo tools, so they are better as a background safety net than as "where the asset lives."
- Because the SMB backend has no hashes, any verification over SMB needs a download-and-hash pass (`rclone check --download`, or a DAM-computed hash), or else the transfer engine should run on the NAS against the local filesystem.
- Never rely on `/usr/bin/rsync` on macOS 15.4 and later. If rsync is used at all, use rsync 3.x on the NAS side over SSH.

### Gaps
- I did not verify whether bisync has officially left beta as of v1.7x/2026. The docs only say "advanced command".
- I did not verify rclone's license text (MIT is commonly cited), Syncthing's license (commonly MPL-2.0) or rsync's license (GPLv3) from primary sources in this session.
- I did not research Syncthing's suitability in depth. It is continuous peer-to-peer sync, which is a poor fit for archival "copy then verify" semantics, but this is an inference only.
- Duplicacy's official license terms were not fetched.

## Q2. Native NAS tools to coexist with or trigger (Synology, QNAP, TrueNAS, Unraid)

### Takeaway
TrueNAS is the most automatable platform. Its Cloud Sync tasks are rclone-based and fully exposed through a versioned API (for example `cloudsync.sync_onetime` in v24.10 to v26.0). Synology's Hyper Backup can be triggered through the DSM Web API, but I found no official public documentation for the backup task API, only community wrappers. QNAP HBS3 has no public API that I could find. A DAM should read status from and trigger these native tools where it can, rather than replace them, and should limit itself to file-level, asset-aware copies.

### Cited Findings
- **TrueNAS**: the API exposes `cloudsync.sync_onetime`, a job that runs a cloud sync without creating a task. The local path must begin with `/mnt` or `/dev/zvol`, and it takes a credential ID plus provider attributes. Reference pages exist for v24.10, v25.10 and v26.0. — [TrueNAS API v26.0](https://api.truenas.com/v26.0/api_methods_cloudsync.sync_onetime.html)
- TrueNAS Cloud Sync modes: SYNC makes the destination match the source and deletes extra files. COPY copies and overwrites same-named files. — [TrueNAS CORE docs](https://www.truenas.com/docs/core/uireference/tasks/cloudsynctasks/)
- A community workaround passes extra rclone flags by PUTting an `args` field to `/api/v2.0/cloudsync/id/<ID>`. This was in 2023, the value doesn't show in the GUI, and it isn't official. — [TrueNAS forum](https://cdn.truenas.com/community/threads/cloud-sync-task-add-more-rclone-flags-or-manual-input-box-to-gui.114349/)
- **Synology Hyper Backup**: each task has "Back up now". A backup client runs only one task at a time, and tasks scheduled together run in sequence. — [Synology KB (Hyper Backup create task)](https://kb.synology.com/en-my/DSM/help/HyperBackup/data_backup_create?version=6)
- A community MCP server exposes "run_backup_task" (start a Hyper Backup task by numeric ID from a list call). That implies a DSM Web API exists for this (commonly called SYNO.Backup.Task), but **I found no official Synology documentation** for it. — [glama.ai synology-mcp](https://glama.ai/mcp/servers/rafalr100/synology-mcp/tools/run_backup_task)
- **Synology C2**: the older C2 Storage and C2 Object Storage products are being merged into **C2 OneStorage** from 2026-06-22. Legacy plans can be renewed until 2026-12-22. — [NASCompares (May 2026)](https://nascompares.com/2026/05/25/synologys-c2-and-license-changes-explained/); [Blackvoid](https://www.blackvoid.club/synology-c2-cloud-service-changes-for-2026/)
- **QNAP HBS3** combines backup, restore and sync in one app and supports 30+ cloud services and object storage. QuDedup does source-side dedup into `.qdff` files, which need the QuDedup Extract Tool (Windows, Ubuntu, macOS) to restore, and only works on x86 models. It keeps multiple versions and supports cross-NAS backup. — [QNAP HBS3](https://www.qnap.com/solution/hbs3); [Catalyst Cloud](https://catalystcloud.nz/solutions/hybrid-backup-sync-3/)
- I found no public QuDedup or HBS3 API. — (search of QNAP sources; see [QNAP HBS3](https://www.qnap.com/solution/hbs3))

### Inferences
- A good pattern is **"orchestrate, don't duplicate"**. On TrueNAS, the DAM can call `cloudsync.sync_onetime` or existing tasks and read job status. On Synology, it can read Hyper Backup status and trigger it through the (undocumented) DSM API, or tell the user to schedule it. On QNAP, it can only report what the user configured. The DAM then records that the folder is covered by a NAS-native backup as one "copy" in its 3-2-1 accounting, without claiming file-level verification it didn't do.
- Proprietary backup formats such as Hyper Backup `.hbk` and QNAP `.qdff` are not readable as plain files. The DAM should count them as backups but not as "browsable locations" of an asset.

### Gaps
- Synology Snapshot Replication, Synology Cloud Sync API, TrueNAS ZFS replication API and Unraid options (for example the community rclone plugin or Docker) were **not researched** within the tool-call budget.
- I did not obtain an official, documented API for Synology Hyper Backup.

## Q3. Destinations and economics (as of Oct 2026)

### Takeaway
For a photographer's archive copy, Backblaze B2 ($6.95/TB/mo, no minimum duration, free egress up to 3x storage, Object Lock at no extra cost) and iDrive e2 (~$4/TB/mo) are the cheapest hot S3-compatible options. Wasabi costs $7.99/TB/mo with a 90-day minimum and a 1 TB minimum. R2 costs more to store ($15/TB/mo) but has zero egress, which makes it better for delivery than for archive. AWS Glacier Deep Archive (~$1/TB/mo) is the cheapest "last-resort" copy but has 12 to 48 hour restores, retrieval fees and a 180-day minimum.

### Cited Findings
| Provider | Storage price | Min duration / min charge | Egress | Immutability |
|---|---|---|---|---|
| Backblaze B2 | from **$6.95/TB/mo** (pay-as-you-go or 1–5 yr commit) | **no minimum duration, no minimum file size** | free up to **3x average monthly storage**, then $0.01/GB; free via CDN partners (Cloudflare, Fastly, bunny.net, etc.) | Object Lock (governance and compliance, legal hold), works through the S3 API, **no extra charge**, can be enabled on existing buckets, cannot be turned off |
| Wasabi (PAYG) | **$7.99/TB/mo** (NA/EMEA/APAC) | **90-day** minimum (Timed Deleted Storage charge); **1 TB minimum** monthly | free if monthly egress ≤ active storage; otherwise not a fit, and service can be limited | immutability supported; immutable data billed as active storage |
| Cloudflare R2 Standard | **$0.015/GB-mo** (~$15/TB) | none | **free** | Bucket locks (bucket-level rules by prefix: age, date or indefinite). The page doesn't mention the S3 Object Lock API |
| Cloudflare R2 Infrequent Access | $0.01/GB-mo | **30 days** | free, plus **$0.01/GB retrieval** | as above |
| AWS S3 Glacier Deep Archive | **$0.00099/GB-mo (~$1/TB)** | 180 days (third-party guides) | retrieval: bulk ~$0.0025/GB, standard ~$0.02/GB (third-party), plus egress | S3 Object Lock (standard AWS) |
| iDrive e2 | **$4/TB/mo** pay-as-you-go | 1 TB minimum charge | free up to 3x storage, then $0.01/GB | not verified |
| Synology C2 OneStorage | **$7.99/TB/mo** monthly or **$77.99/TB/yr** (~$6.50/mo), 1–200 TB; $29.99/yr for 300 GB | — | — | tied to Hyper Backup |

Sources: [Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing); [Backblaze Object Lock docs](https://www.backblaze.com/docs/cloud-storage-object-lock); [Wasabi pricing FAQ](https://wasabi.com/pricing/faq); [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/); [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/); [AWS Glacier storage classes](https://aws.amazon.com/s3/storage-classes/glacier/); [Upstash S3 pricing 2026](https://upstash.com/blog/aws-s3-pricing-explained-2026); [Nubbo S3 pricing 2026](https://nubbo.app/blog/aws-s3-pricing-2026); [iDrive e2 pricing](https://www.idrive.com/e2/pricing); [NASCompares C2](https://nascompares.com/2026/05/25/synologys-c2-and-license-changes-explained/)

- B2 transactions: Class A, B and C are free for pay-as-you-go. Class D costs $0.004 per 10k, with 2,500/day free. — [Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing)
- R2 operations: Standard Class A $4.50/M and Class B $0.36/M. IA Class A $9.00/M and Class B $0.90/M. Free tier (Standard only) is 10 GB-mo, 1M Class A and 10M Class B. — [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- Glacier Deep Archive: AWS states "two retrieval options ranging from 12-48 hours" and 11 nines durability. Glacier Flexible Retrieval offers expedited (1–5 min), standard (3–5 h) and free bulk (5–12 h). — [AWS Glacier storage classes](https://aws.amazon.com/s3/storage-classes/glacier/)
- Third-party claims: Deep Archive charges "10x more for PUTs", and fees plus minimums "routinely add 30–70%" to a theoretical bill. **These are third-party claims and were not verified on AWS's pricing page.** — [Upstash](https://upstash.com/blog/aws-s3-pricing-explained-2026); [CloudForecast](https://www.cloudforecast.io/blog/amazon-s3-pricing-and-optimization-guide/)
- B2 keeps all versions by default (a delete only hides the file), and versioning cannot be disabled. The closest option is a lifecycle rule `daysFromHidingToDeleting=1`. — [rclone B2 docs](https://rclone.org/b2/)
- Secondary sources conflict on R2's Object Lock: one says "limited Object Lock support... as of mid-2026", another lists R2 as supporting it. Cloudflare's own docs describe **bucket-level lock rules** rather than per-object S3 Object Lock. — [needtoknowit.com.au](https://needtoknowit.com.au/blog/immutable-backups-nas-australia/); [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
- A Veeam user reported that Wasabi objects could still be deleted from the web console unless compliance mode was set. — [Veeam forums](https://forums.veeam.com/object-storage-as-backup-target-f52/wasabi-vs-backblaze-b2-vs-idrive-e2-t81522.html)

### Inferences
- **Archive copy for a typical 5–50 TB photographer:** B2 or iDrive e2 with Object Lock (compliance mode, 30–90 day rolling retention) is the cost-effective, ransomware-resistant cloud copy, and its egress allowance makes restore drills affordable. Wasabi's 90-day minimum penalises churn, though photo archives are mostly append-only, so the penalty is small.
- **Deep Archive** makes sense as a "copy 3" for finished shoots that will never change: about $1/TB/mo, but plan for slow, fee-bearing restores. Because of the per-object overhead and PUT costs, bundle small sidecars (XMP) or deliver them separately. The commonly cited 40 KB per-object metadata overhead was not verified here.
- **R2** fits client delivery or proofing, where egress dominates, better than it fits archive.
- The DAM should model each destination's "minimum duration", "egress allowance" and "lock" properties so it can warn before deletes or moves that would trigger early-deletion fees or be blocked by locks.

### Gaps
- AWS egress per GB and the exact Deep Archive retrieval and request prices were not taken from AWS's official pricing page. The third-party 2026 figures are flagged above.
- iDrive e2 Object Lock and the annual price conflict (promo vs list) were not resolved.
- Google Drive, Dropbox and OneDrive consumer plan pricing and API rate limits were not researched.

## Q4. Data integrity: checksums, manifests, metadata and filename pitfalls

### Takeaway
There is no universal hash across backends: S3 uses MD5 or ETag, B2 uses SHA-1, Dropbox and OneDrive use proprietary hashes, and SMB has none. So the DAM should compute its own canonical content hash (xxHash64/XXH3 for speed, plus optionally SHA-256 for fixity) at ingest and store it. It should then verify each copy with the best hash the destination offers, or by reading the data back. AWS S3 now supports xxHash and full-object checksums natively. ASC MHL (chain of custody, xxHash) and BagIt (RFC 8493, SHA-512/256) are the two interoperable manifest formats to emit. The biggest cross-platform hazard is macOS NFD vs NAS/Linux NFC filenames.

### Cited Findings
**Cloud checksums**
- S3 supports CRC64NVME (**now the default**), CRC32, CRC32C, SHA-1, SHA-256, MD5, **XXHash64, XXHash3, XXHash128**, and SHA-512. AWS SDKs compute a checksum on upload, and S3 validates it server-side before storing. Precalculated values can be supplied for single-part uploads, and for multipart uploads using the "full object" checksum type. AWS SDKs do not compute MD5 automatically. S3 Batch Operations "Compute checksum" can verify objects at rest without downloading and produces a completion report. — [AWS S3 checking object integrity](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html)
- B2: SHA-1 is checked on upload and download. Large chunked files store their SHA-1 in `X-Bz-Info-large_file_sha1`, which needs a SHA-1-capable source; **rclone crypt uploads large files without SHA-1**. Modtime is stored as `X-Bz-Info-src_last_modified_millis`, and changing it creates a new version. — [rclone B2 docs](https://rclone.org/b2/)
- The rclone backend table shows S3 md5, B2 sha1, Drive md5/sha1/sha256, Dropbox's own hash, OneDrive quickxor, and **SMB with no hash**. — [rclone overview](https://rclone.org/overview/)

**Media-industry manifests**
- ASC MHL v1.0 (March 2022) defines the `ascmhl` folder naming, an XML schema for hash lists, and a **chain file** that records each copy generation for chain of custody. The reference implementation (`ascmhl` on PyPI) supports xxHash64, XXH3-64/128, MD5, SHA1, SHA256 and C4. — [ASC MHL spec PDF](https://cms-assets.theasc.com/ASCMHL_Specification_v1.0.pdf); [ascmhl docs](https://ascmhl.readthedocs.io/en/latest/README.html); [GitHub ascmitc/mhl](https://www.github.com/ascmitc/mhl)
- xxHash variant and endianness differ between tools: XXH64 big-endian vs little-endian produce different strings. Confirm the variant when comparing hashes across apps. — [Pomfort KB](https://kb.pomfort.com/?p=4678); [Hedge docs](https://docs.hedge.video/offshoot/features/verification)
- BagIt (RFC 8493, Oct 2018, Informational): a `bagit.txt`, a `data/` payload, one or more `manifest-<alg>.txt` covering every payload file, and optional `tagmanifest`, `bag-info.txt` (with Payload-Oxum for quick completeness checks) and `fetch.txt`. **SHA-512 recommended** as the default, SHA-256 must be supported, and MD5 and SHA-1 are allowed for compatibility. A "complete" bag has all files present. A "valid" bag is complete and every checksum matches. — [RFC 8493](https://www.rfc-editor.org/rfc/rfc8493.html)
- RFC 8493 explicitly warns about **case-only name collisions** on FAT/exFAT, **Unicode normalization** (HFS+ stores decomposed forms), Windows path-length limits and reserved names, and path traversal (`..`, leading `/`). Manifests protect against corruption, not tampering, so it recommends signatures. — [RFC 8493](https://www.rfc-editor.org/rfc/rfc8493.html)

**Filename and metadata pitfalls**
- macOS stores names in NFD, while Linux/NAS and Windows typically use NFC. This produces duplicate or invisible files and "error -43" in Finder over SMB. QNAP documents that the server can't find files when the client requests a different normalization form. — [QNAP FAQ](https://www.qnap.com/en/how-to/faq/article/sometimes-i-get-an-error-code-43-when-attempting-to-access-files-in-a-shared-folder-while-using-finder-in-macos-via-smb-what-causes-this); [ZimaSpace](https://shop.zimaspace.com/blogs/support-tips/filenames-change-between-macos-linux); [Insync forum](https://forums.insynchq.com/t/unicode-normalization-nfc-nfd/19457)
- rsync fix: `--iconv=utf-8-mac,utf-8` works over SSH or a daemon, **not** against a mounted SMB share, where rsync treats the share as local and reports "file has vanished". convmv `--nfc` can repair existing names. — [ServerFault mirror](https://kiwix.lema.org/serverfault.com_en_all_2023-11/a/427200); [Roon community](https://community.roonlabs.com/t/again-sync-problems-from-macos-to-rock/316663)
- rclone normalizes by default when comparing, but if both NFC and NFD variants of a name exist it may skip one and mark it duplicate (reported with Korean names). — [rclone forum](https://forum.rclone.org/t/support-for-korean-jaso-conversion/19435); [rclone docs](https://rclone.org/docs/)
- Case-insensitive backends (Dropbox, OneDrive, SMB) vs case-sensitive ones (S3, B2, local Linux) can cause collisions. — [rclone overview](https://rclone.org/overview/)
- rclone `--metadata` preserves xattrs, mode and owner on local backends, but metadata is not re-synced on unchanged files. Without `-M`, only mtime and MIME type are preserved. — [rclone global flags](https://rclone.org/docs/)

### Inferences
- **DAM integrity design:**
  1. At ingest, compute XXH3-128 or XXH64 (fast) and optionally SHA-256 (fixity, BagIt-compatible) per file, and store both in the DAM DB.
  2. On each copy, prefer destination-native checksums where they can be matched: S3 full-object SHA-256 or XXHash, B2 SHA-1 (the DAM must also compute SHA-1 if it wants to match), Drive SHA-256. Otherwise fall back to a read-back hash (`rclone check --download`).
  3. Emit an ASC MHL generation per copy for media-industry interoperability, and/or a BagIt bag for long-term archive and LTO.
  4. Schedule periodic fixity audits: S3 Batch "Compute checksum", or sampled read-back on B2 within the free-egress allowance.
- **Avoid S3 ETag as an MD5.** For multipart uploads the ETag is not the object's MD5. This is widely known, and AWS's page implies it by offering full-object checksums for multipart, but I did not fetch a page stating it verbatim. Store explicit checksums in object metadata or use S3's checksum headers.
- **Normalize identity, not filenames:** key assets by content hash and store the original byte-exact filename. Detect NFC/NFD and case collisions before copying to case-insensitive or differently normalized targets. Never silently rename; flag instead.
- When files are copied from the Mac side over SMB, extended attributes such as Finder tags and resource forks end up as `._` AppleDouble files or SMB streams depending on NAS config. This is not verified here. The DAM should treat XMP sidecars, not xattrs, as the canonical metadata carrier.

### Gaps
- I did not verify an authoritative statement on S3 multipart ETag format, or Samba `vfs_fruit` handling of resource forks and xattrs.
- I did not research path-length limits per cloud service (for example OneDrive's 400-char limit or S3's 1024-byte key limit).

## Q5. Removable/offline media: external drives, LTO/LTFS, offload-verification practice

### Takeaway
Hedge OffShoot's modes give a DAM a ready model for "safe copy" tiers. The fastest checks only file size. "Source" verification hashes the source independently. "Source & Destination" reads back every copy and is needed for ASC MHL. LTO-9 with LTFS costs about $5.7–8.4k per drive (Thunderbolt bundles) and roughly $5.5–12/TB in tape. That is viable for photographers with tens of TB, but the DAM would track tapes as offline volumes and emit MHL or BagIt manifests rather than drive the tape itself.

### Cited Findings
- **Hedge OffShoot verification modes:**
  - *Transfer* (default) compares file sizes only, and Hedge warns not to use it if sources will be erased.
  - *Source* pre-reads and hashes each source file, then reads it again to copy, which catches read errors. A source error stops the transfer.
  - *Source & Destination* reads back and compares all copies, takes about 2x the time, and is recommended for ASC MHL.
  — [Hedge docs: verification](https://docs.hedge.video/offshoot/features/verification)
- Hedge always computes **XXH64BE** from source reads and stores it in transfer logs and MHLs. MD5, SHA1 and C4 are optional and slower. — [Hedge docs](https://docs.hedge.video/offshoot/features/verification)
- Other Hedge safeguards: it reverifies new MHLs on idle destinations and recopies from the source or another destination on failure. It reuses checksums from existing source MHLs when size and mtime match. One-click MHL verification checks the entire chain (24.3+). It detects missing files after transfer and alerts on 0-byte source files (for example from improperly ejected exFAT cards). — [Hedge docs](https://docs.hedge.video/offshoot/features/verification); [Hedge blog 24.3](https://blog.hedge.co/offshoot-24-3)
- Hedge brought Checkpoint's source-read verification into OffShoot in 2018, arguing that hardware can misread without normal verification noticing. — [Hedge blog: Checkpoint](https://blog.hedge.co/checkpoint)
- **LTO-9 costs:** OWC Archive Pro (Thunderbolt, LTO-9, bundled Canister LTFS software described as a $399 value) is listed at $6,379.99 (one listing) to $8,379 (another). A MagStor desktop LTO-9 is listed at $5,699. — [OWC/macsales](https://eshop.macsales.com/item/OWC/TBLTMP90000H); [Adorama](https://www.adorama.com/owc-archive-pro-ethernet-thunderbolt-tape-storage-drive/p/owc10gltmp09); [Newegg](https://www.newegg.com/p/35Y-00JH-00012)
- Tape media: the sources conflict. Wolfcrow says ~$100 per 18 TB LTO-9 tape (~$5.5/TB) but its own table shows $10–15/TB. OWC's example uses $220 per tape (~$12/TB). Archiware's June 2025 update says LTO-9 is now the cheapest per TB. — [Wolfcrow](https://wolfcrow.com/what-is-lto-and-what-has-it-got-to-do-with-video/); [Archiware blog](https://blog.archiware.com/blog/?p=4894)
- Canister creates cross-platform LTFS archives on LTO-7, 8 and 9. — [OWC/macsales](https://eshop.macsales.com/item/OWC/TBLTMP90000H)

### Inferences
- **Lessons for a DAM:**
  1. Default to "source + destination" verification for any move that deletes the source, and never allow "delete source" after a size-only check.
  2. Hash the source at ingest, so later copies compare against a known-good value rather than re-reading a possibly degraded source.
  3. Write a manifest (ASC MHL or BagIt) onto each removable volume, so the drive or tape is self-describing and can be verified without the DAM.
  4. Track volumes (drive serial, label, LTFS volume ID) as offline locations, with a "last verified" date.
  5. Detect 0-byte or truncated files.
- Driving LTO directly from the DAM is a poor build target. It is better to export a BagIt or MHL set to a staging folder that Canister, YoYotta or Archiware P5 writes to tape, then ingest their catalog or manifest back.

### Gaps
- I found no data on YoYotta pricing or features, or on ShotPut Pro and Silverstack verification specifics.
- Current 2026 street prices for LTO-9 tape were not confirmed from a primary retailer.

## Q6. DAM-side design: location tracking, job queues, resumability, bandwidth, where to run the engine

### Takeaway
The DAM should model assets as content hashes with many "copies" (location, path, hash-verified-at, storage class, lock-until, online/offline). It should run the transfer engine (rclone rcd in a container) **on the NAS** to avoid the NAS → workstation → cloud double hop over SMB, which also has no hash support. And it should use rclone's async job API, stats groups and bwlimit timetable for its queue, progress and throttling.

### Cited Findings
- rclone's async jobs (`_async`, `job/status`, `job/stop`, `job/stopgroup`), per-job stats groups (`_group`, `core/stats`), runtime `core/bwlimit`, and Prometheus metrics make it suitable as the execution backend for a DAM job queue. — [rclone rc docs](https://rclone.org/rc/)
- Finished rc jobs expire after 60s by default (`--rc-job-expire-duration`), so the DAM must persist results itself. — [rclone rc docs](https://rclone.org/rc/)
- Scheduled bandwidth limits (`--bwlimit` timetable by weekday and time) are built in. — [rclone global flags](https://rclone.org/docs/)
- The SMB backend has no hash support and is case-insensitive, while local filesystem access supports all hashes and metadata. — [rclone overview](https://rclone.org/overview/)
- rsync to a **mounted** SMB share behaves as a local copy and breaks on NFD/NFC names. Over SSH or the rsync daemon it works with `--iconv`. — [ServerFault mirror](https://kiwix.lema.org/serverfault.com_en_all_2023-11/a/427200)
- `--track-renames` (server-side copy or move) avoids re-uploading when the DAM reorganizes folders. `--backup-dir` and `--max-delete` guard against destructive syncs. — [rclone global flags](https://rclone.org/docs/)
- Hyper Backup runs one task at a time and queues the others. — [Synology KB](https://kb.synology.com/en-my/DSM/help/HyperBackup/data_backup_create?version=6)

### Inferences
- **Run on the NAS:** with the engine running on a workstation, every byte crosses the LAN twice (NAS → workstation over SMB, then workstation → internet) and can only be verified by re-reading over SMB. A container on the NAS (Synology Container Manager, QNAP Container Station, TrueNAS apps, Unraid Docker) reads local disk, gets native hashes and metadata, and keeps running when the laptop sleeps. A workstation-side engine stays useful for offloads to local external drives and for Mac-only destinations.
- **Data model sketch:**
  - `asset (content_hash_xxh, sha256, size, original_name_bytes)`
  - `copy (asset, location_id, path, status{pending, copied, verified, stale, missing}, verified_at, verify_method{size, remote-hash, readback, mhl}, storage_class, lock_until, min_retention_until)`
  - `location (type{nas, cloud-s3, cloud-drive, external, lto, nas-native-backup}, online, last_seen, encoding/case/normalization props)`
  - The 3-2-1 status is computed from verified copies: at least 3 copies, at least 2 media types, at least 1 offsite, plus whether at least one copy is immutable.
- **Moves = copy + verify + then delete.** Always use copy followed by verify followed by delete, never `move` in one step, and use `--immutable`/`copy` semantics for archive targets. Respect `min_retention_until` (Wasabi 90d, Glacier DA 180d, R2 IA 30d) and `lock_until`.
- **Resumability:** checkpoint per file in the DAM DB, so a restarted job skips verified files. rclone's own skip-if-identical behaviour (size+mtime or `--checksum`) provides idempotency. Per-file partial resume was not confirmed in the docs.
- Lightroom catalog links break when files move; another researcher covers this. The DAM should record moves so it can emit a remap for Lightroom.

### Gaps
- I did not benchmark or find a quantitative source on SMB double-hop throughput cost.
- Whether rclone resumes partially uploaded multipart S3 objects after a crash was not confirmed.
- Container availability and limits per NAS OS (for example ARM Synology models) were not researched.

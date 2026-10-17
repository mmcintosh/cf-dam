# Vendor-neutral NAS connectivity for an open-source photo DAM: protocols, change detection, data safety, and architecture

Research date: 2026-10-16. Scope: DAM workloads with 100k–2M RAW files of 20–100 MB each, plus XMP sidecars. Claims are sourced inline. Items labelled "general knowledge, unverified" were not confirmed by a source in this session, and the report writer should treat them as such.

## Protocols: SMB2/3, NFS, WebDAV, AFP, S3-on-NAS, SFTP, rsync

### Takeaway
SMB3 (Samba on the NAS) is the only file protocol every NAS and every desktop OS supports. Getting usable macOS behavior depends on server-side Samba tuning (vfs_fruit, streams_xattr), and that tuning also changes file-ID semantics. S3 on the NAS is uneven across vendors: MinIO Community Edition is effectively dead as of February 2026, so a vendor-neutral DAM cannot assume an S3 endpoint exists.

### Cited Findings
**SMB / Samba**
- Samba 4.15 promoted SMB3 multichannel ("server multi channel support") from experimental to enabled by default, but only on Linux and FreeBSD, because it depends on kernel APIs found only there. — [Samba 4.15.0rc7 WHATSNEW](https://ftp.samba.org/pub/samba/rc/4.15.0rc/samba-4.15.0rc7.WHATSNEW.txt); [Samba 4.15.0rc1 announcement](https://lists.samba.org/archive/samba/2021-July/236695.html)
- Synology's SMB package 4.15.9 added SMB3 multichannel, reportedly on x86 models only. This is third-party reporting, not a Synology document. — [blackvoid.club](https://www.blackvoid.club/synology-smb-4-15-9-package-brings-smb-multichannel.md)
- TrueNAS community threads say the multichannel setting was present but disabled in some vendor configs, so NAS vendors can override Samba's default. — [TrueNAS forum](https://www.truenas.com/community/goto/post?id=767878)
- vfs_fruit is Samba's module for Apple SMB clients. It enables alternate data streams and handles the macOS `AFP_AfpInfo`/`AFP_Resource` streams. It "must be stacked with vfs_streams_xattr" (canonical stack: `catia fruit streams_xattr`). — [Samba vfs_fruit(8)](https://www.samba.org/samba/docs/current/man-html/vfs_fruit.8.html)
- `fruit:aapl` (default yes) enriches directory enumeration with Mac metadata, which greatly cuts per-file round trips. ADS support "avoids certain severe performance degradations caused by Samba's case sensitivity semantics." Mixing fruit and non-fruit shares can globally disable AAPL if the first tree connect is to a non-fruit share. — [Samba vfs_fruit(8)](https://www.samba.org/samba/docs/current/man-html/vfs_fruit.8.html)
- `fruit:time machine = yes` forces `durable handles = yes`, `kernel oplocks = no`, `kernel share modes = no`, and `posix locking = no`. Locking on a Time Machine-style share is therefore coherent only among SMB clients, not with local or NFS processes on the NAS. — [Samba vfs_fruit(8)](https://www.samba.org/samba/docs/current/man-html/vfs_fruit.8.html)
- `fruit:zero_file_id` (default yes) returns zero file IDs to macOS clients once AAPL is negotiated, because Samba's inode-derived IDs can be recycled. As a result, Mac clients do not get stable server file IDs. — [Samba vfs_fruit(8)](https://www.samba.org/samba/docs/current/man-html/vfs_fruit.8.html)
- Capture One users have reported catalogs on Synology opening very slowly on macOS while Windows was fine. This is an old user report, but it fits a pattern of macOS SMB client performance problems. — [Capture One community](https://support.captureone.com/hc/es/community/posts/360012177617-Capture-One-Pro-8-OSX-not-compatible-with-Synology-NAS-drive)
- Dell PowerScale's macOS guidance says busy shares can make Finder refresh constantly. The workaround is `notify_off=yes` in `/etc/nsmb.conf`, which in turn breaks workflows that depend on SMB notifications. — [Dell PowerScale OneFS macOS guide](https://infohub.delltechnologies.com/en-au/l/powerscale-onefs-macos-client-performance-and-user-experience-optimization/smb-change-notifications-5)

**S3-compatible storage on the NAS**
- MinIO timeline:
  - The admin console UI was removed from Community Edition in 2025. Sources disagree on the month (February commit vs. May).
  - Pre-built binaries and Docker images stopped in October 2025, leaving the project source-only.
  - The repo went into "maintenance mode" on 2025-12-03 (no features, no PRs, security fixes case by case).
  - The repo was archived as "NO LONGER MAINTAINED" around 2026-02-12/13.
  - MinIO steers users to its paid AIStor product.
  — [Blocks and Files](https://blocksandfiles.com/2025/06/19/minio-removes-management-features-from-basic-community-edition-object-storage-code/); [Linuxiac](https://linuxiac.com/minio-ends-active-development/); [InfoQ](https://infoq.com/news/2025/12/minio-s3-api-alternatives/); [vonng.com "MinIO is dead"](https://blog.vonng.com/en/db/minio-is-dead/)
- A third-party fork (Pigsty/vonng) restores the console and rebuilds binaries. Its long-term maintenance is unproven. — [vonng.com "MinIO Is Dead, Long Live MinIO"](https://vonng.com/en/db/minio-resurrect/)
- QNAP QuObjects is an optional App Center add-on that exposes shared folders as buckets and files as objects, alongside SMB/NFS. It supports Bucket, Object, and Multipart Upload APIs, needs QTS 5.0.0+, and runs on all x86 QNAP models plus a few ARM ones. QuTS hero support ended at QuObjects 2.3 or earlier. — [QNAP QuObjects](https://www.qnap.com/da-dk/software/quobjects); [vInfrastructure review](https://vinfrastructure.it/it/2025/07/enable-s3-on-qnap-with-quobjects/)
- Garage is a lightweight AGPL-3.0 self-hosted S3 store aimed at small and medium geo-distributed clusters. It uses full replication rather than erasure coding and lacks S3 Object Lock. These are claims from a promotional and a comparison source. — [glukhov.org comparison](https://glukhov.org/data-infrastructure/object-storage/garage-vs-minio-vs-s3/); [Railway Garage template](https://railway.com/deploy/garage-minio-alternative); [NixOS wiki](https://wiki.nixos.org/wiki/Garage)

**Small-file vs. large-file throughput**
- In PhotographyLife's test, copying a 13.5 GB mixed folder (RAW, JPEG, TIFF, XMP) to a NAS took about 33 s over 10GbE and about 139 s over 1GbE: roughly 4x faster, not 10x. Many small files transfer well below link speed. — [PhotographyLife](https://photographylife.com/10-gbit-for-photography)

### Inferences
- A DAM that wants to run "on any NAS" should treat SMB3 as the baseline and NFS as an optional fast path for Linux clients and servers. S3 should be an optional backend only, since Synology DSM has no confirmed first-party S3 server and MinIO CE is no longer a safe dependency.
  - General knowledge, unverified: Synology C2 is Synology's cloud service, not an S3 server on the NAS.
- Server-side Samba settings the DAM cannot control (fruit on or off, zero_file_id, multichannel on or off, Time Machine-style locking overrides) change file-ID stability, locking coherence, and performance. The DAM therefore needs a "share capability probe" at setup.
- Large sequential RAW reads are bandwidth-bound. Scans of millions of files (readdir plus stat) are latency-bound, and that cost grows with per-file round trips. This argues for running the scanner next to the data, on the NAS.
- General knowledge, unverified:
  - Apple deprecated AFP and removed it from recent macOS versions.
  - WebDAV and SFTP have high per-file overhead and are poor for metadata-heavy scans.
  - rsync is good for bulk ingest or mirroring but is not a live access protocol.

### Gaps
- I found no current primary source on AFP's removal timeline in macOS or on NAS vendors dropping AFP.
- I found no benchmark comparing SMB3 and NFSv4.1 on stat/readdir rates over millions of files on consumer NAS hardware.
- I did not verify whether Synology DSM 7.x offers any first-party S3-compatible server.
- WebDAV, SFTP, and rsync characteristics are not sourced in this session.

## Change detection over network shares, and alternatives

### Takeaway
Client-side filesystem watchers are unreliable over network mounts:
- Linux inotify on CIFS mounts does not get remote changes.
- NFS has no change notification in shipping Linux. NFSv4.1 directory-delegation CB_NOTIFY is still a server-side patch series as of June 2026, and the client side has not landed.
- SMB2 CHANGE_NOTIFY works for Windows and macOS clients but is server-dependent and can be switched off.

Reliable change detection therefore means one of: periodic scans (mtime/size/inode, plus hashing on suspicion), a watcher agent running on the NAS (bounded by inotify limits around 8192 by default on Synology), or filesystem-level diffs (`zfs diff`, `btrfs subvolume find-new`).

### Cited Findings
- **Linux CIFS client:** In 2007, Steve French said the Linux cifs client lacked a full mapping from inotify to the SMB CHANGE_NOTIFY wire request, and that Samba uses inotify on the server side to serve CHANGE_NOTIFY. — [LKML 2007](https://lkml.rescloud.iu.edu/0704.0/2681.html)
- **CIFS ioctls:** The kernel has a cifs-specific ioctl, `CIFS_IOC_NOTIFY`. In 2022, `CIFS_IOC_NOTIFY_INFO` was added; it blocks until the server reports a change in a directory (optionally the whole tree) and returns what changed. This is an ioctl, not inotify. — [cifs ioctl.c log](https://sre.ring0.de/linux/log/fs/cifs/ioctl.c?showmsg=1)
- **2022 kernel discussion:** An LSF/MM/BPF topic proposed letting inotify call into network and cluster filesystems. Reviewers wanted fanotify support too. As of these threads it was a prototype, not merged. — [lore.kernel.org thread](https://lore.kernel.org/all/Yhf+FemcQQToB5x+@redhat.com/T/); [LKML follow-up](https://lkml.iu.edu/2202.3/01231.html)
- **NFS:** Jeff Layton's nfsd patch series adds CB_NOTIFY callbacks for directory delegations (v6, posted 2026-06-11, targeting v7.3). The author does not want to merge until a complete client-side implementation exists. — [LKML v6 patch series](https://lkml.rescloud.iu.edu/hypermail/linux/kernel/2606.1/09622.html); [LKML v3 directory delegations](https://lkml.iu.edu/2509.3/01115.html)
- **Changes from other machines:** When another machine writes to an NFS export or SMB share, the local kernel never handles that write, so no local event fires. — [startdebugging.net (2026)](https://startdebugging.net/2026/10/filesystemwatcher-vs-polling-for-detecting-file-changes-on-a-network-share-in-dotnet/)
- **macOS and TrueNAS:** macOS SMB clients did not see changes made via NFS on the server until "kernel change notify" was enabled. Maintainers warned that enabling it causes file-descriptor exhaustion. — [TrueNAS forum thread](https://www.truenas.com/community/threads/truenas-13-and-kernel-change-notify-no.112880/); [iXsystems NAS-124241](https://ixsystems.atlassian.net/browse/NAS-124241)
- **macOS notify off:** `notify_off=yes` in `/etc/nsmb.conf` disables SMB change notifications on macOS. Admins sometimes set it, which silently removes any notification-based detection. — [Dell PowerScale guide](https://infohub.delltechnologies.com/en-au/l/powerscale-onefs-macos-client-performance-and-user-experience-optimization/smb-change-notifications-5)
- **Immich external libraries:**
  - Changes made outside Immich require a library scan. A nightly scan runs once a day by default, with a cron-configurable schedule.
  - Watching is "experimental" and "for advanced users only." On a "network drive, automatic file watching likely won't work."
  - The watcher watches all files in the import paths, including ignored ones. It hits `ENOSPC` when `fs.inotify.max_user_watches` (default 8192) is too low, and it can hang startup.
  — [Immich docs: External Libraries](https://docs.immich.app/features/libraries)
- **Synology inotify limits:** The stock DSM `max_user_watches` is about 8192 per forum reports; no official Synology document was found. Containers share the host kernel's limit. Raising it persistently means a DSM Task Scheduler boot task running `sysctl fs.inotify.max_user_watches=524288`, because manual edits are lost on reboot or DSM upgrade. Each watch costs about 1 KB of unswappable kernel memory. A Roon container on Synology used up the default budget and broke DSM's own services. — [Resilio docs](https://docs.resilio.com/content/troubleshooting/error-messages/agent_run_out_of_system_notify_watchers/); [Syncthing forum](https://forum.syncthing.net/t/setting-inotify-limit-permanently-on-synology-diskstation/12221); [Roon community](https://community.roonlabs.com/t/synology-dsm-roon-server-ipv6-dhcpv6-broken-because-roon-exhausted-inotify-watches/322285)
- **Newer kernels:** Since Linux 5.11, `max_user_watches` scales with RAM. Older NAS kernels use fixed presets. — [Syncthing forum](https://forum.syncthing.net/t/partial-success-on-increasing-inotify-limits-on-synology-nas/20677)
- **`zfs diff`:** It compares a snapshot to a later snapshot or the live filesystem and emits `-` (removed), `+` (created), `M` (modified), and `R` (renamed, with old -> new path). `-H` gives tab-separated machine output; `-t` adds inode change time. — [OpenZFS zfs-diff(8)](https://openzfs.github.io/openzfs-docs/man/master/8/zfs-diff.8.html)
- **`btrfs subvolume find-new <subvol> <last_gen>`:** It lists files changed since a transaction generation and does not report deletions. — [btrfs-subvolume(8) Debian](https://manpages.debian.org/buster/btrfs-progs/btrfs-subvolume.8.en.html); [btrfs docs](https://btrfs.readthedocs.io/en/latest/_sources/btrfs-subvolume.rst.txt); [Gentoo wiki](https://wiki.gentoo.org/wiki/Btrfs/snapshots)

### Inferences
- With 100k–2M files, an inotify watcher on the NAS needs at least one watch per directory. Immich's implementation watches every file, which is far worse. Directory-level watches (inotify watches are per directory) plus raising `max_user_watches` via a boot task is feasible but needs admin privileges on the NAS. That conflicts with "runs in an unprivileged container."
- The most robust design is layered:
  1. Fast path: a NAS-side agent uses inotify (directory watches) where available, `zfs diff` on TrueNAS/ZFS, or `find-new` on Btrfs (Synology and QNAP's Btrfs-based systems) for cheap incremental change sets.
  2. Correctness path: a periodic full scan comparing (path, size, mtime, inode/file-id) against the DB.
  3. Content hash only for new or suspicious files.
  4. Deletions must always come from the scan, because `find-new` misses them.
- From a remote workstation, SMB CHANGE_NOTIFY (Windows ReadDirectoryChangesW, the macOS SMB client) is a "hint," not a source of truth. It can be disabled by `notify_off` or by server settings, and it misses changes made outside SMB unless Samba's kernel change notify is on.
- Whether ZFS or Btrfs snapshot diffs are reachable from a container is vendor-specific and needs privileges. Treat them as optional accelerators.

### Gaps
- PhotoPrism, digiKam, Lightroom, Capture One, and PhotoStructure change-detection internals: not sourced in this session. PhotoPrism docs only say first indexing on a NAS is slower and recommend SSD for the DB and cache.
- No official Synology or QNAP documentation on default inotify limits was found.
- Whether any shipping Linux kernel (as of 2026-10) routes inotify to SMB CHANGE_NOTIFY on cifs mounts was not confirmed. The latest evidence found is the 2022 discussion.
- Synology's own indexer (synoindex) hooks: not researched.

## File locking and databases on network shares

### Takeaway
Every authoritative source says the same thing: don't run an embedded database such as SQLite over SMB or NFS.
- SQLite says to rely on it "at your (and your customers') peril."
- Adobe refuses to open a Lightroom Classic catalog on a network volume.
- Capture One permits it but recommends local catalogs.
- digiKam says SQLite cannot be on network media and points to MySQL/MariaDB.
- Photo Mechanic Plus warns shared catalogs can be corrupted.

A DAM must keep its DB local to the process that owns it: on the NAS in a NAS-side server, or on the workstation. For multi-client use, it should use a client/server DB (PostgreSQL) or a single owning server process.

### Cited Findings
- **SQLite's official guidance:**
  - Network filesystem locks "have been known to operate incorrectly for some network filesystems. This has led to database corruption."
  - fsync on network filesystems is less robust, and writes can land out of order.
  - Problems are "not frequent or repeatable," so testing gives false confidence.
  - Recommendations, in order: (1) a client/server DB, with PostgreSQL "an excellent choice"; (2) WAL mode with all access from processes on the machine holding the file, plus a proxy for remote clients; (3) rollback mode with exclusive one-at-a-time access.
  - Developers should consider blocking users from choosing a remote DB location.
  — [sqlite.org: SQLite Over a Network](https://www.sqlite.org/useovernet.html)
- **Adobe Lightroom Classic:**
  - On a network volume, Lightroom shows the error "Lightroom cannot launch with this catalog. It is either on a network volume or on a volume on which Lightroom cannot save changes."
  - Adobe staff have said non-local catalogs are not supported, while photos may live on network storage.
  - Adobe's HelpX catalog FAQ returned 403 to the fetcher, so the official wording was not verified directly.
  — [Adobe Community thread](https://community.adobe.com/t5/lightroom-classic-discussions/lightroom-cannot-launch-with-this-catalog-it-is-either-on-a-network-volume-or-on-a-volume-on-which/m-p/12772940/highlight/true); [Adobe Community: images on NAS](https://community.adobe.com/t5/lightroom-classic-discussions/lightroom-classic-images-stored-on-nas-official-yes-or-no/m-p/15185203/highlight/true); [Adobe Community feature request](https://community.adobe.com/feature-requests-676/p-allow-catalog-to-be-stored-on-a-networked-drive-666362/index5.html)
- **Capture One:**
  - A catalog can be saved on a network drive, but the drive must be constantly accessible.
  - Another article recommends keeping the catalog local for performance, with RAWs on the NAS.
  - A staff community post says the catalog needs little access to originals beyond import and export.
  — [Capture One support 360002519558](https://support.captureone.com/hc/en-us/articles/360002519558); [Capture One support 360002519598](https://support.captureone.com/hc/en-us/articles/360002519598); [Capture One support 360002519778](https://support.captureone.com/hc/en-us/articles/360002519778); [Capture One community (archived)](https://support.captureone.com/hc/fr/community/posts/360012186497-Catalog-and-or-RAW-Files-on-NAS-Server)
- **digiKam:**
  - SQLite cannot use network media.
  - MySQL/MariaDB lets several digiKam installations manage one collection.
  - digiKam uses three DBs: core, thumbnails, and similarity.
  - The collections docs also warn that local network shares don't permit several clients at once on a common DB. Each client can mount the NAS at a different path with its own DB.
  - Libraries over about 100k items on spinning disks get slow with SQLite.
  — [digiKam handbook: Database Settings](https://docs.digikam.org/en/setup_application/database_settings.html); [digiKam handbook: Collections Settings](https://docs.digikam.org/es/setup_application/collections_settings.html); [KDE Discuss](https://discuss.kde.org/t/digikam-sharing-databases-between-linux-and-windows-pcs/49443)
- **Photo Mechanic Plus:**
  - "Not a multi-user product."
  - Sharing a catalog among users on a shared drive "can cause the catalog database to be damaged."
  - A single user on several machines uses "Manage Shared Folders" to map different mount paths.
  — [Camera Bits: Sharing a Catalog](https://docs.camerabits.com/en/support/solutions/articles/48001159649); [Camera Bits: Managing Shared Folders](https://docs.camerabits.com/en/support/solutions/articles/48001157499)
- **Daminion:**
  - Daminion Server is a Windows service backed by PostgreSQL.
  - Remote PostgreSQL is for experienced admins and was documented as PostgreSQL 12 only.
  - A user who put the DB on a NAS path found it would not start.
  — [Daminion: remote Postgres](https://daminion.net/docs/installation/connect-to-a-remote-postgres-server/); [Daminion forum](https://forum.daminion.net/topic/1772-decentralized-server-environment/)
- **PhotoPrism** recommends SSD storage for the database and cache when running on a NAS. — [PhotoPrism Synology docs](https://docs.photoprism.app/getting-started/nas/synology/)

### Inferences
- **DB placement:** Never place the DAM's SQLite (or any embedded DB, including thumbnail and preview caches using SQLite or LMDB) on a mounted share. If a single-user desktop app uses SQLite, it lives on local disk, and the app should detect network filesystems (statfs type checks) and refuse to put it there, as Lightroom does.
- **Multi-client:** Use one server process that owns the DB (NAS-side container or home server) with a client/server DB such as PostgreSQL, or SQLite in WAL mode accessed only by that process (SQLite option 2). Clients talk to it over HTTP or gRPC, not file sharing.
- **Path mapping:** Desktop-only multi-machine setups need a mount-point mapping table, as in Photo Mechanic's "Shared Folders" and digiKam's per-client base paths. Store paths relative to a volume or library root ID.

### Gaps
- Adobe HelpX's exact current wording was not retrievable (403).
- I found no Capture One statement on session (vs. catalog) files on NAS.
- No measured data on SMB oplocks/leases vs. sidecar write races.

## Metadata: XMP sidecars, consistency, and file identity

### Takeaway
File identity across renames and moves cannot rely on inode or file-ID over SMB:
- Samba deliberately zeroes file IDs for macOS clients because inode numbers can be recycled.
- `zfs diff` and Btrfs can report renames only server-side.

A DAM should identify files by content hash (with a size+mtime fast path), reconcile renames using (hash, size), and use embedded XMP identifiers as a secondary key where present. Multi-writer sidecar edits need a single writer (the server) or explicit conflict handling.

### Cited Findings
- Samba inode-based file IDs can be recycled. With `fruit:zero_file_id` (default yes), macOS clients receive zero IDs and stop trusting server file IDs. — [Samba vfs_fruit(8)](https://www.samba.org/samba/docs/current/man-html/vfs_fruit.8.html)
- `zfs diff` reports renames explicitly (`R old -> new`). `btrfs find-new` reports changed files but not deletions, and so not renames as such. — [OpenZFS zfs-diff(8)](https://openzfs.github.io/openzfs-docs/man/master/8/zfs-diff.8.html); [Gentoo wiki Btrfs snapshots](https://wiki.gentoo.org/wiki/Btrfs/snapshots)
- Photo Mechanic Plus and digiKam both handle per-machine path differences by mapping roots rather than storing absolute paths. — [Camera Bits: Managing Shared Folders](https://docs.camerabits.com/en/support/solutions/articles/48001157499); [digiKam Collections Settings](https://docs.digikam.org/es/setup_application/collections_settings.html)
- In Immich, files outside import paths or matching new exclusion patterns are moved to trash or offlined on the next scan. That is identity by path, not content. — [Immich docs](https://docs.immich.app/features/libraries)

### Inferences
- Recommended identity scheme:
  - Primary key: a library-relative path.
  - Stability key: (size, mtime, file-id where trustworthy).
  - Content key: a full or partial hash.
- Hashing 2M files of 20–100 MB means 40–200 TB of reads. Full hashing over the network is impractical, so hash on the NAS side, or use partial hashes (first and last N MB plus size) with deferred full hashing.
- XMP `xmpMM:DocumentID`/`InstanceID` are useful but not universally present in camera RAWs. They are usually written into sidecars by editors (general knowledge, unverified).
- Concurrent sidecar writes from Lightroom, Capture One, darktable, and the DAM can conflict. A DAM should detect a sidecar mtime change before writing (optimistic concurrency) and avoid rewriting sidecars it didn't change.

### Gaps
- No source fetched on XMP DocumentID semantics, DNG embedded XMP behavior, or how Lightroom and Capture One resolve sidecar conflicts.
- No source on SMB2 durable file IDs (FileId from SMB2 CREATE / FILE_INTERNAL_INFORMATION) stability on Windows clients against Samba with fruit disabled.

## Networking: 1GbE / 2.5GbE / 10GbE and remote access

### Takeaway
10GbE gives a large but sub-linear real gain over 1GbE for mixed photo folders (about 4x in one copy test). Editing RAWs directly over 1GbE "works but is limiting." Every vendor and the community agree that catalogs and DBs should stay local even when RAWs are on the NAS.

### Cited Findings
- 13.5 GB mixed RAW/JPEG/TIFF/XMP copy: about 33 s on 10GbE vs. about 139 s on 1GbE. The theoretical 1250 MB/s on 10GbE is "practically impossible to reach." — [PhotographyLife](https://photographylife.com/10-gbit-for-photography)
- Forum anecdotes:
  - 1GbE is about 100 MB/s in practice and loads a RAW in about 1 s.
  - 10GbE "gets you in the ballpark of usability."
  - One Lightroom user on a direct 10GbE link to Synology reported needing jumbo frames to avoid problems; this is a single anecdote.
  — [FredMiranda forum](https://www.fredmiranda.com/forum/topic/1929373/); [Pentax Forums](https://www.pentaxforums.com/forums/32-digital-processing-software-printing/435229-moving-photo-catalogs-nas-post5471282.html)
- Daminion's own docs say "Scheme A" (files on NAS, server on a separate PC) is the most common setup but its speed is "highly dependent on the network bandwidth." Co-locating server and files (Scheme B) performs well. — [Daminion Scheme A](https://daminion.net/docs/scheme-a-documents-are-stored-on-a-nas-or-remote-location-daminion-server-is-installed-on-a-server-pc/)
- A Daminion Server running in a Windows VM on a NAS works, but users reported a slow virtualized network. — [Daminion forum](https://forum.daminion.net/topic/3250-running-daminion-server-in-a-vm-in-nas/)

### Inferences
- **Rough cost of a full scan.** One stat per file at about 0.5–1 ms round-trip latency over SMB gives roughly 15–30 minutes for 2M files, before any reads. This is an inference from typical LAN RTT and is unmeasured. Over a WAN or VPN (Tailscale/WireGuard at 20–50 ms RTT), it becomes hours to days. Remote access must therefore go through an app-level API (thumbnails, previews, metadata) served from the NAS side, not through SMB-over-VPN.
- **Vendor relays:** Synology QuickConnect and QNAP myQNAPcloud are vendor-specific relays. A vendor-neutral app should support plain HTTPS plus user-supplied overlays (Tailscale/WireGuard) rather than depend on them.

### Gaps
- No 2.5GbE-specific benchmark for RAW editing was found.
- No ServeTheHome or NASCompares benchmark was fetched.
- Tailscale, QuickConnect, and myQNAPcloud behavior and throughput were not researched in this session.

## Hybrid architecture patterns in industry

### Takeaway
Shipping products fall into three patterns:
- **Server co-located with the files plus a client/server DB:** Immich and PhotoPrism run on the NAS or a server, usually in Docker. Daminion Server uses PostgreSQL and recommends co-locating files.
- **Desktop app with a local catalog and originals on the NAS:** Lightroom Classic, Capture One, Photo Mechanic Plus, and digiKam with SQLite.
- **Desktop app with a remote client/server DB:** digiKam with MariaDB, Daminion with remote Postgres.

None of these products relies on client-side filesystem watching over SMB/NFS. The common pattern is scheduled rescans plus optional server-side watchers.

### Cited Findings
- **Immich:** server-side with a nightly rescan and an experimental inotify watcher, explicitly not for network drives. — [Immich docs](https://docs.immich.app/features/libraries)
- **PhotoPrism:** documents NAS installs on Synology, QNAP, and Asustor. It mounts the existing photo share as originals, recommends SSD for the DB and cache, warns that entry-level low-power NAS CPUs may be unsuitable, and says first indexing is slower than on a desktop or server. — [PhotoPrism Synology](https://docs.photoprism.app/getting-started/nas/synology/); [PhotoPrism QNAP](https://docs.photoprism.app/getting-started/nas/qnap/); [PhotoPrism requirements](https://www.photoprism.app/pro/kb/requirements)
- **Daminion:** Windows-native server plus Windows desktop client and PostgreSQL. It describes NAS-file and co-located schemes and does not run natively on NAS hardware. — [Daminion Scheme A](https://daminion.net/docs/scheme-a-documents-are-stored-on-a-nas-or-remote-location-daminion-server-is-installed-on-a-server-pc/); [Daminion installing server](https://daminion.net/docs/installation/installing-daminion-server/); [Daminion forum: Synology](https://forum.daminion.net/topic/3779-daminion-server-on-a-synology-nas/)
- **digiKam:** desktop app with a local SQLite DB per client, or a shared MariaDB/MySQL. — [digiKam Database Settings](https://docs.digikam.org/en/setup_application/database_settings.html)
- **Photo Mechanic Plus:** a local catalog per user with NAS-hosted images and shared-folder path mapping. Search works even when drives are offline. — [Camera Bits](https://docs.camerabits.com/en/support/solutions/articles/48001159649); [KelbyOne review](https://insider.kelbyone.com/review-photo-mechanic-plus)
- **Lightroom Classic and Capture One:** local catalog, originals on NAS. — [Adobe Community](https://community.adobe.com/t5/lightroom-classic-discussions/lightroom-classic-images-stored-on-nas-official-yes-or-no/m-p/15185203/highlight/true); [Capture One support](https://support.captureone.com/hc/en-us/articles/360002519598)

### Inferences
- The best fit for "any NAS" is a hybrid:
  - **NAS-side agent:** a small OCI container that needs no privileges by default. It indexes, watches (where limits allow), hashes, extracts metadata, makes thumbnails, and owns the authoritative DB (Postgres, or SQLite-WAL used only locally), exposing an HTTP API.
  - **Desktop or workstation client:** does heavy RAW rendering and editing and reads originals over SMB3/NFS for full-resolution work.
- A fallback "workstation-only" mode is needed for NAS boxes that can't run containers (ARM or low-RAM models). It keeps the DB local to the workstation and uses scheduled scans over SMB/NFS, with SMB CHANGE_NOTIFY as a hint only.
- Running heavy work (ML, preview generation for 2M RAWs) on low-power NAS CPUs is a real constraint (PhotoPrism's warning). The agent should support offloading compute to the workstation or a GPU box while keeping file enumeration and hashing local to the NAS.

### Gaps
- Mylio, Excire, Peakto, ResourceSpace, Pimcore, Canto, Phraseanet, Razuna, TagSpaces, and PhotoStructure architectures were not researched in this session, for lack of tool budget.
- No primary source confirmed how PhotoPrism detects changes (auto-index delay vs. watcher).

# Existing Photo Management / DAM Landscape On and Alongside NAS (as of 2026-10-16)

Method note: GitHub metrics below were pulled directly from the GitHub REST API on 2026-10-17 (UTC). Contributor counts use `/contributors?anon=1`, so they include anonymous and bot committers and run higher than the "Contributors" number on the repo page. Treat them as relative size, not exact headcount. Many 2026 "comparison" articles found in search are vendor or affiliate content. They are flagged where used.

## 1. Vendor-native NAS photo apps (Synology, QNAP, UGREEN, Asustor, TerraMaster)

### Takeaway
Vendor-native apps are family-oriented gallery and backup layers. They list many RAW extensions, but they offer no controlled vocabulary or hierarchical keywords and no reliable XMP/IPTC write-back. Synology also removed server-side HEVC/HEIC decoding in DSM 7.2.2, which pushes thumbnail work to client devices. Reviewers consistently describe them as an ingest/archive layer that professionals pair with a real cataloguer.

### Cited Findings
**Synology Photos**
- DSM 7.2.2 removed HEVC/HEIC decoding on the NAS, so Synology Photos can no longer generate server-side thumbnails for HEIC photos or HEVC videos. Synology said processing of HEVC/AVC/VC-1 media would "move from the server to end devices." — [Medium/Live View](https://medium.com/live-view/heic-support-in-synology-photos-bd94a12f38e7); [Synology Community](https://community.synology.com/enu/forum/1/post/189443)
- Synology's official workaround is "Synology Image Assistant", a browser extension or desktop app that renders HEIC/HEVC previews on the client. Phones handle it inside the Synology Photos mobile app. — [Medium/Live View](https://medium.com/live-view/heic-support-in-synology-photos-bd94a12f38e7)
- The community has built unofficial fixes, such as a GitHub project that restores server-side HEIC/HEVC thumbnails on DSM 7.2.2+ (tested on DSM 7.2.2-72806 U4 / Synology Photos 1.8.0) and scripts that downgrade Advanced Media Codecs. The Video Station reinstall script now targets DSM 7.2.2, 7.3 and 7.4, which shows DSM 7.4 exists by late 2026. — [octavianx/synology-photos-server-side-thumbnailgen](https://github.com/octavianx/synology-photos-server-side-thumbnailgen); [007revad/Video_Station_for_DSM_722](https://github.com/007revad/Video_Station_for_DSM_722)
- Synology's spec page lists RAW extensions including ARW, CR2, CR3, DNG, NEF, ORF, RAF, RW2 and X3F. Users still report DNG and Fuji RAF files that don't display, though those reports are older or of mixed vintage. — [Synology DSM 7.x spec](https://www.synology.com/en-global/dsm/7.4/software_spec/synology_photos); [SynoForum DNG thread](https://www.synoforum.com/threads/raw-dng-support-with-synology-photos.9077/)
- Synology Photos can edit date/time, description, tags and rating. One ExifTool forum user found that a rating change was written to several rating tags at once, with a Windows-style rating as the primary value. Another user found Synology Photos ignored digiKam sidecars named `file.ext.xmp` until digiKam was set to embed metadata in the file. — [ExifTool forum](https://exiftool.org/forum/index.php?msg=61065); [discuss.pixls.us](https://discuss.pixls.us/t/use-of-tags-created-with-digikam-in-synology-photo/43479)
- An affiliate-ranked review (July 2026) scores Synology Photos 7.7/10 and lists "no controlled vocabulary, no IPTC/XMP write-back, no version history". Its only sharing is at album level. The publisher's top pick is Daminion, so weigh this accordingly. — [PhotoLib "Best DAM for NAS 2026"](https://photolibsoftware.com/best/dam-for-nas/)

**QNAP QuMagie**
- QNAP's docs list a broad set of RAW formats (ARW, CR2, CR3, NEF, RAF, DNG and others). BMP support requires an Intel CPU. — [QNAP QuMagie 2.x supported formats](https://docs.qnap.com/application/qumagie/2.x/en-us/supported-file-formats-2AC2140A.html); [QNAP FAQ](https://www.qnap.com/en/how-to/faq/article/what-kinds-of-image-file-formats-are-supported-by-photo-station-qumagie)
- A DxO forum user reports that QuMagie reads XMP `dc:subject` rather than `lr:HierarchicalSubject`, so keyword hierarchies are flattened. Search for parent and child keywords still worked. — [DxO forum "A hobbyist's workflow"](https://forum.dxo.com/t/a-hobbyist-s-workflow/14652)
- A Daminion-affiliated site says QuMagie lacks hierarchical keywords, IPTC/XMP editing, RAW-aware workflow and versioning, and that ARM models generate thumbnails too slowly for catalogue use. It calls QuMagie "excellent as the ingestion and backup layer". — [PhotoLib QNAP 2026](https://photolibsoftware.com/best/qnap-photo-management/); [PhotoLib DAM for NAS](https://photolibsoftware.com/best/dam-for-nas/)

**UGREEN (UGOS Photos)**
- UGREEN's own photographer page says UGOS Photos previews CR2, CR3, NEF, ARW, RAF, RW2 and DNG. Compatible models get on-device AI recognition (people, scenes, places), natural-language search and duplicate detection, but the AI models have to be downloaded and enabled first. UGREEN states plainly that Photos "is not a replacement for Adobe Lightroom Classic or another professional RAW editor" and pitches it for "a finished or archived library". — [UGREEN NAS for Photographers](https://ai.ugreen.com/pages/nas-for-photo-videographer); [UGREEN NAS Photos](https://ai.ugreen.com/blogs/knowledge/ugreen-nas-photos)
- A 2026 third-party comparison says UGREEN is "still catching up" to Synology and QNAP on AI photo search and calls its RAW support limited, which conflicts with UGREEN's own format list. — [needtoknowit.com.au](https://needtoknowit.com.au/blog/ai-photo-search-on-nas-synology-qnap-and-ugreen-compared/)

### Inferences
- All vendor apps treat the photo as a consumer media item. None of them models culling states (pick/reject), color labels, hierarchical keyword vocabularies or client proofing. That is the space a photographer-oriented DAM would occupy.
- Because Synology moved codec work to clients, licence-encumbered codecs (HEVC) became the vendor's liability to avoid. A new open-source project shipped as a container would face the same codec-patent question when it bundles ffmpeg/libheif builds.
- Vendor lock-in is a real pain point: metadata that lives only in a vendor database (Synology may store some edits only in its DB) does not survive a NAS migration.

### Gaps
- No primary-source information was found on Asustor Photo Gallery 3 or TerraMaster's photo app (RAW, XMP, AI). Searches returned nothing usable.
- No official Synology statement was found confirming or denying XMP sidecar write-back. The "no XMP write-back" claim comes from an affiliate site plus user reports.
- I did not verify Synology's historic feature removals relative to Moments/Photo Station (e.g., loss of Photo Station's per-folder permissions and public blog/sharing features) in this session.
- UGOS Photos XMP read/write behavior is undocumented.

## 2. Open-source self-hosted photo servers and desktop tools

### Takeaway
Immich dominates: 116k stars, v3 since July 2026, releases every 1–3 weeks, full-time staff funded by FUTO and product keys. It writes XMP sidecars for rating, description and tags, but it is still built around phone backup and the family timeline, not RAW culling. PhotoPrism is the more "photographer-flavoured" server (RAW stacking, read-only indexing of existing folders) and runs an open-core membership model. The rest are smaller: LibrePhotos is active again, Lychee is very active, Piwigo is steady, Photoview has had no release since June 2024, and PiGallery2 releases occasionally. digiKam and darktable are the photographer-grade open-source tools, but they are desktop apps and single-user.

### Cited Findings
**GitHub metrics snapshot (GitHub API, 2026-10-17 UTC)**

| Project | Stars | Forks | License (GitHub) | Latest release (date) | Contributors (anon incl.) | Notes |
|---|---|---|---|---|---|---|
| [Immich](https://github.com/immich-app/immich) | 116,430 | 7,243 | AGPL-3.0 | v3.3.3 (2026-10-14) | ~1,026 | 26 non-RC releases in 2026 so far; v2.0.0 2025-10-01; v3.0.0 2026-07-02 |
| [PhotoPrism](https://github.com/photoprism/photoprism) | 40,308 | 2,333 | NOASSERTION (AGPL Community + proprietary Plus) | 261007 (2026-10-07) | ~199 | Releases roughly monthly to every 2 months (Jun 1, Jul 28, Sep 19, Oct 7 2026) |
| [Ente](https://github.com/ente-io/ente) (now `ente/ente`) | 29,428 | — | AGPL-3.0 | — | ~395 | Pushed 2026-10-16 |
| [darktable](https://github.com/darktable-org/darktable) | 13,285 | 1,474 | GPL-3.0 | 5.6.2 (2026-10-04) | ~731 | 5.6.0 on 2026-06-21 |
| [LibrePhotos](https://github.com/LibrePhotos/librephotos) | 8,106 | 412 | MIT | 1.3.0 (2026-10-11) | ~269 | 1.2.0/1.2.1 on 2026-09-29 |
| [Photoview](https://github.com/photoview/photoview) | 6,553 | 493 | AGPL-3.0 | v2.4.0 (2024-06-23) | ~88 | Recent commits are dependabot bumps only; no release in more than two years |
| [Lychee](https://github.com/LycheeOrg/Lychee) | 4,312 | 382 | MIT | v7.11.1 (2026-10-13) | ~129 | Very frequent releases (7.9 → 7.11 within about 3 weeks) |
| [Piwigo](https://github.com/Piwigo/Piwigo) | 3,865 | 486 | GPL-2.0 | 16.4.0 (2026-05-03) | ~120 | Releases every 1–3 months; 751 open issues |
| [PiGallery2](https://github.com/bpatrik/pigallery2) | 2,299 | 268 | MIT | 3.5.2 (2026-01-24) | ~89 | Last push 2026-08-25 |
| [ResourceSpace](https://github.com/resourcespace/resourcespace) (GitHub mirror) | 81 | 26 | NOASSERTION | — | — | Main development is not on GitHub, so stars understate adoption |
| digiKam | — | — | GPL-2.0 | — | — | The GitHub `KDE/digikam` mirror is stale (last push 2019). Real development happens on KDE GitLab. |

**Immich**
- v2.0.0 "Stable" shipped on 2025-10-01. v3.0.0 shipped on 2026-07-01/02 as the first release to use release candidates. It drops pgvecto.rs (VectorChord is now required), introduces mobile non-destructive editing (web editing arrived in v2.5.0), Workflows (preview), HLS/real-time transcoding (preview) and integrity checks. Most breaking changes affect the API used by third-party tools. — [Immich v3.0.0 release](https://github.com/immich-app/immich/releases/tag/v3.0.0); [Immich blog index](https://immich.app/blog)
- v3.1 (2026-07-29) added OIDC role sync. v3.2 (2026-09-10) added "Search v2". v3.3 (2026-10-07) added shared people and opt-in ML accuracy/performance improvements, new OCR models and higher-quality thumbnails/previews. — [Immich blog](https://immich.app/blog); [v3.3.0 release](https://github.com/immich-app/immich/releases/tag/v3.3.0)
- Funding: the core team went full-time under FUTO in May 2024, and Immich has sold "product keys" since July 2024. The FAQ says the team works full-time "supported by users paying for a product key." A "FUTO — 2 years later" retrospective was posted on 2026-06-01. Immich also sells merch. — [Immich blog](https://immich.app/blog); [Immich FAQ](https://docs.immich.app/FAQ/)
- XMP: Immich reads and writes `xmp:Rating`. It writes tags to `digiKam:TagsList` and reads tags in priority order from `digiKam:TagsList`, then `lr:HierarchicalSubject`, then `IPTC:Keywords`. Editing description, rating or tags queues a "Sidecar Write" job, and writes merge into the existing sidecar. Sidecars are named `IMG_0001.jpg.xmp` (full filename plus `.xmp`). — [Immich XMP Sidecars docs](https://docs.immich.app/features/xmp-sidecars/)
- "Immich does not modify the original files." Read-only external libraries (`:ro`) cannot be metadata-edited because sidecars can't be written. In read-write external libraries, emptying the trash deletes the original. Hash-based duplicate checking applies only to upload libraries. — [Immich FAQ](https://docs.immich.app/FAQ/)
- Known gaps for photographers include ratings forced to 0–5 (no −1/reject import, per a 2024 request), no UI for custom XMP fields, and user reports of embedded XMP TagsList not importing. — [Discussion #14454](https://github.com/immich-app/immich/discussions/14454); [Discussion #12001](https://github.com/immich-app/immich/discussions/12001); [AnswerOverflow thread](https://www.answeroverflow.com/m/1467299662682919024)
- Third-party comparisons rate Immich's RAW handling as "Improving" against PhotoPrism's "Mature". Users report missing RAW+JPEG stacking and some Fuji files rendering as broken images. Note that the v3.3 notes say "auto-stacked mobile edits", not RAW+JPEG auto-stacking. — [speedtesthq comparison](https://speedtesthq.com/compare/immich-vs-photoprism); [Immich Discussion #2479 (automatic stacking)](https://github.com/immich-app/immich/discussions/2479); [Mike Lapidakis bake-off](https://empty.coffee/photo-backup-bakeoff-photoprism-vs-immich-review/)

**PhotoPrism**
- Editions: Community (free, AGPL), Essentials (about €2/mo) and Plus (from about €6/mo, under the proprietary "Plus License"), plus managed PikaPods hosting from $6.50/mo. The editions page shows inconsistent headline prices, so verify them there. Paid tiers unlock extra user roles (User, Viewer), with Plus adding an admin web UI, user-management UI, session monitoring, hardened security, custom rate limits and vector-graphics support. Faces, Adobe XMP and RAW are not marked as paid. — [PhotoPrism Editions](https://www.photoprism.app/editions)
- The 2026-10-07 release moved image classification and NSFW detection to ONNX models and added GPU acceleration on NVIDIA cards, automatic naming of face clusters, Insta360 X4/X5 support and better stacking. — [PhotoPrism release 261007](https://github.com/photoprism/photoprism/releases); [PhotoPrism release notes](https://docs.photoprism.app/release-notes/#october-7-2026)
- PhotoPrism can index an existing originals folder in read-only mode and stacks bursts and RAW sidecars automatically, which reviewers count as an advantage over Immich for RAW users. It is "not a full replacement for Lightroom Classic catalog workflows." — [Mike Lapidakis bake-off](https://empty.coffee/photo-backup-bakeoff-photoprism-vs-immich-review/); [contabo self-hosted roundup](https://contabo.com/blog/best-self-hosted-photo-apps/)

**digiKam / ResourceSpace / others**
- digiKam is a desktop client that reads NAS shares over SMB and writes XMP sidecars. Multi-user access to one shared database is unsupported. — [PhotoLib DAM for NAS (affiliate)](https://photolibsoftware.com/best/dam-for-nas/)
- ResourceSpace runs on Linux/Docker, including NAS Docker. It has role-based permissions, ingests assets into its own store rather than indexing in place, and the source recommends a separate box above about 50k assets. Razuna is an open-core Docker DAM alternative. — [PhotoLib DAM for NAS (affiliate)](https://photolibsoftware.com/best/dam-for-nas/)

### Inferences
- Immich's momentum (stars, cadence, paid staff) makes it the default "self-hosted Google Photos". A new project should not compete there. Its XMP support (tags written to `digiKam:TagsList` rather than `lr:HierarchicalSubject`/`dc:subject`, no reject rating, no color labels in the field table) shows the gap is in a photographer-grade metadata model.
- PhotoPrism is the nearest competitor for photographers, but its open-core licence and moderate cadence leave room for a fully open, photographer-first project.
- Photoview has had no release since mid-2024 and PiGallery2 releases occasionally. Low-maintenance projects in this niche tend to stall, which argues for a sustainable funding model from day one.
- No open-source server project found offers a pro culling flow (pick/reject, color labels, compare/loupe, fast embedded-preview extraction) together with client proofing galleries and Lightroom-compatible XMP round-trip.

### Gaps
- Exact Immich product key prices were not retrieved from a primary source this session; the blog and FAQ pages fetched did not show prices. (Background knowledge: about $25 individual / $100 server in 2024. This is unverified and should be checked at buy.immich.app.)
- The content of the "FUTO — 2 years later" post (team size, revenue) could not be extracted.
- Current Immich RAW decode path (LibRaw vs embedded preview) and its color-label support were not confirmed from docs.
- Ente's self-hosting details and RAW support, LibrePhotos' RAW/XMP status, and Lychee/Piwigo XMP handling were not researched in depth.
- digiKam's latest release version and date (KDE GitLab) were not fetched.

## 3. Commercial tools photographers use alongside NAS

### Takeaway
The dominant pro tools are desktop-catalogue apps whose catalogue must live locally: Lightroom Classic refuses network catalogues outright, and Photo Mechanic Plus is "not a multi-user product". Multi-user networked DAM comes from Windows-centric (IMatch Anywhere, Daminion) or subscription (Peakto Pro, Excire Office, Mylio+) products. No polished, Linux/NAS-native, open, multi-user photographer DAM exists.

### Cited Findings
- **Lightroom Classic**: when a catalogue sits on a network volume, LrC shows "Lightroom cannot launch with this catalog. It is either on a network volume or on a volume on which Lightroom cannot save changes." Images on a NAS are fine. A long-running feature request asks Adobe to allow networked catalogues, and posts from November 2025 confirm the restriction is still in place. — [Adobe Community thread](https://community.adobe.com/t5/lightroom-classic-discussions/lightroom-cannot-launch-with-this-catalog-it-is-either-on-a-network-volume-or-on-a-volume-on-which/m-p/12772940/highlight/true); [Feature request: allow catalog on networked drive](https://community.adobe.com/t5/lightroom-classic-ideas/p-allow-catalog-to-be-stored-on-a-networked-drive/idc-p/14866900); [Adobe Community LrC + NAS (2025)](https://community.adobe.com/t5/lightroom-classic-discussions/setup-for-lrc-and-nas-system-is-it-possible/td-p/15594995)
- **Photo Mechanic Plus**: Camera Bits documentation says "Photo Mechanic Plus is not a multi-user product" and warns that sharing catalogues on a shared drive can damage the database. It indexes offline volumes (an offline NAS still browses) and can search across several catalogues at once. — [Camera Bits: Sharing a Catalog](https://docs.camerabits.com/en/support/solutions/articles/48001159649); [KelbyOne review](https://insider.kelbyone.com/review-photo-mechanic-plus); [J.M. Peltier](https://www.jmpeltier.com/cataloging-photo-mechanic-plus/)
- **IMatch** (Windows): about $120–135 one-time. The IMatch Anywhere web/multi-user add-on costs $65 Home (2 concurrent users), $220 Pro (5) or $430 Team, with seat packs of $95/$205/$365 for 2/5/10 seats, per the vendor page. Capterra lists lower figures. — [photools IMatch Anywhere editions](https://www.photools.com/imatch-anywhere-editions/); [Capterra IMatch pricing](https://www.capterra.com/p/126559/IMatch/pricing/)
- **Mylio Photos**: the base app is free, and the paid Photos+ tier syncs a peer-to-peer mesh of devices that can include a NAS. Price sources disagree: $9.99/mo or $99/yr in some 2026 roundups, $20–25/mo or $240/yr from Mylio's own FAQ (about 575 days old) and an October 2026 comparison. — [Mylio FAQ](https://community.mylio.com/posts/faq-how-much-does-mylio-photos-cost); [Reviewed](https://www.reviewed.com/tech/features/mylio-photos-photo-storage-solution); [Fstoppers](https://fstoppers.com/post-production/mylio-photos-relaunching-free-app-631791)
- **PhotoStructure**: Lite is free. Plus costs $5/mo or $42/yr per household and adds advanced de-duplication, deeper metadata extraction and face-tag extraction. — [PhotoStructure pricing](https://photostructure.com/about/pricing/)
- **Peakto** (macOS): reported 2026 pricing is Standard €10/mo billed over two years (€240) and Professional €25/mo (€600 per two years), with a lifetime option on Standard. Pro adds multi-user web access and guest collaboration (launched October 2025). — [PetaPixel Oct 2025](https://petapixel.com/2025/10/08/photo-management-app-peakto-now-has-secure-online-collaboration/); [Cyme help](https://desk.cyme.io/portal/en/kb/articles/how-to-start-with-peakto); [Shotkit review](https://shotkit.com/peakto-review/)
- **Excire Foto 2027**: about USD 249 / EUR 229 lifetime (September 2026, from a competitor's comparison). The Excire Search Lightroom plug-in is about €199. The multi-user Office Edition is a subscription listed at about $59.90 per user per month. — [Excire shop](https://excire.com/en/shop/); [Capterra Excire Office](https://www.capterra.com/p/10034430/Excire-Foto-Office-Edition/); [PhotoCore vs Excire (competitor)](https://photocore.pro/en/compare/vs-excire-foto)
- **Daminion**: runs on a Windows PC or VM beside the NAS, indexes SMB shares in place, offers team permissions, versioning and a web client, and is quote-priced at the "budget" tier. Weaknesses are the Windows requirement, overnight initial indexes for large libraries and a view-only mobile app. — [PhotoLib DAM for NAS (Daminion-affiliated)](https://photolibsoftware.com/best/dam-for-nas/)

### Inferences
- Professional photographers end up with a hybrid: a local catalogue (LrC/C1/PM+) plus a NAS for originals plus maybe Immich/vendor app for family browsing. Each layer holds its own previews and metadata. This is the duplicate-preview and metadata-silo problem a NAS-native DAM could solve, if it round-trips XMP with LrC/C1/PM+.
- Multi-user in this market means either Windows (IMatch, Daminion) or a subscription (Peakto Pro, Excire Office). An open, browser-based, multi-user server running on the NAS is uncontested at the pro level.

### Gaps
- Capture One's NAS/catalogue and session-on-network guidance and pricing were not fetched; only a Capture One community link surfaced.
- Eagle and ACDSee pricing and NAS fit were not researched.
- Daminion's published pricing is not available ("quote-based" per the affiliate site).

## 4. Community pain points (RAW libraries on NAS)

### Takeaway
The recurring complaints are that the Lightroom catalogue can't live on the NAS, that browsing RAW over SMB is slow, that previews are duplicated across tools, that multi-user Lightroom isn't possible, and that XMP doesn't round-trip between tools and NAS apps. Self-hosted servers are judged good for archive, search and phone backup but not for culling.

### Cited Findings
- Standard advice is to keep the LrC catalogue, journal and preview caches on local NVMe with only the RAW originals on the NAS over SMB, and to build Smart Previews so culling and editing still work when the NAS is offline. Live databases should not sit on SMB/NFS because of locking and corruption risk. — [raidsize.com NAS for Photographers 2026](https://raidsize.com/blog/en/nas-for-photographers-2026)
- Sharing one LrC catalogue between two PCs requires a local or external drive, and NAS workarounds are "a huge risk" according to Adobe Community experts. — [Adobe Community: LrC on two PCs + Synology](https://community.adobe.com/t5/lightroom-classic-discussions/lightroom-classic-on-two-pcs-and-synology-nas/m-p/14135540)
- XMP interop friction: Synology Photos ignored digiKam's `file.ext.xmp` sidecars, QuMagie flattens `lr:HierarchicalSubject`, and Immich writes tags to `digiKam:TagsList` and won't import −1/reject ratings. — [pixls.us](https://discuss.pixls.us/t/use-of-tags-created-with-digikam-in-synology-photo/43479); [DxO forum](https://forum.dxo.com/t/a-hobbyist-s-workflow/14652); [Immich XMP docs](https://docs.immich.app/features/xmp-sidecars/); [Immich #14454](https://github.com/immich-app/immich/discussions/14454)
- In self-hosted apps, Immich users report missing RAW stacking and broken Fuji RAW rendering, and reviewers say neither Immich nor PhotoPrism replaces Lightroom-style culling. — [Mike Lapidakis](https://empty.coffee/photo-backup-bakeoff-photoprism-vs-immich-review/); [contabo roundup](https://contabo.com/blog/best-self-hosted-photo-apps/)
- Synology's HEIC/HEVC codec removal pushed users to third-party scripts, some of which break on DSM 7.2.3 and iOS 26. — [LenweSaralonde gist](https://gist.github.com/LenweSaralonde/7e017168b0ef01682f55d852b408dac4); [octavianx repo](https://github.com/octavianx/synology-photos-server-side-thumbnailgen)
- Hardware: Immich ML can saturate the CPU with 2–3 concurrent jobs and may be too heavy for a Raspberry Pi. Third-party guides give conflicting minimums (6 GB RAM vs. 4 vCPU and 8 GB). — [Immich FAQ](https://docs.immich.app/FAQ/); [speedtesthq](https://speedtesthq.com/compare/immich-vs-photoprism)

### Inferences
- The unmet need is a NAS-resident, multi-user, browser-accessible catalogue that:
  1. Indexes RAW in place, read-only-safe, with sidecar XMP written in Lightroom/C1/PM+-compatible fields (`dc:subject`, `lr:HierarchicalSubject`, `xmp:Rating` including −1, `xmp:Label` color labels).
  2. Culls fast using embedded JPEG previews, without needing a desktop catalogue.
  3. Shares one preview cache with lightweight desktop and mobile clients.
  4. Adds client proofing and delivery.
- Low-power ARM NASes are a real constraint: thumbnailing and ML must be optional, offloadable to a PC or GPU node, or able to use embedded previews.

### Gaps
- Direct Reddit, DPReview, Fred Miranda and Lightroom Queen threads were not fetched in this session, so the pain points rest on Adobe Community, vendor docs and blog or comparison sources. Quantified sentiment (e.g., thread counts) is not available.

## 5. Licensing and sustainability models for a new open-source DAM; library licensing gotchas

### Takeaway
The big self-hosted photo servers all chose AGPL-3.0 (Immich, PhotoPrism Community, Ente, Photoview). They fund development through optional purchases (Immich product keys plus FUTO), open-core memberships (PhotoPrism Essentials/Plus) or hosted plans. The most serious dependency gotcha is face recognition: InsightFace's pretrained models (e.g., buffalo_l) are non-commercial-research-only. Immich uses them under a private email permission that does not extend to third parties.

### Cited Findings
- Licences per GitHub: Immich AGPL-3.0, Ente AGPL-3.0, Photoview AGPL-3.0, PhotoPrism NOASSERTION (AGPL Community plus a proprietary "Plus License"), LibrePhotos MIT, Lychee MIT, PiGallery2 MIT, Piwigo GPL-2.0, darktable GPL-3.0. — GitHub API, 2026-10-17 ([Immich](https://github.com/immich-app/immich), [PhotoPrism](https://github.com/photoprism/photoprism), [Ente](https://github.com/ente-io/ente), [LibrePhotos](https://github.com/LibrePhotos/librephotos), [Lychee](https://github.com/LycheeOrg/Lychee), [Piwigo](https://github.com/Piwigo/Piwigo), [darktable](https://github.com/darktable-org/darktable)); [PhotoPrism Editions](https://www.photoprism.app/editions)
- Immich's funding model is FUTO employment (since May 2024) plus voluntary product keys (since July 2024). The FAQ states that development is "supported by users paying for a product key", and no feature paywall is stated. — [Immich blog](https://immich.app/blog); [Immich FAQ](https://docs.immich.app/FAQ/)
- PhotoPrism's model is open-core: an AGPL Community edition plus paid Essentials/Plus memberships that gate multi-role user management and admin/security features, and a revenue-share-style managed hosting option on PikaPods. — [PhotoPrism Editions](https://www.photoprism.app/editions)
- InsightFace's code is MIT, but its pretrained models are "available for non-commercial research purposes only", and commercial use needs a separate licence. Immich's ML README says it received permission by email from Jia Guo (March 2023) and that this permission "does not extend to the redistribution or commercial use of their models by third parties." — [InsightFace licensing page](https://www.insightface.ai/solutions/face-recognition-licensing); [PyPI insightface](https://pypi.org/project/insightface/0.5); [Immich ML README (mirror)](https://ark.sudovanilla.org/Infrastructure/immich/raw/branch/main/machine-learning/README.md)
- PhotoPrism moved its classification and NSFW models to ONNX in October 2026, which shows self-hosted projects are re-platforming ML models. — [PhotoPrism release notes](https://docs.photoprism.app/release-notes/#october-7-2026)

### Inferences
- AGPL is the norm for network-served photo apps. It blocks closed SaaS forks, and it keeps the option of dual-licensing open if the project uses a CLA. MIT/Apache maximises adoption (Lychee, LibrePhotos) but lets NAS vendors or SaaS hosts embed the code without contributing back. GPL-2/3 does not cover network use.
- A new project that wants a hosted or commercial tier cannot ship InsightFace buffalo models. It would need permissively licensed face models or a commercial InsightFace licence. Forking Immich's ML container does not inherit Immich's permission.
- The PhotoPrism-style open core creates community friction (multi-user behind a paywall). The Immich "everything free, pay to support" model works at Immich's scale but depends on a patron (FUTO). A smaller project would likely need hosted proofing/delivery or NAS-vendor partnerships for revenue.

### Gaps
- Licences of the core media libraries were not verified from primary sources this session. From background knowledge, to be confirmed: LibRaw (LGPL-2.1 or CDDL-1.0), ExifTool (Perl, Artistic/GPL; needs a Perl runtime in the container), Exiv2 (GPL-2.0-or-later, which matters for a permissively licensed project linking it), libvips (LGPL-2.1+), ImageMagick (ImageMagick License, Apache-2-style), darktable-cli (GPL-3.0) and RawTherapee (GPL-3.0) as external processes, ffmpeg (LGPL/GPL depending on build; HEVC patent exposure), libheif (LGPL), and OpenAI CLIP weights (MIT) vs OpenCLIP/LAION model licences.
- No primary source was found for PhotoPrism's face-model provenance or licence.
- Nextcloud's sustainability model (enterprise subscriptions on AGPL code) was not researched this session.

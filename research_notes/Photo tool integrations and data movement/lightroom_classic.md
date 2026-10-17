# Lightroom Classic (and Lightroom cloud) interoperability for an open-source DAM

Research date: 2026-10-16. Current app line is LrC 15.x (15.0 Oct 2025, 15.1 Dec 2025, 15.5 Aug 2026). Most of the format and community material is older (2011–2025) and is flagged that way. Prior research already established that LrC won't open a catalog stored on a network volume, so the .lrcat must stay on local disk. That is not repeated here.

Overall map of integration paths (detailed below):
1. **Read the .lrcat directly (SQLite)** while LrC is closed. This gives the most data, including catalog-only data. The schema is undocumented and unsupported by Adobe.
2. **Read XMP** (sidecars for proprietary RAW, embedded for JPEG/TIFF/PSD/DNG) with "Automatically write changes into XMP" turned on. This is safe and supported, but it covers only a subset of the data.
3. **Write a Lua plug-in inside LrC** (LrC SDK): Export/Publish service, LrCatalog API, LrHttp to a local DAM server. This is the only *supported* way to write back into the catalog. It runs only while LrC is running.
4. **Lightroom cloud Partner API (REST)**: covers cloud catalogs only, not LrC catalogs. It is gated to "entitled partner applications".
5. **Reuse previews / Smart Previews**: possible (JPEG in .lrprev; lossy DNG in Smart Previews.lrdata), but the formats are undocumented and the files aren't meant for external use.

---

## Q1. The .lrcat catalog: schema, existing readers, safe access, Adobe's stance

### Takeaway
The .lrcat is an undocumented SQLite database. Its core tables (Adobe_images → AgLibraryFile → AgLibraryFolder → AgLibraryRootFolder) are stable enough that community queries and at least one maintained open-source library (lrcat-extractor, Rust, MPL-2.0, v0.7.0 released Sep 2026) can reconstruct paths, folders, keywords and collections. A DAM should read only a copy, or the original with LrC closed and no WAL/lock files present. No commercial or open-source importer reproduces develop edits faithfully.

### Cited Findings
**Format and schema**
- The .lrcat is a SQLite DB, so general SQLite tools can open it — [pixls.us forum](https://discuss.pixls.us/t/importing-lightroom-in-a-single-file-format-lrcat-into-darktable/18121); [fileinfo](https://www.fileinfo.com/extension/lrcat)
- The schema isn't documented by Adobe and "likely to change between versions". Information about it is unofficial, and Adobe doesn't encourage direct catalog hacking — [uniquephoto Q&A](https://www.uniquephoto.com/community/qa/is-there-official-documentation-for-the-lightroom-catalog-database-schema); [Plex forum](https://forums.plex.tv/t/lightroom-catalog-support/12336)
- A working read-only query (gist, Oct 10 2025) joins `AgLibraryFolderStackImage(stack,image)` → `AgLibraryFolderStack(id_local)` → `Adobe_images(id_local, rootFile)` → `AgLibraryFile(id_local, baseName, extension, folder)` → `AgLibraryFolder(id_local, pathFromRoot, rootFolder)` → `AgLibraryRootFolder(id_local, absolutePath)`. Full path = `absolutePath` + `pathFromRoot` + `baseName.extension`. The author warns to back up the catalog before opening it with any SQLite tool — [thany gist](https://gist.github.com/thany/1f7a2172129aa4aea258c2971610581a)
- `Adobe_images.rootFile` is the FK to `AgLibraryFile.id_local`. One old thread observed that the id_local values of the two tables are offset by 1, so join on `rootFile` rather than assuming the IDs are equal — [Lightroom Queen "Question on Database Columns"](https://www.lightroomqueen.com/community/threads/question-on-database-columns.8546/); [thany gist](https://gist.github.com/thany/1f7a2172129aa4aea258c2971610581a)
- Stacks live in `AgLibraryFolderStack` / `AgLibraryFolderStackImage` — [thany gist](https://gist.github.com/thany/1f7a2172129aa4aea258c2971610581a)
- The catalog stores structured data (e.g., develop settings, crop) in a Lua-table text serialization that lrcat-extractor calls "Lightroom Object Notation" (module `lron`). Crop rectangles use a 0–1.0 coordinate space — [docs.rs lrcat-extractor](https://docs.rs/lrcat-extractor/latest/lrcat/)

**Open-source readers**
- **lrcat-extractor** (Hubert Figuière, Rust): "Extract the data from Adobe Lightroom catalogs" to help import into another application. The README lists catalog versions 2, 4 and 6. MPL-2.0. About 110 commits, 25 stars, 5 forks. It has a `dumper` binary behind `--features=binaries` — [GitHub](https://github.com/hfiguiere/lrcat-extractor)
- The latest docs.rs release is **lrcat-extractor 0.7.0, dated 12 Sep 2026**. It exposes `Catalog`, `RootFolder` ("mapped to an absolute path"), `Folder`, `Folders`, `LibraryFile`, `Image` ("backed by a LibraryFile"), `Keyword`, `KeywordTree`, `Collection`, `Content` (collection/folder view), `CatalogVersion`, and an `LrId` local-ID type. The docs page doesn't list which LrC versions are supported or mention develop settings or virtual copies — [docs.rs](https://docs.rs/lrcat-extractor/latest/lrcat/)
- **lrprev-extract** (Python): pulls the largest JPEG out of .lrprev previews and can query the .lrcat for original paths. Tested only on Lightroom 6.13/macOS — [GitHub](https://github.com/ibips/lrprev-extract/blob/main/README.md)
- **darktable**: no .lrcat importer was found. A feature request (GitHub issue #4986) was mentioned on pixls.us. Users suggest synthesizing "fake" XMPs from the SQLite DB, which one commenter called a large effort — [pixls.us](https://discuss.pixls.us/t/importing-lightroom-in-a-single-file-format-lrcat-into-darktable/18121)
- **digiKam**: no .lrcat importer. The documented route (mailing list, Jul 2026) is to add the LrC folders as a digiKam collection (files are not copied). Users then write all LrC metadata to XMP/embedded and use "Read metadata from files", with sidecar reading enabled. Collections don't come across because they aren't exported to XMP. A workaround is to convert collections to hierarchical keywords in LrC before writing XMP — [digikam-users Jul 2026](https://mail.kde.org/pipermail/digikam-users/2026-July/038268.html); [discuss.kde.org](https://discuss.kde.org/t/problems-migrating-from-lightroom-6-to-digikam/38213)

**Commercial importer as a benchmark (Capture One)**
- Capture One File > Import Catalog > Lightroom Catalog maps Collections → Albums and Collection Sets → Groups. **Smart Collections are not imported**, and neither are empty sets. Only orientation, rotation, crop, WB, saturation, contrast and exposure carry over; "all other adjustments are ignored". Ratings, color labels, flat (non-hierarchical) keywords and some IPTC contact fields transfer. The import does not modify the Lr catalog — [Capture One support FAQ](https://support.captureone.com/hc/en-us/articles/360003692438-Migrating-from-Lightroom-FAQ); [C1 community](https://support.captureone.com/hc/es/community/posts/4406334646673-Importing-catalogue-with-adjustments-from-Lightroom-8-4)
- Users report Highlights/Shadows/Whites/Blacks don't import, and B&W conversions arrive in color — [C1 community](https://support.captureone.com/hc/de/community/posts/4403063117201-Import-from-lightroom-failing-to-import-even-basic-adjustements)

**Safe access: lock and WAL files**
- `.lrcat-wal` and `.lrcat-shm` are temporary SQLite write-ahead-log and shared-memory files. LR creates them when it opens the catalog and deletes them on quit. If they remain after LrC has exited, the previous session terminated abnormally — [Adobe Community](https://community.adobe.com/t5/lightroom-classic-discussions/lrcat-shm-and-lrcat-wal-are-for/td-p/9505585)
- A separate `.lrcat.lock` file is created for every session — [Lightroom Queen "obsolete files"](https://www.lightroomqueen.com/community/threads/obsolete-files.54588/)
- LrC 15.5 (Aug 2026) adds a feature that "automatically detects issues and prompts you to fix the lrcat-data", meaning the companion `.lrcat-data` file/folder stored alongside the catalog — [Adobe LrC release notes](https://helpx.adobe.com/lightroom-classic/desktop/introduction-to-lightroom-classic/release-notes.html)

### Inferences
- Safe read protocol for a DAM: (a) refuse to open the catalog if `<name>.lrcat.lock` or `<name>.lrcat-wal` exists, since that means LrC is running or crashed with unmerged writes; (b) better still, copy `.lrcat` (plus any leftover -wal) to a temp directory and open the copy with SQLite `mode=ro` / `immutable=1`. Never write to the real file. Opening a WAL-mode DB even "read-only" can create -shm files, and could checkpoint the WAL if done carelessly. This follows from standard SQLite WAL behavior together with the Adobe community statements above.
- Writing to the .lrcat from outside LrC is high risk. The schema is undocumented, Adobe gives no support, LrC 15.5 has added an integrity checker, and there are also `.lrcat-data` and previews/sync state that must stay consistent. Any DAM write-back should go through the SDK (Q4) or through XMP plus LrC's "Read Metadata from Files".
- lrcat-extractor's README lists only versions 2/4/6, but the 2026 release suggests ongoing maintenance. Before relying on it, verify coverage of LrC 12–15 catalogs, for example by running `dumper` against a current catalog copy. This is the best ready-made base for a Rust DAM. An MPL-2.0 dependency can be used from projects under other licenses, because MPL-2.0's copyleft applies per file.
- The core path and stack tables have been stable for more than 10 years: the gist is from 2025 and uses the same table names cited in older threads.

### Gaps
- No public, versioned schema reference was found for LrC 12–15: column lists for `Adobe_images` (rating, colorLabels, pick, captureTime, fileFormat, orientation, `masterImage`/`copyName` for virtual copies), `AgLibraryKeyword`/`AgLibraryKeywordImage`, `AgLibraryCollection`/`AgLibraryCollectionImage` (smart collection rules in `AgLibraryCollectionContent`), `Adobe_imageDevelopSettings`, `AgHarvestedExifMetadata`, `AgLibraryIPTC`, `AgLibraryFace`, or `Adobe_libraryImageDevelopHistoryStep`. These names come from general knowledge, not a fetched source. Verify them against a real LrC 15 catalog (`sqlite3 .schema`).
- What the `.lrcat-data` file introduced in recent LrC versions contains was not established, nor whether readers need it.
- Peakto, Excire, Photo Mechanic and Mylio LrC importers were not researched in detail. Excire Search is a confirmed LrC plug-in that spawns a background process via `LrTasks.execute` (see Q4).
- Adobe has no published official statement on third-party catalog reading beyond community experts saying it isn't encouraged.

---

## Q2. What lives only in the catalog vs. what reaches XMP

### Takeaway
XMP (with "Automatically write changes into XMP" on) carries ratings, color labels as a text string, keywords (flat plus `lr:hierarchicalSubject`), IPTC/IPTC Ext, develop settings for the master (crs:), and face regions (mwg-rs). Several things never reach XMP: flags (pick/reject), collections and smart collections, virtual copies, stacks, full develop history, and publish-service state. A DAM that wants these must read the .lrcat or use the SDK.

### Cited Findings
- Community-expert list of catalog-only data: flags, virtual copies, collection membership, uncommitted location data, Develop history, stacks, Develop panel switches and zoom/pan positions — [Adobe Community ideas thread, 2022](https://community.adobe.com/t5/lightroom-classic-ideas/p-include-additional-metadata-in-xmp-flags-collections-vc-s-etc/idi-p/12662756). The same list is summarized from Julieanne Kost in [Adobe Community (flags missing)](https://community.adobe.com/questions-675/flags-missing-when-importing-catalog-934680)
- Specific statements: stacking and collection settings (including collection order) are missing from XMP, and virtual-copy settings "do not appear anywhere in an xmp file" (2011). "Flags aren't stored in XMP" (2019). Users work around this with keywords such as "flagged"/"reject" or a color label — [Adobe Community ideas thread](https://community.adobe.com/t5/lightroom-classic-ideas/p-include-additional-metadata-in-xmp-flags-collections-vc-s-etc/idi-p/12662756)
- Community experts say XMP "cannot be seen as a full backup in case the catalog file is lost" — [Adobe Community (flags missing)](https://community.adobe.com/questions-675/flags-missing-when-importing-catalog-934680)
- **Sidecar vs embedded:** Adobe's wording: for proprietary camera RAW, "XMP isn't written into the original files… stored in a separate file called a sidecar file". For JPEG, TIFF, PSD and DNG, XMP is written into the file. The sidecar shares the image's basename with an `.xmp` extension. XMP for raws is "a subset of the information normally only contained in Lightroom's database" — [Lightroom Queen threads](https://www.lightroomqueen.com/community/threads/when-are-xmp-files-created-for-nef-files.19693/post-133289); [Adobe Community](https://community.adobe.com/t5/lightroom-classic-discussions/xmp-file-not-being-created-in-lightroom/m-p/12509312/highlight/true)
- Writing XMP is triggered either by Catalog Settings > Metadata > "Automatically write changes into XMP" or manually per selection with Ctrl/Cmd+S (Metadata > Save Metadata to File) — [Lightroom Queen](https://www.lightroomqueen.com/community/threads/when-are-xmp-files-created-for-nef-files.19693/post-133289)
- DNGs get embedded XMP, not a sidecar. If a raw has both an embedded XMP and a stray sidecar, LrC is reported to prefer the sidecar — [Lightroom Queen "jpegs and RAW"](https://www.lightroomqueen.com/community/threads/jpegs-and-raw-again.5611/post-41052)
- **lr namespace tags:** `HierarchicalSubject`, `PrivateRTKInfo` and `WeightedFlatSubject` — [ExifTool XMP Tag Names, Lightroom section](https://exiftool.org/TagNames/XMP.html#Lightroom)
- **Color labels:** LrC writes the label *name text* into `xmp:Label`, not a color code. The name is localized ("Rot" for German installs) and user-renamable. A darktable developer called xmp:Label "inherently broken" for this reason. Bridge CC 2018 wrote strings LrC couldn't read. The workaround is identical label names across apps — [pixls.us "Colour label in XMP"](https://discuss.pixls.us/t/colour-label-in-xmp/8067); [FastRawViewer](https://www.fastrawviewer.com/node/395); [Adobe Community Bridge thread](https://community.adobe.com/t5/bridge-discussions/labels-in-br-cc-2018-different-from-cs5-lr-classic-7-2/m-p/9668349/highlight/true)
- **Face regions:** LrC writes face rectangles and person names as MWG regions (`mwg-rs:Regions`) once metadata is saved to file. Adobe's x/y is the rectangle *center*, while Microsoft's is upper-left, and ExifTool ships a conversion config. Unnamed faces have rectangles without Name entries. A 2015 report says LrC did not read mwg-rs regions written by other software such as Picasa. On export, "Remove Person Info" strips `dc:subject`, `lr:weightedFlatSubject` and `Iptc4xmpExt:PersonInImage`, but since LrC 11.0 it leaves `mwg-rs:Regions` in place — [Adobe Community face-region thread](https://community.adobe.com/t5/lightroom-classic-discussions/face-image-region-data-written-according-to-xmp-mwg-rs-but-not-read-by-lr/m-p/13771103); [Adobe Community person info](https://community.adobe.com/t5/lightroom-classic-discussions/person-info-not-removed-during-export-since-11-0/m-p/13047771)
- Ratings and color labels are included in IPTC/XMP on export, but flags aren't — [Adobe Community (flags missing)](https://community.adobe.com/questions-675/flags-missing-when-importing-catalog-934680)

### Inferences
- Recommended DAM ingest strategy is two-tier: (1) read XMP or embedded metadata for anything the user may also edit elsewhere (rating, label, keywords, IPTC, crs, regions); (2) optionally enrich from a .lrcat copy for flags, collections, smart-collection definitions, stacks and virtual copies. Virtual copies have no file, so the DAM must model them as logical "versions" pointing to a master file.
- Label mapping must be configurable. Map LrC label *text* (per the user's LrC label set and language) to DAM color enums, and write back the same text.
- Write-back via XMP has a hazard. LrC doesn't watch XMP. If the DAM changes an XMP, LrC flags a metadata conflict, and the user must run "Read Metadata from Files", which *overwrites* catalog-only-newer changes for those fields. If LrC auto-write is on and LrC later saves, it can overwrite the DAM's XMP edits. Bidirectional XMP sync therefore needs a "last writer" policy and timestamps (`xmp:MetadataDate`).
- Keyword "Include on Export" flags, synonyms and person-keyword type live in the catalog's keyword table, not in XMP (only the flattened `dc:subject` and `lr:hierarchicalSubject` are written). This is based on general knowledge of the keyword dialog. I found no fetched source, so verify.

### Gaps
- No official Adobe HelpX page enumerating catalog-only fields was retrieved. The evidence is community-expert posts from 2011–2022, and nothing confirms whether LrC 14/15 changed anything (e.g., whether flags are written anywhere in recent versions).
- Whether the full develop *history* or snapshots appear in XMP (crs:History is partial) was not verified.
- Whether AI/masking data (LrC 12+ masks, Generative Remove) round-trips in XMP for raw sidecars was not verified.

---

## Q3. Root folders, absolute paths, NAS/local mapping, moved or missing files

### Takeaway
LrC stores each top-level folder's absolute path in `AgLibraryRootFolder.absolutePath`, with subfolders as `AgLibraryFolder.pathFromRoot`. When a volume path changes, the user (or a DAM working on a closed catalog copy) can fix it by changing just the root folder, which LrC does via "Update Folder Location". Windows UNC paths to a NAS are buggy in LrC, so mapped drive letters are recommended.

### Cited Findings
- Path model: `AgLibraryRootFolder.absolutePath` + `AgLibraryFolder.pathFromRoot` + `AgLibraryFile.baseName`.`extension` — [thany gist](https://gist.github.com/thany/1f7a2172129aa4aea258c2971610581a); [Lightroom Queen file-path thread](https://www.lightroomqueen.com/community/threads/semi-ot-question-re-file-path-on-windows.43010/post-1284962)
- lrcat-extractor models `RootFolder` as "mapped to an absolute path" and `Folder` as attached to a `RootFolder` — [docs.rs](https://docs.rs/lrcat-extractor/latest/lrcat/)
- In the SDK, `LrCatalog:getFolders()` returns root-level folders and `getFolderByPath()` / `findPhotoByPath()` look up by absolute path — [LrCatalog reference mirror](https://lrc.mcor.dev/modules/LrCatalog.html)
- **UNC vs drive letter (Windows):** since LrC 8.4 (Aug 2019), folders referenced by UNC (`\\server\share`) show wrong photo counts or "Invalid Path" errors, while the same NAS mapped to a drive letter works. One user blamed 12.2 for breaking NAS linkage and reverted to 12.1. A user on 14.3 (Apr 2025) said the problem persists. Community experts recommend mapping a drive letter and then right-clicking the root folder > **Update Folder Location**, which updates every subfolder — [Adobe Community UNC counts bug](https://community.adobe.com/bug-reports-674/p-missing-photo-counts-for-folders-with-unc-paths-663523/index2.html); [Adobe Community Invalid Path thread](https://community.adobe.com/t5/lightroom-classic-discussions/an-internal-error-has-occurred-invalid-path-error-while-finding-raw-folders-on-a-nas/td-p/13624232)

### Inferences
- **Don't move files behind LrC's back.** If the DAM moves files (e.g., to a NAS archive), LrC shows those folders and photos as missing ("?" badge) until the user does Find Missing Folder / Update Folder Location. The least-damaging patterns are:
  1. Move whole *root folders* only, preserving the subtree, then have the user run one "Update Folder Location" on the root. Alternatively, the DAM can offer an LrC plug-in that calls the SDK to relocate files. Note that the public LrCatalog API listed above has no folder-relocate method, so verify this is possible.
  2. Keep identical mount paths. On macOS, ensure the NAS always mounts at the same `/Volumes/<Share>` (avoid `/Volumes/Share-1` duplicates). On Windows, always use the same drive letter.
  3. When rewriting `absolutePath` offline in a catalog *copy*, follow the same convention LrC uses: trailing slash, forward slashes, and drive letter on Windows. The exact Windows format wasn't confirmed in sources. Then have the user open that copy. This is risky and should be offered only as an expert feature.
- For a DAM indexing the same files, store the files' content hash and LrC's `id_global` UUID (accessible via the SDK's `findPhotoByUuid`) so it can re-link after moves without depending on paths.
- Mixed local + NAS: LrC allows root folders on multiple volumes in one catalog. When the NAS is offline, those folders show as missing but metadata, previews and Smart Previews remain usable. A DAM should likewise treat a NAS-offline state as "unavailable", not "deleted".

### Gaps
- The exact on-disk format of `absolutePath` on Windows vs macOS (separator, trailing slash, UNC prefix) wasn't confirmed from a source.
- No source was found on how LrC handles the same NAS reached from macOS (`/Volumes/x`) and Windows (`X:\`) in a cross-platform catalog. The usual answer is to "Update Folder Location" after moving the catalog between OSes, but that is unverified.
- Whether any SDK call can relocate or rename a folder was not verified. The LrFolder class wasn't fetched.

---

## Q4. Lightroom Classic SDK (Lua plug-ins) as a live integration channel

### Takeaway
The LrC SDK (Lua; current public download is 14.3, with a 15.1 resource bundle reported in Dec 2025) is the only supported way to write into a catalog. A plug-in can find photos, read and write metadata, create keywords and collections (including smart ones), add photos, create virtual copies, build Smart Previews, and implement Export or Publish services that push to a DAM over HTTP. It runs only inside a running LrC, must use write-access gates, and has known subprocess quirks. Free distribution of unsigned `.lrplugin` folders via Plug-in Manager is normal.

### Cited Findings
- **LrCatalog methods (with first SDK version):** `findPhotos` (2.0), `getAllPhotos` (3.0), `findPhotoByPath` (2.0), `findPhotoByUuid` (2.0), `findPhotosWithProperty` (2.0, plug-in properties), `createKeyword` (3.0), `createCollection` / `createSmartCollection` / `createCollectionSet` (3.0), `addPhoto` (2.0; metadata and develop-preset UUID args added in LrC 12.5), `withWriteAccessDo` / `withPrivateWriteAccessDo` / `withProlongedWriteAccessDo` (2.0; timeoutParams 4.0), `getFolders` / `getFolderByPath` (3.0), `getKeywords` (3.0), `getActiveSources` (3.0), `createVirtualCopies` (5.0), `buildSmartPreviews` (5.0), `updateAISettings` (LrC 13.3), `deleteAllEmptyMasks` (LrC 14.0) — [LrCatalog API reference mirror](https://lrc.mcor.dev/modules/LrCatalog.html)
- Publish services: `publishService:createPublishedCollection(Set)(name, parent, canReturnExisting)` must be called inside a `catalog:with___WriteAccessDo` gate. Collection sets can't be re-parented in the same gate that created them. Creating a collection and then reading it in the same gate inside `processRenderedPhotos` throws "Can't get collection information after creating collection inside the same withWriteAccessDo function" — [LrPublishService mirror](https://lrc.mcor.dev/modules/LrPublishService.html); [LrCollectionSet mirror](https://lrc.mcor.dev/modules/LrCollectionSet.html); [Adobe Community 2015](https://community.adobe.com/t5/lightroom-classic-discussions/can-t-update-this-collection-in-processrenderedphotos/m-p/7359529); [akrabat "Creating collections with the LrC SDK"](https://akrabat.com/6128)
- Publish-service per-photo remote state: only remote ID and remote URL are built-in per-service-instance fields. Other per-instance state uses the SDK's "Remembering User Choices" key/value storage — [Adobe Community](https://community.adobe.com/t5/lightroom-classic-discussions/metadata-handling-with-several-publish-service-providers/m-p/12498164/highlight/true)
- **SDK versions:** SDK 14.0 was announced Oct 14 2024 (adds `LrCatalog:deleteAllEmptyMasks`; LrLogger logs moved to `…\Logs\LrClassicLogs`). The download is via Adobe Developer Console (Lightroom Classic > View Downloads). A June 2025 reply says the link pointed to a 14.3 file and was broken — [Adobe announcement](https://community.adobe.com/announcements-673/lightroom-classic-sdk-14-0-max-release-now-live-978916?lang=en)
- In Nov 2025 the Developer Console SDK was "still stuck at v14.3". John Ellis found one new function in LrC 15.0 (`LrApplication.addHapticObserver`, undocumented) and noted Adobe releases SDKs "sporadically". On Dec 16 2025 a user said they had downloaded "SDK 15.1 resources". No Adobe staff replied — [Adobe Community "No Lua SDK for LrC v15?"](https://community.adobe.com/t5/lightroom-classic-discussions/no-lua-sdk-for-lightroom-classic-v15/td-p/15607061)
- The SDK package contains `Manual/Lightroom Classic SDK Guide.pdf` (described as "very good, though dated") and `API Reference/index.htm` — [Adobe Community](https://community.adobe.com/t5/lightroom-classic-discussions/lua-sdk-for-lightwoom-classic/m-p/14171428)
- **Subprocesses and limitations:** Excire Search's plug-in uses `LrTasks.execute` to start a background process. After LrC 13.5, child processes segfaulted on some Intel Macs, and an August update addressed it. On LrC 14.5 Intel macOS, concurrent `LrTasks.execute` calls were serialized, so one plug-in could block another. Apple Silicon and Windows were unaffected — [Adobe Community bug](https://community.adobe.com/t5/lightroom-classic-bugs/p-plugin-crashes-when-a-plug-in-uses-lrtasks-execute/idi-p/14845263/page/2); [Adobe Community LrTasks blocked](https://community.adobe.com/t5/lightroom-classic-discussions/lrtasks-execute-is-blocked/m-p/15466674)
- In Dec 2025, LrC 15.1 had a background process that didn't exit after quit. The suggested isolation step was disabling third-party plug-ins — [Adobe Community](https://community.adobe.com/questions-675/lightroom-process-not-quitting-after-exit-lrc-15-1-1617628)
- **Distribution:** plug-ins are `.lrplugin` folders installed via File > Plug-in Manager > Add, or dropped into the Modules folder. Adobe "encourages users to create, distribute, and install Lightroom Classic plug-ins". Adobe Exchange can package plug-in ZIPs as ZXP, but the user must unzip and place the files by hand. A plug-in has as much system access as LrC itself — [Lightroom Killer Tips](https://lightroomkillertips.com/understanding-the-plug-in-manager/); [Jeffrey Friedl install guide](https://regex.info/blog/lightroom-goodies/plugin-installation); [Adobe developer blog on Exchange](https://blog.developer.adobe.com/lightroom-classic-plugin-support-for-the-adobe-exchange-for-creative-cloud-14e4a0f690df); [Adobe HelpX plug-ins](https://helpx.adobe.com/be_en/lightroom-classic/plug-ins.html)
- **Existing sync plug-ins:**
  - **bmachek/lrc-immich-plugin** publishes and exports LrC to Immich and also imports from Immich. v5.0.0 (pre-release) adds full catalog↔Immich sync, Immich smart search from inside LrC, and pulling metadata from Immich into the catalog. The author warns these are "heavy changes" — [newreleases v5.0.0-pre](https://newreleases.io/project/github/bmachek/lrc-immich-plugin/release/v5.0.0-pre); [v5.0.0-alpha](https://newreleases.io/project/github/bmachek/lrc-immich-plugin/release/v5.0.0-alpha)
  - **midzelis/mi.Immich.Publisher** publishes LrC collections to Immich albums — [Immich community projects](https://docs.immich.app/community-projects)

### Inferences
- **Recommended live-sync architecture:** the DAM runs a local HTTP server, and a companion LrC plug-in provides (a) a Publish Service, so the user drags photos or collections and LrC tracks published/modified state (edits trigger "Modified Photos to Re-Publish"); (b) a Library menu "Sync with DAM" that, inside `withWriteAccessDo` gates, pulls ratings, keywords and collections from the DAM via LrHttp and applies them with `photo:setRawMetadata` and `catalog:createKeyword` / `createCollection`; (c) custom plug-in metadata fields (via a metadata provider in Info.lua) to store the DAM asset ID per photo, queryable with `findPhotosWithProperty`. The lrc-immich-plugin v5 follows essentially this pattern and is a reference implementation.
- Constraints: the plug-in only runs while LrC is open, and there is no OS-level daemon. Background loops are possible via `LrTasks.startAsyncTask` with sleeps, but they are fragile, and writes need gates that can time out when the user is busy. Spawning helpers via `LrTasks.execute` has had platform-specific bugs (13.5, 14.5). Prefer LrHttp to an already-running DAM server over launching subprocesses.
- SDK version numbers lag app versions. Target the 14.x API surface and feature-detect anything newer.

### Gaps
- The official developer.adobe.com/lightroom-classic pages didn't render via fetch. Details on the LrHttp API (localhost allowed, TLS, timeouts), `LrTasks` threading, the Lua 5.1 runtime, and `metadataProvider` (custom fields; searchable/browsable flags; version-bump migrations) come from general knowledge only, not fetched sources.
- Not researched individually: Jeffrey Friedl's plug-ins (e.g., metadata viewer, Folder Watch), LR/Transporter, Any Source, Syncomatic, PhotoShelter, SmugMug, Mylio and Peakto integrations.
- Whether Adobe Exchange requires review or signing for LrC plug-ins today wasn't confirmed.

---

## Q5. Lightroom (cloud) Partner/Services API

### Takeaway
The Lightroom Services ("Partner") REST API reaches only *cloud* Lightroom catalogs, not LrC's local catalog except for collections the user syncs to cloud. It is limited to "entitled partner applications". Registration through the Adobe Developer Console is self-service, but entitlement is opaque and Adobe is seldom responsive. Each end user also needs a Lightroom cloud plan. For an open-source, self-hosted DAM it is at best an optional connector and not a dependable path.

### Cited Findings
- "Adobe Photoshop Lightroom stores user assets, their metadata, and media renditions in a cloud catalog". The APIs are "available only to entitled partner applications that have authenticated the customer". Partners must register an integration to obtain an API key, and authentication is OAuth 2.0 via Adobe IMS with both access token and API key on requests — [AdobeDocs/lightroom-partner-apis README](https://github.com/AdobeDocs/lightroom-partner-apis); [Lightroom API docs](https://developer.adobe.com/lightroom/lightroom-api-docs/)
- Setup: in Adobe Developer (I/O) Console, create a project, add API "Lightroom Services", and complete the OAuth form to get API key and client secret. Verify access with the `/v2/health` endpoint on lr.adobe.io. Extended refresh-token lifetime requires contacting Adobe — [Adobe docs via search](https://developer.adobe.com/lightroom/lightroom-api-docs/getting-started/authenticate_customers)
- Sept 2026 thread: a developer building an uploader to Lightroom cloud got a 403. A Community Expert suspected missing Lightroom Services entitlement, but the accepted resolution was that the developer's IP was blacklisted by Adobe. No Adobe staff replied — [Adobe Community "Lightroom API access" (Sep 2026)](https://community.adobe.com/questions-680/lightroom-api-access-1643014)
- A 2023 forum volunteer said they "haven't seen Adobe respond to queries about the cloud APIs in years". Trial users couldn't access Lightroom Services — [Adobe Community "I can't use the Lightroom API"](https://community.adobe.com/questions-675/i-can-t-use-the-lightroom-api-966929)
- Smart Collections can be synced from LrC to Adobe cloud via a third-party approach (odd.blog, Jan 2026) — [odd.blog](https://odd.blog/2026/01/)

### Inferences
- The API exists and is technically reachable by any developer, so open source is not excluded per se. However, the client secret can't be safely embedded in a distributed open-source app. Each self-hoster would have to register their own Developer Console integration, which may or may not be entitled. Treat it as "bring your own API key", experimental.
- It can't read LrC's local-only catalog data. The only LrC-to-cloud bridge is LrC's own "Sync" of selected collections (Smart Previews uploaded), so cloud-side data is a subset.

### Gaps
- The "create_integration" and getting-started pages returned 404 to the fetcher, so current wording on production quotas, user limits and partner review wasn't verified. No public "Lightroom partner program" application form was found.
- 2025–2026 deprecation or status announcements: none found.

---

## Q6. Previews (previews.lrdata) and Smart Previews: can a DAM reuse them?

### Takeaway
Standard previews (`<Catalog> Previews.lrdata`) are `.lrprev` files containing embedded JPEGs at multiple "levels", indexed by a `previews.db` SQLite DB and laid out by UUID prefix. Smart Previews are lossy linear DNGs about 2560 px on the long edge, stored in `<Catalog> Smart Previews.lrdata`. Both can be extracted with community tools, but they are undocumented, not intended for external use, and lack orientation (which is in the catalog). Use them as a fast-thumbnail or offline-NAS fallback only.

### Cited Findings
- `.lrprev` files contain JPEG data. A community Python tool extracts the largest embedded JPEG and maps it back to originals via the .lrcat (tested on LR 6.13). Other tools (DumpJPGs) exist — [lrprev-extract](https://github.com/ibips/lrprev-extract/blob/main/README.md); [Lightroom Queen](https://www.lightroomqueen.com/community/threads/recover-jpegs-from-previews-no-catalog.31930/)
- One plug-in developer found tools could only extract "level_5", while "level_6" and "level_7" data was also present. The .lrdata tree is organized by the first 4 characters of the UUID. Previews don't carry orientation, which is in the SQLite DB — [Adobe Community "accessing contents of lrprev files"](https://community.adobe.com/t5/lightroom-classic-discussions/accessing-contents-of-lrprev-files/m-p/13205114); [Lightroom Queen plugin-dev thread](https://www.lightroomqueen.com/community/threads/plugin-development-and-lrprev-files.32863/latest)
- Smart Previews: "lightweight, smaller, file format, based on the lossy DNG file format", stored in "[Catalog Name] Smart Previews.lrdata" next to the catalog. They let users edit when originals are offline. Adobe's example: 500 raws = 14 GB versus 400 MB of Smart Previews — [Adobe HelpX Smart Previews](https://helpx.adobe.com/lightroom-classic/desktop/viewing-photos/lightroom-smart-previews.html)
- Smart Previews contain a 2560-px linear-raw image plus a 256-px JPEG thumbnail. A community expert says they "aren't intended to be used outside of LR", and external viewers can show wrong colors and contrast — [Adobe Community](https://community.adobe.com/t5/lightroom-classic-discussions/issue-with-dng-file-display-on-iphone-after-exporting-smart-previews-from-lightroom-classic/m-p/15009263)
- LrC 14.5 (Aug 2025) added GPU-based preview generation, so preview internals may have changed recently — [LrC release notes](https://helpx.adobe.com/lightroom-classic/desktop/introduction-to-lightroom-classic/release-notes.html)

### Inferences
- Legality: extracting the user's own previews for their own use is reading the user's data. No source was found claiming a legal prohibition, but Adobe's EULA was not reviewed. The bigger risk is technical: the formats are undocumented and change across versions, so any parser should be optional and tolerant of failure.
- Practical use: when NAS originals are offline, the DAM could show Smart Preview DNGs, decoded with a DNG-capable library such as rawspeed or LibRaw. Linear DNG handling is needed. Or it could show lrprev JPEGs as thumbnails, with orientation taken from the catalog.

### Gaps
- The byte layout of `.lrprev` (header and level index) is undocumented in the sources found. The `previews.db` schema was not found.
- Adobe EULA language on reverse-engineering cache files was not reviewed.

---

## Q7. Practical photographer patterns and pain points

### Takeaway
The common setup is a local catalog with originals spread across local drives and a NAS, sometimes with one catalog per year. The pain points relevant to a DAM: Windows UNC-path bugs (use mapped drive letters), folders showing missing when the NAS is offline (Smart Previews mitigate), flags and collections not surviving migrations, and color-label text mismatches.

### Cited Findings
- NAS via UNC paths is broken in various ways from LrC 8.4 through at least 14.3. Mapped drive letters are the standard workaround — [Adobe Community](https://community.adobe.com/t5/lightroom-classic-discussions/an-internal-error-has-occurred-invalid-path-error-while-finding-raw-folders-on-a-nas/td-p/13624232)
- Users moving catalogs or computers report lost flags — [Adobe Community "flags missing"](https://community.adobe.com/questions-675/flags-missing-when-importing-catalog-934680)
- A digiKam migration of about 88k items worked through XMP, but collections were lost unless first converted to hierarchical keywords — [discuss.kde.org](https://discuss.kde.org/t/problems-migrating-from-lightroom-6-to-digikam/38213)
- Smart Previews let editing continue while originals (e.g., on NAS or an external drive) are disconnected — [Adobe HelpX](https://helpx.adobe.com/lightroom-classic/desktop/viewing-photos/lightroom-smart-previews.html)
- Label-name mismatches across LrC, Bridge, Capture One, FastRawViewer and darktable are a recurring complaint — [FastRawViewer](https://www.fastrawviewer.com/node/395)

### Inferences
- "One catalog per year": a DAM importer should support multiple .lrcat sources, de-duplicating by file path and hash, and record which catalog each asset came from. Root folders on the same NAS will appear in several catalogs.
- A DAM that "sits alongside" LrC with zero risk can do so by (1) indexing the same folders read-only, (2) reading XMP, (3) periodically reading a *copy* of the closed .lrcat for catalog-only data, and (4) never writing to the catalog or moving files without going through the LrC plug-in or a user-run "Update Folder Location".

### Gaps
- Lightroom Queen articles (Victoria Bampton) on multi-catalog and NAS workflows and Reddit pain-point threads were not fetched directly. The evidence here comes mainly from Adobe Community threads.
- No quantitative data was found on how common "catalog per year" or NAS setups are.

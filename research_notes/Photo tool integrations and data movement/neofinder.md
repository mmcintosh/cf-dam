# NeoFinder (formerly CDFinder): what it does, its data formats and automation, and how an open-source photo DAM could integrate with it

Research date: 2026-10-16. Most findings come from the vendor's own site, the online manual at cdfinder.de/guide and its release notes. I found almost no independent community discussion; see the gaps under "How photographers use it". Some vendor manual pages are clearly old (for example, the Lightroom page names Lightroom 5), and those are flagged where they come up.

## 1. What NeoFinder is today: version, platforms, licensing, development activity

### Takeaway
NeoFinder is a perpetual-licence macOS disk and media cataloger under active development. Version 9.0 shipped in October 2025 and version 9.3.1 on 29 September 2026, certified for macOS 27. There is no "NeoFinder for Windows": the Windows side is a separate product, abeMeda (by Andy Becherer), which uses the same catalog file format. A companion iOS app is a viewer and search tool only.

### Cited Findings
- The current version on the homepage is 9.3.1, "certified for macOS 27 Golden Gate". It needs macOS 10.15 Catalina or later and runs on Apple Silicon and Intel — [cdfinder.de](https://www.cdfinder.de/)
- Release timeline from the release notes — [Release notes](https://cdfinder.de/versions.html):
  - 8.9.1, 23 July 2025: the last 8.x release (faster RAW cataloging, FCPX keywords).
  - 9.0, 14 October 2025:
    - new cataloging engine;
    - native RED .r3d and Nikon NEV support;
    - writes XMP directly into ARW, ORF and RW2 files instead of sidecars;
    - Image Capture import from connected cameras;
    - certified for macOS 26 Tahoe.
  - 9.1, 5 December 2025: 30-year anniversary release.
    - catalogs VisionaryAI Tagger captions, transcriptions and tags;
    - XiNET WebNative DAM metadata;
    - Hasselblad X2D II 3FR support.
  - 9.2, 2 March 2026:
    - imports WinCatalog .w3cat databases and Adobe metadata presets;
    - catalogs TAR and TGZ archives;
    - "improves detection of moved or renamed catalog folders";
    - handles volumes that disappear mid-update more safely.
  - 9.2.1, 30 March 2026:
    - imports ProMax LTO XML;
    - adds the Find Editor operators "==", "!=" and "!!" for EXIF, ID3 and XMP;
    - can invert scanned colour-negative thumbnails.
  - 9.3, 31 August 2026:
    - Find Similar Photos;
    - whole-folder ingest that copies, renames and catalogs;
    - XMP Copyright URL, Digital Source and Data Mining fields;
    - XMP presets;
    - "about 25% faster" photo cataloging;
    - Hasselblad Photos v4 "Approval" values shown as colour labels.
  - 9.3.1, 29 September 2026:
    - certified for macOS 27;
    - workaround for a macOS 15.8 bug that broke RAW cataloging;
    - fixes XMP sidecar cataloging for Pixelmator Pro;
    - the last version to support macOS 10.15.
- The news page says "NeoFinder v9 is a paid upgrade for NeoFinder v8, NeoFinder v7, NeoFinder v6, and CDFinder customers." The 9.3 notes say NeoFinder "is proudly developed by a human being" and that no AI was used to write the code — [NeoFinder News](https://cdfinder.de/news.html)
- Licensing — [NeoFinder Store](https://www.cdfinder.de/store.html):
  - The licence is perpetual, not a subscription: "you can continue using it with the appropriate major version … for as long as you like."
  - A Private licence covers up to three personal Macs.
  - Business licences come in 2, 3, 5, 10, 20 and 50 users, plus a Site licence.
  - A cross-grade from listed competing products costs 25 USD.
  - Prices are in US dollars, but the store page did not show current figures when fetched.
- The Private licence includes "most features". The Business licence adds sharing the database folder on a file server — [License Types](https://cdfinder.de/guide/2/2.11/license_kinds.html) (seen via a search summary)
- The free trial is said to be identical to the paid version but limited to 10 catalogs — [Download page](https://cdfinder.de/download.html). That download page still listed 8.6 as current when indexed, so it is stale. A search summary says Wikipedia describes a 25-disk demo limit, which conflicts; I could not fetch Wikipedia to check.
- Old prices, for history only: in 2017, NeoFinder 7 upgrades started at $22.47 and new Private licences at $34.30 — [MacTech 2017](https://www.mactech.com/2017/12/19/norbert-m-doerner-releases-neofinder-7-2-for-the-mac)
- Windows: abeMeda is at version 7.8.7, released 25 November 2025.
  - It runs on Windows 2000 through Windows 11.
  - It was formerly called "CDWinder".
  - Its site calls NeoFinder the recommended Mac option.
  - abeMeda catalogs can be opened on iOS with "NeoFinder to Go".
  - Source: [abeMeda](https://www.abemeda.com/)
- NeoFinder and abeMeda "use the exact same file format", so catalog files are interchangeable and mixed-platform networks can share one database folder — [Transfer catalogs Mac↔Windows](https://www.cdfinder.de/guide/2/2.10/across_platforms.html)
- The iOS app — [NeoFinder for iOS guide](https://cdfinder.de/guide/12/neofinder_ios.html); [NeoFinder News](https://cdfinder.de/news.html):
  - It searches and browses catalogs and shows previews and EXIF, IPTC, XMP and ID3 data.
  - It has a GeoFinder map and barcode scanning of catalogs.
  - Catalogs get onto the device via Finder or Files, AirDrop, Dropbox or iCloud.
  - Files must have the suffix .neofinder, .neofinder7, .cdw or .abemeda7.
  - iOS 3.0 shipped on 9 September 2025 and iOS 3.1 on 26 May 2026 (adds downloading catalogs from Dropbox and other providers).
- The iOS price is listed at €6.99 by a third-party site — [iPhoneAddict](https://iphoneaddict.fr/apps/productivite/neofinder.html). I did not check this against the App Store.

### Inferences
- Development is steady, roughly every one to two months, from a very small team (essentially one person). The DAM should expect frequent format-adjacent changes but no public API roadmap.
- Licensing is perpetual and paid per major version, so users may stay on older major versions for a long time. An integration should not depend on the newest features.
- The Windows path is abeMeda, a separate vendor that shares the catalog format, not a port of NeoFinder.

### Gaps
- I could not find current USD prices for NeoFinder 9 Private or Business licences, upgrades, or abeMeda; the store tables were empty when fetched.
- The developer's company name ("Wfs GmbH" in the brief) did not appear in anything I read. The App Store lists the publisher as "Norbert Doerner".
- I could not read Wikipedia's history (founding year, rename date) because the fetch was blocked. The 9.1 release notes ("30-year anniversary", December 2025) suggest CDFinder dates from about 1995.

## 2. How it catalogs: volumes, thumbnails, metadata, Lightroom, duplicates, NAS and team catalogs

### Takeaway
NeoFinder stores one catalog file per cataloged volume or folder. A catalog holds the file and folder tree, thumbnails, and EXIF, IPTC, XMP, ID3 and GPS metadata. Optional extras are MD5 "FileCheck" checksums and local Apple-Vision analysis (finding faces, but not recognising who they are; AutoTags; OCR).

It can catalog external drives, NAS and server shares, optical discs, LTO tapes, and TAR/TGZ archives. It edits XMP itself, but it does not read Lightroom's .lrcat database: Lightroom metadata reaches it only through XMP that Lightroom has written to the files. Sharing among a team is simply a shared database folder on a NAS, with no server software and no file locking.

### Cited Findings
- It catalogs internal and external disks, server volumes, LTO volumes, Blu-rays, DVDs and audio CDs. It integrates with LTO tools and imports Yoyotta and storageDNA LTO reports — [cdfinder.de](https://www.cdfinder.de/); [search summary of vendor and callapple pages](https://www.callapple.org/?p=19096)
- It reads EXIF, IPTC, XMP and ID3 "out of these files".
  - You can choose the thumbnail size.
  - "Generate FileCheck (slow)" makes a checksum for every file, which "Verify FileCheck" later checks for changed contents.
  - Reading Finder comments and Finder tags can be "quite slow" on SMB, ExFAT or NTFS volumes, so the manual suggests turning them off.
  - Source: [Cataloging Preferences](https://cdfinder.de/guide/3/3.3/cataloging_settings.html)
- Metadata fields — [XMP/EXIF/IPTC guide](https://cdfinder.de/guide/17/17.2/neofinder_xmp.html):
  - EXIF: camera, lens, exposure, ISO, flash, orientation, and GPS geotags.
  - IPTC: description, capture date, photographer, location, keywords. 9.3 adds the Digital Source and Data Mining fields.
  - XMP: Creator, Copyright, Subject (hierarchical keywords), Headline, location fields, GPS and Persons. The XMP Event field maps to a custom "Event" annotation.
  - It reads and edits XMP inside movie files too.
  - It has a built-in XMP Editor.
- Since 9.0 it writes XMP directly into ARW, ORF and RW2 RAW files instead of using sidecars. 9.3.1 fixed XMP sidecar cataloging for Pixelmator Pro, which shows it also reads sidecars — [Release notes](https://cdfinder.de/versions.html)
- Its XMP editor uses the "standard Adobe XMP format" for ratings, keywords, descriptions and people — [cdfinder.de](https://www.cdfinder.de/)
- Image analysis — [Image Analysis guide via search summary](https://cdfinder.de/guide/30/30.5/image_analysis.html); [Find Faces](https://www.cdfinder.de/guide/5/5.9/find_faces.html):
  - It uses Apple's Vision framework (macOS 10.15 or later) for three tasks: Find Faces, AutoTags (stored in a separate field), and OCR text (stored in the Contents field).
  - It runs on the stored thumbnails, so thumbnails under 640 px give poor results.
  - Everything runs locally.
  - Find Faces "is NOT facial recognition" and cannot identify people.
- 9.3 added "Find Similar Photos" based on the photo's subject — [NeoFinder News](https://cdfinder.de/news.html)
- Lightroom (this manual page is old; it only names "Lightroom 5") — [Catalog Lightroom/Aperture/Photos](https://www.cdfinder.de/guide/3/3.14/catalog_lightroom.html):
  - To catalog Lightroom you catalog the Lightroom folder or its Previews.lrdata bundle, which means turning off "ignore package contents". Otherwise you catalog the original folders.
  - For metadata, the manual tells users to enable Lightroom's option to automatically write changes into XMP "so that NeoFinder can see and catalog your metadata".
  - There is no mention of parsing .lrcat.
  - Photos.app libraries are cataloged as bundles, with a "Find all Photos" command.
- The photographer-workflow page recommends — [Photographer Workflows](https://cdfinder.de/guide/17/17.6/photography_workflow.html):
  - year folders, shoot folders whose names start with the date, and a "Diverse" folder;
  - one catalog per project folder, grouped into year catalog folders in NeoFinder, cataloged in parallel;
  - updating only the project folders that changed ("don't need to Update an entire huge disk");
  - the Light Table for culling, the Multi Renamer, XMP presets, copying GPS from a phone photo to other photos, FileCheck against bit rot, two backups (one off-site), PDF contact sheets and HTML web galleries.
- Find Duplicates — [Find Duplicates](https://cdfinder.de/guide/5/5.3/find_duplicates.html):
  - It works across all catalogs, catalogs with a given label, or a manual selection.
  - Files can match by name (optionally ignoring the suffix, so IMG_1234.NEF matches IMG_1234.JPG; since 8.4), by FileCheck MD5, or by ISRC for songs.
  - Optional filters require matching size, creation date or modification date, and can limit by file type or minimum size.
  - A "Find Unique Files" mode lists files that exist only once, and there is a duplicate-folder mode.
  - Results can be saved as an Album.
- NAS and team setup — [Multi-user install with File Server/NAS](https://www.cdfinder.de/guide/2/2.2/neofinder_server.html):
  - Any folder on a NAS or file server can be the database folder; no server software is needed.
  - There is one database file per cataloged volume or folder.
  - The manual warns that two copies changing the same catalog at nearly the same time may give "unexpected" results, and recommends that a few admins have write access and everyone else read-only.
  - "Keep looking for changes" picks up new or changed catalogs automatically.
  - Sharing on a server needs a Business licence, while a Private licence can still catalog NAS data.
- AutoMount: when cataloging a server volume, NeoFinder stores extra information so it can mount the share again when needed, for example for "Reveal in Finder" — [AutoMount](https://www.cdfinder.de/guide/3/3.8/automount.html)
- Spotlight: NeoFinder can search Spotlight during its own Find, but Spotlight cannot search NeoFinder catalogs — [FAQ](https://cdfinder.de/guide/25/faq.html)

### Inferences
- For a Lightroom Classic user, NeoFinder only sees Lightroom's ratings, keywords and labels if "Automatically write changes into XMP" is on. A DAM that writes XMP sidecars or embedded XMP to the same standard will show up in NeoFinder automatically on the next catalog update. This is the lowest-effort way to coexist.
- Since 9.0, NeoFinder writes XMP into ARW, ORF and RW2 files by default instead of sidecars. A DAM that reads only sidecars for those formats will miss edits made in NeoFinder, so it should read embedded XMP for those formats.
- Face handling in NeoFinder is detection only. A DAM with real face recognition would not have to reconcile identities with it, apart from the XMP Persons field.

### Gaps
- No current manual page covers Lightroom Classic (versions after Lightroom 5) or reading .lrcat. I found nothing showing NeoFinder parses .lrcat.
- Nothing I found documents Photo Mechanic or Capture One interop beyond the shared XMP standard. The release-notes summary said they appear only in older notes, which I did not read.
- Not documented: cataloging speed over SMB, or whether thumbnails live inside the catalog file or alongside it.
- NeoFinder's own volume-identity method (UUID, name or creation date) is not documented; see section 6.

## 3. Data format: catalog files, the database folder, export and import

### Takeaway
Catalogs are proprietary binary files, one per volume or folder, named after that volume or folder. The extension is .neofinder7 (the "Extended" format, the default since v8), with older .neofinder and abeMeda .cdw and .abemeda7 files. They all sit in a "NeoFinder Database" folder. I found no public specification and no reverse-engineered parser.

Supported ways to get data out are tab-delimited text, indented text, XML (Business licence only), HTML web galleries and Hedge Canister. NeoFinder imports catalogs from a long list of legacy catalogers and DAMs.

### Cited Findings
- The default database folder is `~/Library/Application Support/NeoFinder/NeoFinder Database/`. It can be moved anywhere, there can be several, and you can switch between them (an AppleScript can do this) — [FAQ](https://cdfinder.de/guide/25/faq.html); [Backup](https://www.cdfinder.de/guide/4/4.5/neofinder_backup.html)
- There is "a separate database file for each disk or folder you catalog". The file name is the volume or folder name, with the extension .neofinder or .neofinder7 (NeoFinder) or .cdw or .abemeda7 (abeMeda) — [Backup](https://www.cdfinder.de/guide/4/4.5/neofinder_backup.html)
- The Extended format has been automatic since v8 and uses the suffix .neofinder7 — [Cataloging Preferences](https://cdfinder.de/guide/3/3.3/cataloging_settings.html). NeoFinder 7 introduced it to remove a 4 GB limit per catalog file — [search summary of vendor guide](https://www.cdfinder.de/guide/3/3.3/cataloging_settings.html)
- Each catalog can hold "up to 4,000,000,000 files and folders". Large users have about 23,000 catalog files — [FAQ](https://cdfinder.de/guide/25/faq.html)
- The FAQ says not to move catalogs with Export or Import: copy the catalog files into the database folder instead — [FAQ](https://cdfinder.de/guide/25/faq.html); [Import](https://www.cdfinder.de/guide/3/3.6/import.html)
- Export options — [Export catalogs](https://www.cdfinder.de/guide/10/export_catalogs.html):
  - "Text with Tab, for importing the data into databases or Excel".
  - Indented Text, which keeps the folder hierarchy.
  - XML (Business licence only).
  - Hedge Canister (LTO, 8.4 or later).
  - HTML Web Galleries, documented separately.
  - Settings: how many levels to include, date format, column headers, and which fields to include (Name is always included).
  - Found-item results and several catalogs can go into one file.
- Import sources — [Import](https://www.cdfinder.de/guide/3/3.6/import.html):
  - iView MediaPro, Microsoft Expression Media and Phase One MediaPro XML.
  - Extensis Portfolio ("Export Field Values…" text, plus optionally the _previews folder).
  - Canto Cumulus (CRE files).
  - DiskCatalogMaker tab-delimited text (with the Path column visible).
  - WinCatalog .w3cat; WhereIsIt XML; SuperCat .idx; Advanced Disk Catalog and Broken Cross XML.
  - DiskTracker, Disk Wizard, CatFinder, Catalogue, Neometric, DiskLibrary, MacMagna FileFinder, Delicious Library PLIST.
  - LTO and archive formats: LTFS schema XML, BRU and ArGest .txt and .gz, Yoyotta CSV, storageDNA CSV, PreRoll Post CSV (Full Path, File Name, File Size, Creation Date, Modification Date, Is Directory), ProMax and Cache-A XML, Hedge Canister.
  - Imported catalogs should be updated once in NeoFinder to collect richer metadata.
- No public spec or parser for .neofinder7 turned up. Export to text or XML is the practical route — [search, no spec found; vendor Text Files chapter](https://cdfinder.de/guide/21/neofinder_and_text.html)
- A GitHub organisation called "NeoFinder-Mac" exists, but its content reads as SEO or auto-generated marketing and is not an official or reverse-engineering source — [github.com/NeoFinder-Mac](https://github.com/NeoFinder-Mac) (judged from the search summary)

### Inferences
- Importing into a DAM:
  - Direct parsing of .neofinder7 means reverse-engineering an undocumented binary format that may change between versions. That is risky and possibly against the licence; I did not check the licence terms.
  - The robust routes are tab-delimited export (any licence), XML export (Business), or AppleScript (see section 4).
  - The PreRoll Post CSV import is a simple documented schema of path, name, size, dates and is-directory. A DAM could emit it to push a file inventory into NeoFinder without writing a native catalog. The catch is that NeoFinder must then "update" the catalog against the live volume to get thumbnails and metadata.
  - The LTFS XML and Hedge Canister import formats are other documented inventory formats NeoFinder accepts.
- Exporting from a DAM to NeoFinder: there is no documented way to write native catalogs. The realistic options are:
  - (a) write metadata into the files as XMP and let NeoFinder re-catalog;
  - (b) produce one of the importable inventory formats above;
  - (c) drive NeoFinder over AppleScript to catalog or update paths the DAM has just written.

### Gaps
- Not documented:
  - the internal structure of .neofinder7 (SQLite or custom binary);
  - whether thumbnails are embedded in the catalog file;
  - the XML export schema.
- The full field list for text export is not given on the export page.

## 4. Automation: AppleScript, command line, URL schemes, API

### Takeaway
AppleScript is the only documented automation surface, but it is a capable one (the dictionary was "massively expanded" in 8.3):
- a `catalog` command catalogs or updates any folder or volume path;
- `find` and `run query` (an XML query) search across catalogs;
- the object model exposes catalogs, albums and catalog items with path, size, dates, FileCheck, and EXIF, XMP, GPS and ID3 properties, most of which can be read and written.

I found no documented CLI, URL scheme, REST API or plugin SDK. Automation is macOS-only and needs the GUI app.

### Cited Findings
- The manual says AppleScript can control NeoFinder and retrieve data from it. The FileMaker Pro integration is built on AppleScript. On macOS 10.14 and later, the user must allow automation in Apple's AppleScript permission dialogs — [AppleScript chapter](https://www.cdfinder.de/guide/9/neofinder-applescript.html)
- Dictionary classes — [AppleScript dictionary](https://www.cdfinder.de/guide/9/9.1/neofinder-as-dictionary.html):
  - `application`, with properties: `database folder path`, `catalog amount`, `album amount`, `found items amount`, `searching`, `cataloging`, `version`.
  - `Catalogue`, with properties: `id`, `name`, `file number`, `folder number`, `size`, `Creation Date`, `Modification Date`, `comment`.
  - `Album`.
  - `Catalog Item`, with properties:
    - `id`, `name`, `size`, dates, `comment`, `tags`, `label index`, `kind`, `FileCheck`, `text content`;
    - `complete path` (colon-delimited) and `finder path` (POSIX; empty when the item is offline);
    - `media width`, `media height`, `media duration`;
    - many `xmp …`, `exif …`, `GPS …` and `ID3 …` properties, for example `xmp Caption`, `xmp Keywords`, `xmp Rating`.
  - `Annotation`.
  - `found item` and `selected item`.
- Dictionary commands, from the same page:
  - `find` (text search across catalogs, takes a `catalogs` list);
  - `run query` (a custom query given as an XML string);
  - `catalog`, with options `eject afterwards`, `canUpdate`, `canDuplicate` and `canQuit`.
- Caveats on the dictionary, from the same page:
  - Most XMP properties can be both read and written.
  - Changing an item's `name` renames the real file on disk.
- Cataloging example — [Cataloging via AppleScript](https://www.cdfinder.de/guide/9/9.5/cataloging_applescript.html):
  ```applescript
  tell application "NeoFinder"
      with timeout of 20000 seconds
          catalog "/Volumes/Daten/" with canUpdate
      end timeout
  end tell
  ```
  - The command uses the current Cataloging Preferences.
  - Without `canUpdate`, updating an existing catalog returns error -128.
  - The path can be a whole volume or a single folder.
- Other AppleScript manual sections: the Scripts menu and folder, "Find by AppleScript", changing preferences, using the selection, and "Power Examples" — [AppleScript chapter](https://www.cdfinder.de/guide/9/neofinder-applescript.html)

### Inferences
- A DAM on macOS can trigger cataloging after it moves data, for example `osascript -e 'tell application "NeoFinder" to catalog "/Volumes/Archive07/2024/" with canUpdate'`. It can read results by iterating catalogs and items, or by running `find` or `run query`, though this is slow for large catalogs. For bulk reads, tab-delimited or XML export (export may itself be scriptable; not confirmed) is likely faster.
- Because `finder path` is empty for offline items, a script can enumerate the contents of unplugged drives (name, size, FileCheck MD5, XMP) to reconcile against the DAM's database. That makes NeoFinder a usable source of "what is on archive drive X" even when the drive is not attached.
- On Linux or a NAS, there is no supported automation; NeoFinder needs a Mac. A cross-platform DAM would have to treat NeoFinder as a macOS-side companion.

### Gaps
- Not confirmed: whether export is available through AppleScript.
- No CLI, URL scheme, headless mode or scheduler appears in the manual sections I read.
- I did not read the full dictionary text or the "Power Examples" page.

## 5. How photographers use it with NAS and archives: workflows, strengths, pain points

### Takeaway
The vendor positions NeoFinder as the way to search and preview unplugged archive drives, optical discs and LTO tapes, with Lightroom remaining the editing catalog. Almost all the evidence is vendor material. I could not find independent Reddit, DPReview, Fred Miranda or Lightroom Queen threads on NeoFinder with Lightroom.

### Cited Findings
- The vendor's photographer workflow is one catalog per project or shoot folder inside year folders, updated incrementally, with XMP edits, FileCheck against bit rot, and two backups — [Photographer Workflows](https://cdfinder.de/guide/17/17.6/photography_workflow.html)
- The main value, in a reviewer quote on the vendor site: you can catalog archive drives and view them when the drive is "off-line or disconnected" — [Reviews page via search summary](https://cdfinder.de/reviews.html)
- A 2018 Adobe Community thread mentioned NeoFinder for cataloging drives and importing iView catalogs. Another reply said photographers are usually better served by Lightroom Classic for cataloging — [Adobe Community](https://community.adobe.com/t5/illustrator-discussions/offline-asset-catalog-software/m-p/10071324)
- A user blog (2016) names the pain points: catalogs must be updated whenever drive contents change, and the first scan of a large disk is slow — [Chris Shaw](https://www.chrisshawmix.com/news/2016/4/4/disk-cataloging-find-files-on-any-drive) (old)
- The vendor's own docs point to further pain points:
  - simultaneous writes to a shared catalog can give "unexpected" results — [NAS setup](https://www.cdfinder.de/guide/2/2.2/neofinder_server.html);
  - SMB volumes catalog slowly when reading Finder tags and comments — [Cataloging Preferences](https://cdfinder.de/guide/3/3.3/cataloging_settings.html);
  - moving data requires a manual "Reconnect Catalog…" — [Reconnect](https://www.cdfinder.de/guide/4/4.14/reconnect.html);
  - 9.2 needed fixes for moved or renamed catalog folders and for volumes that disappear mid-update — [Release notes](https://cdfinder.de/versions.html).
- A 2026 Adobe feature request asks Lightroom for iPad to work offline from an external SSD. This shows photographers still want offline and external-drive browsing that Adobe does not provide — [Adobe feature request](https://community.adobe.com/feature-requests-681/add-a-fully-offline-local-workflow-to-lightroom-for-ipad-allowing-photographers-to-browse-cull-rate-and-edit-raw-files-directly-from-an-external-ssd-without-importing-them-to-creative-cloud-1644230)

### Inferences
- The likely real-world pattern: Lightroom Classic manages active work, with XMP writing on; NeoFinder holds a catalog for every archive drive, NAS share and optical or LTO volume. Photographers search NeoFinder to find which drive holds a shoot, then plug that drive in. A DAM that already covers active and NAS assets could take over the "where is it" role, or feed NeoFinder by triggering re-catalogs.

### Gaps
- I found no independent forum or Reddit threads (Lightroom Queen, DPReview, Fred Miranda, r/photography) about NeoFinder with Lightroom or NAS. Searches returned only vendor pages. This is a real evidence gap, not a sign that nobody discusses it.

## 6. Comparable offline volume catalog tools, and lessons for DAM design

### Takeaway
Photo Mechanic Plus is the closest photo-focused comparison. It keeps catalog previews and metadata for offline volumes and separates "offline" (the volume is not mounted) from "missing" (the path has changed). Two lessons for a DAM that moves assets between NAS and other storage:
- identify volumes by a stable ID rather than by mount path, and keep previews and metadata so offline assets stay browsable;
- treat relinking or remapping as a primary operation, and keep checksums so moved or duplicated copies can be matched.

### Cited Findings
- Photo Mechanic Plus — [Camera Bits: Offline or Missing Media](https://docs.camerabits.com/support/solutions/articles/48001162818); [Moving a Catalog](https://docs.camerabits.com/en/support/solutions/articles/48001168255):
  - "Offline" means the originals are on a volume that is "currently not mounted". Those items get a yellow indicator, and previews and metadata stay visible because previews are stored next to the catalog database.
  - Metadata changes to offline media cannot sync until the media is available again.
  - "Missing" means the files are no longer at the last known folder path, usually after being moved or renamed outside the app.
  - Moving a catalog without "Forget" makes all files appear offline. "Locate Existing Catalogs" fixes it.
  - There is no built-in backup.
- DiskCatalogMaker, WinCatalog, WhereIsIt, Extensis Portfolio and Cumulus all have documented import paths into NeoFinder, so NeoFinder is effectively a hub for legacy catalogs. WinCatalog .w3cat import was added in 9.2 — [Import](https://www.cdfinder.de/guide/3/3.6/import.html); [Release notes](https://cdfinder.de/versions.html)
- NeoFinder links catalogs to data through "Reconnect Catalog…": "NeoFinder always needs to know the exact location of the cataloged data". If contents changed, you use Update Catalog instead — [Reconnect](https://www.cdfinder.de/guide/4/4.14/reconnect.html)
- AutoMount stores share information so NeoFinder can remount server volumes — [AutoMount](https://www.cdfinder.de/guide/3/3.8/automount.html)
- FileCheck (MD5) gives duplicate matching by content across catalogs, including offline ones, plus a "unique files" list that shows what exists in only one place — [Find Duplicates](https://cdfinder.de/guide/5/5.3/find_duplicates.html)

### Inferences (DAM design lessons)
- **Volume identity.** Store a volume record with:
  - a stable identifier (filesystem UUID for local disks; server, share and export ID for NAS shares);
  - a user-facing label and the last mount point;
  - each asset's path relative to the volume root.

  Resolve absolute paths at runtime. This avoids NeoFinder's and Photo Mechanic's manual "reconnect" or "locate" step when a drive mounts somewhere else, and it handles renamed volumes. NeoFinder ties catalogs to names and locations (the file is named after the volume, and reconnect is manual), which suggests its identity model is weaker; its exact method is undocumented.
- **States.** Track online, offline (volume known but not mounted) and missing (volume mounted but path gone) as separate states, as Photo Mechanic Plus does. Queue metadata writes for offline assets and apply them when the volume reappears.
- **Keep previews and metadata.** Keep thumbnails and previews at 640 px or larger, plus the full metadata, for offline browsing. NeoFinder's own image analysis needs at least 640 px to be useful.
- **Content hashes.** Compute a hash per asset (MD5 for NeoFinder FileCheck compatibility, or a stronger hash plus MD5). This allows:
  - matching moved copies when data goes from NAS to archive;
  - verifying copies;
  - offering "unique files" reports, so the user can see what has only one copy before deleting from the NAS.
- **Path remapping.** Offer bulk path-prefix remapping at volume and folder level. Also emit hooks after moves: on macOS, call NeoFinder's AppleScript `catalog <path> with canUpdate` on the destination folder, and on the source if it still exists, so NeoFinder catalogs stay current.
- **Granularity.** NeoFinder recommends per-project folder catalogs for fast incremental updates. A DAM that moves a shoot folder should re-catalog only that folder.
- **Coexistence contract.** Use standard XMP as the shared metadata layer, written embedded or in sidecars in the same way Lightroom and NeoFinder do (Subject and hierarchical keywords, Rating, Label, Persons, GPS). Watch for NeoFinder 9 writing XMP into ARW, ORF and RW2 directly.

### Gaps
- I did not research these in any depth: DiskCatalogMaker's own volume model, WinCatalog's, Extensis Portfolio's current offline-volume handling, or FotoWare FotoStation.
- How NeoFinder recognises a re-mounted volume (volume UUID, name or creation date) is not in any page I read. The 9.2 note about "improved detection of moved or renamed catalog folders" refers to catalog folders, not volumes.

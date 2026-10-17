# PhotoShelter Integration for an Open-Source Photo DAM

Research date: 2026-10-16/17. Main primary source: the PhotoShelter API v4 OpenAPI 3.0.2 spec at https://engineering.photoshelter.com/psapi-v4-doc/photoshelter.json. The server reported it `last-modified: Fri, 24 Jul 2026`, so it is current, though parts of it contain 2019–2023 example dates. PhotoShelter's support center (support.photoshelter.com) sits behind a Cloudflare JS challenge, so neither WebFetch nor curl could read it. Support-article details below come from search-engine snippets of those pages and are marked as such.

## 1. Product lines, plans, pricing, ownership (2025–2026)

### Takeaway
PhotoShelter Inc. still sells two product lines. **PhotoShelter for Photographers** is a single-user website, storage, delivery and sales product with three plans: Basic $10/mo (4GB), Standard $25/mo (100GB) and Pro $45/mo (500GB), billed annually. **PhotoShelter for Brands** is the team DAM and was called "Libris by PhotoShelter" before a June 2020 rebrand. Libris no longer exists as a separate product. PhotoShelter bought Socialie in 2023 with backing from its majority investor, Clearhaven Partners. I found no evidence of a Mediagraph acquisition. Mediagraph is a competitor that some customers have moved to.

### Cited Findings
- The official photographer plans page (www.photoshelter.com/signup redirects to go.photoshelter.com/photographers/) lists: **Basic $10/mo billed annually at $120, 4GB storage; Standard $25/mo billed annually at $300, 100GB; Pro $45/mo billed annually at $540, 500GB.** Each plan has 1 user, 9 responsive templates, a custom domain, unlimited public/password-protected/private galleries, mandatory 2FA, mobile apps, and sales of prints, products, downloads and licenses. The client proofing tool is on Standard and Pro only. — [PhotoShelter for Photographers](https://go.photoshelter.com/photographers/)
- The legacy signup page gives month-to-month prices of $12.99 (Basic), $29.99 (Standard) and $49.99 (Pro), and also lists Pro at 500GB. It says storage accepts "any image format including RAW, PSD, TIF, PDF and JPG. Unlimited file size." Sales handling fees are **10% Basic / 9% Standard / 8% Pro**. — [PhotoShelter signup (legacy page)](https://m.psecn.photoshelter.com/signup/subscriber)
- **Conflict:** some third-party reviews say Pro includes *unlimited* storage, for example [websitebuilderexpert](https://www.websitebuilderexpert.com/ecommerce-website-builders/photoshelter-review/) and [Baseline guide](https://baseline.is/guides/photoshelter-pricing). One 2026 guide (Baseline, per search snippet) says unlimited covers JPEGs and **RAW backup is a paid add-on**. Both official pages say **500GB** for Pro. I could not confirm a RAW add-on on PhotoShelter's own pages. The marketing banner on get.photoshelter.com still says "Unlimited storage & easy-to-use mobile app", which may cause the confusion. — [get.photoshelter.com page header](https://get.photoshelter.com/signup/trial)
- A 14-day free trial is available. Individual photographers can sign up with no credit card. — [PhotoShelter trial signup](https://get.photoshelter.com/signup/trial)
- The 2020 rebrand renamed "Libris by PhotoShelter" to PhotoShelter for Brands. The single-user product became PhotoShelter for Photographers. — [BusinessWire, June 2020](https://www.businesswire.com/news/home/20200625005210/en/PhotoShelter-Launches-New-Branding-Alongside-Cutting-Edge-Customer-Driven-Innovations); [SaaSworthy (Libris → PhotoShelter for Brands)](https://www.saasworthy.com/product/libris)
- The API docs still say an organization is "also known as a 'Brand' or 'Libris' account", so the Libris name survives only as a legacy alias. — [PhotoShelter API v4 spec](https://engineering.photoshelter.com/psapi-v4-doc/photoshelter.json)
- In 2023 PhotoShelter acquired Socialie, a content distribution and analytics company, "in partnership with" majority investor Clearhaven Partners. — [MarTech Edge](https://martechedge.com/news/photoshelter-acquires-socialie-enhancing-real-time-content-distribution-automation-and-analytics-for-brands); [PhotoShelter 2023 momentum release](https://go.photoshelter.com/photoshelter-closes-momentum-year-driven-by-acquisition-innovation-and-industry-leadership-in-2023). The current PhotoShelter legal hub links both "Socialie Terms" and a "Socialie Login". — [PhotoShelter Terms hub](https://go.photoshelter.com/terms-of-service/)
- Mediagraph appears in sources as a **destination** for customers leaving PhotoShelter, not as an acquirer. The University of Iowa moved its library to Mediagraph in March 2025, and its PhotoShelter workspaces expired on May 31, 2025. — [UIowa Brand](https://brand.uiowa.edu/updates/2025/03/new-media-library-launches)
- PhotoShelter's own figures: "over 750 million visual assets for 80,000 photographers and over 1,200 brands." — [PhotoShelter Engineering](https://engineering.photoshelter.com/)
- **Lumen** is the new library UI. It is rolling out to Photographers accounts (users can switch back to the Classic Image Browser), and its uploads continue in the background and can target multiple galleries. — [Support: New Library FAQs (Lumen), via search snippet](https://support.photoshelter.com/hc/en-us/articles/29189406805399-PhotoShelter-for-Photographers-New-Library-FAQs-Lumen). The Lumen Portal UI for Brands reached GA on Jan 14, 2026. Release notes list copying files between Photographers and Brands accounts (Mar 23, 2026) and video trimming (Feb 11, 2026). — [Lumen Portal announcement](https://go.photoshelter.com/brands/blog/photoshelter-unveils-lumen-portal-ui-to-modernize-how-brands-share-content/); [Brands release notes](https://support.photoshelterbrands.com/hc/en-us/articles/115000041094-What-s-new-at-PhotoShelter-Release-Notes); [2026 product roundup](https://go.photoshelter.com/brands/blog/product-roundup-whats-new-in-photoshelter-for-2026/)
- Third-party listings put PhotoShelter for Brands at roughly $3,999/yr (Basic) and $6,999/yr (Professional), with Enterprise custom. The official page shows "Get Pricing" only. — [ZoftwareHub](https://zoftwarehub.com/products/photoshelter-for-brands/pricing); [Baseline guide](https://baseline.is/guides/photoshelter-pricing)

### Inferences
- Product investment (Lumen, AI search, ML metadata, Socialie, live-stream capture) is focused on **Brands**. The Photographers product gets UI updates (Lumen), but its pricing and feature grid look unchanged for years. The same $10/$25/$45 tiers appear on the legacy signup page.
- For a working photographer, 500GB on Pro is small for a RAW archive. One wedding or sports season of RAW files can exceed it. PhotoShelter fits better as a delivery and selected-archive tier than as a full RAW mirror of a NAS.

### Gaps
- I found no official statement on storage overage or add-on pricing for Photographers, and I could not verify the "RAW backup add-on" claim.
- I found no news of a PhotoShelter ownership change in 2025–2026 beyond Clearhaven's majority stake. I did not check Crunchbase or PitchBook.

## 2. API: versions, auth, access, endpoints, limits, terms, SDKs

### Takeaway
PhotoShelter publishes an open REST API v4 at `https://www.photoshelter.com/psapi/v4.0`. It has a full OpenAPI spec (132 paths) and supports three auth methods: API key plus a password-grant auth token, API key plus OAuth 2.0 authorization code, and API key plus org login for Brands. It covers upload, galleries and collections, IPTC/XMP/custom metadata, search, original downloads, versions, embed and direct links. The biggest constraints for a DAM sync engine:
- **Uploads are rate-limited to one request per minute.** Multiple files can go in one multipart request.
- The general rate limit is per API key (100 requests/min in the example).
- No webhooks, no chunked or resumable upload, and no checksums in the spec.
- I found no documented self-serve way to get an API key.
- I found no API-specific terms of use.

### Cited Findings
All findings below come from [PhotoShelter API v4 OpenAPI spec](https://engineering.photoshelter.com/psapi-v4-doc/photoshelter.json) (rendered at [psapi-v4-doc](https://engineering.photoshelter.com/psapi-v4-doc/)) unless noted.

**Versions and docs**
- The engineering site calls v4 "the latest REST API" with OAuth and JSON:API-style responses, and says v3 is for legacy projects. — [PhotoShelter Engineering](https://engineering.photoshelter.com/). `photoshelter.com/developer` redirects to the v4 docs.
- The API is served at `/psapi/v4.0` on www.photoshelter.com and also on the user's subdomain or CNAME. HTTPS is required (plain HTTP returns 403). It supports CORS. Responses are JSON by default, with XML via the `Accept` header. The spec includes an LLM-oriented note pointing to the JSON spec.
- Endpoints are versioned **per endpoint by date**. Each API key has a default version date, usually its creation date. Clients can opt into newer versions per request with the `X-PS-API-Version` header or the `api_version` parameter, and can never request an older one. `GET /version` shows the date tied to a key.

**Authentication**
- Every request needs an API key, sent as the `X-PS-API-Key` header or the `api_key` parameter. A missing or invalid key returns 403.
- **Auth token:** `POST /authenticate` with the user's credentials returns a session `token`, sent as `X-PS-Auth-Token`. The docs call this a "password" grant that is "only recommended for utility purposes". There are also 2FA endpoints (`/two-factor/authenticate`, `/two-factor/generate`). 2FA is mandatory on Photographers plans. — [Photographers plans](https://go.photoshelter.com/photographers/)
- **OAuth 2.0:** authorization code and refresh token grants. Endpoints are `/oauth/authorize`, `/oauth/token`, `/oauth/revoke` and `/oauth/register`. Clients self-register through `POST /oauth/register` with name, description, redirect_uri(s), email, application_name and optional company, homepage, privacy policy and logo, and get back `client_id` and `client_secret`. The **only scope is read/write all**. Token lifetimes: authorization code 1 hour, access token **14 days**, refresh token **180 days**. Only `response_type=code` is supported. For native apps the docs point to oauth.net guidance; they do not explicitly mention PKCE.
- **Organizations (Brands/Libris):** after user auth, call `/organization/authenticate`, or pass `org_id` to `/authenticate`. Roles are Administrator, Editor, Contributor (upload only, cannot modify existing media) and Tagger (metadata only).
- **Access:** I found no documented process for getting an API key and no statement on which plans include API access. The WordPress "PhotoShelter Importer" plugin asks for an API key plus an Org ID found under Admin > Account Settings, which suggests keys are tied to Brands org accounts there. — [WordPress: PhotoShelter Importer](https://wordpress.org/plugins/photoshelter-importer/)

**Rate limits**
- Rate limits apply per API key, per minute. Each response's `meta.rate_limit` carries `limit`, `current` and `expires`. The example shows `"limit": 100`. Exceeding the limit returns HTTP 429; a `Retry-After` header is defined on 429 responses.
- "**Media upload requests are subject to an additional limitation of one upload per minute.**" The `POST /media` description repeats: "Uploads are subject to a rate limit of one per minute."

**Upload**
- `POST /media` takes `multipart/form-data`. Send a single `file` or multiple `file[]` parts in one request. Destination options: `gallery_id`, `workspace_id` + `group_id`, or `gallery_name` as a hint (otherwise the account-type default). Other fields: `photographer_id` (Brands only, sets a different uploader) and `searchable`.
- I found no chunked or resumable upload and no max file size in the spec. Marketing for the legacy photographer plans says "Unlimited file size" and lists RAW, PSD, TIF, PDF and JPG. — [legacy signup](https://m.psecn.photoshelter.com/signup/subscriber). Brands FTP marketing reportedly cites a 20GB FTP file limit (search snippet; unverified). — [PhotoShelter FTP blog](https://go.photoshelter.com/ftp-what-it-is-why-brands-need-it-and-how-to-set-it-up)
- The four media types are Image (includes RAW and PDF), Video, Audio and Document (everything else). IPTC is available for images only.
- **Versions:** `POST /media/{id}/versions` uploads a new revision, with `select=true` by default. There are also `PUT` (create), `PATCH`/`DELETE /media/versions/{version_id}`, and `POST .../activate`. The DAM can use these to replace an edited export without changing the media ID or breaking gallery membership or links.

**Containers**
- **Galleries** contain only media and can sit in multiple parent collections. **Collections** contain only galleries or collections and have one parent. Full CRUD covers both: children, display order, key image, access/permissions, link, breadcrumb path, and copy/move media between galleries (`/galleries/media/copy|move`). Gallery `display_mode` can be file_name, upload_time, created_time, added_to_gallery_time, rating or custom.
- Brands also has workspaces, permissions (`/permissions` + `/permissions/notify` email invites), contacts, email templates and a portal.

**Metadata**
- `GET/PATCH /media/{id}/iptc` covers images only. Writable fields: title, edit_status, urgency (0–9), category, keyword, instructions, author, position, city, state, country, country_iso, headline, trans_ref, credit, source, copyright, caption, caption_writer, file_name, contact-info fields (ci_city/country/address/postal_code/region/email/phone/url), genre, location, rights, scene, subject_code, web_statement, publish_date and creation_date (ISO-8601).
- `GET/PATCH /media/{image_id}/xmp` takes arbitrary XMP name/value pairs. There are also `GET /media/{id}/exif`, `GET /media/{id}/xmp-metadata` and `GET/PATCH /media/{id}/metadata`.
- `GET /metadata/fields` lists the supported tags in categories iptc, xmp and metadata. `PATCH /metadata` does bulk updates.
- **Custom metadata fields** (`/metadata/custom-fields`, with options for pick-lists) can be created, read, updated and deleted. `GET /media/{id}/custom-metadata` is image only.
- `PATCH /media/{id}` sets `file_name` (max 100 chars), `flagged`, `model_released`, `property_released`, `searchable`, **`rating` (-1 to 5, where -1 = reject)** and `rotation`. I found no color-label field.
- ML metadata endpoints cover auto tags, faces and people, "magic search", and ML routines. These appear aimed at Brands.

**Search and sync support**
- `GET /media` (media only) and `GET /search` (media plus containers) take filters including `file_name`, `terms`, `keywords`, `caption`, `title`, `rating`/`rating_min`/`rating_max`, `create_start`/`create_end`, **`modify_start`/`modify_end`**, `galleries`, `collections`, `custom_metadata`, `model_release`, `page`/`per_page` and `sort_by`. Modes are `library` (session, all media) and `portal` (public). **There is a hard cap of 10,000 results per search.** `terms` does a stemmed search across keywords, caption, title, city, state, country, file_name and person_shown.
- I found **no checksum or hash fields** (md5, sha) anywhere in the spec. Media objects expose `file_size` and `modified_at`.
- **The spec contains no webhooks.** A search for "webhook" across the 2.1MB spec found nothing. Change detection has to poll with `modify_start`.

**Download, links, embeds**
- `GET /media/{id}/download` takes `download_filetype` = original | jpeg | mp4 and `download_quality` (longest edge in px for jpeg; hd1080/hd720/sd480 for video; no upscaling). **`download_image_embed`** (default `true`) writes PhotoShelter-side IPTC/XMP edits into the downloaded file; `false` returns the original embedded metadata.
- `GET /media/batch/download` downloads a whole gallery or workspace, or up to **250 media IDs** in containerless mode, as a zip. In containerless mode, sizes are capped at the largest common size.
- `GET /media/download-link` and `POST /media/quick-send` (emailed download link) also exist.
- `GET /media/{id}/link` returns CDN display links "intended for display on a website or app". There are also `/media/{id}/embed-link`, `/embed-tokens` and `/embed-media`, and `/direct-link/{asset_id}` (owner can create, get or revoke). Gallery and collection `link` endpoints return shareable URLs.
- The trash can be listed, purged and restored via the API (`/trash`, `/trash/restore/{media_id}`).

**Terms and open-source clients**
- The Terms hub links photographer and Brands T&Cs, a "Third Party Service Agreement" and Socialie terms. I could not retrieve the clause text (JS-rendered), and I found **no published API terms of use or developer agreement**. — [PhotoShelter Terms hub](https://go.photoshelter.com/terms-of-service/)
- History: in 2008 Flickr shut down a PhotoShelter tool that imported from Flickr, a sign that platform API terms can bite. — [TechCrunch 2008](https://techcrunch.com/2008/03/11/flickr-shuts-down-photoshelters-import-tool/)
- Official GitHub: the `photoshelter` org hosts the engineering site and UI widgets (tripod-hero-marquee, scrollstream, a polymer scaffold). **It has no official API SDK.** — [PhotoShelter Engineering](https://engineering.photoshelter.com/); GitHub API search 2026-10-16.
- Community repos from a GitHub repository search on 2026-10-16. All are small, with 0–3 stars:

  | Repo | Language | License | Last push | What it is |
  |---|---|---|---|---|
  | [kuklaph/photoshelter-api-js](https://github.com/kuklaph/photoshelter-api-js) | JS | none | 2024-12 | API client |
  | [Ninkuk/Photoshelter-Migration-Tool](https://github.com/Ninkuk/Photoshelter-Migration-Tool) | Python | none | 2024-11 | Downloads an entire library for migration |
  | [hayleox/photoshelter-scraper](https://github.com/hayleox/photoshelter-scraper) | Python | MIT | 2026-10 | Bulk downloader for PhotoShelter websites |
  | [AdamFrieberg/R_MigrateGalleriesToPhotoShelter](https://github.com/AdamFrieberg/R_MigrateGalleriesToPhotoShelter) | R | MIT | 2020 | On-disk galleries to PhotoShelter via API |
  | [SpencerAP/oauth-tester](https://github.com/SpencerAP/oauth-tester) | PHP | none | 2024 | PhotoShelter OAuth debugging page |
  | [webbtik-io/photoshelter](https://github.com/webbtik-io/photoshelter) | PHP | Apache-2.0 | 2025-10 | Drupal 11 module fork |
  | [justjess/craft-psconnect](https://github.com/justjess/craft-psconnect) | PHP | MIT | 2021 | Craft CMS connector |
  | [kulyim/psapi-v4-doc.github.io](https://github.com/kulyim/psapi-v4-doc.github.io) | — | — | 2019 | Generated client code from the v4 spec |

  There are also WordPress.org plugin mirrors, including PhotoShelter Importer and the official plugin.

### Inferences
- **The upload limit dominates the design.** At one `POST /media` per minute, pushing files one per request means at most about 1,440 files/day. Batching several files per request with `file[]` is the only way to get real throughput. Request size limits and timeouts for large RAW multi-file posts are undocumented and need empirical testing. A DAM "PhotoShelter target" should queue, batch, and persist a resumable job state.
- The spec has no checksums, so the DAM must keep its own local ↔ PhotoShelter ID map (local file hash → `I0000…` media ID, plus `modified_at`). Re-publishing an edited file should use `/media/{id}/versions` rather than a fresh upload.
- With no webhooks, pull-back of metadata and status means polling `GET /media?modify_start=…` with `per_page`. The 10,000-result cap means paging by date window or by gallery for large accounts.
- OAuth's single read/write-all scope and the self-registration endpoint make an open-source desktop or server DAM *technically* possible. Each self-hosted install would register its own client, or the project could ship a client_id. Shipping a secret in open-source code is a known OAuth weakness, and PKCE support is not documented. The password-grant auth token is simpler for a personal tool, but it must handle 2FA.
- Because API key issuance is undocumented, the project should tell users to ask PhotoShelter support for a key. Plan for the possibility that keys are only issued to Brands or partner accounts.
- The spec is current (modified July 2026) and is actively maintained (Lumen, ML and embed tokens are recent additions). The legacy v3 docs should be treated as stale.

### Gaps
- How a Photographers-plan user gets an API key, and whether any plan tier or partner approval is required. Neither the docs nor search results say.
- The real per-key rate limit for a new key; 100/min is only the doc example.
- Maximum request or file size for API uploads, whether very large multi-file posts are accepted, and whether "one upload per minute" counts requests or files. The spec wording implies requests.
- API terms of use and whether open-source redistribution of a client or embedding a client_id is permitted. I found no published developer terms.
- Whether `/metadata/fields` returns XMP keys such as `xmp:Label` (color label) or `lr:hierarchicalSubject`. That would need a live call.

## 3. Other ingest paths (Lightroom, FTP, uploader, Photo Mechanic, sync, mobile)

### Takeaway
PhotoShelter supports several upload routes: a first-party Lightroom Classic publish service (which officially does not support LrC 12.4 and later), incoming FTP (Standard and Pro), outbound FTP/FTPS/SFTP/SCP export, a legacy Java Desktop Uploader, Photo Mechanic's built-in uploader, the browser and Lumen uploader, and mobile apps. Incoming FTP into a target gallery or collection is the simplest non-API push path for a NAS-based DAM.

### Cited Findings
- **Lightroom plug-in:** PhotoShelter's support article (v1.12 install steps) states the plug-in "is not compatible with Adobe Lightroom v12.4 and above". The publish service is meant to automatically sync Lightroom changes to PhotoShelter, but only for a single catalog, single account and single computer; multi-catalog users should use export instead. Edits made on the PhotoShelter side can cause the two to drift apart. — [Support: Adobe Lightroom Plug-in (via search snippet)](https://support.photoshelter.com/hc/en-us/articles/203373590-PhotoShelter-s-Adobe-Lightroom-Plug-in)
- A 2024 Adobe Community thread reports publish and sync errors. PhotoShelter support blamed Adobe, and the user pointed to the plug-in's own incompatibility note. — [Adobe Community](https://community.adobe.com/questions-675/publishing-in-lightroom-classic-getting-errors-974868)
- The publish service was added in July 2015, after the official plug-in launched in January 2014. — [PhotoShelter blog 2015](https://blog.photoshelter.com/2015/07/product-update-photoshelter-publish-service-for-adobe-lightroom/); [PhotoShelter blog 2014](https://blog.photoshelter.com/2014/01/official-photoshelter-lightroom-plugin/)
- Jeffrey Friedl's generic Lightroom publishers (Collection/Folder Publisher) appear in the same results. They are third-party tools; I did not verify whether they publish to PhotoShelter. — [regex.info Collection Publisher](https://regex.info/blog/lightroom-goodies/collection-publisher)
- **Incoming FTP** requires a paid plan. Standard allows one active FTP user at a time and Pro has no limit. It is configured via Upload (classic) or Settings (Lumen), and an FTP user can target a collection or a specific gallery. — [Support: FTP Incoming (via search snippet)](https://support.photoshelter.com/hc/en-us/articles/203373550-FTP-Incoming)
- **Outbound FTP** exports images to external servers over FTP, FTPS, SFTP or SCP. — [Support: Export via Outbound FTP (via search snippet)](https://support.photoshelter.com/hc/en-us/articles/203374490-Export-Images-via-Outbound-FTP-)
- **Desktop Uploader** is a standalone app with nested folder upload, pause/resume, queueing and bandwidth throttling. The support article is dated and mentions Java requirements. — [Support: Desktop Uploader (via search snippet)](https://support.photoshelter.com/hc/en-us/articles/203373570-PhotoShelter-Desktop-Uploader)
- **Photo Mechanic** has had "Upload to PhotoShelter" built in since 4.5.4. It can upload to existing or new galleries and collections, and since v5 it can browse the gallery tree, set visibility, and skip or rename files that already exist. Photo Mechanic 6 still supports it. — [PhotoShelter Photo Mechanic integration](https://go.photoshelter.com/integration/photo-mechanic); [PM6 blog](https://go.photoshelter.com/photographers/blog/photo-mechanic-6-still-supports-photoshelter-uploads/); [Camera Bits list](https://home.camerabits.com/sites-to-upload-from-photo-mechanic/)
- **Lumen web uploads** continue in the background and can target multiple galleries at once. — [Support: Lumen FAQs (via search snippet)](https://support.photoshelter.com/hc/en-us/articles/29189406805399-PhotoShelter-for-Photographers-New-Library-FAQs-Lumen)
- **Mobile apps** are included on all Photographers plans. — [Photographers plans](https://go.photoshelter.com/photographers/)
- For Brands, PhotoShelter lists DAM integrations; the Brands integrations page was not fully read. — [Brands integrations](https://go.photoshelter.com/brands/integrations/)

### Inferences
- An unsupported Lightroom plug-in on current LrC creates an opening for the DAM. If it handles the "publish from catalog/NAS → PhotoShelter, re-publish on change" workflow through the API, it replaces a broken first-party path.
- FTP gives a fallback push with no API key: write to a per-gallery FTP user. But FTP gives no media IDs back, so later status and metadata reconciliation must go through the API or matching by filename.

### Gaps
- Whether PhotoShelter has released a Lightroom plug-in compatible with LrC 12.4+ or 13/14/15. None found.
- Whether incoming FTP supports SFTP/FTPS. Only the outbound protocols were confirmed.
- I found no evidence of native Dropbox or Box sync for Photographers accounts.

## 4. Metadata fidelity (read on upload, write back on download)

### Takeaway
PhotoShelter reads embedded IPTC on upload and exposes a broad IPTC Core/Extension-style field set plus arbitrary XMP over the API. On download it embeds PhotoShelter-side edits into the file by default (`download_image_embed=true`). Ratings exist (-1 to 5) and can be set via the API. I found no evidence of color labels or hierarchical keywords. File names are editable (max 100 chars).

### Cited Findings
- The IPTC-writable field list covers title, headline, caption, caption_writer, keyword, category, author, position, credit, source, copyright, rights, web_statement, instructions, city/state/country/country_iso/location, urgency, edit_status, genre, scene, subject_code, trans_ref, contact-info fields, publish_date and creation_date. — [API v4 spec](https://engineering.photoshelter.com/psapi-v4-doc/photoshelter.json)
- `download_image_embed`: "`true` to overwrite the image's IPTC/XMP metadata with any updates made in PhotoShelter. `false` to keep the image's original metadata." The default is true. — [API v4 spec](https://engineering.photoshelter.com/psapi-v4-doc/photoshelter.json)
- Rating is an integer from -1 to 5, where -1 = reject. It is settable with PATCH /media/{id} and filterable in search; galleries can sort by rating. The spec contains no keyword-hierarchy or color-label field. — [API v4 spec](https://engineering.photoshelter.com/psapi-v4-doc/photoshelter.json)
- The Lightroom publish service syncs Lightroom metadata edits to PhotoShelter one way; PhotoShelter-side edits can drift. — [Support: Lightroom Plug-in (via search snippet)](https://support.photoshelter.com/hc/en-us/articles/203373590-PhotoShelter-s-Adobe-Lightroom-Plug-in)

### Inferences
- The DAM should treat its local XMP sidecar or catalog as the source of truth. On push, it should embed metadata in the uploaded file or set it via PATCH iptc/xmp. On pull, it can read `/iptc` and `/xmp-metadata` and `rating` for fields that clients or assistants edited on PhotoShelter.
- Hierarchical keywords (`lr:hierarchicalSubject`) will probably flatten to `keyword`. This should be verified with `GET /metadata/fields` and `GET /media/{id}/xmp`.

### Gaps
- Exactly which XMP namespaces are preserved on upload and returned by `/xmp`, and whether `xmp:Label` survives a round trip. This needs live testing.
- Whether RAW files' embedded or sidecar XMP is read; PhotoShelter does not ingest `.xmp` sidecars as metadata, as far as I found.

## 5. Archive vs delivery; limits as a backup target

### Takeaway
Photographers mainly use PhotoShelter for client galleries, proofing and delivery, print and license sales, and a curated searchable cloud archive. It is a weak primary backup for a NAS: Pro caps at 500GB, there is no documented bulk "export everything" tool, the cancellation policy leads to purge, the trash empties every 90 days, and API batch download is limited to 250 IDs or one gallery per call.

### Cited Findings
- PhotoShelter markets storage as "Backup your photos and access them anytime" with a "geographically redundant, secure backup strategy", plus delivery and proofing, e-commerce and SEO. — [Photographers page](https://go.photoshelter.com/photographers/)
- On cancellation, the account stays active through the paid term with no refunds. Afterwards the site goes offline, photos go private and "are eventually deleted and purged from our servers", and the account becomes a free buyer account. — [Support: Downgrading/Canceling (via search snippet)](https://support.photoshelter.com/hc/en-us/articles/203373790-Downgrading-Canceling)
- Trash auto-empties every 90 days and items cannot be restored afterwards. — [Support: Deleting/Purging/Restoring (via search snippet)](https://support.photoshelter.com/hc/en-us/articles/203374460-Deleting-Removing-Purging-and-Restoring-Files)
- Forum users leaving PhotoShelter describe downloading manually and re-uploading elsewhere. One reported empty galleries after a migration. — [TalkPhotography thread](https://www.talkphotography.co.uk/threads/photoshelter-deleting-images.760559/)
- Community migration and downloader tools exist because no official bulk export exists: Ninkuk/Photoshelter-Migration-Tool ("Downloads the entire photoshelter library assets for migrating") and hayleox/photoshelter-scraper. — GitHub search, 2026-10-16 ([Ninkuk](https://github.com/Ninkuk/Photoshelter-Migration-Tool), [hayleox](https://github.com/hayleox/photoshelter-scraper))
- API batch download handles a whole gallery or workspace, or ≤250 IDs, as a zip. Originals are available with `download_filetype=original`. — [API v4 spec](https://engineering.photoshelter.com/psapi-v4-doc/photoshelter.json)
- Outbound FTP/SFTP/SCP export is another way to get files out. — [Support: Outbound FTP (via search snippet)](https://support.photoshelter.com/hc/en-us/articles/203374490-Export-Images-via-Outbound-FTP-)

### Inferences
- A sensible DAM model: NAS plus a separate cloud backup (e.g., B2/S3, handled by other researchers) is the archive of record. PhotoShelter is a **publish/delivery target** holding selects and finals, sometimes RAWs for key jobs. The DAM can also offer a verified "pull originals back" job per gallery using the batch download API. That gives a credible exit and verification path; the DAM must compare file sizes because the API returns no checksums.

### Gaps
- No official whole-account export tool or post-cancellation grace period was documented in the sources I could reach.

## 6. Comparable services for a generic "publish target" abstraction

### Takeaway
Of the client-gallery platforms, SmugMug, Zenfolio and Flickr have documented public APIs. PhotoShelter's is documented but its access route is unclear. Pic-Time's API is semi-private and partner-oriented. Pixieset has no public API. I did not confirm ShootProof's or Adobe Portfolio's status. Cloud drives (Dropbox, Google Drive) have mature public OAuth2 APIs. A generic target interface should model: auth (OAuth1a / OAuth2 / API key plus session), container tree (album/gallery/collection), upload (rate-limited, batch-capable), replace or version, metadata set/get, rating, link/share, and poll-for-changes, with optional webhooks.

### Cited Findings
- **SmugMug:** API v2 at `api.smugmug.com/api/v2` with OAuth 1.0a (HMAC-SHA1). Tokens don't expire unless revoked, and uploads go to the separate host `upload.smugmug.com`. — [dgrin thread](https://dgrin.com/discussion/comment/2130684); [phpSmug auth docs](https://fastly.jsdelivr.net/wp/plugins/smugmug-embed/trunk/vendor/lildude/phpsmug/docs/authentication.md); [docs.rs smugmug](https://docs.rs/smugmug)
- **Zenfolio:** public documented API using SOAP and JSON-RPC at a single endpoint, with RAW upload documented and example uploader and downloader code. Tool developers get a free account. — [Zenfolio API](https://www.zenfolio.com/zf/help/api); [Zenfolio upload guide](https://www.zenfolio.com/zf/help/api/guide/upload); [Zenfolio support](https://support.zenfolio.com/hc/en-us/articles/7432718008979-Zenfolio-API)
- **Pic-Time:** no public OpenAPI. A third party documents about 9 endpoints (projects, photo listing, webhook registration) with OAuth bearer tokens. There is a WordPress "Pic-Time Connect" plugin and a Zapier app. — [Jentic](https://jentic.com/apis/pic-time.com/pic-time); [Pic-Time Connect](https://pirate.wordpress.org/plugins/pic-time-connect/); [Zapier Pic-Time](https://zapier.com/apps/pic-time/integrations)
- **Pixieset:** no public or partner API and no developer program; only reverse-engineered unofficial docs. — [APIs.io Pixieset](https://apis.io/providers/pixieset/); [Zapier Pixieset](https://zapier.com/apps/pixieset/integrations)
- **ShootProof:** listed as having an "API" feature in comparison listings, but I found no developer docs. — [SoftwareAdvice compare](https://www.softwareadvice.co.uk/compare/116397/250134/shootproof/vs/pixieset)
- **Flickr:** since May 15, 2025, free accounts cannot download originals or sizes above 1024px. Uploads are unaffected, and full data export is available under Settings > Flickr Data. — [OWC blog](https://www.owc.com/ca/blog/flickr-to-restrict-download-sizes-for-free-accounts-heres-how-to-save-your-photos-and-assets); [PopPhoto](https://www.popphoto.com/look-into-latest-flickr-pro-changes-and-backlash-they-inspired)

### Inferences
- From general background knowledge, not re-verified this session: the Flickr API uses OAuth 1.0a with app keys; Dropbox and Google Drive offer OAuth2 REST APIs with chunked/resumable upload and change-notification or webhook mechanisms; Adobe Portfolio has no public API and syncs from Lightroom/Adobe accounts. These make Dropbox and Drive the easiest "publish targets" technically. PhotoShelter is middling: a good API surface, but the upload throttle, polling-only changes, and unclear key access hold it back.

### Gaps
- I did not verify Zenfolio's API status after Zenfolio's 2022 merger with ShootProof.
- I did not check ShootProof's API docs, Adobe Portfolio, or current Flickr API terms and rate limits against primary sources.

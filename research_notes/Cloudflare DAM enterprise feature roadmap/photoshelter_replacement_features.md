# PhotoShelter Replacement: Photographer-Facing Delivery, Client and Commerce Features

Research date: 2026-10-16. Sources were fetched in October 2026 unless a date is given. Many third-party pricing pages contradict each other, so this file prefers vendor pages and flags conflicts. Some PhotoShelter Zendesk help pages (support.photoshelter.com, support.photoshelterbrands.com) returned HTTP 403 to direct fetch. Where that happened, the claims below come from search-result snippets of those pages and are marked "(snippet)".

## 1. PhotoShelter feature set 2025–2026 (Photographers and Brands, including Lumen)

### Takeaway
"Lumen" is a **PhotoShelter for Brands** interface, not part of the photographer product. The Lumen library launched in April 2024 and the Lumen portal reached general availability on 14 Jan 2026. PhotoShelter for Photographers is a separate, slow-moving product: $10/$25/$45 per month, a 4GB/100GB/500GB storage ladder, 9 website templates, a custom domain, unlimited public/private/password galleries, proofing only on Standard and above, print/download/license sales with an 8–10% transaction fee, Lightroom and Photo Mechanic upload plugins, and mobile apps.

### Cited Findings
**PhotoShelter for Photographers (vendor page, ©2026):**
- Plans: Basic $10/mo ($120/yr), 4GB; Standard $25/mo ($300/yr), 100GB; Pro $45/mo ($540/yr), 500GB. Every plan has 1 user and 9 customizable responsive website templates. The client proofing tool is only on Standard and Pro. Extra storage is sold in 10GB or 35GB increments beyond 500GB. There is a 14-day free trial. — [PhotoShelter for Photographers](https://go.photoshelter.com/photographers/)
- **Pricing conflict:** third-party aggregators list $12.99/$29.99/$49.99 with "unlimited" storage on Pro — [Picflow compare](https://picflow.com/compare/client-gallery/photoshelter); [Capterra](https://www.capterra.com/p/229274/PhotoShelter-for-Photographers/). Treat the vendor page ($10/$25/$45, 500GB cap) as authoritative. The aggregator figures may be stale or monthly-vs-annual confusion.
- Every plan includes: a custom domain, "integrated SEO & social sharing", Instagram/WordPress/Vimeo/Tumblr integrations, unlimited public, password-protected and private galleries, selling prints/products through "integrated print vendors", selling downloads and licenses, custom watermarks, desktop and web uploaders, mobile apps, and keyword/metadata search. The transaction fee is 8–10% per sale depending on tier. FTP and analytics are not mentioned on the page. — [PhotoShelter for Photographers](https://go.photoshelter.com/photographers/)
- The FAQ mentions Lightroom and Photo Mechanic upload plugins. — [PhotoShelter for Photographers](https://go.photoshelter.com/photographers/); [Lightroom plug-in support article](https://support.photoshelter.com/hc/en-us/articles/203373590-PhotoShelter-s-Adobe-Lightroom-Plug-in)
- **Gallery/collection model:** "galleries are groups of images", and collections are groups of galleries and other collections, so the hierarchy is nested. — [Colby PhotoShelter FAQ](https://www.colby.edu/people/offices-directory/communications/photography/photoshelter-faq/) (via search snippet)
- **Download permissions (snippet):** the photographer controls "who can download your photos, when access expires, and what file size can be downloaded". There are three methods: a password, specific logged-in people (an email list), or anyone (anonymous). Anonymous download overrides any other permission set on that gallery. Viewing and download permissions are separate settings. — [Gallery/Collection Access: Who Can Download](https://support.photoshelter.com/hc/en-us/articles/203374400-Gallery-Collection-Access-Who-Can-Download-Your-Images); [Managing Visibility and Download Permissions](https://support.photoshelter.com/hc/en-us/articles/203374470-Managing-Visibility-and-Download-Permissions)
- **fotoQuote licensing (snippet):** rights-managed licensing runs through an integrated fotoQuote "calculator" like those on photo agency sites. The photographer builds pricing profiles from usage rights plus sales regions, and at least one of each is required. After purchase, PhotoShelter builds a ZIP and the buyer has **10 days** to download it. — [Rights-Managed License](https://support.photoshelterbrands.com/hc/en-us/articles/115000053173-Rights-Managed-License) (snippet); bulk pricing profiles are a valued feature that Squarespace lacks — [Ryan Wright, "Why I Left PhotoShelter"](https://iamryanwright.com/blog/why-i-left-photoshelter)
- **Print vendors:** the changelog notes that BWC Photo Imaging is no longer an integrated automated-fulfillment vendor — [PhotoShelter changelog](https://support.photoshelter.com/hc/en-us/articles/203373360-What-s-new-Changelog) (snippet, date not visible). A secondary review lists WHCC, Printique and Loxley Colour — [Picflow PhotoShelter review](https://picflow.com/blog/photoshelter-review). That list may be outdated.

**PhotoShelter for Brands / Lumen:**
- Lumen launched in April 2024 as a new Brands **library** UI with "mortar" (masonry) view, enhanced video metadata, AI tagging and easier sharing — [PhotoShelter blog: New Library UI](https://go.photoshelter.com/brands/blog/new-photoshelter-library-ui-with-advanced-ai-supercharges-marketing-and-creative-teams/); [PR Newswire](https://www.prnewswire.com/news-releases/new-photoshelter-library-ui-with-advanced-ai-supercharges-marketing--creative-teams-302130658.html)
- The **Lumen portal** (the public/invited-user portal) reached GA on **14 Jan 2026**. It adds view options, sort tools, more metadata visibility, better filtering (including filtering AI Visual Search by metadata), and accessibility/mobile improvements. Customers can toggle between the Classic and Lumen portals. — [PhotoShelter blog: Lumen Portal](https://go.photoshelter.com/brands/blog/photoshelter-unveils-lumen-portal-ui-to-modernize-how-brands-share-content/); [PRWeb](https://www.prweb.com/releases/photoshelter-unveils-lumen-portal-ui-to-modernize-how-organizations-share-visual-content-302661050.html)
- Release note dated 3 Jun 2026: portal visitors can download through the organization's **custom derivative presets** — [Brands release notes](https://support.photoshelterbrands.com/hc/en-us/articles/115000041094-What-s-new-at-PhotoShelter-Release-Notes) (snippet)
- **Sharing & Permissions in Lumen (snippet):** per-recipient Can View or Can Download, maximum image and video sizes, and an expiration date per permission — [Sharing & Permissions in Lumen](https://support.photoshelterbrands.com/hc/en-us/articles/21690334115223-Sharing-Permissions-in-Lumen)
- **Watermarked downloads (Brands):** a per-gallery/collection toggle "Watermark JPEG Downloads" that works on JPEG downloads only — [PhotoShelter Brands blog: watermark downloads](https://go.photoshelter.com/brands/blog/product-feature-release-watermark-downloads/)
- **Download request/approval in practice:** at Villanova, staff can view, but only comms and approved vendors download without a request. Others submit lightboxes to a department comms director, who approves and passes them to the photo team for a batch download link. This is a workflow built on lightbox sharing, not a dedicated button. — [Villanova "First time users – Libris"](https://www1.villanova.edu/villanova/unicommunication/photo-archive/first-time-users---libris.html)
- Brands download controls per third-party listings: allow/restrict downloads, size limits, download count limits, time limits and passwords per file, and download logs — [Capterra UK Libris listing](https://www.capterra.co.uk/software/143701/libris)
- **Socialie** was acquired on 13 Jun 2023 for content distribution to partners/athletes/influencers plus social analytics, with Clearhaven Partners. It is still a separate product with its own login. — [PhotoShelter acquires Socialie](https://go.photoshelter.com/brands/blog/photoshelter-acquires-socialie); [Lumen portal blog nav](https://go.photoshelter.com/brands/blog/photoshelter-unveils-lumen-portal-ui-to-modernize-how-brands-share-content/)

### Inferences
- The "Lumen" framing in the brief mixes up the two products. A photographer leaving PhotoShelter for Photographers is leaving the older UI. Lumen-style features (per-recipient expiring permissions, derivative presets, AI visual search) are the bar for the *Brands/team* side of a replacement.
- The core PhotoShelter permission model to replicate in v1 has five parts: separate view and download permissions; four access modes (public, unlisted/private, password, named-user/email list); per-grant max download size and expiry; and nested collections containing galleries. All of it maps naturally onto signed URLs and per-share policy rows.
- fotoQuote-style rights-managed pricing is a niche but sticky differentiator for editorial/stock photographers. It is a candidate for "later", but make the data model license-aware (license type, usage, region, duration) from v1.

### Gaps
- I found no documentation of a Brands feature literally named "Quick Links". It may be a UI term behind the 403'd help pages. The same goes for usage-terms-on-download acceptance.
- No current list of PhotoShelter's integrated print labs (the changelog was blocked) and no confirmation of FTP ingest in 2026. The vendor page omits FTP.
- Brands pricing is not public.
- No source found on whether the PhotoShelter for Photographers watermark is dynamic (applied at render) or baked in.

## 2. Client proofing workflows (Pixieset, Pic-Time, ShootProof)

### Takeaway
Proofing at the market leaders has converged on: favorites (often multiple named lists), per-image comments, optional selection limits, size-tiered downloads, a download PIN separate from the view password, expiry dates with automatic reminder emails, and auto-archiving after expiry with a delayed restore. Contracts/invoicing and automated sales campaigns separate the platforms.

### Cited Findings
- **Pixieset Client Gallery:** clients mark favorites and the photographer can track and export the lists. Per-image comments/editing requests. Download PIN alongside password protection. Clients choose download size from web to high-res and can download the whole gallery or single photos. Built-in watermarks. Store with automatic printing, packaging and shipping (labs not named on page). Lightroom upload/sync. Branded email invites. Activity log of who downloaded what and when. Video/GIF delivery. The page does not mention selection limits, expiry, or a custom domain. — [Pixieset Client Gallery](https://pixieset.com/client-gallery/)
- **Pixieset pricing (2026):** free tier with 3GB and a 15% store commission. Paid plans are $8/$16/$24/$40 per month billed annually ($10/$20/$30/$50 monthly). $40 is unlimited storage. 0% commission on paid plans. Contracts/invoicing sit in a separate product (Studio Manager / Suite). AI alt-text for SEO. — [Kepla comparison (pricing checked Sept 2026)](https://www.getkepla.com/blog/pixieset-vs-pic-time-vs-shootproof); [Aftershoot](https://aftershoot.com/blog/best-online-proofing-galleries/)
- **Pic-Time:** setting an expiration date takes the gallery offline automatically, but it still counts against storage. Reminder emails go to the main client 7, 4 and 1 days before expiry. After extending an expired gallery, it must be switched back online manually. — [Pic-Time help: expiration](https://help.pic-time.com/en/articles/7905685-how-do-i-set-the-expiration-date-for-my-client-galleries)
- **Pic-Time archive/restore:** archived photos can be de-archived and stay restored for **12 months**. Clients can request images and get them in 4–15 hours, or about 4 hours if the photographer triggers it. — [Pic-Time help: unarchive](https://help.pic-time.com/en/articles/8951337-how-do-i-unarchive-an-older-gallery)
- **Pic-Time pricing (2026):** Beginner $7, Professional $21, Advanced $42 per month (annual). Commission is 15%/8%/6%, dropping to 0% on Professional and Advanced if the photographer self-collects payments. Best-in-class automated sales campaigns (anniversary, abandoned cart, early-bird). AI face/object recognition and semantic search. No contracts/CRM. — [Kepla](https://www.getkepla.com/blog/pixieset-vs-pic-time-vs-shootproof); commission is on markup — [12img comparison](https://www.12img.com/blog/gallery-platform-comparison-2026)
- **ShootProof:** proofing with PIN protection, resizing and digital downloads. Favorites on photos, videos and slideshows, visible to the photographer. **Labels** to help clients pick photos for specific products. Gallery presets. **Automatic archiving of expired galleries.** Control over the download size offered to each client. Sale of single images, albums or full galleries. Automatic watermarking on upload. Pro lab integration, self-fulfillment or mixed, with boutique packaging. Price sheets, discounts and packages. Contracts with e-signature, invoices with tipping, and email campaigns including expiration reminders. Free client mobile apps and an event app that collects guest emails. Lightroom plugin that creates gallery/album structure. Custom branding with multiple brands per account. Custom subdomains. Basic portfolio site builder. — [ShootProof feature index](https://www.shootproof.com/feature-index/)
- ShootProof free-digital rules can set resolution, download count, PIN, watermark and print release at the gallery, linked-contact or album level. — [Aftershoot / SLR Lounge summaries via search](https://aftershoot.com/blog/best-online-proofing-galleries/) (secondary)
- **ShootProof pricing:** 0% commission on all tiers, including free. Plans were historically by photo count: free (100), about $8.33 (1,500), $16.67 (5,000), $26.67 (25,000), $50 (unlimited), annual. One source says new plans moved to storage-based pricing. — [Kepla](https://www.getkepla.com/blog/pixieset-vs-pic-time-vs-shootproof); conflict noted in [12img](https://www.12img.com/blog/gallery-platform-comparison-2026)
- **Selection limits as a pattern:** Pixpa documents a per-album maximum favorites count, where 0 means unlimited — [Pixpa help](https://help.pixpa.com/kb/client-galleries-faqs/). One Pixieset photographer's blog says clients can favorite unlimited images — [Jay Grubb blog](https://jaygrubbphotography.mypixieset.com/blog/how-to-create-a-favorites-list-in-your-online-photo-gallery-in-pixieset/) (anecdotal).

### Inferences
- The v1 proofing must-haves are: multiple named favorite lists per client, a configurable selection limit, per-image comments, CSV/Lightroom-filename export of selections (photographers apply picks back in Lightroom), and a "proof → final" flow where the same gallery switches from watermarked low-res view to download-enabled finals.
- Expiry plus reminder emails plus auto-archive are standard. For an R2-based DAM, "archive" can map to R2 Infrequent Access or to removing derivatives while keeping originals. The 4–15 hour Pic-Time restore suggests they use cold storage, so a cheap-storage tier with an async restore job is acceptable UX.
- Sales automation (abandoned cart, anniversary campaigns) and contracts/CRM belong in "later" or outside the DAM's scope.

### Gaps
- No official Pixieset documentation found for selection limits, expiry, or archive behaviour.
- No vendor-published archive/reactivation fee for Pic-Time or ShootProof.
- I did not confirm which labs Pixieset uses.

## 3. Commerce: print labs, digital sales, payments, tax, licensing, invoicing

### Takeaway
WHCC has a public developer program: an Order Submit API with JSON orders and shipment webhooks, plus a limited Editor API. Access requires contacting WHCC, and fulfillment is largely US/Canada. For a self-hosted single-photographer DAM, plain Stripe Checkout on the photographer's own account plus Stripe Tax is enough. Stripe Connect matters only for a multi-tenant hosted service.

### Cited Findings
- **WHCC Order Submit API:** creates print/product orders by POSTing structured JSON, then sends webhooks for events such as shipment. The **Editor API** sends customers to WHCC's unbranded editor and currently covers only 5×7 flat cards (foil, boutique shapes). New integrators "describe what you're building" and WHCC follows up, with no public self-serve signup. — [WHCC developer docs](https://developer.whcc.com/docs); [WHCC Integrate with Us](https://www.whcc.com/developer/)
- WHCC constraints seen in integrators: Photocrati/Imagely ships white-labeled, to US/Canada only, because WHCC only provides upfront shipping costs there — [Photocrati print lab fulfillment](https://www.photocrati.com/?p=21946). Pixpa notes no PO boxes, a minimum shipping charge per product catalog, mixed-product orders split into separate shipments, a choice of auto-submit or manual review, and a high-res source file requirement — [Pixpa: Understand WHCC lab fulfillment](https://help.pixpa.com/kb/understand-whcc-lab-fulfilment/)
- PhotoShelter uses "integrated print vendors" (fees apply) — [PhotoShelter](https://go.photoshelter.com/photographers/). ShootProof supports pro labs, self-fulfillment or mixed — [ShootProof](https://www.shootproof.com/feature-index/)
- **Transaction fees across platforms (2026):** PhotoShelter 8–10% — [PhotoShelter](https://go.photoshelter.com/photographers/). SmugMug about 15% of markup on Portfolio/Pro, with no selling on cheaper plans — [Markus Hagner (Aug 2026)](https://markus-hagner-photography.com/smugmug-vs-zenfolio-for-photographers/). Zenfolio has a 7% "Commerce Fee" on the order *subtotal* (not markup) and no selling on Basic — [Markus Hagner](https://markus-hagner-photography.com/smugmug-vs-zenfolio-for-photographers/), though another blog cites 10–12% — [Fouzan Adil](https://www.fouzanadil.com/blog/zenfolio-vs-smugmug-comparison). PhotoDeck charges 0% — [PhotoDeck](https://www.photodeck.com/alternative/photoshelter/). ShootProof 0% — [Kepla](https://www.getkepla.com/blog/pixieset-vs-pic-time-vs-shootproof).
- **Stripe Connect:** destination charges run on the platform and move funds to the connected account. The platform keeps `application_fee_amount`, which is capped at the charge. Direct charges land on the connected account, with the application fee sent to the platform. Express accounts get a hosted Express Dashboard. — [Stripe: destination charges](https://docs.stripe.com/connect/destination-charges); [Stripe: direct charges](https://docs.stripe.com/connect/direct-charges); [Stripe: marketplace](https://docs.stripe.com/connect/marketplace)
- If a platform handles pricing for its users, Connect costs $2 per monthly active account plus 0.25% + 25¢ per payout (verify the current figure) — [Stripe support: monetizing Connect](https://support.stripe.com/questions/monetizing-payments-with-stripe-connect)
- Stripe Tax works with Connect charges. For Express/Custom (`application*` fee payer) accounts, the platform pays the Stripe Tax fees — [Stripe: fee behavior on connected accounts](https://docs.stripe.com/connect/direct-charges-fee-payer-behavior)
- **Licensing:** PhotoShelter fotoQuote rights-managed calculator (usage × region profiles, 10-day ZIP download window) — [Rights-Managed License](https://support.photoshelterbrands.com/hc/en-us/articles/115000053173-Rights-Managed-License) (snippet)
- **Invoicing:** ShootProof includes invoices with tipping and contracts. Pixieset puts them in Studio Manager. Pic-Time has none. — [ShootProof](https://www.shootproof.com/feature-index/); [Kepla](https://www.getkepla.com/blog/pixieset-vs-pic-time-vs-shootproof)

### Inferences
- For v1, digital download sales should use Stripe Checkout on the photographer's own Stripe key, with Stripe Tax turned on for VAT/sales tax, priced per size tier (web/hi-res/original) and per-gallery packages ("all images $X"). Fulfillment is a signed, expiring download link emailed after the `checkout.session.completed` webhook. That gives "0% commission", which is a key PhotoShelter grievance.
- Print-lab integration is a "later" item. It needs a business relationship with WHCC, which is US/Canada-centric. Miller's and Bay Photo have no public API in my results. A cheaper v1 path is self-fulfillment orders, where the photographer gets an order email and uploads to their lab.
- Licensing: v1 can offer simple royalty-free license tiers as products. A fotoQuote-style rights-managed calculator (usage × region × duration matrix) is "later" but should be planned for in the price-sheet schema.

### Gaps
- No public developer/API information found for Miller's (Miller's Professional Imaging) or Bay Photo. Their availability to third parties is unconfirmed.
- No platform-specific documentation found on VAT handling (EU digital goods MOSS/OSS) at Pixieset, Pic-Time or PhotoShelter.

## 4. Delivery mechanics (ZIP, large/RAW downloads, signed links, notifications, white-label, domains)

### Takeaway
Every platform offers full-gallery download (usually ZIP), size tiers, password/PIN gating, expiry, email invites/reminders and branding. PhotoShelter delivers purchases as ZIPs with a 10-day window. Download activity logs are now table stakes (Pixieset, PhotoShelter Brands).

### Cited Findings
- Whole-gallery or single downloads in multiple sizes and formats, with a who-downloaded-what-when log — [Pixieset](https://pixieset.com/client-gallery/)
- PhotoShelter creates a ZIP for licensed purchases with a 10-day download window — [Rights-Managed License](https://support.photoshelterbrands.com/hc/en-us/articles/115000053173-Rights-Managed-License) (snippet). Download options include "Original file" or "JPEG – original size" — [Illinois State PhotoShelter guide 2026 (PDF)](https://universitymarketing.illinoisstate.edu/downloads/PhotoShelter%20User%20Guide%202026%20final.pdf) (via snippet)
- Per-permission expiration dates and max sizes — [Sharing & Permissions in Lumen](https://support.photoshelterbrands.com/hc/en-us/articles/21690334115223-Sharing-Permissions-in-Lumen) (snippet). Lumen portal downloads through custom derivative presets (Jun 2026) — [Brands release notes](https://support.photoshelterbrands.com/hc/en-us/articles/115000041094-What-s-new-at-PhotoShelter-Release-Notes) (snippet)
- Branded email invites — [Pixieset](https://pixieset.com/client-gallery/). Expiry reminder emails at 7/4/1 days — [Pic-Time](https://help.pic-time.com/en/articles/7905685-how-do-i-set-the-expiration-date-for-my-client-galleries). Custom branding with multiple brands and custom subdomains — [ShootProof](https://www.shootproof.com/feature-index/). Custom domain on all PhotoShelter plans — [PhotoShelter](https://go.photoshelter.com/photographers/)

### Inferences
- v1 must-haves: a streaming ZIP built on the fly from R2 using store-only/no compression (JPEG/RAW don't compress), with ZIP64 for galleries over 4GB. Single-file downloads via expiring presigned URLs, which support HTTP Range so browsers and download managers can resume. An "original/RAW" download size tier. Per-share expiry. Email notifications on share and before expiry. A custom domain per photographer (Cloudflare for SaaS / custom hostnames). Logo/colour branding. A download activity log.
- Very large galleries (tens of GB) may be better served as split ZIPs (e.g. 2–5GB parts) or a per-file manifest, since a failed multi-GB single ZIP stream cannot resume. This is a design inference, not something a source states.
- This research did not cover the specific Workers implementation (CPU limits for streaming ZIP); other researchers may cover it.

### Gaps
- No competitor documentation found describing resumable full-gallery downloads or ZIP size splitting.
- I did not confirm whether competitors deliver RAW files through the client gallery by default.

## 5. Portfolio/website: own it or integrate?

### Takeaway
Gallery platforms bundle only basic portfolio sites (PhotoShelter has 9 templates unchanged for years; ShootProof has a basic builder). Photographers frequently leave PhotoShelter for Squarespace or WordPress for the website while keeping a separate gallery/delivery tool. A replacement DAM should integrate rather than compete.

### Cited Findings
- PhotoShelter offers 9 responsive templates on every plan, a custom domain and WordPress/Tumblr integrations — [PhotoShelter](https://go.photoshelter.com/photographers/). A reviewer says the templates have not improved since 2013 — [Picflow compare (quoting Trustpilot)](https://picflow.com/compare/client-gallery/photoshelter)
- A photographer moved their site to Squarespace for better website features despite weaker e-commerce, citing missing blog hosting and custom URL slugs at PhotoShelter (post c. 2018, old) — [Ryan Wright](https://iamryanwright.com/blog/why-i-left-photoshelter)
- One photographer's final reason for leaving was photos no longer appearing in Google search — [G2/Trustpilot reviews summary](https://www.trustpilot.com/review/www.photoshelter.com)
- Format is positioned as portfolio-first with a commission-free store, Basic $10/mo billed yearly (2026) — [Ecommerce Paradise](https://ecommerceparadise.com/smugmug-alternatives/). An older 2025 source says $6/mo — [Jasmine DeFoore](https://www.jasminedefoore.com/blog/photographer-portfolio-website-products-compared)
- SmugMug is stronger on commerce and print fulfillment. Zenfolio is an all-in-one with strong proofing. — [Markus Hagner (Aug 2026)](https://markus-hagner-photography.com/smugmug-vs-zenfolio-for-photographers/)

### Inferences
- v1 should ship a minimal, SEO-friendly public portfolio/gallery page set (server-rendered HTML, clean slugs, sitemap.xml, OpenGraph, alt text from IPTC caption) on the photographer's custom domain. That preserves the PhotoShelter "my archive is searchable on Google" value.
- Later: a public read API plus embeddable gallery widget/web component, and an Astro/WordPress integration, so photographers can keep Squarespace/WordPress/Astro sites. Avoid building a full website builder.

### Gaps
- No usage data on what share of PhotoShelter users use its website vs only galleries.

## 6. Photographer complaints about PhotoShelter and alternatives

### Takeaway
The dominant PhotoShelter complaints are stagnation, price-to-value, back-end UX/login friction, support, slow uploads and transaction fees. Reviews are mostly 2024–2025. I found no confirmed recent price increase. In fact the vendor page now shows lower list prices ($10/$25/$45) than aggregators report.

### Cited Findings
- "Feels like the company abandoned development with only a few upgrades in the 7 years I was with them" (G2) — [Picflow compare](https://picflow.com/compare/client-gallery/photoshelter)
- Long-time users say nothing has changed "since 2015ish" — [SourceForge reviews](https://sourceforge.net/software/product/PhotoShelter/). A user who left after 15+ years says premium pricing is no longer justified — [Slashdot reviews](https://slashdot.org/software/p/PhotoShelter/)
- Login friction (signing in "a dozen times"), a print store that "vanished", photos dropping from Google search, and support refusing help — [Trustpilot](https://www.trustpilot.com/review/www.photoshelter.com)
- G2's summary praises storage capacity and ease of use but notes slow upload speed — [G2 PhotoShelter for Photographers](https://www.g2.com/products/photoshelter-for-photographers/reviews)
- The changelog was removed from public view, emails to leadership went unanswered, there was an 8–10% commission (9% on Professional), and the user paid $29/mo (c. 2018, old) — [Ryan Wright](https://iamryanwright.com/blog/why-i-left-photoshelter)
- A competitor claims PhotoShelter's photographer product has a 1.8 Trustpilot rating and limited video support (vendor marketing) — [PhotoDeck](https://www.photodeck.com/alternative/photoshelter/)
- Brands-side reviews are mostly positive. One reviewer likes the new Lumen portal look. — [G2 PhotoShelter for Brands](https://www.g2.com/products/photoshelter-for-brands/reviews)
- Alternatives: Pic-Time commissions on lower tiers, Pixieset's 15% on the free tier, and Zenfolio's 7% on the full subtotal are the cost complaints implied by comparisons — [Kepla](https://www.getkepla.com/blog/pixieset-vs-pic-time-vs-shootproof); [Markus Hagner](https://markus-hagner-photography.com/smugmug-vs-zenfolio-for-photographers/)

### Inferences
- Positioning for the replacement: 0% commission, storage priced at R2 cost (no 500GB cliff), fast/resumable uploads (multipart, parallel), a visible changelog, and data portability (full export) as features.

### Gaps
- Reddit was not accessible to the search tool, so there is no r/photography or r/WeddingPhotography evidence.
- No sourced evidence found on Lightroom plugin breakage specifically.
- No dated record of a PhotoShelter price increase.

## 7. Migration: exporting from PhotoShelter

### Takeaway
There is no documented one-click bulk export. A PhotoShelter API exists (referenced from their blog), but its documentation was not retrievable. Forum users describe migration as largely manual. An importer should walk the collection→gallery tree through the API (or authenticated web endpoints) and pull originals plus embedded IPTC/XMP. Lightroom catalogs are a fallback source of structure.

### Cited Findings
- A forum user migrating to WordPress found the sitemap only exposes slugs/keys, not full gallery structure or metadata. Another said migration will "more than likely" be manual. — [TalkPhotography: Migrating away from PhotoShelter](https://www.talkphotography.co.uk/threads/migrating-away-from-photoshelter.760510/)
- PhotoShelter references an API for third-party use ("if you're interested in using the PhotoShelter API ... get started here") — [PhotoShelter blog: PhotoShelter-friendly apps](https://go.photoshelter.com/photographers/blog/get-work-done-even-faster-with-these-photoshelter-friendly-apps). The guessed doc URL (photoshelter.com/psapi/v3/doc) returned 404.
- The structure is nested collections containing galleries and collections — [Colby FAQ](https://www.colby.edu/people/offices-directory/communications/photography/photoshelter-faq/) (snippet)
- Downloads offer "Original file" vs "JPEG – original size" — [Illinois State 2026 guide](https://universitymarketing.illinoisstate.edu/downloads/PhotoShelter%20User%20Guide%202026%20final.pdf) (snippet)
- The Lightroom catalog can hold the structure if uploads went through the plugin — [TalkPhotography](https://www.talkphotography.co.uk/threads/migrating-away-from-photoshelter.760510/)
- University guides document migrations *into* PhotoShelter (structure planning) — [UIC LAS: Migrating to PhotoShelter](https://it.las.uic.edu/web-technology/las-photoshelter/migrating-to-photoshelter)

### Inferences
- Importer design should map PhotoShelter Collection → album/folder (nested) and Gallery → album/share. It should carry over visibility (public/private/password), and record permissions to recreate shares. It should download "Original file" (not JPEG-original) so embedded IPTC/XMP (captions, keywords, credit, copyright) survives, then re-extract metadata. Price profiles, fotoQuote profiles, and sales/order history likely won't transfer and would need manual recreation.
- Accept a Lightroom-catalog or folder-structure import as an alternative path. Provide a verification report (counts per gallery vs source).

### Gaps
- PhotoShelter API v3 endpoints, auth, rate limits, and whether originals and gallery permissions are exposed could not be verified (docs 404/403).
- No community export scripts were found in this search, though GitHub was not searched specifically.

## Summary: v1 vs later (inferred from all findings above)

**v1 must-haves (parity with PhotoShelter for Photographers plus the proofing basics):**
1. Nested collections/galleries with visibility of public, unlisted, password, or named-email-list. Separate view and download permissions.
2. Per-share download policy: size tiers (web / hi-res / original-RAW), max size, expiry date, download PIN, download count. Activity log.
3. Dynamic watermark on previews (render-time, per gallery), turned off for finals.
4. Proofing: multiple favorite lists, selection limit, per-image comments, export selections (filenames/CSV for Lightroom).
5. Delivery: streaming ZIP (ZIP64, store-only, optionally split), single-file presigned Range-capable links, branded email invites, expiry reminders.
6. Branding and custom domain per photographer. SEO-friendly public portfolio/gallery pages with a sitemap.
7. Digital download sales through the photographer's own Stripe (Checkout + Stripe Tax), with simple license tiers and 0% commission.
8. Ingest: resumable multipart web upload and a Lightroom publish path (or an S3-compatible endpoint that existing tools can target). Full IPTC/XMP metadata search.
9. PhotoShelter importer, plus full export for portability.

**Later:**
- Print-lab automation (WHCC Order Submit API requires a partnership and is US/CA-only). Self-fulfilled print orders can come earlier.
- fotoQuote-style rights-managed license calculator.
- Stripe Connect (only if offered as a multi-tenant hosted service).
- Sales campaigns (abandoned cart, anniversary), contracts/invoicing/CRM.
- Client mobile apps and event/guest capture.
- Brands/team features: request→approve download workflows, usage terms acceptance, derivative presets, AI visual search, social distribution (Socialie-like), analytics.
- Embeddable gallery widget and public API for Astro/WordPress/Squarespace.
- Cold-archive tier with async restore.

**SmugMug / Zenfolio / Format / Mediagraph note:** these were covered only lightly. SmugMug takes about 15% of markup and is commerce-strong. Zenfolio takes a 7% commerce fee on the subtotal and offers strong proofing ([Markus Hagner, Aug 2026](https://markus-hagner-photography.com/smugmug-vs-zenfolio-for-photographers/)). Format is portfolio-first with a commission-free store ([Ecommerce Paradise](https://ecommerceparadise.com/smugmug-alternatives/)). Mediagraph (from the TandemVault team) is an organization-wide DAM with published, start-small pricing ([TandemVault: Mediagraph is live](https://tandemvault.com/blog/mediagraph-is-live)). No photographer-delivery-specific features or prices for Mediagraph were found.

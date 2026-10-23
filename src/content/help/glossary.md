---
title: "Glossary"
summary: "The words cf-dam and storage services use, in plain words."
section: Getting started
order: 9
---

**AI review.** An AI model looking at each photo and writing suggestions: alt text, a caption, a description, keywords. You decide what to keep. See [AI review](/help/ai-review).

**Alt text.** A short description of a photo for people who can't see it. Screen readers read it out; galleries and websites use it.

**Archive.** A safe, cheap copy of your originals, usually in Glacier Deep Archive, for the day something goes wrong. See [Archiving](/help/archiving).

**AWS (Amazon Web Services).** Amazon's business renting computers and storage, separate from its shop. S3 is part of it. See [Connecting Amazon S3](/help/amazon-s3).

**Bucket.** A named storage space in S3, R2 or similar services: like a drive in the cloud. cf-dam can keep originals in one or several.

**Catalogue.** Everything cf-dam knows about your photos: details, keywords, captions, ratings, albums, thumbnails and previews. Not the originals themselves.

**Client gallery.** An album shared with someone through a private link, with its own password, expiry and downloads. See [Client galleries](/help/client-galleries).

**Docker.** A standard way to run small programs, such as cf-dam's helper, on a NAS. Each program runs in its own sealed "container".

**EXIF.** Details your camera writes into each photo: camera, lens, exposure, date and time, and GPS position if it has one.

**Glacier and Deep Archive.** Amazon's cheapest storage classes, for files you rarely open. A terabyte in Deep Archive costs about a dollar a month, but getting a file back takes up to 12 or 48 hours. See [Archiving](/help/archiving).

**HEIC.** The photo format iPhones use. cf-dam reads it.

**Helper (agent).** A small program on your NAS or computer that catalogues photos where they are, without moving them. See [Computers and NAS](/help/computers-and-nas).

**IPTC.** The standard set of fields for describing photos used by agencies, newspapers, Lightroom and Photo Mechanic: headline, creator, credit line, copyright, usage terms, contact details, place, job.

**Keyword.** A word or phrase saying what's in a photo or what it's about. cf-dam keeps them in a tree, such as *Places › Norway › Bergen*. See [Keywords](/help/keywords).

**Look-alike.** A copy of a photo that isn't the same file: resized, re-saved, exported again. See [Duplicates](/help/duplicates).

**Metadata.** Information about a photo, rather than the picture itself: EXIF, IPTC, keywords, captions, ratings.

**NAS (network-attached storage).** A box of drives on your network, such as a Synology or QNAP, that holds files for every computer in the house or studio.

**Neurons.** How Cloudflare measures (and bills) Workers AI. 10,000 a day are free; then $0.011 per 1,000. Reviewing 1,000 photos uses roughly 46,000.

**Original.** The full file from your camera or editing program. cf-dam never changes it.

**Pairing code.** The eight letters a new helper shows. Typing it into cf-dam connects the helper to your archive.

**Passkey.** A way to sign in with your fingerprint, face, device PIN or password manager instead of a password. Safer, and nothing to remember. See [Your account and sign-in](/help/account-security).

**Preview.** A large copy of a photo (up to 2,048 pixels across) that cf-dam makes for viewing, sharing and AI review, kept in your Cloudflare account.

**R2.** Cloudflare's own storage. cf-dam's thumbnails and previews always live there, and originals can too.

**RAW.** The unprocessed file some cameras save (such as `.CR3`, `.NEF`, `.ARW`). It holds the most detail; you develop it in Lightroom or similar.

**Restore.** Bringing a copy of an archived original back from Glacier so it can be downloaded. Also: bringing the catalogue back from a backup. See [Backups](/help/backups).

**S3.** Amazon's storage service, and the "language" many other storage services also speak (R2, Backblaze B2, Wasabi).

**Storage class.** How a file is kept in S3: Standard (instant, dearest), Infrequent Access, Glacier, Deep Archive (slowest, cheapest).

**Thumbnail.** A small copy of a photo (480 pixels across) for the library grid.

**Two-step sign-in (two-factor).** A second step after your password: a code from an app on your phone. See [Your account and sign-in](/help/account-security).

**Watermark.** Your name or logo laid over photos shown in client galleries and in downloaded copies. Originals are never watermarked.

**XMP.** A standard way of storing metadata (keywords, captions, ratings, labels) inside a photo or in a small file beside it (a "sidecar"), which Lightroom, Capture One and Bridge read.

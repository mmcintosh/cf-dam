---
title: "What clients receive"
summary: "What's in the files clients download or buy from a gallery, what they can read on the page, and what to check before you send a link."
section: Sharing
order: 6
---

A gallery shows your photos, but a downloaded file can carry more than the picture. This page lists what clients get, so nothing you meant to keep private goes with it.

## On the gallery page

- **Titles, captions and alt text** are shown to everyone who opens the link. A caption like "Lily, 4, with Grandma" names people, so check captions before you share an album.
- **Filenames** are shown only with **Show filenames** on.
- **People you named** in cf-dam are shown only to the gallery's own couple, under the names you choose, when you set the gallery to (see [People in a client gallery](/help/people-in-galleries)). Keywords, ratings, places on the map and notes are never shown.

## File names

With **Show filenames** off, nothing a client receives carries the real file name. Downloads are named after the gallery and the photo's place in it, for example `smith-wedding-042.jpg`. Orders and Stripe receipts call it **Photo 42**. With it on, files keep their real names.

## Small and Large downloads

Small and Large downloads are JPEGs that cf-dam makes from the photo, with your edits (crops and turns) and the watermark if the gallery has one. They carry nothing from the original file except your **creator** and **copyright notice**, from the photo's Rights fields in cf-dam. If you change those, the next download has the new ones.

## Originals

An original download is the file as it was uploaded, **cleaned** on the way out when it's a JPEG or PNG:

- **Taken out:** people's names (including Lightroom's face regions), captions and descriptions, keywords, ratings, comments, the GPS location, the camera owner's name, the camera maker's private notes (some hold face-recognition names) and content credentials (C2PA).
- **Kept:** the picture itself, untouched; the camera settings and date; and your **creator** and **copyright notice** from the photo's Rights fields in cf-dam.
- **Phone HDR photos**, which hide a second picture inside the file, arrive as the standard picture.
- **No edits made in cf-dam.** If you cropped someone out here, they're still in the original.

If a file can't be cleaned with certainty, it isn't sent at all: the client is asked to contact you, and **Activity** says which gallery.

**Send originals exactly as stored** (in the gallery's settings, under Downloads) sends originals untouched, with everything your software and camera wrote into them. Use it only when you've checked what your export includes. In Lightroom, the export's **Metadata** setting can include only copyright and contact details.

Paid **Full size** downloads are originals too, cleaned the same way, and sold only for JPEG and PNG photos with no edits in cf-dam.

Originals always come from cf-dam itself. Even when they're stored on Amazon S3, the client never gets a link to your bucket.

## Other file types

RAW, TIFF, HEIC, WebP, AVIF and GIF photos and videos are always sent as stored, without cleaning, whatever the gallery's setting. Phone photos (HEIC) and videos often hold the GPS location.

## See also

- [Client galleries](/help/client-galleries)
- [Selling photos](/help/selling)
- [Naming people in photos](/help/people-in-photos)
- [People in a client gallery](/help/people-in-galleries)

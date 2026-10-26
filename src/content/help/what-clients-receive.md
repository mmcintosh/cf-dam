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
- **People you named** in cf-dam are never shown, and neither are keywords, ratings, places on the map or notes.

## File names

With **Show filenames** off, nothing a client receives carries the real file name. Downloads are named after the gallery and the photo's place in it, for example `smith-wedding-042.jpg`. Orders and Stripe receipts call it **Photo 42**. With it on, files keep their real names.

## Small and Large downloads

Small and Large downloads are JPEGs that cf-dam makes from the photo, with your edits (crops and turns) and the watermark if the gallery has one.

## Originals

An original download is **the file exactly as it was uploaded**. That includes:

- **Everything your editing software wrote into it:** for example, Lightroom can write people's names, keywords, captions, ratings and your contact details.
- **The camera's information:** some cameras and phones add the GPS location, the camera owner's name and their own face-recognition names.
- **No edits made in cf-dam.** If you cropped someone out here, they're still in the original.

Paid **Full size** downloads are originals too, sold only for JPEG and PNG photos with no edits in cf-dam.

Before offering originals, check what your export includes. In Lightroom, the export's **Metadata** setting can include only copyright and contact details, and remove people and location information.

Originals always come from cf-dam itself. Even when they're stored on Amazon S3, the client never gets a link to your bucket.

> **Coming next:** cf-dam will remove people's names, keywords, captions and the location from JPEG and PNG originals as clients download them, and keep the camera details and your copyright. Each gallery will have a switch to send originals exactly as stored.

## Other file types

RAW, TIFF, HEIC, WebP, AVIF and GIF photos and videos are always sent as stored. Phone photos (HEIC) and videos often hold the GPS location.

## See also

- [Client galleries](/help/client-galleries)
- [Selling photos](/help/selling)
- [Naming people in photos](/help/people-in-photos)

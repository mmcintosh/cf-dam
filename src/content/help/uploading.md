---
title: "Uploading photos"
summary: "Adding photos and videos from your computer, where they go, and what happens to them next."
section: Your photos
order: 3
---

Uploading suits a few hundred photos at a time, or photos from a computer that won't keep them. For a whole NAS or a large collection on a computer, a helper is better: it catalogues photos where they are, without uploading the originals (see [Computers and NAS](/help/computers-and-nas)).

## How to upload

1. In the **Library**, press **Upload**.
2. Choose where the originals go: **Store originals in** (the default is chosen for you) and the **Storage class**. See [Where originals are kept](/help/storage).
3. Drag photos, RAW files and videos onto the box, or click it to choose them. You can drag a **whole folder**: cf-dam opens it, and the folders inside it, and uploads everything in them (hidden files are skipped).

Each file shows its progress: **Checking for duplicates…**, then a percentage, then **Uploaded**. Large files go up in parts, up to 5 TB each, and you can keep working while they do. **Cancel** stops one. When they've finished, press **Refresh the library** to see them.

## Duplicates are skipped

Before uploading, cf-dam checks whether the archive already has that exact file, whether it was uploaded before or catalogued by a helper. If it does, the file says **Already in the archive**, with a link to the photo, and isn't uploaded again. (Files over 512 MB skip this check, because it means reading the whole file.)

Copies that aren't identical, such as a smaller export or a re-saved JPEG, are uploaded, and then show up under [Duplicates](/help/duplicates) as look-alikes.

## What happens next

Within a few seconds of each upload, cf-dam:

1. reads its details: camera, lens, exposure, date, GPS, and any keywords, title, caption, credit and copyright already in the file;
2. makes a thumbnail and a preview;
3. looks up the city and country from its GPS position;
4. makes it searchable;
5. queues it for [AI review](/help/ai-review), if that's switched on for new photos.

## Kinds of file

| Kind | Notes |
| --- | --- |
| JPEG, PNG, WebP, AVIF, GIF, HEIC (iPhone) | Previews made by cf-dam. |
| Files over about 20 MB | Your browser makes the preview before uploading, because Cloudflare's image service only reads files up to 20 MB. |
| RAW (camera files), TIFF | Previews come from the small JPEG most cameras put inside the file. If there isn't one, the photo has no preview until a helper makes one. |
| Video | Your browser makes a poster frame, if it can play the video. |

## Straight into deep archive

If you upload straight into **Glacier** or **Deep Archive**, your browser makes the preview first, because nothing can read the original back for hours afterwards. Getting the original later takes a restore: see [Archiving and restoring originals](/help/archiving).

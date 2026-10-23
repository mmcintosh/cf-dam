---
title: "Duplicates"
summary: "Finding identical files and look-alike copies, and keeping the best one."
section: Your photos
order: 6
---

Archives collect copies: the same photo uploaded twice, an export next to its original, a re-saved JPEG, the same folder on two drives. **Duplicates** finds them and suggests which one to keep.

## Two kinds

- **Identical files** are byte-for-byte the same file, wherever they came from: an upload and a helper's copy on the NAS, for example.
- **Look-alikes** are different files of the same picture: resized, re-saved, exported at another quality, lightly edited. cf-dam finds them by a "fingerprint" of each picture's light and dark areas, so it catches copies a file comparison can't. Two photos taken a moment apart can look alike too, which is why look-alikes are for you to review.

Photos of plain scenes (an empty sky, fog, a black frame) have very little in their fingerprint, so they're only paired when their fingerprints and pixel sizes are **exactly** the same.

Identical files can't be uploaded twice in the first place: the upload says **Already in the archive** (see [Uploading photos](/help/uploading)).

## Which one to keep

Each group shows every copy with its size in pixels, file size, file type, date and camera, and marks one **Suggested**, with the reason. cf-dam prefers, in this order:

1. **More pixels**: the larger picture.
2. **The RAW original**, then a lossless file (TIFF, PNG), over a JPEG.
3. At the same size, the **less compressed** file: "the same size, but less compressed (707 KB against 664 KB)".
4. **Your pick**, then the one **rated higher**.
5. Otherwise, the one that came in first.

The reason is shown, so you can disagree: choose another copy before pressing the button.

## Keeping one

Choose the copy to keep and press **Keep selected, remove …**. The others' keywords, albums, rating and pick move to the one you keep, and the others are removed from the catalogue.

> **Removing a duplicate never deletes a file.** It only takes that copy out of cf-dam's catalogue. The original files stay where they are, on your NAS, computer or in storage, for you to tidy up if you want to.

## Not duplicates

For look-alikes that aren't really copies (two frames of a burst, say):

- **Not duplicates** dismisses the whole group;
- **Not a duplicate** under one photo takes just that one out of the group.

Dismissed pairs aren't suggested again.

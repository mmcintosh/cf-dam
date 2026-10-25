---
title: "A photo's page"
summary: "Everything about one photo: its details, keywords, credit and rights, rotate and crop, downloads, and its original."
section: Your photos
order: 4
---

Open a photo in the library and press **Open details** (or click a photo anywhere it links) to get its own page. The photo is on the left; everything about it is on the right.

## Describing it

- **Title** and **Caption**: what anyone reading about the photo should know.
- **Alt text**: a short description for people who can't see the image (screen readers read it out). Galleries and downloads use it.
- **Rating**, **pick or reject**, and **Colour label**.
- **Tags** (keywords): type to find one from your keyword list, or add a new one. See [Keywords](/help/keywords).
- **Albums**: the albums the photo is in. Choose one under **Add to an album…** and press **Add**; press **×** beside an album to take the photo out of it (the photo stays in your library and its other albums).

Changes are saved as you make them, and become searchable straight away.

## AI suggestions

If [AI review](/help/ai-review) has looked at the photo, **AI suggestions** shows what it wrote: alt text, a caption, a longer description of **what the model saw**, any **text in the picture**, and suggested tags. Nothing it writes replaces yours unless you say so:

- **Use this** copies a suggestion into an empty field; **Replace mine** overwrites what you wrote.
- Suggested tags are searchable at once: **✓** keeps one as your own, **×** drops it, **Keep all** keeps them all.
- **Analyse** asks the AI to look (again).

## People

When [counting people](/help/ai-review) is set up, **People** says whether TypeSafe's Jev saw anyone, and how many: **No people**, **One person**, **2–5 people**, **6 or more**, or that it hasn't looked yet. If it's wrong, press the right answer: that's what the library's **People** filter uses from then on, and Jev won't change it. **Back to Jev's answer** undoes it.

The same card names **who's in it**: type a name and press **Add**, or **×** to take one off. Names read from the file (as Lightroom writes them) are marked **from the file**. See [People in photos](/help/people-in-photos).

## Credit, rights and place

Under **Credit, rights & place** are the standard press and agency fields (called IPTC): headline, creator and their job title, credit line, source, copyright notice, usage terms, contact details, sublocation, city, state or province, country, job identifier and instructions. Many cameras and editing programs fill some in already.

**Apply preset (fill empty fields)…** fills them from a ready-made set. See [Presets](/help/presets).

City and country are filled in from GPS when a photo has it. You can always change them.

## Rotate and crop

Press **Rotate and crop** under the photo to:

- turn it a quarter left or right, or **Mirror** it;
- drag the corners of the box to crop, or drag inside it to move the crop; pick a shape (**Square**, **4:5**, **3:2**, **16:9**, **Original**, or **Free**).

Press **Save**. The thumbnail, preview, library, galleries and downloads all show the edited picture.

**The original file is never changed.** The page says "Edited: the original is unchanged". To undo, open **Rotate and crop**, press **Reset**, then **Save**.

## Download a copy

**Download a copy** gives you a JPEG made for sending or posting:

| Size | Made from |
| --- | --- |
| **Small (1024 px)** | the preview |
| **Large (2048 px)** | the preview |
| **Full size** | the original (only when cf-dam can read it: originals in cloud storage, up to about 20 MB) |
| **Background removed (PNG)** | the preview, with the background cut away by Cloudflare's AI; works best on a clear subject |

Each copy is rotated and cropped as shown. Tick **With the watermark** to add your watermark to small and large copies (when a watermark is set: see [Client galleries](/help/client-galleries)).

## Metadata for Lightroom and others

**Metadata only (XMP)** in the download menu, or **Download XMP sidecar** under **Details**, gives you a small `.xmp` file with the photo's title, caption, alt text, keywords, rating, colour label and credits. Put it in the same folder as the original, with the same name, and Lightroom, Capture One or Bridge pick up everything you wrote in cf-dam. How keywords are written follows your choices on [Keywords](/help/keywords).

## The original

The **Original** card says where the original file is and what state it's in:

- In cloud storage: **Download original** gives you the file exactly as it was uploaded. An administrator can **Move to another class** (for example into Deep Archive).
- In Glacier or Deep Archive: **Restore from deep storage** brings a copy back for a few days. See [Archiving and restoring originals](/help/archiving).
- On a NAS or computer: the original stays there; the card says on which helper and in which folder.

## More like this

**More like this** opens the library with photos whose descriptions are closest to this one's. See [Searching](/help/search).

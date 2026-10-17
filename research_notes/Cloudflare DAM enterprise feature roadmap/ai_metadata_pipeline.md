# AI Metadata Pipeline for a Cloudflare Photo DAM (alt text, descriptions, keywords, shoot tags, sidecars, MCP)

Research date: 2026-10-16. Prices and model lists were checked against official pages on that date unless marked "third-party" or "older".

## 1. Standards: which IPTC/XMP fields, current version, tool support, sidecar conventions

### Takeaway
The current standard is IPTC Photo Metadata 2025.1 (dated 2025-11-26). Every field the DAM needs already has a standard home: alt text and extended description (added 2021.1), caption, headline, keywords, Event Name plus Event Identifier, Location Created/Shown, Person Shown, and Digital Source Type. 2025.1 adds four AI-*generation* fields (AI System Used, AI System Version Used, AI Prompt Information, AI Prompt Writer Name). These describe how an *image* was made. They are not a way to flag AI-written *metadata*. ExifTool (13.59) can write all of these. Sidecar naming is not uniform: Lightroom uses `basename.xmp` and darktable uses `basename.ext.xmp`.

### Cited Findings
- **Version:** IPTC Photo Metadata Standard 2025.1 (revision 1, 2025-11-26) contains IPTC Core 1.5 and IPTC Extension 1.9. Some labels on the spec page still say Extension 1.8. — [IPTC spec 2025.1](http://www.iptc.org/std/photometadata/specification/IPTC-PhotoMetadata-2025.1.html)
- **Change history:**
  - 2025.1 (Ext 1.9, approved 2025-10-16) added AI Prompt Information, AI Prompt Writer Name, AI System Used and AI System Version Used.
  - 2024.1 (Core 1.5, approved 2024-10-02) changed the definition of Keywords.
  - 2023.1 (Ext 1.8) added Data Mining.
  - 2022.1 (Core 1.4/Ext 1.7) added Contributor and a Digital Source Type user note.
  - 2021.1 (Core 1.3/Ext 1.6) added Alt Text (Accessibility), Extended Description (Accessibility) and Event Identifier, and renamed Event to Event Name.
  - Source: [IPTC spec 2025.1](http://www.iptc.org/std/photometadata/specification/IPTC-PhotoMetadata-2025.1.html)
- **Property ids, types and limits:**

  | Property | XMP id | Type | Notes |
  |---|---|---|---|
  | Alt Text (Accessibility) | `Iptc4xmpCore:AltTextAccessibility` | Lang Alt | 250-character limit; implementers should warn when it is exceeded |
  | Extended Description (Accessibility) | `Iptc4xmpCore:ExtDescrAccessibility` | Lang Alt | No limit |
  | Description/Caption | `dc:description` | Lang Alt | IIM limit 2000 bytes |
  | Headline | `photoshop:Headline` | Text | IIM 256 bytes; not the same as Title |
  | Keywords | `dc:subject` | Bag | IIM 64 bytes per value; controlled-vocabulary codes belong in CV-Term About Image |
  | Event Name | `Iptc4xmpExt:Event` | Lang Alt | |
  | Event Identifier | `Iptc4xmpExt:EventId` | Bag of URIs | "A URL to a persistent calendar entry can be used" |
  | Location Created / Location Shown | `Iptc4xmpExt:LocationCreated` / `Iptc4xmpExt:LocationShown` | Bag of Location structs | |
  | Digital Source Type | `Iptc4xmpExt:DigitalSourceType` | URI | |
  | AI System Used | `Iptc4xmpExt:AISystemUsed` | Text | Generation provenance |
  | AI System Version Used | `Iptc4xmpExt:AISystemVersionUsed` | Text | Generation provenance |
  | AI Prompt Information | `Iptc4xmpExt:AIPromptInformation` | Text | Generation provenance |
  | AI Prompt Writer Name | `Iptc4xmpExt:AIPromptWriterName` | Text | The prompt writer "should not be treated as the image creator" |

  Source: [IPTC spec 2025.1](http://www.iptc.org/std/photometadata/specification/IPTC-PhotoMetadata-2025.1.html)
- **Digital Source Type vocabulary:** active terms are digitalCapture, computationalCapture, negativeFilm, positiveFilm, print, humanEdits, compositeWithTrainedAlgorithmicMedia, algorithmicallyEnhanced, digitalCreation, dataDrivenMedia, trainedAlgorithmicMedia, algorithmicMedia, screenCapture, virtualRecording, composite, compositeCapture and compositeSynthetic. Retired terms: minorHumanEdits, digitalArt, softwareImage. The latest concept changes are dated 2024-10-23. — [IPTC NewsCodes digitalsourcetype](https://cv.iptc.org/newscodes/digitalsourcetype/)
- IPTC recommends that software creating images with trained AI write DigitalSourceType = trainedAlgorithmicMedia into XMP, or into a C2PA manifest. — [IPTC news: guidance for AI-generated media](https://iptc.org/news/iptc-publishes-metadata-guidance-for-ai-generated-synthetic-media/)
- I found no IPTC guidance that requires a "machine-generated" marker on captions or keywords. The AI fields describe how the image was produced. — [IPTC news](https://iptc.org/news/iptc-publishes-metadata-guidance-for-ai-generated-synthetic-media/); search summary only, so see Gaps.
- **Person Shown:** ExifTool exposes `PersonInImage` and `PersonInImageWDetails` (XMP-iptcExt). Full IPTC definitions were past the part of the spec page I fetched. — [ExifTool XMP tags](https://exiftool.org/TagNames/XMP.html)
- **ExifTool tag names:**
  - XMP-iptcCore: `AltTextAccessibility` (lang-alt) and `ExtDescrAccessibility`. ExifTool shortens the prefix `Iptc4xmpCore` to the group `XMP-iptcCore`.
  - XMP-iptcExt: `AISystemUsed`, `AISystemVersionUsed`, `AIPromptInformation`, `AIPromptWriterName`, `DigitalSourceType`, `Event` (lang-alt), `EventIdentifier`, `LocationCreated*` and `LocationShown*` (flattened, e.g. `LocationShownCity`), `PersonInImage`, `PersonInImageWDetails`. The iptcExt table says it covers Extension 1.7 "plus the AI additions".
  - Current ExifTool version is 13.59.
  - Sources: [ExifTool XMP tags](https://exiftool.org/TagNames/XMP.html); [exiftool.org/ver.txt](https://exiftool.org/ver.txt)
- **Custom namespaces in ExifTool:** ExifTool reads XMP from namespaces it does not know, but writes them only if they are defined as user-defined tags in its config file (`pdfx` example). — [ExifTool XMP tags](https://exiftool.org/TagNames/XMP.html)
- **Photo Mechanic:** added Alt Text and Extended Description in build 6645 (PM6 and PM Plus). The fields appear in the Metadata (IPTC) Info and Template dialogs, can be used to filter Find, and are available as `{alt}` and `{extd}` variables. — [Camera Bits](https://home.camerabits.com/alt-text-new-accessibility-metadata-fields-in-photo-mechanic/)
- **Adobe:** Creative Cloud apps (including Lightroom Classic) began supporting the accessibility properties in December 2023. — [IPTC news](https://iptc.org/news/wordpress-7-0-iptc-alt-text/). An Adobe community thread from that month said the fields could not be used in filters or smart collections at first. It is unclear whether that was fixed. — [Adobe community](https://community.adobe.com/feature-requests-676/p-support-for-new-iptc-accessibility-metadata-665062)
- **WordPress 7.0:** reads IPTC Alt Text (Accessibility) from uploaded images and puts it in the image's HTML alt. IPTC also tells editors to check embedded alt text against each post's context.
  - Before 7.0, the Media Library Assistant plugin could map the field. A Trac ticket (#55535, May 2025) tracked the request.
  - Sources: [IPTC news](https://iptc.org/news/wordpress-7-0-iptc-alt-text/); [Camera Bits](https://home.camerabits.com/alt-text-metadata-is-coming-to-wordpress-7/); [wp-trac](https://lists.wordpress.org/pipermail/wp-trac/2025-May/542498.html)
- **Sidecar naming:**
  - darktable writes `<basename>.<extension>.xmp` (and `<basename>_<n>.<extension>.xmp` for duplicates).
  - Lightroom writes `<basename>.xmp`.
  - darktable reads Lightroom sidecars on import (tags, labels, ratings, GPS, some develop settings) but never writes to them. It creates its own file instead.
  - Source: [darktable manual 5.6](https://docs.darktable.org/usermanual/5.6/en/overview/sidecar-files/sidecar-import/)
- **ExifTool sidecar idiom:**
  - Batch examples write sidecars as `%d%f.xmp` (e.g. `exiftool -ext EXT -o %d%f.xmp -r DIR`). Copying back into an image: `exiftool -tagsfromfile SRC.xmp -all:all DST.jpg`.
  - `-all:all` keeps original namespaces. A block copy (`-xmp`) is "the only way to transfer unknown or non-writable XMP tags".
  - Source: [ExifTool metafiles](https://exiftool.org/metafiles.html)
- **Lightroom Classic embedded vs sidecar:**
  - Proprietary raw files get `.xmp` sidecars.
  - DNG, JPEG, TIFF, PSD and PNG have metadata written into the file itself. DNG has no sidecar option, so the original DNG is modified.
  - Writing also updates EXIF/IPTC in JPEG/TIFF and changes file modification times, which some users found broke rsync backups (community reports).
  - Sources: [Adobe community](https://community.adobe.com/t5/lightroom-classic-discussions/dng-and-xmp/m-p/13586421/highlight/true); [Adobe community](https://community.adobe.com/t5/lightroom-classic-discussions/enabling-quot-automatically-write-changes-to-xmp-quot-changes-orig-file-creation-modification-dates/m-p/12558644/highlight/true); [BeyondPhotoTips](https://www.beyondphototips.com/automatically-write-changes-xmp-lightroom/)

### Inferences
- Map DAM fields one-to-one:
  - alt → `Iptc4xmpCore:AltTextAccessibility`
  - long/extended description → `Iptc4xmpCore:ExtDescrAccessibility`
  - caption → `dc:description`
  - headline → `photoshop:Headline`
  - keywords → `dc:subject`
  - shoot/event → `Iptc4xmpExt:Event`, plus `Iptc4xmpExt:EventId` set to a stable URL of the DAM's shoot/job record. The spec explicitly allows a persistent calendar-entry URL here.
  - people → `Iptc4xmpExt:PersonInImage`
  - places → `LocationCreated`/`LocationShown`
- Enforce the 250-character alt limit in the UI and in the AI prompt.
- Do not use DigitalSourceType or the 2025.1 AI fields to mark AI-*written* captions. They describe how the pixels were made. For a camera original the correct value is digitalCapture (or computationalCapture for phone HDR), even when every caption was written by AI. Store field-level provenance elsewhere (see section 7).
- Sidecar naming:
  - For RAW, write `basename.xmp` by default (Lightroom, Capture One and Photo Mechanic users expect it).
  - Offer `basename.ext.xmp` as an option for darktable/digiKam users.
  - Never write both names for the same file without a precedence rule. Two files with the same basename (`IMG_1.CR3` and `IMG_1.JPG`) would collide on `IMG_1.xmp`. The `.ext.xmp` scheme avoids that collision.

### Gaps
- I did not read the full IPTC definitions for Person Shown / Person Shown with Details (the fetch was truncated). Their XMP ids come from ExifTool.
- Drupal's handling of IPTC alt text was not researched. I found no source.
- I did not verify digiKam's default sidecar naming (believed to be `file.ext.xmp` with a Lightroom-compatible option). No source was fetched.
- Whether current Lightroom Classic can filter or search on Alt Text is unconfirmed.
- I did not read the IPTC Photo Metadata User Guide section "Applying metadata to AI-generated images" directly.

## 2. Alt text best practice: WCAG/W3C, length, context, alt vs caption vs long description

### Takeaway
Alt text depends on context. The W3C decision tree changes the right alt depending on whether the image is decorative, sits inside a link, repeats nearby text, or carries meaning. So one embedded alt string can only be a *default*. The DAM should store per-placement alt overrides and treat the IPTC field as the "general purpose" alt. Keep it short (IPTC caps it at 250 characters; the 125-character figure is folklore), and send detail to the caption or extended description.

### Cited Findings
- **W3C WAI alt decision tree (updated 13 May 2024):**
  1. Text in the image: use empty alt if the text is repeated nearby, describe the function, or include the text.
  2. Image in a link or button: describe the destination or action.
  3. Image that adds meaning: give a brief description, or put complex information elsewhere on the page. Use empty alt if it repeats nearby text.
  4. Purely decorative image: use empty alt.

  The tree gives no character limit. — [W3C WAI decision tree](https://www.w3.org/WAI/tutorials/images/decision-tree/)
- IPTC caps `AltTextAccessibility` at 250 characters, and Extended Description is "a longer visual description that elaborates on Alt Text" with no limit. — [IPTC spec 2025.1](http://www.iptc.org/std/photometadata/specification/IPTC-PhotoMetadata-2025.1.html)
- WebAIM guidance as quoted in its mailing list: there is no set length limit, but alt text should be brief, a few words up to a few short sentences. The 125-character figure came from older JAWS versions and is not a current limit.
  - Screen readers read alt as flat text with no structure, and some split long alt into chunks.
  - Sources: [WebAIM list archive](https://webaim.org/discussion/mail_message?id=14818); [WebAIM list](https://webaim.org/discussion/mail_message?id=14785); secondary: [DubBot 2026](https://dubbot.com/dubblog/2026/how-much-alt-text-is-too-much-alt-text.html)
- Alt text should not duplicate nearby text or captions. Long descriptions are for complex visuals, and alt text should still be present when a long description exists. `longdesc` is deprecated in HTML5. — [WebAIM list](https://webaim.org/discussion/mail_message?id=3801); [lettercounter (secondary)](https://lettercounter.org/blog/alt-text-length-best-practices/)
- IPTC itself warns WordPress editors that "a description written for one use may not fit another" and that embedded alt should be checked against each post's context. — [IPTC news](https://iptc.org/news/wordpress-7-0-iptc-alt-text/)

### Inferences
- **Data model:**
  - `asset.alt_default` maps to IPTC AltTextAccessibility.
  - `asset.ext_description` maps to ExtDescrAccessibility.
  - `asset.caption` maps to dc:description and is editorial: who/what/where/when, names allowed.
  - A separate `placement_alt` table keyed by (asset, usage/gallery/page) holds overrides. It also has an "is_decorative" flag that emits `alt=""`.
  - Public galleries and the MCP `get_asset` tool should return the placement alt when a context is given.
- **Prompting:** ask the model for alt text that describes what is *visually* necessary, ≤250 characters (target ~100–150), without "image of" or "photo of", and without repeating the caption. Generate the caption and extended description separately so each serves its own purpose.
- WCAG 2.2 Success Criterion 1.1.1 (Non-text Content) is the governing criterion. I did not fetch the WCAG 2.2 text this session, so cite W3C directly in the final report.

### Gaps
- I did not fetch WCAG 2.2's SC 1.1.1 text or the W3C Images Tutorial "informative images" page. The only W3C page fetched was the decision tree.
- I found no empirical study on the best alt length for photography specifically.

## 3. Vision models: options, quality and cost per 1,000 images; accuracy pitfalls

### Takeaway
As of October 2026, Claude Haiku 5.5 makes LLM-quality alt text, captions and keywords very cheap: about $0.35 per 1,000 images at standard rates and about $0.18 with the Batch API (my arithmetic, assumptions below). That is below or near the label-only APIs (Rekognition $1.00, Google Vision $1.50 per 1,000), which return generic labels and no prose. Sonnet 5.5 costs about $7 per 1,000 ($3.50 batch) for better quality.

Workers AI keeps everything on Cloudflare. Its vision options (Llama 3.2 11B Vision, Llama 4 Scout, Mistral Small 3.1, Moondream 3.1, Qwen 3.8 27B, GLM-5.3-flash, Kimi K2.6) have low token prices, but image token accounting is undocumented, and the Llama multimodal licenses restrict EU-domiciled users.

Claude will not name people. Names must come from human-confirmed tags supplied as context.

### Cited Findings
- **Claude API prices** (per MTok; batch is 50% off input and output; batch and caching discounts stack):

  | Model | Input | Output | Batch input | Batch output |
  |---|---|---|---|---|
  | Haiku 5.5 (prompts ≤100k tokens) | $0.10 | $0.50 | $0.05 | $0.25 |
  | Haiku 4.5 | $1 | $5 | | |
  | Sonnet 5.5 | $2 | $10 | $1 | $5 |
  | Sonnet 4.6 | $3 | $15 | | |
  | Opus 5.5 | $4 | $20 | $2 | $10 |
  | Opus 5 / 4.x | $5 | $25 | | |
  | Fable 5 / 5.1 | $10 | $50 | | |

  - Cache hits: Haiku 5.5 $0.01, Sonnet 5.5 $0.10, Opus 5.5 $0.20.
  - Haiku 5.5 over 100k-token prompts costs $0.50 in / $2.50 out.
  - Source: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- **Claude image tokens:** cost = ⌈width/28⌉ × ⌈height/28⌉ visual tokens.

  | Tier | Models | Max long edge | Max tokens |
  |---|---|---|---|
  | High-resolution | Claude 4.7 and later | 2576 px | 4784 |
  | Standard | Other models | 1568 px | 1568 |

  - Examples: 1000×1000 = 1296 tokens; 1920×1080 = 2691 tokens (high-res) or 1560 (standard); 4K = 4784 tokens on high-res.
  - Anthropic's own worked example: Opus 5.5, 1000×1000 image ≈ $5.18 per 1,000 images for image input alone; 4K ≈ $19.14 per 1,000. Haiku 4.5 1 MP ≈ $1.30 per 1,000.
  - Limits: 8000×8000 max dimensions. Above 20 images per request, each image must be ≤2000 px. 10 MB per image (API). Up to 600 images per request (100 on 200k-context models), with a 32 MB request cap. The Files API allows upload-once, reference-by-`file_id`. JPEG/PNG/GIF/WebP only.
  - Claude does not read image metadata, so EXIF/IPTC context has to go in the prompt text.
  - Source: [Anthropic vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- **Claude restrictions:** "Claude cannot be used to name people in images and refuses to do so" (AUP). It can hallucinate on low-quality, rotated or <200 px images. Counts are approximate. It cannot detect whether an image is AI-generated. — [Anthropic vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- **Workers AI vision-capable models** listed (slugs): llama-3.2-11b-vision-instruct, llava-1.5-7b-hf, moondream3.1-9B-A2B (detection, pointing, OCR, structured output), mistral-small-3.1-24b-instruct, llama-4-scout-17b-16e-instruct, kimi-k2.6, kimi-k2.7-code, glm-5.3-flash, qwen3.8-27b, and Cloudflare's "clef" decision models. The only image classifier is resnet-50. — [Workers AI models](https://developers.cloudflare.com/workers-ai/models/)
- **Workers AI pricing:** $0.011 per 1,000 Neurons; 10,000 free Neurons per day.

  | Model | Input $/M tokens | Output $/M tokens |
  |---|---|---|
  | llama-3.2-11b-vision | 0.049 | 0.676 |
  | llama-4-scout | 0.270 | 0.850 |
  | mistral-small-3.1 | 0.351 | 0.555 |
  | moondream | 0.300 | 1.000 |
  | qwen3.8-27b | 0.450 | 3.200 |
  | glm-5.3-flash | 0.150 (cached 0.030) | 0.500 |
  | kimi-k2.6 (paid plan only) | 0.950 | 4.000 |
  | resnet-50 | $2.51 per M images | |

  Source: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- **Llama licence:** the Llama 3.2, 3.3 and Llama 4 AUPs restrict rights granted to EU-based companies and individuals for the *multimodal* models. Non-EU companies may ship products containing them to EU end users. — [Meta Llama FAQ](https://www.llama.com/faq/); [HF Llama 3.2 blog](https://huggingface.co/blog/llama32)
- **AWS Rekognition:**
  - DetectLabels (Group 2): $0.0010 per image for the first 1M per month, then $0.0008, $0.0006 and $0.00025 at higher tiers. Each API run on an image counts as a separate image.
  - Face storage costs $0.00001 per face vector per month.
  - Custom Labels: $1 per training hour, $4 per inference hour.
  - Source: [AWS Rekognition pricing](https://aws.amazon.com/rekognition/pricing/)
- **Google Cloud Vision Label Detection:** the first 1,000 units per month are free, then $1.50 per 1,000 up to 5M, then $1.00 per 1,000. Each feature is billed separately. — [Google Cloud Vision pricing](https://cloud.google.com/vision/pricing) (search-result summary; older third-party articles list higher, outdated rates)

### Inferences
- **Cost per 1,000 photos.** My arithmetic from the official rates above. Assumptions: the image is downsampled to about 1,500 visual tokens (e.g. 1092×728 = 39×26 = 1,014 tokens; 1536×1024 = 55×37 = 2,035), plus about 500 prompt tokens, so about 2,000 input tokens; output is about 300 tokens of JSON (alt + caption + extended description + 15–25 keywords).

  | Model | Standard per 1,000 | Batch per 1,000 |
  |---|---|---|
  | Haiku 5.5 | ≈ $0.20 in + $0.15 out = **$0.35** | **≈ $0.18** |
  | Haiku 4.5 | ≈ $3.50 | ≈ $1.75 |
  | Sonnet 5.5 | ≈ $4 + $3 = **$7.00** | **≈ $3.50** |
  | Opus 5.5 | ≈ $14 | ≈ $7 |

  - A 50,000-image back catalogue run once on Sonnet 5.5 batch is therefore about $175. On Haiku 5.5 batch it is about $9.
  - Sending full-resolution 24–45 MP files wastes money on the high-res tier, which caps at 4,784 tokens. Always send a ~1,000–1,600 px rendition, which the DAM already generates.
- **Workers AI cost** is probably ≤$0.50 per 1,000 for llama-3.2-11b-vision at its token rates. This cannot be confirmed because Cloudflare does not document how many input tokens an image consumes.
  - Workers AI's advantages: no egress, no third-party data processor, and a free daily allocation.
  - Its downsides: EU licence restrictions on Llama vision, and quality that is likely below frontier models. No head-to-head benchmark was found.
- **Recommended pattern:** Claude (Haiku 5.5 by default; Sonnet 5.5 as a "high quality" toggle or for hero selects) through the Message Batches API for imports. Batches fit, because imports are not latency-critical. Use the synchronous API for single-image "regenerate" in the review UI. Put a long static instruction block plus the shoot's context in a cached prefix.
- **Constraining hallucinations.** Supply context in the prompt, since Claude ignores embedded metadata:
  - shoot or job name, client, event type and date
  - a reverse-geocoded place name from EXIF GPS
  - the photographer's house style
  - names of *human-confirmed* people, with the instruction to use only those names
  - an instruction never to infer race, ethnicity, religion, health, sexual orientation or age beyond broad visual terms (e.g. "child", "adult")

  Return structured JSON with a confidence score per field. Claude's AUP already refuses to identify people, which suits the design: identities come only from the human or roster layer.
- Label APIs (Rekognition/Google) are not worth adding as a primary source. They cost more than Haiku 5.5, produce generic nouns, and produce no alt text. They are only worth considering for moderation or as a cheap second opinion on keywords.

### Gaps
- I found no independent 2026 benchmark comparing Claude 5.x, Workers AI vision models, Qwen2.5-VL, Florence-2 or Llama 3.2 Vision on photo captioning or alt text quality. Quality ranking is therefore unsourced and should be validated with an in-house eval on 100–200 of the photographer's own images.
- Workers AI image-token accounting for vision models is undocumented on the pricing page.
- I did not verify Florence-2 (MIT) or Qwen2.5-VL (Apache-2.0/Qwen licence) licences and self-hosting costs this session. Florence-2 and Qwen2.5-VL do not appear in the current Workers AI catalogue; Qwen 3.8 27B does.
- I did not confirm whether Haiku 5.5 is in the high-res image tier. Per the docs, "Claude 4.7 and later" implies yes.
- Prompt-caching minimum prefix lengths were not extracted.

## 4. Embeddings for semantic and visual search

### Takeaway
Workers AI has no image or multimodal embedding model in its October 2026 catalogue, only text embedders (bge-m3, qwen3-embedding-0.6b, embeddinggemma and others). There are two viable designs:

- (a) Embed the AI-generated caption, keywords and alt text with a cheap Workers AI text embedder into Vectorize. This is fully on Cloudflare and nearly free.
- (b) Call an external multimodal embedder for true image-to-image and text-to-image search. Voyage multimodal-3.5 is about $0.60 per billion pixels (third-party listing); Cohere Embed v4 images are about $0.47/M tokens (third-party).

Vectorize storage cost is negligible at photographer scale.

### Cited Findings
- **Workers AI embedding models** (per M tokens): bge-small-en-v1.5 (384-d, $0.020), bge-base-en-v1.5 (768-d, $0.067), bge-large-en-v1.5 (1024-d, $0.204), bge-m3 ($0.012), qwen3-embedding-0.6b ($0.012), embeddinggemma-300m (beta, 100+ languages), plamo-embedding-1b (Japanese). No multimodal or image embedding model is listed. — [Workers AI models](https://developers.cloudflare.com/workers-ai/models/); [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- **Vectorize pricing:**
  - Queried dimensions: 50M per month included on Paid, then $0.01 per million.
  - Stored dimensions: 10M included, then $0.05 per 100M.
  - Free plan: 30M queried and 5M stored.
  - Worked example: 10k vectors × 768-d with 30k queries per month is $0 on Paid.
  - Source: [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)
- **Voyage multimodal-3.5:** $0.60 per billion pixels; text, images, video and interleaved inputs; 2048/1024/512/256 dimensions; 32K context. — [OpenRouter listing (third-party)](https://openrouter.ai/voyageai/voyage-multimodal-3.5)
- **Cohere Embed v4:** image inputs billed at $0.47 per 1M tokens versus about $0.12 for text, with a 2 MP max image size. These are aggregator figures, not Cohere's own sheet. — [Puter Cohere pricing guide (third-party)](https://developer.puter.com/tutorials/cohere-api-pricing/); [AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-j3fgisven2yrs)
- **PhotoShelter** markets "AI Visual Search" as language and image matching "removing the need for asset tagging". This is the feature a replacement needs to match. — [PhotoShelter AI visual search](https://go.photoshelter.com/photoshelter-unveils-ai-visual-search)

### Inferences
- **Vectorize cost:** 100k images × 1024-d = 102.4M stored dimensions, which is about $0.05 per month beyond the included amount. Effectively free.
- **Voyage cost:** about $0.60 per 1,000 one-megapixel renditions (my arithmetic from the third-party price).
- **Phase 1:** text embeddings of (caption + alt + keywords + event + place) with bge-m3 or qwen3-embedding in Vectorize, plus D1 full-text search for exact keywords. Hybrid search covers most needs.
- **Phase 2:** an optional multimodal embedder (Voyage or Cohere), keyed on the rendition, to enable "find similar" and text-to-pixel search for images with weak captions. Store the model id and version on each vector so you can re-embed when the model changes.
- CLIP/SigLIP self-hosting would need a container or GPU outside Workers AI. The current catalogue has no such model.

### Gaps
- I did not fetch Voyage's or Cohere's official price pages. Figures are from third-party listings.
- I found no comparison of CLIP/SigLIP against commercial multimodal embedders on photo retrieval.
- I did not check whether Workers AI or Cloudflare AI Gateway can proxy Voyage or Cohere embeddings.

## 5. Auto-tagging a shoot on import (deriving "Smith–Jones wedding")

### Takeaway
Every mature tool derives shoot or event metadata from *human-supplied context applied to the batch*, not from AI guessing:

- Photo Mechanic: IPTC templates with per-file variables and code replacements at ingest.
- Bynder: metadata presets at upload.
- Canto: metadata templates and a required upload pop-up.
- PhotoShelter: roster sync.

The DAM should make an upload batch belong to a **Shoot/Job record** (name, client, date range, venue, event type, people roster, IPTC template). That record is inherited by every asset, written to `Iptc4xmpExt:Event` / `EventId`, and passed to the vision model as context. Time and GPS clustering and camera serials refine it. They do not replace it.

### Cited Findings
- **Photo Mechanic:**
  - The Metadata (IPTC) Template (formerly the "IPTC Stationery Pad") is stamped on each image during ingest from card or camera.
  - Variables such as `{serial}` (camera serial), `{photog}` and `{filenamebase}` resolve per file.
  - Code replacements (tab-delimited files, typed as `=code=`, with `#n` to select a column) can map a camera serial to a photographer name, title and folder, e.g. `={serial}=` in Creator.
  - Templates can be saved as XMP template files.
  - Sources: [Camera Bits docs](https://docs.camerabits.com/support/solutions/articles/48000223660); [Camera Bits code replacement history](https://home.camerabits.com/?p=2273); [ProVideo Coalition tutorial](https://www.provideocoalition.com/video-tutorial-photo-mechanic-ingesting-variables-and-code-replacement/)
- **Bynder metadata presets:** admin-defined sets of descriptions, metaproperty options, custom fields and collections. They are available only during upload, not batch edit, and add to existing data rather than overwriting it.
  - The mass uploader applies metadata from a CSV.
  - Bynder's "metadata inheritance" feature covers derivatives only (Title, Description, Author, Copyright).
  - Sources: [Bynder metadata presets](https://support.bynder.com/hc/en-us/articles/360013931319); [Bynder derivative inheritance](https://support.bynder.com/hc/en-us/articles/33620709174802-Metadata-inheritance-for-custom-image-derivatives); [Bynder migration guide PDF](https://dam.bynder.com/m/12b14ece55dd437c/original/EN-Migrating-assets-to-Bynder.pdf)
- **Canto:** admin metadata templates (keywords, tags, terms, copyright, watermark, custom fields) applied at upload. An optional upload pop-up can make chosen fields required before the upload completes. CSV import is keyed by filename or Content ID. — [Canto metadata templates](https://support.canto.com/hc/en-us/articles/23001734858385-Create-Metadata-Templates); [Canto upload settings](https://support.canto.com/hc/en-us/articles/23001399194513-Upload-Settings)
- **PhotoShelter for Brands:**
  - ObjectID (objects), BrandID (sponsors), TextID (predefined words), Custom Models, PeopleID (face matching against reference headshots) and RosterID (face plus jersey number from a synced roster).
  - Vendor claim: since 2022, more than 10M people tags on about 289k individuals across 5.5M images.
  - Sources: [PhotoShelter PeopleID](https://go.photoshelter.com/brands/blog/facial-recognition-auto-tagging-peopleid/); [PhotoShelter RosterID](https://go.photoshelter.com/brands/blog/artificial-intelligence-automated-metadata-rosterid); [PhotoShelter AI](https://brands.photoshelter.com/artificial-intelligence/)
- IPTC Event Identifier explicitly allows "a URL to a persistent calendar entry", which supports linking assets to a job or calendar record. — [IPTC spec 2025.1](http://www.iptc.org/std/photometadata/specification/IPTC-PhotoMetadata-2025.1.html)

### Inferences
- **Proposed ingest pipeline:**
  1. **Choose or create a Shoot.** The uploader, the watch-folder agent, or a CLI requires or offers a Shoot. A Shoot can be pre-created from a calendar entry (ICS or Google Calendar) carrying title, client, venue and time window. Folder or session names such as `2026-06-14_Smith-Jones_Wedding` are parsed into a suggested Shoot.
  2. **Template inheritance.** The Shoot carries an IPTC template: creator, credit, copyright, usage terms, event name, city and location, keywords such as "wedding". Fields support Photo Mechanic-style variables (`{serial}`, `{date}`, `{seq}`, `{shoot.client}`) and a serial-to-photographer lookup for multi-shooter jobs.
  3. **Clustering.** Within a Shoot, cluster by EXIF DateTimeOriginal (gap threshold, e.g. >20–30 min starts a new "moment") and by GPS (DBSCAN-style radius). Suggest sub-events such as ceremony, portraits and reception. Correct for per-body clock drift by aligning serials on overlapping frames.
  4. **Assets outside any Shoot window** are flagged "unassigned" for review. Never guess.
  5. **AI pass.** Batch-captioning gets the Shoot context and sub-event label, so captions say "the couple's first dance at the reception" and not "two people dancing".
- Shoot and event fields come from the human-supplied record and should be marked as human or template provenance, not AI, even though they were applied automatically.
- Lightroom import metadata presets work like Photo Mechanic templates (not fetched this session; see Gaps). Importing an existing Lightroom or Photo Mechanic template file (XMP) could seed DAM Shoot templates.

### Gaps
- I did not fetch Adobe's Lightroom Classic docs on "Apply During Import > Metadata" presets.
- I did not research Aprimo's metadata inheritance from collections or upload batches, or how PhotoShelter for photographers (as opposed to the Brands product) applies batch metadata.
- I found no published reference implementation of EXIF time and GPS clustering parameters for event segmentation. The thresholds above are my own proposal.

## 6. Face recognition: legal risk and options

### Takeaway
Face recognition carries the most legal risk and should be off by default, opt-in, and scoped per person:

- **Illinois BIPA:** private right of action, $1,000 or $5,000 per violation. The 2024 amendment limits recovery to one per person, and the Seventh Circuit applied it retroactively in April 2026.
- **Texas CUBI:** Attorney General enforcement, $25,000 per violation. Settlements: Meta $1.4B (2024, over photo tagging) and Google $1.375B (2025).
- **GDPR Article 9:** applies once photos are processed to uniquely identify people.
- **EU AI Act Article 5(1)(g):** bans biometric categorisation that infers sensitive traits (since 2 Feb 2025).

Claude will not identify people. AWS Rekognition collections are the practical managed option. InsightFace's popular open models are non-commercial without a paid licence.

### Cited Findings
- **BIPA amendment:**
  - SB 2979 (Public Act 103-0769), signed 2 Aug 2024. Repeated collection from the same person by the same method is a single violation with "at most, one recovery" under 15(b) and 15(d).
  - Statutory damages remain $1,000 (negligent) or $5,000 (reckless or intentional) per violation. The amendment responded to Cothron v. White Castle.
  - Sources: [Thompson Hine](https://www.thompsonhine.com/insights/illinois-legislature-amends-bipa-to-limit-damages-and-expand-consent-options/); [Kilpatrick Townsend](https://ktslaw.com/insights/alert/2024/5/illinois-legislature-passes-bill-amending-bipa-violation-accrual-standards)
- **Retroactivity:** on 1 April 2026 the Seventh Circuit held the amendment procedural and retroactive to pending cases. This binds federal courts in that circuit, not Illinois state courts. — [Paul Hastings](https://www.paulhastings.com/insights/ph-privacy/7th-circuit-confirms-bipa-amendment-has-retroactive-application); [ABA](https://www.americanbar.org/groups/litigation/resources/newsletters/class-actions-derivative-suits/retroactive-riddle-navigating-imprudent-rulings-on-bipa-amendment-application/)
- **Zellmer v. Meta:** the Ninth Circuit held that Facebook Tag Suggestions "face signatures" for a non-user were not biometric identifiers under BIPA. This was a search-result summary; the date was not confirmed. — [search summary; see Gaps]
- **Texas CUBI:**
  - Face geometry is a biometric identifier. Capturing it for commercial purposes needs notice and consent first.
  - $25,000 per violation, AG enforcement only.
  - Meta settled for $1.4B over photo-tagging face geometry (announced 30 July 2024, paid over 5 years). Google settled for $1.375B in May 2025 (biometric, geolocation and incognito claims). The AG set up a CUBI enforcement team.
  - Sources: [FindBiometrics](https://findbiometrics.com/meta-to-pay-1-4b-in-texas-biometric-privacy-lawsuit); [CSLawReport](https://www.cslawreport.com/21169961/texas-ags-billiondollar-settlement-with-google-highlights-biometric-data-use-compliance-considerations.thtml); [Faegre Drinker](https://www.faegredrinker.com/en/insights/publications/2024/8/texas-attorney-generals-office-zeroes-in-on-data-privacy-and-entities-using-biometric-data)
- **GDPR Recital 51:** photographs count as biometric data only "when processed through a specific technical means allowing the unique identification or authentication of a natural person". At that point Article 9 special-category rules apply. — [gdpr-text Recital 51](https://gdpr-text.com/es/read/recital-51); [VeraSafe](https://verasafe.com/blog/gdpr-and-photographs-understanding-special-categories-of-personal-data/)
- **EU AI Act Article 5(1)(g):** prohibits biometric categorisation that infers race, political opinions, trade-union membership, religious or philosophical beliefs, sex life or sexual orientation, in force since 2 Feb 2025. 1:1 verification is not prohibited. — [Orrick on Commission guidelines](https://www.orrick.com/en/insights/2025/04/eu-commission-publishes-guidelines-on-the-prohibited-ai-practices-under-the-ai-act); [Bundesnetzagentur](https://bundesnetzagentur.de/EN/Areas/Digitalisation/AI/08_ProhibitedPractices/start.html)
- **AWS Rekognition collections:** IndexFaces and SearchFacesByImage are Group 1 APIs at about $0.001 per image in the first tier. Stored face vectors cost $0.00001 per face per month. — [AWS Rekognition pricing](https://aws.amazon.com/rekognition/pricing/)
- **InsightFace:** code is MIT, but pretrained model packs (buffalo_l, antelopev2, etc.) are "non-commercial research purposes only". Commercial use needs a licence (recognition-oss-pack@insightface.ai). Permissive alternatives such as YuNet + SFace (Apache-2.0) are less accurate. — [InsightFace licensing](https://www.insightface.ai/solutions/face-recognition-licensing); [PyPI insightface](https://pypi.org/project/insightface/); [HF face-detect-gguf](https://huggingface.co/mudler/face-detect-gguf)
- Claude refuses to name people in images. — [Anthropic vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- PhotoShelter's PeopleID and RosterID match faces against reference headshots. Its consent and retention terms were not found in the marketing pages. — [PhotoShelter PeopleID](https://go.photoshelter.com/brands/blog/facial-recognition-auto-tagging-peopleid/)

### Inferences
- **Recommended design:**
  - **Phase 1: no biometrics.** People tags are manual or come from the Shoot roster: "people in this shoot" chosen per image, with keyboard-fast assignment. The AI prompt can say "two adults" and the human assigns names.
  - **Phase 2: optional, per-account, off by default face clustering.**
    - Requires explicit enabling plus a written consent record per enrolled person (name, consent date, scope, revocation).
    - Only enrolled people are matched. Unknown faces are never stored as templates, or are discarded after the run.
    - Geofence or disable for Illinois, Texas and Washington residents and EU subjects unless consent is on file.
    - Retention and destruction policy (BIPA requires a public retention schedule; not verified this session).
    - Rekognition collections in a region of choice, or a commercially licensed model.
  - Never infer or store sensitive attributes (ethnicity, religion, orientation, health). Tell the vision model so explicitly.
- Because wedding and event photographers in the US routinely photograph Illinois and Texas residents, even "cluster similar faces" with stored face vectors probably counts as capturing face geometry. The one-recovery-per-person BIPA cap still leaves $1,000–$5,000 per person in the photo library. Seek counsel before shipping.

### Gaps
- I did not fetch the full text of BIPA §15(a) (retention schedule) and §15(b) (written release), or Washington's and Colorado's biometric laws.
- The date and status of Zellmer v. Meta are unverified.
- I found no source on whether *client-side* (on-device) clustering changes BIPA or CUBI analysis.
- I did not cover high-risk AI Act obligations for remote biometric identification.

## 7. Human-in-the-loop review, confidence, field provenance and audit history

### Takeaway
No IPTC or XMP standard records *per-field* provenance (who or what wrote a caption, with which model, when). DigitalSourceType and the 2025.1 AI fields describe image generation. So the DAM needs:

1. An authoritative provenance and audit log in D1, recorded per field and per value.
2. A small custom XMP namespace so the provenance travels in sidecars. Define it in an ExifTool config so ExifTool can write it; other tools will read it as unknown XMP and should keep it.

### Cited Findings
- IPTC's AI properties (AI System Used, Version, Prompt Information, Prompt Writer) apply to AI-*generated images*. The prompt writer "should not be treated as the image creator". — [IPTC spec 2025.1](http://www.iptc.org/std/photometadata/specification/IPTC-PhotoMetadata-2025.1.html)
- IPTC guidance focuses Digital Source Type on how the file was produced. I found no IPTC guidance on marking machine-written captions or keywords. — [IPTC news](https://iptc.org/news/iptc-publishes-metadata-guidance-for-ai-generated-synthetic-media/)
- ExifTool writes custom namespaces only when they are defined in its config file. Block-copying XMP is the only way to carry unknown tags. — [ExifTool XMP tags](https://exiftool.org/TagNames/XMP.html); [ExifTool metafiles](https://exiftool.org/metafiles.html)
- The IPTC spec includes "Description Writer" (its notes were revised in 2021.1), which identifies who wrote the caption. — [IPTC spec 2025.1](http://www.iptc.org/std/photometadata/specification/IPTC-PhotoMetadata-2025.1.html)
- Anthropic advises carefully reviewing Claude's image interpretations and not using it for sensitive analysis without human oversight. — [Anthropic vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)

### Inferences
- **D1 schema sketch:**
  - `metadata_value(asset_id, field, lang, value, source ENUM(human, template, ai, import, exif), model, model_version, prompt_hash, confidence, status ENUM(suggested, accepted, edited, rejected), created_by, created_at, reviewed_by, reviewed_at)`
  - An append-only `metadata_event` log for history and undo.
  - The "effective" value of each field is the latest accepted one.
  - AI output starts as `suggested`. It is not published to public galleries or exported into sidecars unless the owner turns on auto-accept for that field (e.g. keywords above 0.8 confidence) or accepts it.
- **Review queue UX:**
  - Grid of a Shoot with AI alt/caption shown inline.
  - Accept-all per Shoot, or per moment cluster.
  - Keyboard approve, edit or reject.
  - Filters: "no alt text", "AI unreviewed", "low confidence", "mentions a person".
  - Highlight any proper noun not present in the Shoot context, as a likely hallucination.
- **Sidecar provenance:**
  - Write standard fields with the accepted values.
  - Set `photoshop:CaptionWriter` (IPTC "Description Writer") to the human reviewer, or to e.g. "AI (claude-haiku-5-5) / reviewed by M. McIntosh".
  - Add a custom namespace (e.g. `xmlns:damai="https://<dam-domain>/ns/ai/1.0/"`) with a per-field struct `damai:FieldProvenance` [{field, source, model, modelVersion, generatedAt, reviewedBy, reviewedAt, confidence}].
  - Publish an ExifTool config file for it.
  - Do **not** set DigitalSourceType to an AI value on camera originals.
- Whether Lightroom, Photo Mechanic and Capture One *keep* unknown XMP namespaces when they rewrite a sidecar is unverified. Treat the DAM's D1 log as authoritative and the sidecar copy as best effort.

### Gaps
- I did not verify any existing community or industry namespace for metadata provenance (e.g. C2PA assertions for metadata edits, or the XMP `xmpMM:History` semantics in detail).
- I did not test whether Lightroom or Photo Mechanic preserve unknown XMP namespaces on round trip.

## 8. Exposing the DAM to the owner's AI tools via MCP on Cloudflare

### Takeaway
Cloudflare's 2026 guidance for new remote MCP servers is the **stateless `createMcpHandler()`** (from `agents/mcp/server`), wrapped by the **Workers OAuth Provider** (`OAuthProvider`, tokens in a KV namespace, `/authorize`, `/token` and `/register` endpoints). The Durable Object-based `McpAgent` is now marked deprecated or legacy. Streamable HTTP is the transport.

Reference DAM servers:

- **Cloudinary:** official, broad read/write: upload, search, rename, folders, tags, plus separate metadata and analysis servers.
- **Bynder:** official, focused on natural-language search.
- **Adobe AEM Assets:** community servers only.

Design a small set of goal-oriented tools with scopes (read, write-metadata, export), and gate destructive or write tools by scope.

### Cited Findings
- Remote MCP servers use Streamable HTTP and OAuth; local servers use stdio. Cloudflare's guidance: design tools around user goals, not whole-API wrappers; scope permissions narrowly; write detailed parameter descriptions; run evals. — [Cloudflare MCP overview](https://developers.cloudflare.com/agents/model-context-protocol/)
- **Handlers:**
  - `createMcpHandler()` is stateless and recommended for new servers.
  - `createLegacyMcpHandler()` is the legacy protocol path.
  - `McpAgent` is "stateful, legacy, deprecated", a "Deprecated Durable Object and RPC server".
  - The quick-deploy templates (`remote-mcp-authless`, `remote-mcp-github-oauth`) still use McpAgent. The `mcp-worker` example in `cloudflare/agents` is recommended.
  - The OAuth example uses a KV namespace `OAUTH_KV` and secrets for the IdP.
  - Clients: Claude Desktop through `npx mcp-remote <url>/mcp`, MCP Inspector, and the AI Playground.
  - Source: [Cloudflare remote MCP guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
- **Authorization options:** Cloudflare Access; third-party OAuth (GitHub, Google) where the Worker issues its own MCP token; bring-your-own provider (Stytch, Auth0, WorkOS, Descope); or self-handled.
  - The Workers OAuth Provider Library implements OAuth 2.1 provider-side, configured with `apiRoute`, `apiHandler`, `defaultHandler`, `authorizeEndpoint`, `tokenEndpoint` and `clientRegistrationEndpoint`.
  - With `createMcpHandler`, `getMcpAuthContext()` returns app props, and `context.http.authInfo` holds clientId. Do not log the raw token.
  - Permissions are enforced either inside the tool (the model gets a denial) or by registering tools conditionally so unauthorized tools are hidden. Uses `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`.
  - Source: [Cloudflare MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/)
- **Cloudinary:** official Asset Management MCP server (`@cloudinary/asset-management-mcp`). Upload, manage, search and filter, delete or rename, folders and tags. Separate MCP servers for environment config, structured metadata, and AI analysis (auto-tagging, moderation, object detection). — [Cloudinary blog](https://cloudinary.com/blog/assets-management-cloudinary-mcp-server); [npm README](https://cdn.jsdelivr.net/npm/@cloudinary/asset-management-mcp@0.9.3/README.md)
- **Bynder:** official MCP server connecting Claude, Copilot and CLIs. Documented mainly for natural-language search over metadata and metaproperties. — [Bynder MCP](https://api.bynder.com/page/mcp)
- **AEM:** no Adobe-official AEM Assets MCP server was found. Community servers exist (e.g. SatoshiInoue/aem-assets-mcp-server, indrasishbanerjee/aem-mcp-server). — [Glama listing](https://glama.ai/mcp/servers/SatoshiInoue/aem-assets-mcp-server); [Glama listing](https://glama.ai/mcp/servers/@indrasishbanerjee/aem-mcp-server)

### Inferences
- **Proposed tool set** (goal-oriented, ~8–10 tools):
  - **Read (`dam:read`):**
    - `search_assets(query, shoot?, date_range?, people?, keywords?, has_alt?, review_status?, limit)` runs hybrid search: Vectorize plus D1.
    - `get_asset(id, placement?)` returns metadata, effective alt (placement-aware), provenance and a short-lived signed rendition URL. It does not return original bytes.
    - `list_shoots(filter)` and `get_shoot(id)`.
    - `view_image(id, size)` returns a downsampled image block so the client model can look at it.
  - **Write (`dam:write_metadata`):**
    - `propose_metadata(id|shoot, fields)` writes as `suggested`, with source = "mcp:<client>".
    - `apply_metadata(id, fields)` requires a separate scope.
    - `tag_assets(ids, add/remove keywords|people|event)`.
    - `create_shoot(...)` and `assign_to_shoot(ids, shoot)`.
  - **Export (`dam:export`):** `write_sidecars(ids|shoot, naming="basename.xmp"|"basename.ext.xmp")` and `export_with_metadata(ids, format)` return signed download URLs.
  - **Out of scope by default:** delete, share or publish tools, or put them behind an `admin` scope plus confirmation.
- **Auth:** the DAM owner is the only user, so the simplest option is Cloudflare Access in front of the MCP route, or OAuthProvider with the DAM's existing login as `defaultHandler`. Scopes become props, and tools are registered conditionally per granted scope.
- The stateless `createMcpHandler` fits the DAM: no session state is needed, and long jobs (batch captioning, sidecar export) return a job id polled with `get_job(id)`. This avoids holding an MCP session open.
- MCP writes should go through the same provenance and audit path as UI and AI writes (section 7), so an external agent's edits are attributable and reversible.

### Gaps
- I did not confirm the exact npm package name and version for the Workers OAuth Provider (`@cloudflare/workers-oauth-provider` per general knowledge; not stated on the pages fetched).
- I did not verify MCP spec details for scopes or resource indicators in the current MCP authorization spec revision.
- The Bynder MCP tool list (write capabilities) was not enumerated.

## 9. Writing EXIF/IPTC/XMP in a Workers environment; embed vs sidecar strategy

### Takeaway
The safest pattern is to **never mutate originals in R2**. Keep metadata in D1 as the source of truth. Generate XMP sidecars with a small custom serializer (XMP is just RDF/XML text). Embed metadata only into *derivative downloads or exports*, on demand.

For embedding:

- **ExifTool compiled to WASM via zeroperl** (`@uswriting/exiftool`, bundling ExifTool 13.42) can read and write in JS runtimes. It has a heavy cold start (a Go/wazero port reports about 7–10 s) and memory and CPU constraints, so run it in a Queue consumer, Workflow or Container, not in the request path.
- piexifjs-class libraries handle EXIF only and cannot write IPTC Core/Extension XMP.

### Cited Findings
- `@uswriting/exiftool`: "ExifTool (13.42) powered by WebAssembly to extract and write metadata from files in browsers and Node.js environments using zeroperl". It provides `writeMetadata(file, tags, options)`, which returns an ArrayBuffer, and runs without native binaries. — [npm README via jsDelivr](https://cdn.jsdelivr.net/npm/@uswriting/exiftool@1.0.9/README.md); [zeroperl write-up](https://andrews.substack.com/p/zeroperl-sandboxed-perl-with-webassembly)
- A Go/wazero ExifTool-WASM port reports a cold start of about 7–10 s to compile, instantiate and initialize Perl. — [go-exiftool-wasm](https://pkg.go.dev/github.com/lbe/go-exiftool-wasm)
- ExifTool's documented sidecar workflows: create `%d%f.xmp` from source; restore with `-tagsfromfile SRC.xmp -all:all DST.jpg`. Block copy is needed for unknown namespaces. — [ExifTool metafiles](https://exiftool.org/metafiles.html)
- Lightroom writes metadata *into* JPEG, DNG and TIFF and changes file modification times, which disrupted users' backup tools (community reports). This is a cautionary example for mutating originals. — [Adobe community](https://community.adobe.com/t5/lightroom-classic-discussions/enabling-quot-automatically-write-changes-to-xmp-quot-changes-orig-file-creation-modification-dates/m-p/12558644/highlight/true)
- Canto documents which metadata is "saved in a file when downloading", so embedding at download is an established DAM pattern. — [Canto help](https://support.canto.com/hc/en-us/articles/23002101443601-Metadata-that-will-be-saved-in-a-file-when-downloading)

### Inferences
- **Sidecars (all formats):** generate in the Worker with a custom TypeScript XMP serializer covering a fixed set of namespaces: dc, photoshop, Iptc4xmpCore, Iptc4xmpExt, xmp, xmpRights, plus the custom `damai` namespace. It needs correct Lang Alt (`rdf:Alt` with `xml:lang="x-default"`), Bag and Seq handling, and XML escaping. It is cheap, deterministic and testable against ExifTool round-trip (`exiftool -j file.xmp`) in CI.
  - Store sidecars in R2 next to originals, or generate them on the fly, and include them in zip exports.
  - When an imported asset already has a sidecar (Lightroom or darktable), parse it, merge it into D1, and preserve unknown namespaces by keeping the original packet and patching only the fields the DAM owns.
- **Embedded on export:**
  - JPEG, TIFF and DNG downloads: a Queue- or Workflow-driven job runs ExifTool-WASM (or a Cloudflare Container running native ExifTool 13.59, which avoids WASM cold start and memory limits) to inject XMP, mirrored IIM and EXIF.
  - Cache the result in R2 keyed by (asset, metadata-version hash).
  - For proprietary RAW, never embed; ship a sidecar.
- **Originals:** leave R2 originals byte-identical (checksum-verifiable). This preserves backup integrity and the "catalogue in place" model of an existing bucket (Phase 2d). Make "write metadata back into originals" an explicit, off-by-default action for photographers who want Lightroom-style behaviour.
- Workers have per-isolate memory limits (128 MB per Cloudflare's published limits; not re-fetched this session), so ExifTool-WASM on 50–100 MB RAW/TIFF files is risky in a Worker. Containers or streaming segment-rewriting for JPEG (APP1 XMP segment replacement) are safer. A minimal JPEG APP1 XMP injector is feasible in pure TS for the common case. Note that standard XMP is limited to about 64 KB per APP1 segment unless extended XMP is used (general JPEG/XMP knowledge; not verified this session).

### Gaps
- I did not evaluate exiv2-wasm or xmp-toolkit-rs (Adobe XMP Toolkit Rust bindings) compiled to wasm32 for Workers. No sources were fetched.
- I did not measure `@uswriting/exiftool` memory use, bundle size or cold start inside workerd. Its Workers compatibility is unverified.
- I did not re-fetch Workers memory and CPU limits or Containers pricing this session.
- Whether piexifjs is still maintained in 2026 was not checked.

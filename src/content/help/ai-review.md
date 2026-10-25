---
title: "AI review"
summary: "Letting an AI model describe your photos, what it costs, and how you stay in charge of what it writes."
section: Your photos
order: 5
---

AI review looks at each photo and writes suggestions: **alt text**, a **caption**, a longer description of **what it saw**, any **text in the picture** (signs, documents), suggested **keywords**, and a note on quality. It makes a large archive searchable in a way nobody has time to do by hand, and it's what [search by meaning](/help/search) reads.

It runs on **Workers AI in your own Cloudflare account**. Your photos aren't sent to any other company, and the model doesn't learn from them.

## You stay in charge

Nothing the AI writes replaces your own words unless you say so. On a [photo's page](/help/photo-page), under **AI suggestions**:

- **Use this** copies a suggestion into an empty field; **Replace mine** overwrites what's there.
- Suggested keywords are searchable straight away, marked as the AI's. **✓** keeps one as your own, **×** drops it, **Keep all** keeps them all.
- **Analyse** runs it again (after you've changed the context below, for example).

To accept suggestions for many photos at once, select them in the library and use **AI…**: **Use AI captions where empty**, **Use AI alt text where empty**, **Keep AI tags**, or **Analyse again**.

## The AI review page

**AI review** (under **Setup** in the menu) shows how many photos are **analysed**, **in the queue**, **never analysed** and **failed**, and what it costs per 1,000 photos on your archive.

### Settings (administrators)

- **AI review:** on or off. Off stops all analysis; suggestions already made are kept.
- **Analyse new uploads:** each new photo is queued once it has a preview. Photos from a helper are queued after a folder's first scan.
- **Model:** the AI model to use. The page says what each is good at.
- **About your work:** a sentence about you, given to the model with every photo so its keywords fit your archive, for example *"Wedding and landscape photographer in western Norway"* or *"Bird photography, mostly Florida wetlands"*.

### Analysing everything at once

If some photos have never been analysed, **Analyse the back catalogue** says how many, and roughly what it will cost. Press **Queue** to start. Photos are worked through in the background, several at a time; you can carry on working. A photo that fails is tried again a couple of times, then marked **failed** with the reason.

## People in photos

Beside the AI review, TypeSafe's **Jev** looks at each new photo for people, and how many, for the library's **People** filter. It's faster and cheaper than the AI review (about 9 cents per 1,000 photos), and in a test on 805 photos it found people in 87 where the AI review found 47, mostly small figures in the background. It writes no text.

- **What is sent:** a 1,024 px copy of each photo, without its filename, camera data or location, goes to TypeSafe (api.typesafe.ai). TypeSafe says it doesn't train on it.
- **Older photos:** the **People in photos** panel on this page counts what's been found (each number opens those photos in the library) and **Look at N photos not looked at yet** does the rest.
- **Switches:** **Look for people** off sends nothing more to TypeSafe (answers already found stay, and the filter keeps working); **In new photos as they arrive** off leaves new photos waiting for the button.
- **Wrong answers:** correct one on the photo's page, or many at once in the library (select them, then **People…**). Jev never changes an answer set by hand, and **Back to Jev's answer** undoes it.
- **Photos it couldn't look at** are listed with the reason: too small, refused by TypeSafe, or failed three times (with **Try again**).
- Videos aren't looked at, nor photos under 280 pixels on a side.

## What it costs

Workers AI is billed in **neurons**. Cloudflare gives 10,000 neurons a day free, then charges $0.011 per 1,000.

For a real example: reviewing 662 bird photos used about 30,000 neurons, about **33 cents**, or about 22 cents after the free daily allowance. That's roughly 50 cents per 1,000 photos. The AI review page shows the figure for your own archive.

## How good is it?

It's good at what's in a picture (*a grey heron standing in shallow water among reeds*) and at reading text. It doesn't know who people are, the names of places it can't read, or the story behind a photo. Those are yours to add. Treat its keywords as a first pass, and its alt text as a draft.

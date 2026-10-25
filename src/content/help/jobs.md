---
title: "Jobs"
summary: "Following each piece of work for a client from booking to delivery: shoot dates, stages, albums, galleries, and what needs attention."
section: Sharing
order: 4
---

A **job** is one piece of work for a client: a wedding, a portrait session, a product shoot. It keeps the shoot dates, the place, where the work has got to, and its albums. Its galleries are its albums' galleries. **Jobs** is the first tab of **Client work** in the menu, beside **Clients** and **Client galleries**; like clients, only **administrators** see it.

## Making a job

- **From the Library**, the usual way, after the shoot: filter the Library to the shoot's photos (an album, a month, a folder, a keyword), then press **New job from these photos**. The form fills in the shoot dates from the photos and offers to put them in the job's first album.
- **From a client's page**: **New job** there chooses the client for you.
- **From Jobs**: **New job**. You can make a new client in the same form: choose **+ New client** and type their name.

Give it a title for your team (*Hansen wedding*) and, if you like, a **Name the client sees** (*Your wedding*), the kind of job, the shoot date (and the last day, for a shoot over several days), the place, and when delivery is due.

On the job's page, **Link to your CRM** keeps the address of this job in your CRM, with **Open in…** beside it (see [Clients](/help/clients)).

## Stages

A job moves through **Booked**, **Shot**, **Editing**, **Proofing**, **Final edits**, **Delivered** and **Completed**, or is **Cancelled**. Press a stage on the job's page to move it there, forward or back. **Proofing** and **Final edits** (dashed) can be skipped: a portrait session or a product shoot often has no proofing.

Two moves happen by themselves, and the history says so:

- **Booked → Shot** when photos taken on the shoot dates arrive in the archive.
- **→ Delivered** when you make a gallery from one of the job's albums with **Final delivery** ticked (see [Client galleries](/help/client-galleries)).

Everything else is up to you. **Completed** is for when the work is done and paid for.

## Albums and galleries

On the job's page, **Albums** lists its albums with their photos and galleries:

- **Add an album** puts an album you already have in the job. An album belongs to one job at most; a photo can be in several.
- **New album of the photos from the shoot dates** makes one from every photo taken on those days.
- **Make a gallery** opens the album with the gallery form ready.
- **Take out of job** leaves the album and its galleries as they are.

An album that's part of a job shows a link to it at the top of its page.

## Originals

**Originals** on the job's page says where its photos' original files are:

- how many **can be read now** (from the archive's own storage, a computer or NAS, or a restored copy);
- how many **need a restore**: they're only in a cold archive (Glacier or Deep Archive), so nobody can download them until they're brought back;
- how many are **only on a computer or NAS**: you can open them, but a client gallery can't offer them as originals;
- how many have a **cold backup**, a copy in Glacier or Deep Archive. With the archive's own copy kept, a cold backup doesn't make a photo unreadable.

The **Jobs** list shows the same in short: *Readable* or *n need a restore*, and *cold backup* when every photo has one.

### Restoring a job

Before a reprint order, say, press **Restore n originals…**. Choose the **Speed** (*Bulk*: cheapest, up to 48 hours; *Standard*: faster, up to 12 hours) and how many days to keep the copies, then **See the cost**: getting them out of the archive, keeping the copies, and what it costs if clients download them all once (often the biggest part). Then confirm. The page shows how far the restore has got, and until when the copies are ready. The originals stay in the archive; the restored copies disappear after the days you chose.

Restoring needs the permission to manage storage tiers (administrators have it).

When a gallery offers originals and some of the album's originals are archived or only on a NAS, the gallery form says so before you make the link.

## Archiving after delivery

When **Archive delivered jobs** is on (on the **Storage** page: choose the S3 connection, **Deep Archive** or **Glacier Flexible**, and how many days after delivery), every original in a delivered job's albums gets a copy in that cold class once the days have passed. The copy kept in cf-dam's own storage stays, so nothing becomes slower to open: the cold copy is a backup that costs very little to keep.

- Before you switch it on, **What would it archive now?** shows how many jobs, originals and GB it would copy at once (every job already delivered long enough counts), what that costs a month to keep and once to upload.
- Each part of a copy is checked as it arrives, and the copy's size is compared at the end. A copy interrupted carries on where it stopped.
- Delivering a job again, after taking it back to **Editing** say, starts its days again.
- **Keep hot** on a job's page never archives it automatically (reprints, albums in progress).
- **Archive now** copies a job straight away, in the class you choose (needs the permission to manage storage connections).
- Originals that are only on a computer or NAS are archived by its helper when that folder archives to S3 (**Computers and NAS**); if it doesn't, the job says how many are left out.
- Originals that couldn't be copied after three tries show as an alert.

Under **Originals**, **Cold backup** on the job's page says where it stands: when it will be archived, how far a copy has got, when it was archived, or what's in the way.

## What needs attention

At the top of **Jobs**, **Needs attention** lists:

- delivery due within 7 days, or overdue;
- a shoot more than 3 days ago with no photos from it yet;
- a job's gallery closing within 7 days;
- a proofing gallery with no favourites after 14 days.

**In progress** shows open jobs by stage, soonest shoot first; **Delivered and closed** and **All** show the rest. Search by title, place or client; accents don't matter.

## Deleting a job

**Delete job** at the bottom of its page (press it twice) removes the job only: its albums and galleries stay. Erasing a client (see [Clients](/help/clients)) removes their jobs too.

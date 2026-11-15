---
title: "Archiving and restoring originals"
summary: "Keeping a safe, cheap copy of every original in Amazon Glacier, and getting a photo back when you need it."
section: Where photos are kept
order: 3
---

An **archive** is a copy of your originals somewhere safe and cheap, for the day a disk fails or a NAS is stolen. Amazon's **Glacier Deep Archive** keeps a terabyte for about a dollar a month. The catch is that getting a file back takes hours, so it's for keeping, not for everyday use.

cf-dam can archive in two ways, depending on where your originals are.

## Originals on a NAS or computer

The helper on your NAS or computer can copy each original to an S3 bucket by itself.

1. First connect a bucket on the **Storage** page (see [Connecting Amazon S3](/help/amazon-s3)).
2. On **Computers and NAS**, find the helper and, under **Archive originals**, press **Set up archiving**.
3. Choose the **Bucket** and the **Storage class**: **Deep Archive** for the cheapest keeping.
4. Choose the hours it may work (**From** and **Until**, on the helper's own clock), for example overnight, and a speed limit in Mbps so it doesn't fill your internet connection. The same hour in both means any time; 0 Mbps means no limit.
5. Save.

The helper copies each original once it has been left alone for a day (so it doesn't archive a file you're still editing), and checks each part as it lands. It only ever **reads** your files: it never changes or deletes them. The panel shows what's been sent, what's left and roughly how long it will take.

Each copy in the bucket is stored under the photo's catalog number, and labelled with where the file was: its full path, the helper's name and the file's date, in the copy's own metadata (`cf-dam-path`, `cf-dam-helper` and `cf-dam-modified`, with spaces and accents written as `%20`-style codes). So even without cf-dam, the bucket says where each file belongs. Identical files share one copy, labelled with the first one found. A path too long for the label (over about 2,000 characters) is left off, and the file is still archived.

You can **Change** the settings or **Stop archiving** at any time. What's already in the bucket stays there.

### When something can't be archived

The panel says "Everything settled is archived" only when that's true. Otherwise it tells you what's wrong:

- **The bucket is refusing.** The bucket turned the helper away (its role or keys stopped working, the bucket was removed, or AWS was busy). The helper waits 15 minutes and tries again, waiting longer each time, up to two hours. No file is held against it. An alert stays open until the bucket answers again.
- **Files couldn't be archived.** A file failed three times for a reason of its own. The panel names the last one and why. The helper tries them again by itself once a week, or straight away when you press **Try them again**. A file you edit gets a fresh start.
- **Files couldn't be read.** The helper couldn't open them, so cf-dam has no photo for them and they aren't archived.
- **Archived files can no longer be read.** A file that was archived can't be opened any more: a failing disk, or something that changed it. Its archived copy is kept. Check the file before anything else happens to it.
- **Files changed without their date moving.** Part of a file came back different from what was already sent, though its date and size are the same. That's how a failing disk, or a program writing into files, looks. The helper stops sending that file and asks you: **Archive them as they are now**, or **Keep the copies in the bucket**. A file with no copy in the bucket yet (its first archive was under way) has nothing to keep, so it stays held until you choose to archive it. Either choice is recorded in **Activity**.

### Earlier copies

When a file you've edited is archived again, the copy made before stays in the bucket, and cf-dam keeps track of it: the photo page lists its **Earlier copies** with their dates, and the bucket can't be removed from cf-dam while it holds them. If many archived files change or can no longer be read in one day (ransomware, a sync gone wrong, a failing disk), an alert says so, so you can check before the changed files are archived again.

A big file is sent in parts over several nights if it needs to. If the bucket ends an unfinished upload (an "abort incomplete uploads" rule shorter than a week can), the helper starts that file again; after three times it gives the file up and says so. Set that rule to 7 days or more.

## Originals already in a bucket

For a photo whose original is in S3, its page shows where it is and lets you **Move** it to another storage class, for example from Standard to Deep Archive.

> Amazon bills a **minimum stay**: 30 days for the IA classes, 90 days for Glacier and 180 days for Deep Archive. Moving a photo out sooner still costs the whole period, so only move photos you're sure you'll leave alone.

## Getting a photo back from Glacier

A file in Glacier or Deep Archive can't be opened straight away. Amazon has to bring a copy back first:

1. Open the photo's page. Under the original's storage, choose how fast:

   | Speed | Glacier Flexible Retrieval | Deep Archive | Cost |
   | --- | --- | --- | --- |
   | **Expedited** | minutes | not offered | the most |
   | **Standard** | 3 to 5 hours | within 12 hours | about $20 per TB from Deep Archive |
   | **Bulk** | 5 to 12 hours | within 48 hours | the least: about $2.50 per TB from Deep Archive |

2. Choose how long to **Keep restored for** (the copy disappears after that, and the original stays archived).
3. Press **Request restore**.

cf-dam checks on the restore by itself and shows when it's ready; **Check status** asks Amazon straight away. Once restored, the photo can be downloaded as usual until the copy expires.

Your thumbnails and previews are never in Glacier: you can always see, search, keyword and share every photo, even while its original is in the deepest archive.

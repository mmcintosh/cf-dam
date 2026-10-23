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

You can **Change** the settings or **Stop archiving** at any time. What's already in the bucket stays there.

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

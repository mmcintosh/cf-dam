---
title: "Where originals are kept"
summary: "The difference between the catalogue and the originals, and the places cf-dam can keep originals."
section: Where photos are kept
order: 1
---

cf-dam keeps two different things in two different places.

- **The catalogue:** everything cf-dam knows about each photo (its details, keywords, captions, ratings) plus a small **thumbnail** and a larger **preview**. These always live in your Cloudflare account, so the library is quick whatever happens to the originals.
- **The originals:** the full files from your camera. These can be in any of the places below, and different photos can be in different places.

## The places originals can be

| Where | Good for | Notes |
| --- | --- | --- |
| **Cloudflare R2** (built in) | Getting started; photos you open often | Already set up. No charge for downloading. |
| **Amazon S3** | Large archives; very cheap long-term storage | Needs an Amazon Web Services account. See [Connecting Amazon S3](/help/amazon-s3). |
| **Backblaze B2, Wasabi, R2 (second bucket)** | Cheaper alternatives to Amazon | Connect with access keys, like S3. |
| **Your NAS or computer** | Photos you already keep at home or in the studio | Nothing moves: a helper catalogues them where they are. See [Computers and NAS](/help/computers-and-nas). |

The **Storage** page lists every place you've connected. One of them is the **Default**, where uploads go unless you choose another in the upload box.

## Connecting a bucket

On **Storage**, press **Add an S3 connection** and pick the provider. cf-dam fills in what it can. You then give it:

- **Name:** anything that helps you recognise it, such as "Studio archive".
- **Bucket:** the bucket's name, exactly as the provider shows it.
- **Region:** where the bucket is, such as `us-east-1`.
- **Folder in the bucket** (optional): keeps cf-dam's files in one folder, such as `cf-dam`.
- **How to sign in:** access keys, or for Amazon, the keyless option (see [Connecting Amazon S3](/help/amazon-s3)).
- **Storage classes this bucket offers**, and the **default class for uploads**.

Press **Add and test**. cf-dam writes a small test file, reads it back and deletes it. "Connected" means it all worked; anything else comes with the reason.

> **Uploading from the browser into a bucket** needs one more setting on the bucket itself, called a CORS rule. The form shows the exact rule to copy under "Browser uploads go straight to the bucket". Without it, uploads to that bucket fail with a network error.

## Photos already in a bucket

If the bucket already has photos in it, open **Catalogue files already in this bucket** under the connection and press **Import**. Every file becomes searchable where it is: nothing is copied or moved. You can start from one folder, such as `photos/2019/`. Previews are made in the background. Files in deep storage are listed with their name, size and class until you restore them.

## Storage classes, in short

Amazon offers cheaper "classes" for files you rarely open. The cheaper the storage, the longer and costlier it is to get a file back:

| Class | Roughly per terabyte a month | Getting a file back |
| --- | --- | --- |
| Standard | $23 | At once |
| Standard-IA (infrequent access) | $12.50 | At once, small fee per GB |
| Glacier Flexible Retrieval | $3.60 | 3 to 12 hours |
| Glacier Deep Archive | $1 | Within 12 to 48 hours |

Prices are Amazon's published US prices at the time of writing; check [Amazon's S3 pricing page](https://aws.amazon.com/s3/pricing/) for yours. Amazon also bills a **minimum stay**: 30 days for the IA classes, 90 for Glacier and 180 for Deep Archive, even if you delete or move the file sooner.

You can move one photo between classes from its page (**Move**), and get a photo back from Glacier with **Request restore**. See [Archiving and restoring](/help/archiving).

## The other parts of the Storage page

- **Checks:** cf-dam regularly makes sure the originals it knows about are still where it thinks. Problems show here and as an alert.
- **Archive delivered jobs:** a cold copy of each delivered job's originals in S3, some days after delivery. See [Jobs](/help/jobs).
- **Cloudflare Images this month:** how many images Cloudflare made for previews, thumbnails, AI and watermarks this month, which Cloudflare bills beyond your plan's allowance, with an alert when it passes the number you set.
- **Previews:** checks that every thumbnail and preview is really there, and makes missing ones again. See [Backups and restoring the catalogue](/help/backups).
- **Catalog backups:** daily copies of the catalogue itself. See [Backups and restoring the catalogue](/help/backups).

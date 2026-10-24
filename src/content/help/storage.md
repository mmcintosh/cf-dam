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

The **Storage** page lists every place you've connected, one row each: what kind it is, how many originals it keeps and how much space they take, and what uses it (**New uploads**, **Job archive**, **Catalog backups**, a helper's archive). One of them is the **Default**, where uploads go unless you choose another in the upload box. Press a row to open that connection's own page.

## Connecting a bucket

On **Storage**, press **Add a connection** and pick the provider. cf-dam fills in what it can. You then give it:

- **Name:** anything that helps you recognise it, such as "Studio archive".
- **Bucket:** the bucket's name, exactly as the provider shows it.
- **Region:** where the bucket is, such as `us-east-1`.
- **Folder in the bucket** (optional): keeps cf-dam's files in one folder, such as `cf-dam`.
- **How to sign in:** access keys, or for Amazon, the keyless option (see [Connecting Amazon S3](/help/amazon-s3)).
- **Storage classes this bucket offers**, and the **default class for uploads**.

Press **Add and test**. cf-dam opens the new connection's page and tests it: it writes a small test file (inside the folder, if you gave one), reads it back and deletes it, and says whether that worked or why not. For a keyless Amazon connection it opens the AWS steps instead, since nothing works until they're done.

## A connection's page

- **What's kept here:** how many originals have a copy here and how much space they take, by kind of storage (hot, warm, cold, deep archive), with links that show those photos in the library. Also job archive copies still to make, and catalog backups kept here. These are counted from the catalogue, not by looking in the bucket.
- **What uses it:** new uploads (if it's the default), archiving delivered jobs, the daily catalog backup, a NAS or Mac helper's archive, each with where to change it.
- **Uploading from the browser:** see below.
- **Catalogue files already in this bucket:** see "Photos already in a bucket" below.
- **AWS setup** (keyless Amazon connections): the steps and policies to create in AWS. See [Connecting Amazon S3](/help/amazon-s3).
- **Details:** press **Edit** to rename it, change the storage classes it offers and the default class, or change its role (keyless) or access keys. A new secret replaces the old one; leave it empty to keep it. Saving new credentials tests them at once. The **bucket, region, endpoint and folder** can only change while nothing is kept there and nothing uses it, because originals are stored under those names: to move to another bucket, add a new connection.
- **Remove:** forgets the connection (the bucket and its files stay as they are). It can't be removed while anything is kept there or uses it; the page lists what does.

## Uploading from the browser, and the CORS rule

When you upload to an S3 connection (it's the default, or you picked it in the upload box), your browser sends the photos **straight to the bucket**, not through cf-dam. A bucket refuses that unless it allows this site, with a setting on the bucket called a **CORS rule**.

1. On the connection's page, under **Uploading from the browser**, press **Copy** beside the rule.
2. In the AWS console: **S3**, the bucket, **Permissions**, **Cross-origin resource sharing (CORS)**, **Edit**. Paste it and save. (Other services have the same setting on the bucket.)
3. Back in cf-dam, press **Test uploading from this browser**. It sends one byte the way an upload does and says whether the bucket took it, and if not, why.

You only need the rule for uploading from the browser. cf-dam's own copies (archiving jobs, backups, moving between classes, restores) and the NAS or Mac helper reach the bucket without it.

## Photos already in a bucket

If the bucket already has photos in it, open the connection's page and, under **Catalogue files already in this bucket**, press **Import**. Every file becomes searchable where it is: nothing is copied or moved. You can start from one folder, such as `photos/2019/`. Previews are made in the background. Files in deep storage are listed with their name, size and class until you restore them.

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

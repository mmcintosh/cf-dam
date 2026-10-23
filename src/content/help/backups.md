---
title: "Backups and restoring the catalogue"
summary: "Daily copies of the catalogue, how to bring it back into a new install, and the preview check."
section: Where photos are kept
order: 4
---

Your photos' **originals** are protected by where you keep them (see [Archiving and restoring originals](/help/archiving)). The **catalogue** (every photo's details, keywords, captions, ratings, albums, galleries and people) is protected by **catalogue backups**.

## Turning backups on

On **Storage**, under **Catalog backups**:

1. **Back up to:** choose a bucket. Any connected bucket works; the built-in one is there already.
2. **Every day at:** the hour (in UTC; cf-dam shows your local time beside it).
3. **Keep for:** how many days of backups to keep. Older ones are deleted, but never the newest.
4. Press **Save**. The first backup starts within a minute; **Back up now** runs one at any time.

> **Use a bucket outside Cloudflare if you can.** The built-in bucket is in the same Cloudflare account as the catalogue, so it protects against mistakes but not against losing the account. A bucket in Amazon S3 (or Backblaze B2, Wasabi…) protects against both.

### What's in a backup, and what isn't

| In it | Not in it |
| --- | --- |
| Every photo's details, keywords, captions, ratings, labels | The original files (they're wherever you keep them) |
| Albums, client galleries, their visitors and picks | Passwords, passkeys, two-step codes, sign-ins |
| People and their roles | API keys |
| Keywords, presets, settings, helper connections | Thumbnails and previews (they're made again) |

Because passwords aren't in a backup, after a restore everyone is given a new password.

## Bringing the catalogue back

A restore goes into a **new, empty** cf-dam (for example after starting again in a new Cloudflare account):

1. Install cf-dam as usual. On the first page, choose **Restore from a backup** instead of **Start a new archive**.
2. Say **where the backups are**: this install's built-in storage if it still has them, or an S3 bucket. Read-only keys are enough; they're kept only until the restore has finished.
3. **Choose a backup** from the list, and create the first administrator.

The restore runs in the background and can be followed on the page. If it stops (a network problem, say), **try again**: it carries on where it stopped.

After a restore:

- **Helpers** on your NAS and computers pair again and get their own entries back, so they don't send everything twice. See [Computers and NAS](/help/computers-and-nas).
- **Thumbnails and previews** are made again: from the originals where cf-dam can read them, and by the helpers for originals on a NAS.

## The preview check

On **Storage**, under **Previews**, **Check every preview** asks the built-in storage about each thumbnail and preview, and makes again any that are missing. At a million photos it takes some hours and costs well under a dollar. **Try the stuck ones again** retries any that couldn't be made.

You won't normally need this: cf-dam notices a missing preview the first time someone opens it. It's there for after a restore, or for peace of mind.

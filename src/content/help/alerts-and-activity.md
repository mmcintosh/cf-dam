---
title: "Alerts and activity"
summary: "Problems that need someone, and the record of who did what."
section: People and security
order: 3
---

Both pages are for administrators.

## Alerts

cf-dam checks itself every five minutes and raises an **alert** when something needs a person. The menu shows how many are open beside **Alerts**.

| Alert | What it usually means | What to do |
| --- | --- | --- |
| A helper is offline | A NAS or computer is off, asleep, or lost its network connection. | Check it's on. After a network change, restart the helper (or its container). |
| A helper isn't allowed to read a folder | The computer or NAS won't let it in: on a Mac, it was refused access to Pictures, a drive or a network volume. | On a Mac: **System Settings → Privacy & Security → Files and Folders** (or **Full Disk Access**), allow `node`. On a NAS: the folder's permissions. |
| Archiving problems | A helper couldn't copy originals to the archive bucket. | The alert says why: often the bucket's permissions. |
| Storage problems | Originals cf-dam expected weren't where it thought, or a bucket can't be read. | Open **Storage → Checks**. |
| Backups failing or overdue | The daily catalogue backup didn't finish. | See [Backups](/help/backups); check the backup bucket. |
| Previews stuck | Some thumbnails or previews couldn't be made. | **Storage → Previews → Try the stuck ones again**. |
| Background work failing or stopped | The work cf-dam does every minute (processing, AI, checks, backups) has an error or hasn't run. | The alert says which part. If it's stopped altogether, look for errors in the Worker's logs in the Cloudflare dashboard, or deploy again. |

Each alert says since when, and **Go to** the page that fixes it. When the problem is put right, the alert closes by itself and moves to **Put right in the last two weeks**.

**Dismiss** takes an alert out of the count while you deal with it (or if you've decided it doesn't matter). It counts again if it comes back after being put right; **Count it again** undoes a dismissal.

## Activity

**Activity** is the record of who signed in, and who changed what, newest first: sign-ins (and failed ones), people added or changed, roles, two-step sign-in changes, storage connections, imports, deletions, galleries shared, AI review queued, settings changed, and background work such as backups and checks.

Narrow it by **Kind** of event, or by **Person**. It's the first place to look when something has changed and you don't know how.

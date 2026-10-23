---
title: "Computers and NAS"
summary: "The small helper that catalogues photos on your NAS or computer without moving them, and how to set it up."
section: Computers and NAS
order: 1
---

Many photographers keep their photos on a **NAS** (a network drive in the studio or at home) or on a computer's drives. cf-dam can catalogue them **where they are**: a small helper program runs next to the photos, reads each one, and sends cf-dam its details and a thumbnail and preview. The originals never move and are never changed.

You can have several helpers, for example one on the NAS and one on a laptop.

## What the helper does

- Reads each photo's details (camera, date, place, keywords, captions) and makes a thumbnail and preview.
- Sends those to cf-dam, so the photos appear in the library and can be searched, keyworded and shared.
- Scans again every so often, picking up new, changed, renamed and deleted photos. A photo whose file disappears is marked **missing**, never deleted from the catalogue.
- Optionally copies originals to an archive bucket (see [Archiving and restoring originals](/help/archiving)).
- On a big first scan it sends all the thumbnails first, so the library fills quickly, then the larger previews.

It only ever **reads** your photo folders. Synology's own folders (`@eaDir`, `#recycle`), Mac and Windows clutter and Lightroom caches are always skipped.

## Adding a helper

On **Computers and NAS**, press **Add a computer or NAS**, then choose where it runs. The page shows the exact steps for each; here's the outline.

### On a NAS

The helper runs as a **Docker container**, a standard way to run small programs on a NAS. Choose your NAS under **Which NAS?** and cf-dam shows the steps for it, with a ready-made setup file (a "compose file") to copy:

| NAS | Where the setup file goes |
| --- | --- |
| Synology | Container Manager → Project → Create |
| QNAP | Container Station → Applications → Create |
| UGREEN | The Docker app: create a project |
| TerraMaster | Docker Manager: create a project |
| Asustor | Portainer (from App Central) → Stacks → Add stack |
| TrueNAS (24.10 or later) | Apps → Discover Apps → ⋮ → Install via YAML |
| Unraid | Docker → Add Container (cf-dam lists each field), or the Compose Manager plugin |
| OpenMediaVault | Services → Compose → Files → Add (with omv-extras) |
| Another Linux computer | Save the file and run `docker compose up -d` |

**Paste the setup file as it is: there's nothing to change in it.** It lets the helper *read* your NAS's main drive (`:ro` means read-only: it can never change or delete anything there), and you choose which photo folders it catalogues afterwards, from a list in cf-dam. The helper needs about 1 GB of memory, and runs on Intel, AMD and ARM NAS models.

Photos on a second drive too? The setup file has a comment showing the one line to add for it.

**WD My Cloud and Buffalo** NAS models can't run Docker. Run the helper on a Mac or PC that can see the NAS's shared folders instead.

### On a Mac or Windows PC

1. Install **Node.js 24** (the LTS installer) from [nodejs.org](https://nodejs.org), if it isn't there already.
2. Unzip the helper and open a terminal (Mac: **Terminal**; Windows: **PowerShell**) in its folder.
3. Run the command the page shows. It already contains your archive's address.
4. On a Mac, when macOS asks whether `node` may read your Pictures folder, drives or network volumes, **allow it**.

The helper starts by itself whenever you sign in to the computer, as you, so it sees your drives and shares.

## Pairing

Every new helper shows an **eight-letter code**: on its own page (`http://your-nas:8790` or `http://localhost:8790`) and in its log.

1. Type the code into **Enter the code** on the Computers and NAS page.
2. Give the helper a name, such as "Studio NAS", and press **Connect**.

The helper gets a key that can only send photos to this archive: it can't read anything else or change anyone's photos. If you're setting up a helper again (say after reinstalling the NAS), choose **As "…" again** so it gets back its entry, folders and photos instead of sending everything twice.

## Choosing folders

Under the helper, in **Folders**, choose a folder from the list (it shows your NAS's shared folders and the folders inside them, as the NAS names them, such as `/volume1/photo/2024`) and press **Index this folder**. The first scan starts straight away. Each folder shows when it was last scanned. Folders on removable drives say so, and show as offline while the drive is unplugged.

**Remove** stops indexing a folder. Its photos stay in cf-dam, marked missing.

## Keeping an eye on it

Each helper's card shows whether it's **Online**, **Scanning** or when it was **Last seen**; how many photos it has; how many are missing; and what it's doing now. **Scan now** starts a scan, and **Pause** stops it working until you **Resume**.

If a helper hasn't been in touch for a while, an alert appears for administrators (see [Alerts and activity](/help/alerts-and-activity)). The usual causes are the NAS or computer being off, asleep, or after a network change. Restarting the helper (or its container) fixes most of them.

**Disconnect** removes a helper's key. Its photos stay in cf-dam.

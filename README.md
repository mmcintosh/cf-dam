# cf-dam

An open-source digital asset manager that runs entirely on Cloudflare.

cf-dam is built for photographers and studios whose archives have outgrown their NAS. It indexes,
thumbnails, catalogs and AI-reviews every file where it already lives, then moves originals through
cheaper storage tiers (R2, then warm storage, then deep archive) while the catalog stays searchable
and online.

> **Status: early scaffold.** Nothing here is usable yet. The project is being stood up from the
> media system of the [Infowall](https://infowall.ai) CMS.

## What it will do

- **Catalog in place.** A small agent on your NAS scans files, reads EXIF/IPTC/XMP, pulls RAW
  previews and uploads thumbnails, so the cloud index is complete before any original moves.
- **Metadata stays in your files.** Keywords and captions are written back to XMP sidecars, never
  held hostage in a database.
- **AI review.** Tags, alt text and captions from Workers AI, with an approve/dismiss workflow.
- **Search everything.** Full text plus camera, lens, aperture, date and tag filters.
- **Tiered lifecycle.** Policies move originals from hot to warm to cold storage (for example S3
  Glacier Deep Archive), and restore them on request.
- **One-click install.** Deploy to your own Cloudflare account; D1, R2 and the Worker are
  provisioned for you.

## Architecture

One Cloudflare Worker serves everything:

```
Request ─▶ Hono app (apps/dam/src/fetch.ts)
            ├─ /api/*   JSON API (packages/api)         D1 · R2 · KV · Workers AI · Queues
            └─ /*       Astro pages (apps/dam/src/pages)
```

| Path | What it is |
| --- | --- |
| `apps/dam` | The deployable Worker: Astro front end plus the Hono entry that mounts the API |
| `packages/api` | The DAM's JSON API (Hono) |

## Development

Requires Node 22+.

```sh
npm install
npm run dev        # Astro + API on http://localhost:4321 with local D1/R2
npm test           # unit tests
npm run check      # type checks
```

## License

To be decided (MIT or Apache-2.0).

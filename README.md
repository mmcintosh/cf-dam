# cf-dam

[![CI](https://github.com/mmcintosh/cf-dam/actions/workflows/ci.yml/badge.svg)](https://github.com/mmcintosh/cf-dam/actions/workflows/ci.yml)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mmcintosh/cf-dam)

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
- **Search everything.** Full text plus camera, lens, aperture, date and tag filters, and (optional)
  search by meaning: "birds by the water" finds the heron nobody keyworded "bird".
- **Rotate and crop without touching the original**, and download a copy in a chosen size, with a
  watermark, or with the background removed.
- **Tiered lifecycle.** Policies move originals from hot to warm to cold storage (for example S3
  Glacier Deep Archive), and restore them on request.
- **One-click install.** Deploy to your own Cloudflare account; D1, R2 and the Worker are
  provisioned for you.

## Architecture

One Cloudflare Worker serves everything:

```
Request ─▶ Hono app (src/fetch.ts, the Worker entry)
            ├─ /api/*   JSON API (packages/api)          D1 · R2 · KV · Workers AI · Queues
            └─ /*       Astro pages with Svelte 5 islands (src/pages)
```

| Path | What it is |
| --- | --- |
| `src/` | The deployable Worker: the Hono entry and the Astro front end |
| `packages/api` | The DAM's JSON API (Hono) |

## Development

Requires Node 22+.

```sh
npm install
npm run dev        # Astro + API on http://localhost:4321 with local D1/R2
npm test           # unit tests
npm run check      # type checks
```

### Search by meaning (optional)

It needs a Vectorize index in your Cloudflare account, made once:

```sh
npx wrangler vectorize create cf-dam-meaning --dimensions=1024 --metric=cosine
```

`npm run deploy` binds it when it's there (`scripts/optional-bindings.mjs`; Wrangler doesn't make
Vectorize indexes itself, so the binding can't sit in `wrangler.jsonc` without breaking new installs).
After the next deploy, the background work turns each photo's words (title, caption, keywords,
place, what the AI saw) into vectors with Workers AI, and the library offers "Search by meaning"
and each photo "More like this". Without the index both are simply absent.

### A staging copy (optional)

A second, separate cf-dam in the same Cloudflare account, for trying changes before they go live. It has
its own Worker (`cf-dam-staging`), database, bucket, KV, queue and Vectorize index, made by its first deploy
(the index once, by hand); it never sees the real archive.

```sh
npx wrangler vectorize create cf-dam-staging-meaning --dimensions=1024 --metric=cosine   # once
npm run deploy:staging
npx wrangler secret put BETTER_AUTH_SECRET --name cf-dam-staging                          # once
npx wrangler secret put SETUP_TOKEN --name cf-dam-staging                                 # once, then /setup
```

Every deploy checks it is going where you meant (`scripts/deploy-target.mjs`): a staging build won't deploy
as production, and a production build won't touch a staging resource. Keep real photos, production backups,
real storage connections and NAS helpers off staging.

## License

[Apache-2.0](LICENSE). cf-dam includes code derived from the Infowall CMS and SonicJS; see
[NOTICE](NOTICE).

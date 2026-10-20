# Scale test

How cf-dam's own queries behave on a catalog the size of the first photographer's (1.4 million photos),
locally and at no cost.

```sh
cd packages/api
SCALE_PHOTOS=1400000 npx vitest run --config scale/vitest.config.ts
```

- **The catalog** is built once in `~/cf-dam-scale/catalog-<photos>.db` (`SCALE_DIR` to move it; about 6 GB and
  15 minutes for 1.4 million) by `generate.ts`, and reused by later runs, which apply new migrations first.
- **The run** (`catalog.scale.ts`) builds the sweep's whole-archive snapshot, times the Library, search, filters,
  timeline, keywords, duplicates, sweep queries and a full catalog backup, and writes
  `results/<photos>[-<SCALE_LABEL>].json`, with each slow statement's query plan.
- **`d1-sqlite.ts`** runs the app's code unchanged on Node's built-in SQLite. It enforces two D1 limits Node
  doesn't have (100 bound values a statement; short compound SELECTs). Times are local, without D1's network hop;
  query plans and sizes carry over. Planner statistics are dropped before measuring, as D1 doesn't gather them.

Findings and the fixes they led to: `research/SCALE-1.4M-v1.md` in cf-dam-docs.

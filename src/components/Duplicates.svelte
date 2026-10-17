<script lang="ts">
  /** Review duplicate groups: keep the best (pre-selected), merge and remove the rest, or dismiss look-alikes. */
  interface Member {
    id: string
    filename: string
    title: string | null
    width: number | null
    height: number | null
    size: number
    capturedAt: string | null
    rating: number | null
    flag: string | null
    renditions: string[]
    camera: { model: string | null }
    storage: { storageClass: string } | null
    albums: number
    tags: number
    createdAt: string
  }
  interface Group {
    key: string
    kind: 'exact' | 'similar'
    assets: Member[]
  }
  interface Props {
    kind: 'exact' | 'similar'
    initial: Group[]
    canDelete: boolean
    canEdit: boolean
  }
  let { kind, initial, canDelete, canEdit }: Props = $props()

  let groups = $state<Group[]>([...initial])
  let keep = $state<Record<string, string>>(Object.fromEntries(initial.map((g) => [g.key, g.assets[0]!.id])))
  let busy = $state<string | null>(null)
  let message = $state('')

  const size = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`)
  const date = (iso: string | null) => (iso ? new Date(`${iso}Z`).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' }) : 'Undated')

  async function post(path: string, body: unknown) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? `Failed (${res.status})`)
    return res.json()
  }

  async function resolve(group: Group) {
    const kept = keep[group.key]!
    const remove = group.assets.filter((a) => a.id !== kept).map((a) => a.id)
    busy = group.key
    try {
      await post('/api/duplicates/resolve', { keep: kept, remove })
      groups = groups.filter((g) => g.key !== group.key)
      message = `Kept one, removed ${remove.length}. Their tags, albums and ratings were merged into it.`
    } catch (e) {
      message = e instanceof Error ? e.message : 'That did not work.'
    } finally {
      busy = null
    }
  }

  /** Take one photo out of a look-alike group; the rest stay grouped. */
  async function exclude(group: Group, id: string) {
    busy = group.key
    try {
      await post('/api/duplicates/dismiss', { ids: group.assets.map((a) => a.id), only: id })
      const rest = group.assets.filter((a) => a.id !== id)
      groups = rest.length < 2 ? groups.filter((g) => g.key !== group.key) : groups.map((g) => (g.key === group.key ? { ...g, assets: rest } : g))
      if (keep[group.key] === id && rest[0]) keep[group.key] = rest[0].id
    } finally {
      busy = null
    }
  }

  async function dismiss(group: Group) {
    busy = group.key
    try {
      await post('/api/duplicates/dismiss', { ids: group.assets.map((a) => a.id) })
      groups = groups.filter((g) => g.key !== group.key)
      message = 'Marked as not duplicates.'
    } finally {
      busy = null
    }
  }
</script>

{#if message}<div class="alert alert-success" role="status">{message}</div>{/if}

{#if groups.length === 0}
  <div class="card empty">
    <h2>{kind === 'exact' ? 'No exact duplicates' : 'No look-alikes to review'}</h2>
    <p class="muted">
      {kind === 'exact'
        ? 'Every file in the archive is unique by content.'
        : 'Resized copies, re-saved JPEGs and light edits show up here as they are found. Older photos are fingerprinted in the background.'}
    </p>
  </div>
{/if}

<div class="groups">
  {#each groups as group (group.key)}
    <section class="card group">
      <header class="row">
        <strong>{group.assets.length} {kind === 'exact' ? 'identical files' : 'look-alikes'}</strong>
        <span class="muted">Choose the one to keep. The others' tags, albums, rating and pick move to it.</span>
      </header>
      <div class="members">
        {#each group.assets as asset, i (asset.id)}
          <label class="member" class:kept={keep[group.key] === asset.id}>
            <input type="radio" name={`keep-${group.key}`} value={asset.id} bind:group={keep[group.key]} />
            <span class="thumb">
              {#if asset.renditions.includes('thumb')}<img src={`/api/assets/${asset.id}/renditions/thumb`} alt={asset.filename} loading="lazy" />{/if}
              {#if i === 0}<span class="best">Suggested</span>{/if}
            </span>
            <span class="facts">
              <a href={`/assets/${asset.id}`} class="name">{asset.title ?? asset.filename}</a>
              <span>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : 'unknown size'} · {size(asset.size)}</span>
              <span>{date(asset.capturedAt)}{asset.camera.model ? ` · ${asset.camera.model}` : ''}</span>
              <span>
                {asset.rating ? '★'.repeat(asset.rating) : ''}{asset.flag === 'pick' ? ' ⚑' : ''}
                {asset.tags} tags · {asset.albums} albums{asset.storage ? ` · ${asset.storage.storageClass}` : ''}
              </span>
            </span>
            {#if kind === 'similar' && canEdit && keep[group.key] !== asset.id}
              <button class="out" type="button" onclick={(e) => (e.preventDefault(), exclude(group, asset.id))} disabled={busy === group.key}>Not a duplicate</button>
            {/if}
          </label>
        {/each}
      </div>
      <div class="row actions">
        {#if canDelete}
          <button class="btn btn-primary" onclick={() => resolve(group)} disabled={busy === group.key}>
            Keep selected, remove {group.assets.length - 1}
          </button>
        {/if}
        {#if kind === 'similar' && canEdit}<button class="btn" onclick={() => dismiss(group)} disabled={busy === group.key}>Not duplicates</button>{/if}
      </div>
    </section>
  {/each}
</div>

<style>
  .groups {
    display: grid;
    gap: 18px;
  }
  .empty h2 {
    margin-bottom: 6px;
  }
  .group header {
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .members {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }
  .member {
    display: grid;
    gap: 8px;
    padding: 10px;
    border-radius: var(--radius);
    border: 2px solid var(--border);
    cursor: pointer;
    position: relative;
  }
  .member input {
    position: absolute;
    top: 18px;
    left: 18px;
    z-index: 2;
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .member.kept {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .member:not(.kept) img {
    opacity: 0.55;
  }
  .thumb {
    position: relative;
    display: block;
    aspect-ratio: 4 / 3;
    border-radius: 8px;
    overflow: hidden;
    background: var(--surface-strong);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .best {
    position: absolute;
    right: 8px;
    top: 8px;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 99px;
    color: #fff;
    background: var(--accent-strong);
  }
  .facts {
    display: grid;
    gap: 2px;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .name {
    color: var(--text);
    font-weight: 550;
    overflow-wrap: anywhere;
  }
  .actions {
    margin-top: 14px;
  }
  .out {
    justify-self: start;
    font: inherit;
    font-size: 0.75rem;
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-strong);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }
  .out:hover {
    color: var(--text);
  }
</style>

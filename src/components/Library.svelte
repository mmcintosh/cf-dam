<script lang="ts">
  /**
   * The working library: justified grid, selection, keyboard culling, loupe, compare and bulk edits.
   *
   * Click opens the loupe. ⌘/Ctrl-click toggles selection, Shift-click selects a range, the round tick on
   * each tile toggles it too. Keys (grid or loupe): arrows move, Enter opens, Space selects, 0–5 rate,
   * P pick, X reject, U clear the flag, Esc closes or clears. Ratings and flags apply to the selection when
   * there is one, otherwise to the photo in focus.
   */
  import { onMount, tick } from 'svelte'
  import { api } from '../lib/auth-client'

  interface Asset {
    id: string
    filename: string
    title: string | null
    width: number | null
    height: number | null
    rating: number | null
    flag: 'pick' | 'reject' | null
    status: string
    renditions: string[]
    capturedAt: string | null
    camera: { make: string | null; model: string | null; lens: string | null }
    exposure: { focalLength: number | null; aperture: number | null; exposureTime: number | null; iso: number | null }
    storage: { storageClass: string; state: string } | null
  }
  interface Props {
    initial: Asset[]
    initialTotal: number
    /** The current filter query string, without offset/limit. */
    query: string
    pageSize: number
    canEdit: boolean
    canDelete: boolean
  }
  let { initial, initialTotal, query, pageSize, canEdit, canDelete }: Props = $props()

  let assets = $state<Asset[]>([...initial])
  let total = $state(initialTotal)
  let selected = $state<Set<string>>(new Set())
  let focus = $state(0)
  let anchor = $state<number | null>(null)
  let loupe = $state<number | null>(null)
  let compare = $state<string[] | null>(null)
  let zoom = $state(false)
  let showInfo = $state(true)
  let loading = $state(false)
  let toast = $state('')
  let tagInput = $state('')
  let albums = $state<{ id: string; name: string }[]>([])
  let detail = $state<{ id: string; tags: string[] } | null>(null)
  let grid: HTMLDivElement | undefined = $state()

  const current = $derived(loupe !== null ? assets[loupe] : null)
  const selectedList = $derived(assets.filter((a) => selected.has(a.id)))

  const ratio = (a: Asset) => (a.width && a.height ? Math.min(Math.max(a.width / a.height, 0.4), 3) : 1.5)
  const ext = (name: string) => name.split('.').pop()?.toUpperCase().slice(0, 5) ?? 'FILE'
  const shutter = (t: number | null) => (t === null ? '' : t >= 1 ? `${t}s` : `1/${Math.round(1 / t)}`)
  const TIER: Record<string, string> = { STANDARD: 'hot', STANDARD_IA: 'warm', ONEZONE_IA: 'warm', INTELLIGENT_TIERING: 'warm', GLACIER_IR: 'cold', GLACIER: 'cold', DEEP_ARCHIVE: 'deep' }

  function say(message: string) {
    toast = message
    setTimeout(() => toast === message && (toast = ''), 2200)
  }

  // ── Loading more ─────────────────────────────────────────────────────────────
  async function loadMore() {
    if (loading || assets.length >= total) return
    loading = true
    try {
      const sep = query ? '&' : ''
      const page = await api<{ assets: Asset[] }>(`/api/assets?${query}${sep}offset=${assets.length}&limit=${pageSize}`)
      assets = [...assets, ...page.assets]
    } finally {
      loading = false
    }
  }

  // ── Selection ────────────────────────────────────────────────────────────────
  function toggle(index: number) {
    const id = assets[index]!.id
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    selected = next
    anchor = index
  }
  function selectRange(index: number) {
    const from = Math.min(anchor ?? index, index)
    const to = Math.max(anchor ?? index, index)
    const next = new Set(selected)
    for (let i = from; i <= to; i++) next.add(assets[i]!.id)
    selected = next
  }
  function onTileClick(event: MouseEvent, index: number) {
    focus = index
    if (event.shiftKey) {
      event.preventDefault()
      selectRange(index)
    } else if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      toggle(index)
    } else {
      event.preventDefault()
      openLoupe(index)
    }
  }
  const selectAll = () => (selected = new Set(assets.map((a) => a.id)))
  const clearSelection = () => ((selected = new Set()), (anchor = null))

  // ── Edits (optimistic, then the API) ─────────────────────────────────────────
  function targets(): string[] {
    if (loupe !== null && current) return [current.id]
    if (selected.size > 0) return [...selected]
    const focused = assets[focus]
    return focused ? [focused.id] : []
  }

  async function bulk(body: Record<string, unknown>, ids = targets()): Promise<boolean> {
    if (!canEdit && body.action !== 'delete') return false
    if (ids.length === 0) return false
    try {
      await api('/api/assets/bulk', { method: 'POST', body: JSON.stringify({ ids, ...body }) })
      return true
    } catch (e) {
      say(e instanceof Error ? e.message : 'That did not save.')
      return false
    }
  }

  async function rate(value: number) {
    const ids = targets()
    const rating = value === 0 ? null : value
    assets = assets.map((a) => (ids.includes(a.id) ? { ...a, rating } : a))
    if (await bulk({ action: 'rating', rating }, ids)) say(rating ? `${'★'.repeat(rating)} on ${ids.length}` : `Rating cleared on ${ids.length}`)
  }

  async function setFlag(flag: 'pick' | 'reject' | null) {
    const ids = targets()
    assets = assets.map((a) => (ids.includes(a.id) ? { ...a, flag } : a))
    if (await bulk({ action: 'flag', flag }, ids)) say(flag ? `${flag === 'pick' ? 'Picked' : 'Rejected'} ${ids.length}` : `Flag cleared on ${ids.length}`)
    if (loupe !== null && flag) next(1)
  }

  async function addTags() {
    const tags = tagInput.split(',').map((t) => t.trim()).filter(Boolean)
    if (tags.length === 0) return
    if (await bulk({ action: 'tag-add', tags })) {
      say(`Tagged ${targets().length} with ${tags.join(', ')}`)
      tagInput = ''
      if (detail) detail = { ...detail, tags: [...new Set([...detail.tags, ...tags])] }
    }
  }

  async function addToAlbum(albumId: string) {
    if (!albumId) return
    if (await bulk({ action: 'album-add', albumId })) say(`Added ${targets().length} to ${albums.find((a) => a.id === albumId)?.name ?? 'the album'}`)
  }

  async function remove() {
    const ids = [...selected]
    if (!confirm(`Delete ${ids.length} ${ids.length === 1 ? 'item' : 'items'}? Originals stay in storage until purged.`)) return
    if (await bulk({ action: 'delete' }, ids)) {
      assets = assets.filter((a) => !selected.has(a.id))
      total -= ids.length
      clearSelection()
      say(`Deleted ${ids.length}`)
    }
  }

  // ── Loupe and compare ────────────────────────────────────────────────────────
  async function openLoupe(index: number) {
    loupe = index
    zoom = false
    history.replaceState(null, '', `#a=${assets[index]!.id}`)
    loadDetail(assets[index]!.id)
  }
  function closeLoupe() {
    loupe = null
    zoom = false
    history.replaceState(null, '', location.pathname + location.search)
    tick().then(() => grid?.querySelectorAll<HTMLElement>('.tile')[focus]?.focus())
  }
  async function next(step: number) {
    if (loupe === null) return
    const target = loupe + step
    if (target >= assets.length) await loadMore()
    if (target < 0 || target >= assets.length) return
    loupe = target
    focus = target
    zoom = false
    history.replaceState(null, '', `#a=${assets[target]!.id}`)
    loadDetail(assets[target]!.id)
  }
  async function loadDetail(id: string) {
    detail = null
    try {
      const full = await api<{ tags: { name: string }[] }>(`/api/assets/${id}`)
      if (current?.id === id) detail = { id, tags: full.tags.map((t) => t.name) }
    } catch {
      detail = null
    }
  }
  function openCompare() {
    const ids = [...selected].slice(0, 4)
    if (ids.length >= 2) {
      compare = ids
      zoom = false
    }
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────────
  function columnsGuess(): number {
    const tiles = grid?.querySelectorAll<HTMLElement>('.tile')
    if (!tiles || tiles.length < 2) return 1
    const top = tiles[0]!.offsetTop
    let n = 0
    for (const t of tiles) {
      if (t.offsetTop !== top) break
      n++
    }
    return Math.max(n, 1)
  }

  function onKey(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, select') || event.metaKey || event.ctrlKey || event.altKey) return
    const key = event.key.toLowerCase()

    if (compare) {
      if (key === 'escape') compare = null
      else if (key === 'z') zoom = !zoom
      return
    }
    if (loupe !== null) {
      if (key === 'escape') closeLoupe()
      else if (key === 'arrowright') next(1)
      else if (key === 'arrowleft') next(-1)
      else if (key === 'z') zoom = !zoom
      else if (key === 'i') showInfo = !showInfo
      else if (/^[0-5]$/.test(key) && canEdit) rate(Number(key))
      else if (key === 'p' && canEdit) setFlag('pick')
      else if (key === 'x' && canEdit) setFlag('reject')
      else if (key === 'u' && canEdit) setFlag(null)
      else return
      event.preventDefault()
      return
    }
    if (!grid?.contains(document.activeElement) && document.activeElement !== document.body) return
    const cols = columnsGuess()
    if (key === 'arrowright') focus = Math.min(focus + 1, assets.length - 1)
    else if (key === 'arrowleft') focus = Math.max(focus - 1, 0)
    else if (key === 'arrowdown') focus = Math.min(focus + cols, assets.length - 1)
    else if (key === 'arrowup') focus = Math.max(focus - cols, 0)
    else if (key === 'enter') openLoupe(focus)
    else if (key === ' ') toggle(focus)
    else if (key === 'escape') clearSelection()
    else if (key === 'a' && event.shiftKey) selectAll()
    else if (/^[0-5]$/.test(key) && canEdit) rate(Number(key))
    else if (key === 'p' && canEdit) setFlag('pick')
    else if (key === 'x' && canEdit) setFlag('reject')
    else if (key === 'u' && canEdit) setFlag(null)
    else return
    event.preventDefault()
    if (key.startsWith('arrow')) {
      tick().then(() => grid?.querySelectorAll<HTMLElement>('.tile')[focus]?.focus())
      if (focus >= assets.length - cols * 2) loadMore()
    }
  }

  onMount(() => {
    const hashed = /^#a=([0-9a-f]+)$/.exec(location.hash)?.[1]
    const index = hashed ? assets.findIndex((a) => a.id === hashed) : -1
    if (index >= 0) openLoupe(index)
    if (canEdit) api<{ albums: { id: string; name: string }[] }>('/api/albums').then((r) => (albums = r.albums)).catch(() => {})
    // Infinite scroll: fetch the next page as the end of the grid comes into view.
    const sentinel = document.getElementById('library-end')
    if (!sentinel) return
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore(), { rootMargin: '600px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  })
</script>

<svelte:window onkeydown={onKey} />

<div class="justified" bind:this={grid} role="grid" aria-label="Photos" aria-multiselectable="true">
  {#each assets as asset, index (asset.id)}
    <a
      class="tile"
      class:selected={selected.has(asset.id)}
      class:rejected={asset.flag === 'reject'}
      href={`/assets/${asset.id}`}
      style={`--ar:${ratio(asset).toFixed(4)}`}
      tabindex={index === focus ? 0 : -1}
      role="gridcell"
      aria-selected={selected.has(asset.id)}
      title={asset.title ?? asset.filename}
      onclick={(e) => onTileClick(e, index)}
      onfocus={() => (focus = index)}
    >
      <i class="spacer" style={`padding-bottom:${(100 / ratio(asset)).toFixed(4)}%`}></i>
      {#if asset.renditions.includes('thumb')}
        <img src={`/api/assets/${asset.id}/renditions/thumb`} alt={asset.title ?? asset.filename} loading={index < 40 ? 'eager' : 'lazy'} decoding="async" />
      {:else}
        <span class="placeholder"><strong>{ext(asset.filename)}</strong><span>{asset.status === 'ready' ? 'No preview' : asset.status === 'queued' ? 'Queued' : 'Processing…'}</span></span>
      {/if}
      <button
        class="tick"
        type="button"
        aria-label={selected.has(asset.id) ? 'Deselect' : 'Select'}
        onclick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          e.shiftKey ? selectRange(index) : toggle(index)
        }}>✓</button
      >
      {#if asset.flag === 'pick'}<span class="flag pick" title="Pick">⚑</span>{/if}
      {#if asset.storage && asset.storage.storageClass !== 'STANDARD'}<span class={`tier tier-${TIER[asset.storage.storageClass] ?? 'warm'}`} title={asset.storage.storageClass}></span>{/if}
      <span class="overlay">
        <span class="name">{asset.title ?? asset.filename}</span>
        {#if asset.rating}<span class="stars">{'★'.repeat(asset.rating)}</span>{/if}
      </span>
    </a>
  {/each}
</div>
<div id="library-end" class="end muted">
  {#if loading}Loading…{:else if assets.length < total}<button class="btn btn-sm" onclick={loadMore}>Load more</button>{:else if total > 0}All {total} shown{/if}
</div>

{#if selected.size > 0 && loupe === null && !compare}
  <div class="bulkbar card" role="toolbar" aria-label="Selection actions">
    <strong>{selected.size} selected</strong>
    {#if canEdit}
      <span class="group">
        {#each [1, 2, 3, 4, 5] as star (star)}<button class="icon" title={`${star} star${star > 1 ? 's' : ''}`} onclick={() => rate(star)}>{star}★</button>{/each}
        <button class="icon" title="Pick (P)" onclick={() => setFlag('pick')}>⚑</button>
        <button class="icon" title="Reject (X)" onclick={() => setFlag('reject')}>✕</button>
      </span>
      <form class="group" onsubmit={(e) => (e.preventDefault(), addTags())}>
        <input type="text" placeholder="Add tags, comma separated" bind:value={tagInput} aria-label="Tags to add" />
        <button class="btn btn-sm" type="submit">Tag</button>
      </form>
      {#if albums.length > 0}
        <select aria-label="Add to album" onchange={(e) => (addToAlbum(e.currentTarget.value), (e.currentTarget.value = ''))}>
          <option value="">Add to album…</option>
          {#each albums as album (album.id)}<option value={album.id}>{album.name}</option>{/each}
        </select>
      {/if}
    {/if}
    {#if selected.size >= 2 && selected.size <= 4}<button class="btn btn-sm" onclick={openCompare}>Compare</button>{/if}
    {#if canDelete}<button class="btn btn-sm btn-danger" onclick={remove}>Delete</button>{/if}
    <span class="spacer"></span>
    <button class="btn btn-sm" onclick={selectAll}>Select all {assets.length}</button>
    <button class="btn btn-sm" onclick={clearSelection}>Clear</button>
  </div>
{/if}

{#if current}
  <div class="loupe" role="dialog" aria-modal="true" aria-label={current.title ?? current.filename}>
    <div class="stage" class:zoomed={zoom}>
      {#if current.renditions.includes('preview') || current.renditions.includes('thumb')}
        {#key current.id}
          <img
            src={`/api/assets/${current.id}/renditions/${current.renditions.includes('preview') ? 'preview' : 'thumb'}`}
            alt={current.title ?? current.filename}
            style={current.renditions.includes('thumb') ? `background-image:url(/api/assets/${current.id}/renditions/thumb)` : ''}
            onclick={() => (zoom = !zoom)}
          />
        {/key}
      {:else}
        <div class="no-preview"><strong>{ext(current.filename)}</strong><span>No preview</span></div>
      {/if}
      <button class="nav prev" aria-label="Previous (←)" onclick={() => next(-1)} disabled={loupe === 0}>‹</button>
      <button class="nav next" aria-label="Next (→)" onclick={() => next(1)} disabled={loupe === assets.length - 1 && assets.length >= total}>›</button>
      <button class="close" aria-label="Close (Esc)" onclick={closeLoupe}>✕</button>
      {#if current.flag}<span class={`loupe-flag ${current.flag}`}>{current.flag === 'pick' ? '⚑ Pick' : '✕ Reject'}</span>{/if}
    </div>
    {#if showInfo}
      <aside class="info">
        <h2>{current.title ?? current.filename}</h2>
        <p class="muted">{loupe! + 1} of {total}</p>
        <div class="stars-row" aria-label="Rating">
          {#each [1, 2, 3, 4, 5] as star (star)}
            <button class:on={(current.rating ?? 0) >= star} disabled={!canEdit} onclick={() => rate(current.rating === star ? 0 : star)} aria-label={`${star} stars`}>★</button>
          {/each}
        </div>
        <dl>
          {#if current.capturedAt}<dt>Taken</dt><dd>{new Date(`${current.capturedAt}Z`).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })}</dd>{/if}
          {#if current.camera.model}<dt>Camera</dt><dd>{current.camera.model}</dd>{/if}
          {#if current.camera.lens}<dt>Lens</dt><dd>{current.camera.lens}</dd>{/if}
          {#if current.exposure.aperture}<dt>Exposure</dt><dd>{[current.exposure.focalLength && `${current.exposure.focalLength} mm`, `ƒ/${current.exposure.aperture}`, shutter(current.exposure.exposureTime), current.exposure.iso && `ISO ${current.exposure.iso}`].filter(Boolean).join(' · ')}</dd>{/if}
          {#if current.width}<dt>Size</dt><dd>{current.width} × {current.height}</dd>{/if}
        </dl>
        {#if detail && detail.id === current.id}
          <div class="tags">{#each detail.tags as tag (tag)}<a class="tag" href={`/?tag=${encodeURIComponent(tag)}`}>{tag}</a>{/each}</div>
        {/if}
        {#if canEdit}
          <form class="row" onsubmit={(e) => (e.preventDefault(), addTags())}>
            <input type="text" placeholder="Add tags…" bind:value={tagInput} aria-label="Add tags" />
          </form>
        {/if}
        <a class="btn btn-sm" href={`/assets/${current.id}`}>Open details</a>
        <p class="keys muted">← → move · 1–5 rate · P pick · X reject · U clear · Z zoom · I info · Esc close</p>
      </aside>
    {/if}
  </div>
{/if}

{#if compare}
  <div class="loupe compare" role="dialog" aria-modal="true" aria-label="Compare">
    <div class="compare-grid" class:zoomed={zoom}>
      {#each compare as id (id)}
        {@const asset = assets.find((a) => a.id === id)}
        {#if asset}
          <figure>
            <img src={`/api/assets/${id}/renditions/preview`} alt={asset.title ?? asset.filename} onclick={() => (zoom = !zoom)} />
            <figcaption>
              <span>{asset.title ?? asset.filename}</span>
              {#if canEdit}
                <span>
                  <button class="icon" class:on={asset.flag === 'pick'} onclick={() => bulk({ action: 'flag', flag: 'pick' }, [id]).then(() => (assets = assets.map((a) => (a.id === id ? { ...a, flag: 'pick' } : a))))}>⚑ Pick</button>
                  <button class="icon" class:on={asset.flag === 'reject'} onclick={() => bulk({ action: 'flag', flag: 'reject' }, [id]).then(() => (assets = assets.map((a) => (a.id === id ? { ...a, flag: 'reject' } : a))))}>✕ Reject</button>
                </span>
              {/if}
            </figcaption>
          </figure>
        {/if}
      {/each}
    </div>
    <button class="close" aria-label="Close (Esc)" onclick={() => (compare = null)}>✕</button>
    <p class="keys muted compare-keys">Z zoom both · click a photo to zoom · Esc close</p>
  </div>
{/if}

{#if toast}<div class="toast" class:raised={selected.size > 0} role="status">{toast}</div>{/if}

<style>
  .justified {
    --row: 220px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .justified::after {
    content: '';
    flex-grow: 1000000;
  }
  .tile {
    position: relative;
    flex-grow: calc(var(--ar) * 100);
    flex-basis: calc(var(--row) * var(--ar));
    overflow: hidden;
    border-radius: 6px;
    background: var(--surface-strong);
    color: #fff;
    outline-offset: 2px;
  }
  .spacer {
    display: block;
  }
  .tile img,
  .placeholder {
    position: absolute;
    inset: 0;
  }
  .tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 400ms var(--ease), opacity 200ms var(--ease);
  }
  .tile:hover img {
    transform: scale(1.03);
  }
  .tile.rejected img {
    opacity: 0.35;
    filter: grayscale(1);
  }
  .tile.selected {
    box-shadow: 0 0 0 3px var(--accent);
  }
  .tile.selected img {
    transform: scale(0.94);
    border-radius: 4px;
  }
  .placeholder {
    display: grid;
    place-content: center;
    gap: 4px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .placeholder strong {
    font-size: 1.2rem;
    letter-spacing: 0.06em;
    color: var(--text);
  }
  .tick {
    position: absolute;
    top: 8px;
    left: 8px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid rgb(255 255 255 / 0.85);
    background: rgb(0 0 0 / 0.3);
    color: transparent;
    font-size: 0.75rem;
    font-weight: 800;
    cursor: pointer;
    opacity: 0;
    transition: opacity 150ms var(--ease);
  }
  .tile:hover .tick,
  .tile:focus-visible .tick,
  .tile.selected .tick {
    opacity: 1;
  }
  .tile.selected .tick {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .flag.pick {
    position: absolute;
    top: 8px;
    right: 10px;
    color: #4ade80;
    text-shadow: 0 1px 4px rgb(0 0 0 / 0.6);
  }
  .tier {
    position: absolute;
    bottom: 10px;
    right: 10px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px rgb(0 0 0 / 0.4);
  }
  .tier-warm {
    background: #facc15;
  }
  .tier-cold {
    background: #38bdf8;
  }
  .tier-deep {
    background: #818cf8;
    box-shadow: 0 0 8px #818cf8;
  }
  .overlay {
    position: absolute;
    inset: auto 0 0 0;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 28px 10px 8px;
    font-size: 0.8rem;
    background: linear-gradient(transparent, rgb(0 0 0 / 0.65));
    opacity: 0;
    transition: opacity 200ms var(--ease);
    pointer-events: none;
  }
  .tile:hover .overlay,
  .tile:focus-visible .overlay {
    opacity: 1;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stars {
    color: #fbbf24;
    flex: none;
  }
  .end {
    display: grid;
    place-items: center;
    padding: 24px;
    font-size: 0.85rem;
  }

  /* Bulk bar */
  .bulkbar {
    position: sticky;
    bottom: 16px;
    z-index: 20;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
    padding: 10px 14px;
    border-radius: var(--radius);
  }
  .bulkbar .group {
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }
  .bulkbar input {
    width: 220px;
    padding: 6px 10px;
  }
  .bulkbar select {
    width: auto;
    padding: 6px 10px;
  }
  .bulkbar .spacer {
    flex: 1;
  }
  .icon {
    font: inherit;
    font-size: 0.82rem;
    padding: 5px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-strong);
    background: none;
    color: var(--text);
    cursor: pointer;
  }
  .icon:hover,
  .icon.on {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }

  /* Loupe */
  .loupe {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    grid-template-columns: 1fr auto;
    background: rgb(5 6 9 / 0.97);
    color: #eceef3;
    animation: fade 160ms var(--ease);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  .stage {
    position: relative;
    display: grid;
    place-items: center;
    overflow: hidden;
    min-width: 0;
  }
  .stage img {
    max-width: calc(100% - 120px);
    max-height: calc(100vh - 48px);
    object-fit: contain;
    background-size: cover;
    cursor: zoom-in;
    transition: transform 250ms var(--ease);
  }
  .stage.zoomed img {
    transform: scale(2.2);
    cursor: zoom-out;
  }
  .no-preview {
    display: grid;
    gap: 8px;
    text-align: center;
  }
  .no-preview strong {
    font-size: 2rem;
  }
  .nav,
  .close {
    position: absolute;
    border: 0;
    background: rgb(255 255 255 / 0.08);
    color: #fff;
    cursor: pointer;
    border-radius: 50%;
    width: 44px;
    height: 44px;
    font-size: 1.6rem;
    line-height: 1;
  }
  .nav:hover,
  .close:hover {
    background: rgb(255 255 255 / 0.18);
  }
  .nav:disabled {
    opacity: 0.2;
  }
  .prev {
    left: 18px;
    top: 50%;
  }
  .next {
    right: 18px;
    top: 50%;
  }
  .close {
    top: 16px;
    right: 18px;
    font-size: 1rem;
  }
  .loupe-flag {
    position: absolute;
    top: 22px;
    left: 24px;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 99px;
  }
  .loupe-flag.pick {
    background: rgb(74 222 128 / 0.2);
    color: #4ade80;
  }
  .loupe-flag.reject {
    background: rgb(255 107 122 / 0.2);
    color: #ff6b7a;
  }
  .info {
    width: 320px;
    padding: 28px 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    border-left: 1px solid rgb(255 255 255 / 0.08);
    background: rgb(15 18 24 / 0.9);
    overflow-y: auto;
  }
  .info h2 {
    font-size: 1.05rem;
    overflow-wrap: anywhere;
  }
  .info p {
    margin: 0;
  }
  .info dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    margin: 0;
    font-size: 0.85rem;
  }
  .info dt {
    color: #9aa2b1;
  }
  .info dd {
    margin: 0;
  }
  .stars-row button {
    font-size: 1.4rem;
    background: none;
    border: 0;
    color: rgb(255 255 255 / 0.25);
    cursor: pointer;
    padding: 0 2px;
  }
  .stars-row button.on {
    color: #fbbf24;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tag {
    font-size: 0.8rem;
    padding: 2px 10px;
    border-radius: 99px;
    color: #eceef3;
    background: rgb(138 164 255 / 0.18);
  }
  .info input {
    background: rgb(255 255 255 / 0.06);
    color: #eceef3;
    border-color: rgb(255 255 255 / 0.15);
  }
  .keys {
    margin-top: auto !important;
    font-size: 0.75rem;
    color: #6b7385;
  }

  /* Compare */
  .compare {
    grid-template-columns: 1fr;
  }
  .compare-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    padding: 64px 24px 48px;
    overflow: hidden;
  }
  .compare-grid figure {
    margin: 0;
    display: grid;
    grid-template-rows: 1fr auto;
    min-height: 0;
    overflow: hidden;
  }
  .compare-grid img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    min-height: 0;
    cursor: zoom-in;
    transition: transform 250ms var(--ease);
  }
  .compare-grid.zoomed img {
    transform: scale(2.2);
  }
  .compare-grid figcaption {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 4px;
    font-size: 0.85rem;
  }
  .compare-grid .icon {
    color: #eceef3;
    border-color: rgb(255 255 255 / 0.2);
  }
  .compare-keys {
    position: absolute;
    bottom: 8px;
    left: 0;
    right: 0;
    text-align: center;
  }

  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 200;
    padding: 10px 18px;
    border-radius: 99px;
    background: rgb(20 24 33 / 0.95);
    color: #eceef3;
    font-size: 0.88rem;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.4);
  }
  /* Clear of the bulk bar when it is showing. */
  .toast.raised {
    bottom: 120px;
  }
  @media (max-width: 860px) {
    .loupe {
      grid-template-columns: 1fr;
    }
    .info {
      display: none;
    }
    .justified {
      --row: 130px;
      gap: 3px;
    }
  }
</style>

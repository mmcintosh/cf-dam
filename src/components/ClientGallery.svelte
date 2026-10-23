<script lang="ts">
  import { onMount } from 'svelte'
  import type { GalleryItem } from '@cf-dam/api'

  type Size = 'small' | 'large' | 'original'
  interface GalleryData {
    gallery: { title: string; message: string; expiresAt: string | null; downloadSizes: Size[]; proofing: boolean; showFilenames: boolean; watermark: boolean; imageVersion: string }
    items: GalleryItem[]
    visitor: { name: string; submittedAt: string | null } | null
    /** A client signed in to their account: a way back to their galleries, and no "not you?". */
    member: { name: string } | null
    picks: string[]
  }
  interface Props {
    token: string
    title: string
    /** Null when the gallery is locked behind its password. */
    initial: GalleryData | null
  }
  let { token, title, initial }: Props = $props()

  const base = `/api/public/galleries/${token}`
  const SIZE_LABELS: Record<Size, string> = { small: 'Small (1024 px)', large: 'Large (2048 px)', original: 'Original file' }

  let data = $state<GalleryData | null>(initial)
  let password = $state('')
  let error = $state('')
  let busy = $state(false)
  let picks = $state(new Set<string>(initial?.picks ?? []))
  let onlyPicks = $state(false)
  let open = $state<number | null>(null)
  let asking = $state<string | null>(null)
  let name = $state('')
  let email = $state('')
  let note = $state('')

  const shown = $derived(data ? (onlyPicks ? data.items.filter((i) => picks.has(i.id)) : data.items) : [])
  const current = $derived(open === null ? null : (shown[open] ?? null))
  const image = (item: GalleryItem, name: 'thumb' | 'preview') => `${base}/assets/${item.id}/${name}?v=${data?.gallery.imageVersion ?? ''}-${item.imageVersion}`
  const ratio = (i: GalleryItem) => (i.width && i.height ? Math.min(Math.max(i.width / i.height, 0.4), 3) : 1.5)
  const label = (i: GalleryItem) => i.title || i.filename || ''
  const sizesFor = (i: GalleryItem) => (data?.gallery.downloadSizes ?? []).filter((s) => (s === 'original' ? i.originalReachable : !i.video))
  const expires = $derived(data?.gallery.expiresAt ? new Date(data.gallery.expiresAt).toLocaleDateString(undefined, { dateStyle: 'long' }) : null)

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string }
      throw new Error(body.message ?? `Something went wrong (${response.status}).`)
    }
    return (response.status === 204 ? undefined : await response.json()) as T
  }

  async function load() {
    data = await request<GalleryData>('')
    picks = new Set(data.picks)
  }

  async function unlock(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    busy = true
    try {
      await request('/unlock', { method: 'POST', body: JSON.stringify({ password }) })
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : 'That password is not right.'
    } finally {
      busy = false
    }
  }

  async function toggle(item: GalleryItem) {
    if (!data?.gallery.proofing) return
    if (!data.visitor) {
      asking = item.id
      return
    }
    const picked = !picks.has(item.id)
    const next = new Set(picks)
    if (picked) next.add(item.id)
    else next.delete(item.id)
    picks = next
    note = ''
    try {
      await request(`/picks/${item.id}`, { method: picked ? 'PUT' : 'DELETE' })
      if (data.visitor.submittedAt) data.visitor.submittedAt = null
    } catch (e) {
      // Put it back as it was, and say why.
      const back = new Set(picks)
      if (picked) back.delete(item.id)
      else back.add(item.id)
      picks = back
      note = e instanceof Error ? e.message : 'That favourite was not saved.'
    }
  }

  async function introduce(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    busy = true
    try {
      const { visitor } = await request<{ visitor: { name: string; submittedAt: string | null } }>('/visitor', {
        method: 'POST',
        body: JSON.stringify({ name, email: email || undefined }),
      })
      if (data) data.visitor = visitor
      picks = new Set()
      const first = data?.items.find((i) => i.id === asking)
      asking = null
      if (first) await toggle(first)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save your name.'
    } finally {
      busy = false
    }
  }

  async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    window.location.href = '/login'
  }

  async function submit() {
    busy = true
    try {
      await request('/submit', { method: 'POST' })
      if (data?.visitor) data.visitor.submittedAt = new Date().toISOString()
      note = 'Thank you. The photographer can see your favourites now.'
    } catch (e) {
      note = e instanceof Error ? e.message : 'Could not send your selection.'
    } finally {
      busy = false
    }
  }

  function step(by: number) {
    if (open === null || shown.length === 0) return
    open = (open + by + shown.length) % shown.length
  }

  function onKey(event: KeyboardEvent) {
    if (open === null || asking) return
    if (event.key === 'Escape') open = null
    else if (event.key === 'ArrowRight') step(1)
    else if (event.key === 'ArrowLeft') step(-1)
  }

  /** Focus a field as soon as it appears (autofocus only works on page load). */
  const focus = (node: HTMLInputElement) => node.focus()

  let touchX = 0
  const touchStart = (event: TouchEvent) => (touchX = event.touches[0]?.clientX ?? 0)
  function touchEnd(event: TouchEvent) {
    const dx = (event.changedTouches[0]?.clientX ?? 0) - touchX
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1)
  }

  // Look at the next photo while this one is on screen, so stepping through feels instant.
  $effect(() => {
    if (open === null || shown.length < 2) return
    const next = shown[(open + 1) % shown.length]
    if (next?.hasPreview) new Image().src = image(next, 'preview')
  })

  onMount(() => {
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })
</script>

{#if !data}
  <main class="lock">
    <form class="card stack" onsubmit={unlock}>
      <h1>{title}</h1>
      <p class="muted">This gallery is private. Enter the password you were given.</p>
      <div class="field">
        <label for="gallery-password">Password</label>
        <input id="gallery-password" type="password" autocomplete="current-password" required bind:value={password} use:focus />
      </div>
      {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
      <button class="btn btn-primary" type="submit" disabled={busy}>Open the gallery</button>
    </form>
  </main>
{:else}
  {#if data.member}
    <nav class="member" aria-label="Your account">
      <a href="/my-galleries">← Your galleries</a>
      <span class="row">
        <a href="/account">Account</a>
        <a href="/help/for-clients">Help</a>
        <button class="link" onclick={signOut}>Sign out</button>
      </span>
    </nav>
  {/if}
  <main class="gallery">
    <header>
      <div>
        <h1>{data.gallery.title}</h1>
        {#if data.gallery.message}<p class="message">{data.gallery.message}</p>{/if}
        <p class="muted small">
          {data.items.length} {data.items.length === 1 ? 'photo' : 'photos'}{expires ? ` · open until ${expires}` : ''}
        </p>
      </div>
      {#if data.gallery.proofing}
        <div class="proofing">
          {#if data.visitor}
            <span class="muted small">Picking as <strong>{data.visitor.name}</strong>{#if !data.member} · <button class="link" onclick={() => (asking = '')}>not you?</button>{/if}</span>
          {:else}
            <span class="muted small">Tap ♥ on the photos you like.</span>
          {/if}
          <div class="row">
            <button class="btn btn-sm" class:on={onlyPicks} onclick={() => ((onlyPicks = !onlyPicks), (open = null))} aria-pressed={onlyPicks}>
              ♥ Favourites ({picks.size})
            </button>
            {#if data.visitor && picks.size > 0}
              <button class="btn btn-sm btn-primary" onclick={submit} disabled={busy || Boolean(data.visitor.submittedAt)}>
                {data.visitor.submittedAt ? 'Sent to the photographer' : "I'm done"}
              </button>
            {/if}
          </div>
        </div>
      {/if}
    </header>
    {#if note}<p class="note" role="status">{note}</p>{/if}

    {#if shown.length === 0}
      <p class="muted">{onlyPicks ? 'No favourites yet.' : 'There are no photos in this gallery yet.'}</p>
    {:else}
      <div class="justified">
        {#each shown as item, i (item.id)}
          <div class="tile" style={`--ar:${ratio(item).toFixed(4)}`}>
            <i class="spacer" style={`padding-bottom:${(100 / ratio(item)).toFixed(4)}%`}></i>
            <button class="open" onclick={() => (open = i)} aria-label={`Open ${label(item) || `photo ${i + 1}`}`}>
              {#if item.hasThumb}
                <img src={image(item, 'thumb')} alt={item.alt ?? label(item)} loading="lazy" decoding="async" draggable="false" oncontextmenu={(e) => e.preventDefault()} />
              {:else}
                <span class="placeholder">No preview yet</span>
              {/if}
              {#if item.video}<span class="video" aria-label="Video">▶</span>{/if}
            </button>
            {#if data.gallery.proofing}
              <button class="heart" class:picked={picks.has(item.id)} onclick={() => toggle(item)} aria-pressed={picks.has(item.id)} aria-label={picks.has(item.id) ? 'Remove from favourites' : 'Add to favourites'}>♥</button>
            {/if}
            {#if data.gallery.showFilenames && item.filename}<span class="name">{item.filename}</span>{/if}
          </div>
        {/each}
      </div>
    {/if}
    <footer class="muted small">Shared with cf-dam</footer>
  </main>

  {#if current}
    <div class="viewer" role="dialog" aria-modal="true" aria-label={label(current) || 'Photo'} ontouchstart={touchStart} ontouchend={touchEnd}>
      <div class="bar">
        <span class="small">{open! + 1} / {shown.length}{label(current) ? ` · ${label(current)}` : ''}</span>
        <div class="row">
          {#if data.gallery.proofing}
            <button class="btn btn-sm" class:on={picks.has(current.id)} onclick={() => toggle(current)} aria-pressed={picks.has(current.id)}>
              ♥ {picks.has(current.id) ? 'Favourite' : 'Add to favourites'}
            </button>
          {/if}
          {#each sizesFor(current) as size (size)}
            <a class="btn btn-sm" href={`${base}/assets/${current.id}/download/${size}`} download>⤓ {SIZE_LABELS[size]}</a>
          {/each}
          {#if data.gallery.downloadSizes.includes('original') && !current.originalReachable}
            <span class="muted small">Original: ask the photographer</span>
          {/if}
          <button class="btn btn-sm" onclick={() => (open = null)} aria-label="Close">✕</button>
        </div>
      </div>
      <div class="stage">
        <button class="nav prev" onclick={() => step(-1)} aria-label="Previous photo">‹</button>
        {#if current.hasPreview}
          <img src={image(current, 'preview')} alt={current.alt ?? label(current)} draggable="false" oncontextmenu={(e) => e.preventDefault()} />
        {:else}
          <span class="placeholder">No preview yet</span>
        {/if}
        <button class="nav next" onclick={() => step(1)} aria-label="Next photo">›</button>
      </div>
      {#if current.caption}<p class="caption">{current.caption}</p>{/if}
    </div>
  {/if}

  {#if asking !== null}
    <div class="viewer modal" role="dialog" aria-modal="true" aria-labelledby="who-title">
      <form class="card stack who" onsubmit={introduce}>
        <h2 id="who-title">Who's picking?</h2>
        <p class="muted small">Your name goes with your favourites, so the photographer knows whose they are.</p>
        <div class="field">
          <label for="who-name">Your name</label>
          <input id="who-name" type="text" required maxlength="100" bind:value={name} use:focus />
        </div>
        <div class="field">
          <label for="who-email">Email (optional)</label>
          <input id="who-email" type="email" maxlength="254" bind:value={email} />
        </div>
        {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
        <div class="row">
          <button class="btn btn-primary" type="submit" disabled={busy}>Start picking</button>
          <button class="btn" type="button" onclick={() => (asking = null)}>Cancel</button>
        </div>
      </form>
    </div>
  {/if}
{/if}

<style>
  .lock {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 32px 16px;
  }
  .lock form {
    width: min(400px, 100%);
  }
  .lock h1 {
    font-size: 1.4rem;
  }
  .gallery {
    max-width: 1400px;
    margin: 0 auto;
    padding: 32px 24px 48px;
  }
  .member {
    max-width: 1400px;
    margin: 0 auto;
    padding: 14px 24px 0;
    display: flex;
    justify-content: space-between;
    gap: 16px;
    font-size: 0.9rem;
  }
  .member .row {
    gap: 16px;
  }
  .member + .gallery {
    padding-top: 16px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 20px;
    flex-wrap: wrap;
    margin-bottom: 24px;
  }
  h1 {
    font-size: 1.8rem;
    font-weight: 650;
  }
  .message {
    margin: 8px 0 0;
    max-width: 60ch;
    white-space: pre-line;
  }
  .small {
    font-size: 0.85rem;
  }
  .proofing {
    display: grid;
    gap: 8px;
    justify-items: end;
  }
  .link {
    font: inherit;
    color: var(--accent);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  .btn.on {
    color: #ff6b8a;
    border-color: color-mix(in srgb, #ff6b8a 50%, transparent);
  }
  .note {
    margin: -8px 0 16px;
    color: var(--success);
  }
  .justified {
    --row: 260px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
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
  }
  .spacer {
    display: block;
  }
  .open {
    position: absolute;
    inset: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
  }
  .open img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    user-select: none;
    -webkit-user-drag: none;
  }
  .placeholder {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .video {
    position: absolute;
    left: 10px;
    bottom: 10px;
    color: #fff;
    text-shadow: 0 1px 4px rgb(0 0 0 / 0.6);
  }
  .heart {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 0;
    font-size: 1.1rem;
    color: #fff;
    background: rgb(0 0 0 / 0.35);
    cursor: pointer;
    opacity: 0.85;
    transition: transform 120ms var(--ease), background 150ms var(--ease);
  }
  .heart:hover {
    transform: scale(1.08);
  }
  .heart.picked {
    color: #ff4d75;
    background: rgb(255 255 255 / 0.9);
    opacity: 1;
  }
  .name {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 18px 10px 6px;
    font-size: 0.75rem;
    color: #fff;
    background: linear-gradient(transparent, rgb(0 0 0 / 0.55));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }
  footer {
    margin-top: 40px;
    text-align: center;
  }
  .viewer {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    grid-template-rows: auto 1fr auto;
    background: rgb(5 6 9);
    color: #fff;
  }
  .viewer.modal {
    grid-template-rows: 1fr;
    place-items: center;
    background: rgb(5 6 9 / 0.8);
    padding: 16px;
    color: var(--text);
  }
  .who {
    width: min(420px, 100%);
    background: var(--bg-elevated);
  }
  .bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 10px 16px;
  }
  .stage {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 0;
    padding: 0 56px 16px;
  }
  .stage img {
    max-width: 100%;
    max-height: calc(100vh - 120px);
    object-fit: contain;
    user-select: none;
    -webkit-user-drag: none;
  }
  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 44px;
    height: 64px;
    border: 0;
    border-radius: var(--radius-sm);
    font-size: 2rem;
    color: #fff;
    background: rgb(255 255 255 / 0.06);
    cursor: pointer;
  }
  .nav:hover {
    background: rgb(255 255 255 / 0.14);
  }
  .prev {
    left: 8px;
  }
  .next {
    right: 8px;
  }
  .caption {
    margin: 0;
    padding: 0 16px 16px;
    text-align: center;
    color: rgb(255 255 255 / 0.8);
  }
  @media (max-width: 640px) {
    .gallery {
      padding: 20px 12px 40px;
    }
    .justified {
      --row: 140px;
      gap: 4px;
    }
    .proofing {
      justify-items: start;
    }
    .stage {
      padding: 0 0 12px;
    }
    .nav {
      display: none;
    }
  }
</style>

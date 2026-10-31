<script lang="ts">
  import { onMount } from 'svelte'
  import type { GalleryItem } from '@cf-dam/api'
  import { format, t } from '@cf-dam/i18n/client'
  import type { MessageKey } from '@cf-dam/i18n'
  import SuggestNames from './SuggestNames.svelte'

  type Size = 'small' | 'large' | 'original'
  /** Someone the couple can find photos of (catalog/gallery-people.ts): `key` is what items list. */
  interface PeopleChip {
    key: number
    label: string
    kind: 'group' | 'person'
    count: number
  }
  interface GalleryData {
    gallery: { title: string; message: string; expiresAt: string | null; downloadSizes: Size[]; proofing: boolean; showFilenames: boolean; watermark: boolean; imageVersion: string }
    items: (GalleryItem & { people?: number[]; suggested?: { id: string; label: string; mine: boolean }[] })[]
    /** Only for the gallery's client's own people, signed in, when it shows people. */
    people?: PeopleChip[]
    /** The couple can say who's on a photo (catalog/name-suggestions.ts); items carry what's waiting. */
    suggesting?: boolean
    /** The gallery shows people to its client's people: ask anyone else here to sign in. Names nobody. */
    peopleSignIn?: boolean
    visitor: { name: string; submittedAt: string | null } | null
    /** A client signed in to their account: a way back to their galleries, and no "not you?". */
    member: { name: string } | null
    picks: string[]
    /** What it sells (null: nothing), and what this browser has bought here. */
    store: { currency: string; prices: { small: number | null; large: number | null; full: number | null; all: number | null } } | null
    purchases: { orderId: string; itemId: string; assetId: string; size: string; paid: boolean }[]
  }
  interface Props {
    token: string
    title: string
    /** Null when the gallery is locked behind its password. */
    initial: GalleryData | null
  }
  let { token, title, initial }: Props = $props()

  const base = `/api/public/galleries/${token}`
  const SIZE_LABELS: Record<Size, MessageKey> = { small: 'gallery.size.small', large: 'gallery.size.large', original: 'gallery.size.original' }

  let data = $state<GalleryData | null>(initial)
  let password = $state('')
  let error = $state('')
  let busy = $state(false)
  let picks = $state(new Set<string>(initial?.picks ?? []))
  let onlyPicks = $state(false)
  /** Chips chosen: photos with all of them. */
  let chosen = $state<number[]>([])
  let open = $state<number | null>(null)
  let asking = $state<string | null>(null)
  /** "Who's in this photo?" is open: the viewer's keys and swipes leave the photo alone. */
  let suggestingOpen = $state(false)
  function suggestedChanged(byPhoto: Record<string, { id: string; label: string; mine: boolean }[]>) {
    if (!data) return
    data.items = data.items.map((i) => (byPhoto[i.id] ? { ...i, suggested: byPhoto[i.id] } : i))
  }
  let name = $state('')
  let email = $state('')
  let note = $state('')

  const shown = $derived(
    data ? data.items.filter((i) => (!onlyPicks || picks.has(i.id)) && chosen.every((key) => i.people?.includes(key))) : [],
  )
  function choose(key: number) {
    chosen = chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key]
    open = null
  }
  const current = $derived(open === null ? null : (shown[open] ?? null))
  const image = (item: GalleryItem, name: 'thumb' | 'preview') => `${base}/assets/${item.id}/${name}?v=${data?.gallery.imageVersion ?? ''}-${item.imageVersion}`
  const ratio = (i: GalleryItem) => (i.width && i.height ? Math.min(Math.max(i.width / i.height, 0.4), 3) : 1.5)
  const label = (i: GalleryItem) => i.title || i.filename || ''
  const sizesFor = (i: GalleryItem) => (data?.gallery.downloadSizes ?? []).filter((s) => (s === 'original' ? i.originalReachable : !i.video))
  /** Prices in the gallery's currency (minor units: cents, or yen as they are). */
  const money = (amount: number) => format().number(amount / (data?.store?.currency === 'jpy' ? 1 : 100), { style: 'currency', currency: (data?.store?.currency ?? 'usd').toUpperCase() })
  const SALE_LABELS: Record<'small' | 'large' | 'full', MessageKey> = { small: 'gallery.size.small', large: 'gallery.size.large', full: 'gallery.buy.full' }
  const forSale = (i: GalleryItem) =>
    !data?.store || i.video ? [] : (['small', 'large', 'full'] as const).filter((s) => data!.store!.prices[s] !== null && (s !== 'full' || i.originalReachable))
  const bought = (i: GalleryItem) => (data?.purchases ?? []).filter((p) => p.assetId === i.id)
  let buying = $state(false)

  /** To Stripe's checkout page (a JSON request, then location.assign: forms may only post to this site). */
  async function buy(body: Record<string, unknown>) {
    buying = true
    error = ''
    try {
      const { url } = await request<{ url: string }>('/checkout', { method: 'POST', body: JSON.stringify(body) })
      location.assign(url)
    } catch (e) {
      note = e instanceof Error ? e.message : t('gallery.buy.failed')
      buying = false
    }
  }

  // The last day it's open (expiry is the start of the next day).
  const expires = $derived(data?.gallery.expiresAt ? format().date(new Date(data.gallery.expiresAt).getTime() - 1) : null)

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string }
      throw new Error(body.message ?? t('common.error.generic', { status: String(response.status) }))
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
      error = e instanceof Error ? e.message : t('gallery.error.password')
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
      note = e instanceof Error ? e.message : t('gallery.error.favourite')
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
      error = e instanceof Error ? e.message : t('gallery.error.name')
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
      note = t('gallery.thanks')
    } catch (e) {
      note = e instanceof Error ? e.message : t('gallery.error.send')
    } finally {
      busy = false
    }
  }

  function step(by: number) {
    if (open === null || shown.length === 0) return
    open = (open + by + shown.length) % shown.length
  }

  function onKey(event: KeyboardEvent) {
    if (open === null || asking || suggestingOpen) return
    if (event.key === 'Escape') open = null
    else if (event.key === 'ArrowRight') step(1)
    else if (event.key === 'ArrowLeft') step(-1)
  }

  /** Focus a field as soon as it appears (autofocus only works on page load). */
  const focus = (node: HTMLInputElement) => node.focus()

  let touchX = 0
  const touchStart = (event: TouchEvent) => (touchX = event.touches[0]?.clientX ?? 0)
  function touchEnd(event: TouchEvent) {
    if (suggestingOpen) return
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
      <p class="muted">{t('gallery.lock.lead')}</p>
      <div class="field">
        <label for="gallery-password">{t('common.password')}</label>
        <input id="gallery-password" type="password" autocomplete="current-password" required bind:value={password} use:focus />
      </div>
      {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
      <button class="btn btn-primary" type="submit" disabled={busy}>{t('gallery.lock.open')}</button>
    </form>
  </main>
{:else}
  {#if data.member}
    <nav class="member" aria-label={t('gallery.member.nav')}>
      <a href="/my-galleries">{t('gallery.member.back')}</a>
      <span class="row">
        <a href="/account">{t('common.account')}</a>
        <a href="/help/for-clients">{t('common.help')}</a>
        <button class="link" onclick={signOut}>{t('common.signOut')}</button>
      </span>
    </nav>
  {/if}
  <main class="gallery">
    <header>
      <div>
        <h1>{data.gallery.title}</h1>
        {#if data.gallery.message}<p class="message">{data.gallery.message}</p>{/if}
        <p class="muted small">
          {t('common.photos', { count: data.items.length })}{expires ? ` · ${t('gallery.openUntil', { date: expires })}` : ''}
        </p>
      </div>
      {#if data.store?.prices.all}
        <div class="store">
          <button class="btn btn-sm btn-primary" disabled={buying} onclick={() => buy({ all: true })}>{t('gallery.buy.all', { price: money(data.store.prices.all) })}</button>
        </div>
      {/if}
      {#if data.gallery.proofing}
        <div class="proofing">
          {#if data.visitor}
            {@const [before, after = ''] = t('gallery.pickingAs', { name: '\u0000' }).split('\u0000')}
            <span class="muted small">{before}<strong>{data.visitor.name}</strong>{after}{#if !data.member} · <button class="link" onclick={() => (asking = '')}>{t('gallery.notYou')}</button>{/if}</span>
          {:else}
            <span class="muted small">{t('gallery.tapHeart')}</span>
          {/if}
          <div class="row">
            <button class="btn btn-sm" class:on={onlyPicks} onclick={() => ((onlyPicks = !onlyPicks), (open = null))} aria-pressed={onlyPicks}>
              {t('gallery.favourites', { count: picks.size })}
            </button>
            {#if data.visitor && picks.size > 0}
              <button class="btn btn-sm btn-primary" onclick={submit} disabled={busy || Boolean(data.visitor.submittedAt)}>
                {data.visitor.submittedAt ? t('gallery.sent') : t('gallery.done')}
              </button>
            {/if}
          </div>
        </div>
      {/if}
    </header>
    {#if data.people && data.people.length > 0}
      <div class="people" role="group" aria-label={t('gallery.people.label')}>
        <span class="muted small">{t('gallery.people.find')}</span>
        {#each data.people as chip (chip.key)}
          <button class="btn btn-sm chip" class:on={chosen.includes(chip.key)} aria-pressed={chosen.includes(chip.key)} onclick={() => choose(chip.key)}>
            {chip.label} <span class="muted">{chip.count}</span>
          </button>
        {/each}
        {#if chosen.length > 0}<button class="link small" onclick={() => ((chosen = []), (open = null))}>{t('gallery.people.everyone')}</button>{/if}
      </div>
      {#if chosen.length > 1}<p class="muted small">{t('gallery.people.all')}</p>{/if}
    {:else if data.peopleSignIn}
      <p class="muted small">{t('gallery.people.invited')} <a href={`/login?next=${encodeURIComponent(`/s/${token}`)}`}>{t('gallery.people.signIn')}</a></p>
    {/if}
    {#if note}<p class="note" role="status">{note}</p>{/if}

    {#if shown.length === 0}
      <p class="muted">{chosen.length > 0 ? t('gallery.people.none') : onlyPicks ? t('gallery.noFavourites') : t('gallery.empty')}</p>
    {:else}
      <div class="justified">
        {#each shown as item, i (item.id)}
          <div class="tile" style={`--ar:${ratio(item).toFixed(4)}`}>
            <i class="spacer" style={`padding-bottom:${(100 / ratio(item)).toFixed(4)}%`}></i>
            <button class="open" onclick={() => (open = i)} aria-label={t('gallery.openPhoto', { name: label(item) || t('gallery.photoNumber', { number: i + 1 }) })}>
              {#if item.hasThumb}
                <img src={image(item, 'thumb')} alt={item.alt ?? label(item)} loading="lazy" decoding="async" draggable="false" oncontextmenu={(e) => e.preventDefault()} />
              {:else}
                <span class="placeholder">{t('gallery.noPreview')}</span>
              {/if}
              {#if item.video}<span class="video" aria-label={t('gallery.video')}>▶</span>{/if}
            </button>
            {#if data.gallery.proofing}
              <button class="heart" class:picked={picks.has(item.id)} onclick={() => toggle(item)} aria-pressed={picks.has(item.id)} aria-label={picks.has(item.id) ? t('gallery.removeFavourite') : t('gallery.addFavourite')}>♥</button>
            {/if}
            {#if data.gallery.showFilenames && item.filename}<span class="name">{item.filename}</span>{/if}
          </div>
        {/each}
      </div>
    {/if}
    <footer class="muted small">{t('gallery.footer')}</footer>
  </main>

  {#if current}
    <div class="viewer" role="dialog" aria-modal="true" aria-label={label(current) || t('gallery.photo')} ontouchstart={touchStart} ontouchend={touchEnd}>
      <div class="bar">
        <span class="small">{open! + 1} / {shown.length}{label(current) ? ` · ${label(current)}` : ''}</span>
        <div class="row">
          {#if data.gallery.proofing}
            <button class="btn btn-sm" class:on={picks.has(current.id)} onclick={() => toggle(current)} aria-pressed={picks.has(current.id)}>
              ♥ {picks.has(current.id) ? t('gallery.isFavourite') : t('gallery.addFavourite')}
            </button>
          {/if}
          {#each sizesFor(current) as size (size)}
            <a class="btn btn-sm" href={`${base}/assets/${current.id}/download/${size}`} download>⤓ {t(SIZE_LABELS[size])}</a>
          {/each}
          {#each bought(current) as p (p.itemId)}
            {#if p.paid}
              <a class="btn btn-sm" href={`${base}/purchases/${p.orderId}/${p.itemId}`} download>⤓ {t('gallery.buy.bought', { size: t(SALE_LABELS[p.size as 'small' | 'large' | 'full'] ?? 'gallery.size.large') })}</a>
            {:else}
              <span class="muted small">{t('gallery.buy.paying')}</span>
            {/if}
          {/each}
          {#if forSale(current).length > 0 && bought(current).length === 0}
            <select class="buy" aria-label={t('gallery.buy.label')} disabled={buying} onchange={(e) => { const v = e.currentTarget.value; e.currentTarget.value = ''; if (v) buy({ assetId: current!.id, size: v }) }}>
              <option value="">{t('gallery.buy.menu')}</option>
              {#each forSale(current) as size (size)}<option value={size}>{t(SALE_LABELS[size])} · {money(data.store!.prices[size]!)}</option>{/each}
            </select>
          {/if}
          {#if data.gallery.downloadSizes.includes('original') && !current.originalReachable}
            <span class="muted small">{t('gallery.originalAsk')}</span>
          {/if}
          <button class="btn btn-sm" onclick={() => (open = null)} aria-label={t('common.close')}>✕</button>
        </div>
      </div>
      <div class="stage">
        <button class="nav prev" onclick={() => step(-1)} aria-label={t('gallery.previous')}>‹</button>
        {#if current.hasPreview}
          <img src={image(current, 'preview')} alt={current.alt ?? label(current)} draggable="false" oncontextmenu={(e) => e.preventDefault()} />
        {:else}
          <span class="placeholder">{t('gallery.noPreview')}</span>
        {/if}
        <button class="nav next" onclick={() => step(1)} aria-label={t('gallery.next')}>›</button>
      </div>
      {#if current.caption || data.suggesting}
        <div class="foot">
          {#if current.caption}<p class="caption">{current.caption}</p>{/if}
          {#if data.suggesting}
            <SuggestNames
              {base}
              item={current}
              items={data.items}
              chips={data.people ?? []}
              thumb={(i) => image(i as GalleryItem, 'thumb')}
              onchange={suggestedChanged}
              onopen={(o) => (suggestingOpen = o)}
            />
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if asking !== null}
    <div class="viewer modal" role="dialog" aria-modal="true" aria-labelledby="who-title">
      <form class="card stack who" onsubmit={introduce}>
        <h2 id="who-title">{t('gallery.who.title')}</h2>
        <p class="muted small">{t('gallery.who.lead')}</p>
        <div class="field">
          <label for="who-name">{t('gallery.who.name')}</label>
          <input id="who-name" type="text" required maxlength="100" bind:value={name} use:focus />
        </div>
        <div class="field">
          <label for="who-email">{t('gallery.who.email')}</label>
          <input id="who-email" type="email" maxlength="254" bind:value={email} />
        </div>
        {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
        <div class="row">
          <button class="btn btn-primary" type="submit" disabled={busy}>{t('gallery.who.start')}</button>
          <button class="btn" type="button" onclick={() => (asking = null)}>{t('common.cancel')}</button>
        </div>
      </form>
    </div>
  {/if}
{/if}

<style>
  .people {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    margin: 0 0 12px;
  }
  .people .chip {
    border-radius: 999px;
  }
  .buy {
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: 0.85rem;
  }
  .store {
    display: flex;
    align-items: flex-start;
  }
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
    /* Follows light or dark, like the rest of the gallery. */
    background: light-dark(rgb(240 242 246), rgb(5 6 9));
    color: var(--text);
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
    color: var(--text);
    background: light-dark(rgb(0 0 0 / 0.06), rgb(255 255 255 / 0.06));
    cursor: pointer;
  }
  .nav:hover {
    background: light-dark(rgb(0 0 0 / 0.12), rgb(255 255 255 / 0.14));
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
    color: var(--text-muted);
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

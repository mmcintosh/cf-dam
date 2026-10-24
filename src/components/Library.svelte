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
  import { format, lang, t } from '@cf-dam/i18n/client'
  import { intlTag } from '@cf-dam/i18n/languages'

  interface Asset {
    id: string
    filename: string
    title: string | null
    /** Alt text, for screen readers: preferred over the title and file name. */
    alt: string | null
    caption: string | null
    /** AI review's suggestions, kept apart until someone uses them. */
    ai: { alt: string | null; caption: string | null } | null
    width: number | null
    height: number | null
    /** The size shown, after any rotate or crop. */
    displayWidth: number | null
    displayHeight: number | null
    /** Part of image addresses: changes with each edit. */
    imageVersion: string
    rating: number | null
    flag: 'pick' | 'reject' | null
    label: Label | null
    status: string
    renditions: string[]
    capturedAt: string | null
    camera: { make: string | null; model: string | null; lens: string | null }
    exposure: { focalLength: number | null; aperture: number | null; exposureTime: number | null; iso: number | null }
    storage: { storageClass: string; state: string } | null
    video: { duration: number | null } | null
  }
  interface Props {
    initial: Asset[]
    initialTotal: number
    /** False when more than `initialTotal` match (the count stops at 10,000). */
    initialTotalExact: boolean
    /** The current filter query string, without offset/limit. */
    query: string
    pageSize: number
    canEdit: boolean
    canDelete: boolean
    /** Can queue photos for AI review (and AI is available here). */
    canRunAi: boolean
    /** What each colour label is called in this archive. */
    labelNames: Record<Label, string>
    /** Metadata presets that can be stamped on a selection. */
    presets: { id: string; name: string }[]
    /** Can make client galleries (with canEdit, to make the album for them). */
    canShare?: boolean
  }
  type Label = 'red' | 'yellow' | 'green' | 'blue' | 'purple'
  const LABEL_KEYS: Record<string, Label> = { '6': 'red', '7': 'yellow', '8': 'green', '9': 'blue' }
  /** The most one bulk edit takes (the server's MAX_BULK). */
  const MAX_BULK = 500
  let { initial, initialTotal, initialTotalExact, query, pageSize, canEdit, canDelete, canRunAi, labelNames, presets, canShare = false }: Props = $props()

  let assets = $state<Asset[]>([...initial])
  let total = $state(initialTotal)
  let totalExact = $state(initialTotalExact)
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

  const ratio = (a: Asset) => (a.displayWidth && a.displayHeight ? Math.min(Math.max(a.displayWidth / a.displayHeight, 0.4), 3) : 1.5)
  const ext = (name: string) => name.split('.').pop()?.toUpperCase().slice(0, 5) ?? 'FILE'
  const shutter = (t: number | null) => (t === null ? '' : t >= 1 ? `${t}s` : `1/${Math.round(1 / t)}`)
  const TIER: Record<string, string> = { NAS: 'nas', STANDARD: 'hot', STANDARD_IA: 'warm', ONEZONE_IA: 'warm', INTELLIGENT_TIERING: 'warm', GLACIER_IR: 'cold', GLACIER: 'cold', DEEP_ARCHIVE: 'deep' }

  const clock = (s: number) => {
    const t = Math.round(s)
    const h = Math.floor(t / 3600)
    const mm = String(Math.floor((t % 3600) / 60)).padStart(h ? 2 : 1, '0')
    return `${h ? `${h}:` : ''}${mm}:${String(t % 60).padStart(2, '0')}`
  }
  // Hovering a video flicks through its contact sheet (four frames in a 2×2 grid). Mouse only: on a
  // touch screen the pointer "enters" on a tap, which opens the loupe anyway.
  let scrubbing = $state<string | null>(null)
  let scrubFrame = $state(0)
  let scrubTimer: ReturnType<typeof setInterval> | undefined
  function scrub(id: string | null) {
    clearInterval(scrubTimer)
    scrubbing = id
    scrubFrame = 0
    if (id) scrubTimer = setInterval(() => (scrubFrame = (scrubFrame + 1) % 4), 650)
  }

  function say(message: string) {
    toast = message
    setTimeout(() => toast === message && (toast = ''), 2200)
  }

  // ── Loading more ─────────────────────────────────────────────────────────────
  async function loadMore() {
    if (loading || (totalExact && assets.length >= total)) return
    loading = true
    try {
      const sep = query ? '&' : ''
      const page = await api<{ assets: Asset[] }>(`/api/assets?${query}${sep}offset=${assets.length}&limit=${pageSize}`)
      assets = [...assets, ...page.assets]
      // Past the count's cap, the end shows itself as a short page.
      if (!totalExact && page.assets.length < pageSize) {
        total = assets.length
        totalExact = true
      } else if (!totalExact) total = Math.max(total, assets.length)
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
  function selectAll() {
    selected = new Set(assets.slice(0, MAX_BULK).map((a) => a.id))
    if (assets.length > MAX_BULK) say(t('library.say.firstOnly', { count: MAX_BULK }))
  }
  const clearSelection = () => ((selected = new Set()), (anchor = null))

  // ── Edits (optimistic, then the API) ─────────────────────────────────────────
  function targets(): string[] {
    if (loupe !== null && current) return [current.id]
    if (selected.size > 0) return [...selected]
    const focused = assets[focus]
    return focused ? [focused.id] : []
  }

  async function bulk(body: Record<string, unknown>, ids = targets()): Promise<boolean> {
    if (!canEdit && body.action !== 'delete' && body.action !== 'ai-queue') return false
    if (ids.length === 0) return false
    if (ids.length > MAX_BULK) {
      say(t('library.say.atMost', { max: MAX_BULK, count: ids.length }))
      return false
    }
    try {
      await api('/api/assets/bulk', { method: 'POST', body: JSON.stringify({ ids, ...body }) })
      return true
    } catch (e) {
      say(e instanceof Error ? e.message : t('library.say.notSaved'))
      return false
    }
  }

  /**
   * Show a rating, flag or label at once, then save it. If the save fails, the photos get back what they
   * had (bulk() says why), unless they've been changed again since.
   */
  async function edit<K extends 'rating' | 'flag' | 'label'>(ids: string[], field: K, value: Asset[K]): Promise<boolean> {
    // Nothing to change, or too many (bulk() says so): nothing is shown either.
    if (ids.length === 0 || ids.length > MAX_BULK) return bulk({ action: field }, ids)
    const before = new Map(assets.filter((a) => ids.includes(a.id)).map((a) => [a.id, a[field]]))
    assets = assets.map((a) => (ids.includes(a.id) ? { ...a, [field]: value } : a))
    if (await bulk({ action: field, [field]: value }, ids)) return true
    assets = assets.map((a) => (before.has(a.id) && a[field] === value ? { ...a, [field]: before.get(a.id) } : a))
    return false
  }

  /** What a screen reader hears: the alt text, else the AI's suggested one, else the title or file name. */
  const altOf = (a: Asset) => a.alt ?? a.ai?.alt ?? a.title ?? a.filename

  /** Keep the AI's caption and alt text where the photo has none (people's own text is never replaced). */
  async function useSuggestion(asset: Asset) {
    try {
      const result = await api<{ alt: string | null; caption: string | null }>(`/api/assets/${asset.id}/ai/accept`, { method: 'POST', body: JSON.stringify({ fields: ['alt', 'caption'] }) })
      assets = assets.map((a) => (a.id === asset.id ? { ...a, alt: result.alt, caption: result.caption } : a))
      say(t('library.say.suggestionUsed'))
    } catch (e) {
      say(e instanceof Error ? e.message : t('common.couldNotSave'))
    }
  }

  async function rate(value: number) {
    const ids = targets()
    const rating = value === 0 ? null : value
    if (await edit(ids, 'rating', rating)) say(rating ? t('library.say.rated', { stars: '★'.repeat(rating), count: ids.length }) : t('library.say.ratingCleared', { count: ids.length }))
  }

  async function setFlag(flag: 'pick' | 'reject' | null, ids = targets()) {
    if (!(await edit(ids, 'flag', flag))) return
    say(flag ? t(flag === 'pick' ? 'library.say.picked' : 'library.say.rejected', { count: ids.length }) : t('library.say.flagCleared', { count: ids.length }))
    if (loupe !== null && flag) next(1)
  }

  /** Set a label on the targets; pressing the label a photo already has clears it (as in Lightroom). */
  async function setLabel(value: Label | null) {
    const ids = targets()
    const first = assets.find((a) => a.id === ids[0])
    const label = value && first?.label === value && ids.length === 1 ? null : value
    if (await edit(ids, 'label', label)) say(label ? t('library.say.labelled', { label: labelNames[label], count: ids.length }) : t('library.say.labelCleared', { count: ids.length }))
  }

  async function addTags() {
    const tags = tagInput.split(',').map((t) => t.trim()).filter(Boolean)
    if (tags.length === 0) return
    if (await bulk({ action: 'tag-add', tags })) {
      say(t('library.say.tagged', { count: targets().length, tags: format().list(tags) }))
      tagInput = ''
      if (detail) detail = { ...detail, tags: [...new Set([...detail.tags, ...tags])] }
    }
  }

  /** Make an album of the selection, then open its new-gallery form. The album can be renamed there. */
  async function shareWithClient() {
    const ids = targets()
    if (ids.length === 0) return
    if (ids.length > MAX_BULK) return say(t('library.say.atMost', { max: MAX_BULK, count: ids.length }))
    say(t('library.say.makingAlbum'))
    try {
      const name = t('library.shareAlbumName', { date: format().date(new Date()) })
      const { album } = await api<{ album: { id: string } }>('/api/albums', { method: 'POST', body: JSON.stringify({ name }) })
      if (await bulk({ action: 'album-add', albumId: album.id }, ids)) location.href = `/albums/${album.id}?share=new#share`
    } catch (e) {
      say(e instanceof Error ? e.message : t('library.say.notSaved'))
    }
  }

  async function addToAlbum(albumId: string) {
    if (!albumId) return
    if (await bulk({ action: 'album-add', albumId })) say(t('library.say.addedToAlbum', { count: targets().length, album: albums.find((a) => a.id === albumId)?.name ?? t('library.say.theAlbum') }))
  }

  async function applyPreset(value: string) {
    const [id, mode] = value.split(':')
    const preset = presets.find((p) => p.id === id)
    if (!preset) return
    if (await bulk({ action: 'preset', presetId: id, overwrite: mode === 'overwrite' })) say(t(mode === 'overwrite' ? 'library.say.presetOverwrote' : 'library.say.presetApplied', { preset: preset.name, count: targets().length }))
  }

  /** People in the photo set by hand, or back to TypeSafe's Jev's answer (jev-facets.ts). */
  async function setPeople(value: string) {
    const count = targets().length
    if (await bulk({ action: 'people', people: value })) say(t(value === 'jev' ? 'library.say.peopleJev' : 'library.say.peopleSet', { count }))
  }

  async function aiAction(choice: string) {
    const count = targets().length
    if (choice === 'queue') {
      if (await bulk({ action: 'ai-queue' })) say(t('library.say.queued', { count }))
    } else if (choice === 'alt' || choice === 'caption' || choice === 'tags') {
      const done = ({ alt: 'library.say.altUsed', caption: 'library.say.captionUsed', tags: 'library.say.tagsKept' } as const)[choice]
      if (await bulk({ action: 'ai-accept', fields: [choice] })) say(t(done, { count }))
    }
  }

  async function remove() {
    const ids = [...selected]
    if (!confirm(t('library.confirmDelete', { count: ids.length }))) return
    if (await bulk({ action: 'delete' }, ids)) {
      assets = assets.filter((a) => !selected.has(a.id))
      total -= ids.length
      clearSelection()
      say(t('library.say.deleted', { count: ids.length }))
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
      const full = await api<{ tags: { name: string; path: string }[] }>(`/api/assets/${id}`)
      if (current?.id === id) detail = { id, tags: full.tags.map((t) => t.path) }
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
      else if (LABEL_KEYS[key] && canEdit) setLabel(LABEL_KEYS[key]!)
      else if (key === 'p' && canEdit) setFlag('pick')
      else if (key === 'x' && canEdit) setFlag('reject')
      else if (key === 'u' && canEdit) setFlag(null)
      else return
      event.preventDefault()
      return
    }
    const inGrid = grid?.contains(document.activeElement) ?? false
    if (!inGrid && document.activeElement !== document.body) return
    // From the page itself no tile shows focus: arrows bring it to the grid, and edits need a
    // selection to act on, never the tile that was focused last.
    const editable = canEdit && (inGrid || selected.size > 0)
    const cols = columnsGuess()
    if (key === 'arrowright') focus = Math.min(focus + 1, assets.length - 1)
    else if (key === 'arrowleft') focus = Math.max(focus - 1, 0)
    else if (key === 'arrowdown') focus = Math.min(focus + cols, assets.length - 1)
    else if (key === 'arrowup') focus = Math.max(focus - cols, 0)
    else if (key === 'enter' && inGrid) openLoupe(focus)
    else if (key === ' ' && inGrid) toggle(focus)
    else if (key === 'escape') clearSelection()
    else if (key === 'a' && event.shiftKey) selectAll()
    else if (/^[0-5]$/.test(key) && editable) rate(Number(key))
    else if (LABEL_KEYS[key] && editable) setLabel(LABEL_KEYS[key]!)
    else if (key === 'p' && editable) setFlag('pick')
    else if (key === 'x' && editable) setFlag('reject')
    else if (key === 'u' && editable) setFlag(null)
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
  onMount(() => () => clearInterval(scrubTimer))
</script>

<svelte:window onkeydown={onKey} />

<div class="justified" bind:this={grid} role="grid" aria-label={t('library.grid')} aria-multiselectable="true">
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
      onpointerenter={(e) => e.pointerType === 'mouse' && asset.renditions.includes('sheet') && scrub(asset.id)}
      onpointerleave={() => scrubbing === asset.id && scrub(null)}
    >
      <i class="spacer" style={`padding-bottom:${(100 / ratio(asset)).toFixed(4)}%`}></i>
      {#if asset.renditions.includes('thumb')}
        <img src={`/api/assets/${asset.id}/renditions/thumb?v=${asset.imageVersion}`} alt={altOf(asset)} loading={index < 40 ? 'eager' : 'lazy'} decoding="async" />
      {:else}
        <span class="placeholder"><strong>{ext(asset.filename)}</strong><span>{asset.status === 'ready' ? t('common.noPreview') : asset.status === 'queued' ? t('common.queued') : asset.status === 'error' ? t('common.notProcessed') : t('common.processing')}</span></span>
      {/if}
      {#if scrubbing === asset.id}
        <span class="scrub" style={`background-image:url(/api/assets/${asset.id}/renditions/sheet);background-position:${scrubFrame % 2 ? '100%' : '0%'} ${scrubFrame > 1 ? '100%' : '0%'}`}></span>
      {/if}
      <button
        class="tick"
        type="button"
        aria-label={selected.has(asset.id) ? t('library.deselect') : t('library.select')}
        onclick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          e.shiftKey ? selectRange(index) : toggle(index)
        }}>✓</button
      >
      {#if asset.video}<span class="duration">▶ {asset.video.duration ? clock(asset.video.duration) : ''}</span>{/if}
      {#if asset.flag === 'pick'}<span class="flag pick" title={t('library.pick')}>⚑</span>{/if}
      {#if asset.label}<span class={`label-strip label-${asset.label}`} title={labelNames[asset.label]}></span>{/if}
      {#if asset.storage && asset.storage.storageClass !== 'STANDARD'}<span class={`tier tier-${TIER[asset.storage.storageClass] ?? 'warm'}`} title={asset.storage.storageClass}></span>{/if}
      <span class="overlay">
        <span class="name">{asset.title ?? asset.filename}</span>
        {#if asset.rating}<span class="stars">{'★'.repeat(asset.rating)}</span>{/if}
      </span>
    </a>
  {/each}
</div>
<div id="library-end" class="end muted">
  {#if loading}{t('common.loading')}{:else if assets.length < total || !totalExact}<button class="btn btn-sm" onclick={loadMore}>{t('library.loadMore')}</button>{:else if total > 0}{t('library.allShown', { count: total })}{/if}
</div>

{#if selected.size > 0 && loupe === null && !compare}
  <div class="bulkbar card" role="toolbar" aria-label={t('library.bulkbar')}>
    <strong>{t('library.selected', { count: selected.size })}</strong>
    {#if selected.size > MAX_BULK}<span class="muted">{t('library.editsAtATime', { count: MAX_BULK })}</span>{/if}
    {#if canEdit}
      <span class="group">
        {#each [1, 2, 3, 4, 5] as star (star)}<button class="icon" title={`${star} star${star > 1 ? 's' : ''}`} onclick={() => rate(star)}>{star}★</button>{/each}
        <button class="icon" title={t('library.pickKey')} onclick={() => setFlag('pick')}>⚑</button>
        <button class="icon" title={t('library.rejectKey')} onclick={() => setFlag('reject')}>✕</button>
      </span>
      <form class="group" onsubmit={(e) => (e.preventDefault(), addTags())}>
        <input type="text" placeholder={t('library.tagsPlaceholder')} bind:value={tagInput} aria-label={t('library.tagsToAdd')} />
        <button class="btn btn-sm" type="submit">{t('library.tag')}</button>
      </form>
      <select aria-label={t('library.label')} onchange={(e) => { const v = e.currentTarget.value; if (v) setLabel(v === 'clear' ? null : (v as Label)); e.currentTarget.value = '' }}>
        <option value="">{t('library.labelMenu')}</option>
        {#each Object.entries(labelNames) as [value, name] (value)}<option {value}>{name}</option>{/each}
        <option value="clear">{t('library.noLabel')}</option>
      </select>
      <select aria-label={t('library.people')} onchange={(e) => { const v = e.currentTarget.value; e.currentTarget.value = ''; if (v) setPeople(v) }}>
        <option value="">{t('library.peopleMenu')}</option>
        <option value="none">{t('photoPeople.none')}</option>
        <option value="one">{t('photoPeople.onePerson')}</option>
        <option value="two_to_five">{t('photoPeople.twoToFive')}</option>
        <option value="six_or_more">{t('photoPeople.sixOrMore')}</option>
        <option value="jev">{t('photoPeople.backToJev')}</option>
      </select>
      {#if presets.length > 0}
        <select aria-label={t('library.applyPreset')} onchange={(e) => { const v = e.currentTarget.value; e.currentTarget.value = ''; if (v) applyPreset(v) }}>
          <option value="">{t('library.presetMenu')}</option>
          {#each presets as p (p.id)}
            <option value={`${p.id}:fill`}>{t('library.presetFill', { name: p.name })}</option>
            <option value={`${p.id}:overwrite`}>{t('library.presetOverwrite', { name: p.name })}</option>
          {/each}
        </select>
      {/if}
      {#if albums.length > 0}
        <select aria-label={t('library.addToAlbum')} onchange={(e) => (addToAlbum(e.currentTarget.value), (e.currentTarget.value = ''))}>
          <option value="">{t('library.addToAlbumMenu')}</option>
          {#each albums as album (album.id)}<option value={album.id}>{album.name}</option>{/each}
        </select>
      {/if}
    {/if}
    {#if canRunAi || canEdit}
      <select aria-label={t('library.aiActions')} onchange={(e) => (aiAction(e.currentTarget.value), (e.currentTarget.value = ''))}>
        <option value="">{t('library.aiMenu')}</option>
        {#if canRunAi}<option value="queue">{t('library.aiAgain')}</option>{/if}
        {#if canEdit}
          <option value="alt">{t('library.aiAlt')}</option>
          <option value="caption">{t('library.aiCaption')}</option>
          <option value="tags">{t('library.aiTags')}</option>
        {/if}
      </select>
    {/if}
    {#if canShare && canEdit}<button class="btn btn-sm" onclick={shareWithClient}>{t('library.shareWithClient')}</button>{/if}
    {#if selected.size >= 2 && selected.size <= 4}<button class="btn btn-sm" onclick={openCompare}>{t('library.compare')}</button>{/if}
    {#if canDelete}<button class="btn btn-sm btn-danger" onclick={remove}>{t('common.delete')}</button>{/if}
    <span class="spacer"></span>
    <button class="btn btn-sm" onclick={selectAll} title={assets.length > MAX_BULK ? t('library.editsAtATimeTitle', { count: MAX_BULK }) : undefined}>{assets.length > MAX_BULK ? t('library.selectFirst', { count: MAX_BULK }) : t('library.selectAll', { count: assets.length })}</button>
    <button class="btn btn-sm" onclick={clearSelection}>{t('common.clear')}</button>
  </div>
{/if}

{#if current}
  <div class="loupe" role="dialog" aria-modal="true" aria-label={current.title ?? current.filename}>
    <div class="stage" class:zoomed={zoom}>
      {#if current.renditions.includes('preview') || current.renditions.includes('thumb')}
        {#key current.id}
          <img
            src={`/api/assets/${current.id}/renditions/${current.renditions.includes('preview') ? 'preview' : 'thumb'}?v=${current.imageVersion}`}
            alt={altOf(current)}
            style={current.renditions.includes('thumb') ? `background-image:url(/api/assets/${current.id}/renditions/thumb?v=${current.imageVersion})` : ''}
            onclick={() => (zoom = !zoom)}
          />
        {/key}
      {:else}
        <div class="no-preview"><strong>{ext(current.filename)}</strong><span>{t('common.noPreview')}</span></div>
      {/if}
      <button class="nav prev" aria-label={t('library.previous')} onclick={() => next(-1)} disabled={loupe === 0}>‹</button>
      <button class="nav next" aria-label={t('library.next')} onclick={() => next(1)} disabled={loupe === assets.length - 1 && assets.length >= total && totalExact}>›</button>
      <button class="close" aria-label={t('library.closeKey')} onclick={closeLoupe}>✕</button>
      {#if current.flag}<span class={`loupe-flag ${current.flag}`}>{current.flag === 'pick' ? t('library.pickButton') : t('library.rejectButton')}</span>{/if}
      {#if current.label}<span class={`loupe-label label-${current.label}`}>{labelNames[current.label]}</span>{/if}
    </div>
    {#if showInfo}
      <aside class="info">
        <h2>{current.title ?? current.filename}</h2>
        <p class="muted">{t('library.position', { index: loupe! + 1, total: `${format().number(total)}${totalExact ? '' : '+'}` })}</p>
        {#if current.caption}
          <p class="caption">{current.caption}</p>
        {:else if current.ai?.caption || (!current.alt && current.ai?.alt)}
          <div class="suggestion">
            <span class="small muted">{t('library.aiSuggestion')}</span>
            {#if current.ai?.caption}<p>{current.ai.caption}</p>{/if}
            {#if !current.alt && current.ai?.alt}<p class="small"><span class="muted">{t('editor.alt')}:</span> {current.ai.alt}</p>{/if}
            {#if canEdit}<button class="btn btn-sm" type="button" onclick={() => useSuggestion(current)}>{t('library.useSuggestion')}</button>{/if}
          </div>
        {/if}
        <div class="stars-row" aria-label={t('common.rating')}>
          {#each [1, 2, 3, 4, 5] as star (star)}
            <button class:on={(current.rating ?? 0) >= star} disabled={!canEdit} onclick={() => rate(current.rating === star ? 0 : star)} aria-label={t('common.stars', { count: star })}>★</button>
          {/each}
        </div>
        <dl>
          {#if current.capturedAt}<dt>{t('common.taken')}</dt><dd>{new Intl.DateTimeFormat(intlTag(lang()), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(`${current.capturedAt}Z`))}</dd>{/if}
          {#if current.camera.model}<dt>{t('common.camera')}</dt><dd>{current.camera.model}</dd>{/if}
          {#if current.camera.lens}<dt>{t('common.lens')}</dt><dd>{current.camera.lens}</dd>{/if}
          {#if current.exposure.aperture}<dt>{t('common.exposure')}</dt><dd>{[current.exposure.focalLength && `${current.exposure.focalLength} mm`, `ƒ/${current.exposure.aperture}`, shutter(current.exposure.exposureTime), current.exposure.iso && `ISO ${current.exposure.iso}`].filter(Boolean).join(' · ')}</dd>{/if}
          {#if current.width}<dt>{t('common.size')}</dt><dd>{current.width} × {current.height}</dd>{/if}
        </dl>
        {#if detail && detail.id === current.id}
          <div class="tags">{#each detail.tags as tag (tag)}<a class="tag" href={`/?tag=${encodeURIComponent(tag)}`} title={tag}>{tag.split(' › ').at(-1)}</a>{/each}</div>
        {/if}
        {#if canEdit}
          <form class="row" onsubmit={(e) => (e.preventDefault(), addTags())}>
            <input type="text" placeholder={t('library.addTagsPlaceholder')} bind:value={tagInput} aria-label={t('library.addTags')} />
          </form>
        {/if}
        <a class="btn btn-sm" href={`/assets/${current.id}`}>{t('library.openDetails')}</a>
        <p class="keys muted">{t('library.loupeKeys')}</p>
      </aside>
    {/if}
  </div>
{/if}

{#if compare}
  <div class="loupe compare" role="dialog" aria-modal="true" aria-label={t('library.compareTitle')}>
    <div class="compare-grid" class:zoomed={zoom}>
      {#each compare as id (id)}
        {@const asset = assets.find((a) => a.id === id)}
        {#if asset}
          <figure>
            <img src={`/api/assets/${id}/renditions/${asset.renditions.includes('preview') ? 'preview' : 'thumb'}?v=${asset.imageVersion}`} alt={altOf(asset)} onclick={() => (zoom = !zoom)} />
            <figcaption>
              <span>{asset.title ?? asset.filename}</span>
              {#if canEdit}
                <span>
                  <button class="icon" class:on={asset.flag === 'pick'} onclick={() => setFlag('pick', [id])}>{t('library.pickButton')}</button>
                  <button class="icon" class:on={asset.flag === 'reject'} onclick={() => setFlag('reject', [id])}>{t('library.rejectButton')}</button>
                </span>
              {/if}
            </figcaption>
          </figure>
        {/if}
      {/each}
    </div>
    <button class="close" aria-label={t('library.closeKey')} onclick={() => (compare = null)}>✕</button>
    <p class="keys muted compare-keys">{t('library.compareKeys')}</p>
  </div>
{/if}

{#if toast}<div class="toast" class:raised={selected.size > 0} role="status">{toast}</div>{/if}

<style>
  .justified {
    /* Taller rows on wide screens, and the person's thumbnail size (catalog/preferences.ts). */
    --row: clamp(200px, 11vw, 300px);
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
  :global(:root[data-thumbs='small']) .justified {
    --row: clamp(130px, 7vw, 190px);
  }
  :global(:root[data-thumbs='large']) .justified {
    --row: clamp(280px, 16vw, 440px);
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
  .scrub {
    position: absolute;
    inset: 0;
    background-size: 200% 200%;
    background-repeat: no-repeat;
    pointer-events: none;
  }
  /* Bottom right, left of the storage dot: the bottom left carries the name on hover. */
  .duration {
    position: absolute;
    right: 26px;
    bottom: 6px;
    padding: 1px 7px;
    border-radius: 6px;
    font-size: 0.72rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: #fff;
    background: rgb(0 0 0 / 0.6);
  }
  .label-strip {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 4px;
  }
  .loupe-label {
    position: absolute;
    top: 18px;
    left: 50%;
    transform: translateX(-50%);
    padding: 3px 12px;
    border-radius: 99px;
    font-size: 0.8rem;
    font-weight: 600;
    color: #fff;
  }
  .label-red {
    background: var(--label-red);
  }
  .label-yellow {
    background: var(--label-yellow);
    color: #222;
  }
  .label-green {
    background: var(--label-green);
  }
  .label-blue {
    background: var(--label-blue);
  }
  .label-purple {
    background: var(--label-purple);
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
  .tier-nas {
    background: #a3e635;
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
    /* Follows light or dark, like every other page. */
    background: light-dark(rgb(240 242 246 / 0.98), rgb(5 6 9 / 0.97));
    color: var(--text);
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
    background: light-dark(rgb(0 0 0 / 0.06), rgb(255 255 255 / 0.08));
    color: var(--text);
    cursor: pointer;
    border-radius: 50%;
    width: 44px;
    height: 44px;
    font-size: 1.6rem;
    line-height: 1;
  }
  .nav:hover,
  .close:hover {
    background: light-dark(rgb(0 0 0 / 0.12), rgb(255 255 255 / 0.18));
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
    border-left: 1px solid var(--border);
    background: var(--bg-elevated);
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
    color: var(--text-muted);
  }
  .caption {
    font-size: 0.9rem;
  }
  .suggestion {
    display: grid;
    gap: 6px;
    justify-items: start;
    padding: 10px 12px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
  }
  .info dd {
    margin: 0;
  }
  .stars-row button {
    font-size: 1.4rem;
    background: none;
    border: 0;
    color: var(--border-strong);
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
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .keys {
    margin-top: auto !important;
    font-size: 0.75rem;
    color: var(--text-faint);
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
    color: var(--text);
    border-color: var(--border-strong);
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

<script lang="ts">
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'
  import { t } from '@cf-dam/i18n/client'

  interface Props {
    assetId: string
    title: string | null
    caption: string | null
    alt: string | null
    rating: number | null
    /** Keyword paths ('Places › Norway › Bergen'). */
    tags: string[]
    label: Label | null
    labelNames: Record<Label, string>
    canEdit: boolean
    ai: AiSuggestions
    aiTags: string[]
    /** Workers AI is bound and AI review is switched on. */
    aiAvailable: boolean
    canRunAi: boolean
    /** The albums this photo is in. */
    inAlbums?: { id: string; name: string }[]
  }

  interface AiSuggestions {
    status: string | null
    model: string | null
    analyzedAt: string | null
    alt: string | null
    caption: string | null
    description: string | null
    quality: string | null
    people: number | null
    text: string | null
    error: string | null
  }
  type TagRow = { name: string; path: string; source: string }
  type Label = 'red' | 'yellow' | 'green' | 'blue' | 'purple'
  let props: Props = $props()

  let title = $state(props.title ?? '')
  let caption = $state(props.caption ?? '')
  let alt = $state(props.alt ?? '')
  let rating = $state(props.rating ?? 0)
  let tags = $state<string[]>([...props.tags])
  let tagInput = $state('')
  let label = $state<Label | null>(props.label)
  let suggestions = $state<{ id: string; path: string; total: number }[]>([])
  let suggestionIndex = $state(-1)
  let suggestTimer: ReturnType<typeof setTimeout> | undefined
  let suggesting: AbortController | undefined
  const leaf = (path: string) => path.split(' › ').at(-1) ?? path

  // The server's splitPath and normalizeName (packages/api/src/catalog/keywords.ts), so a typed
  // "Places > Norway" is the path it will be saved as. Keep the two the same.
  const SEPARATORS = /\s*(?:>|\||›)\s*/
  const toPath = (input: string) =>
    input
      .split(SEPARATORS)
      .map((name) => name.normalize('NFKC').replace(/\s+/g, ' ').trim())
      .filter((name) => name.length > 0 && name.length <= 80)
      .slice(0, 12)
      .join(' › ')

  function suggest() {
    clearTimeout(suggestTimer)
    suggesting?.abort()
    const q = tagInput.trim()
    if (q.length < 1) {
      suggestions = []
      return
    }
    suggestTimer = setTimeout(async () => {
      const request = (suggesting = new AbortController())
      try {
        const found = await api<{ keywords: { id: string; path: string; total: number }[] }>(`/api/tags?q=${encodeURIComponent(q)}`, { signal: request.signal })
        // An answer to what was typed before, or after a pick, is ignored.
        if (request !== suggesting || tagInput.trim() !== q) return
        suggestions = found.keywords.filter((k) => !tags.includes(k.path)).slice(0, 8)
        suggestionIndex = -1
      } catch {
        // Cancelled, or no suggestions to be had: typing still works.
      }
    }, 120)
  }

  function closeSuggestions() {
    clearTimeout(suggestTimer)
    suggesting?.abort()
    suggesting = undefined
    suggestions = []
    suggestionIndex = -1
  }

  function pickTag(typed: string) {
    const path = toPath(typed)
    if (path && !tags.some((t) => t.toLowerCase() === path.toLowerCase())) void saveTags([...tags, path])
    tagInput = ''
    closeSuggestions()
  }

  async function setLabel(value: Label) {
    const before = label
    label = label === value ? null : value
    if (!(await save({ label }))) label = before
  }
  let ai = $state<AiSuggestions>({ ...props.ai })
  let aiTags = $state<string[]>([...props.aiTags])
  let analysing = $state(false)
  let aiMessage = $state('')

  function applyTags(rows: TagRow[]) {
    tags = rows.filter((t) => t.source !== 'ai').map((t) => t.path)
    aiTags = rows.filter((t) => t.source === 'ai').map((t) => t.path)
  }

  async function analyse() {
    analysing = true
    aiMessage = ''
    try {
      const response = await fetch(`/api/assets/${props.assetId}/ai/analyze`, { method: 'POST' })
      const body = (await response.json()) as { ai?: AiSuggestions; tags?: TagRow[]; message?: string }
      if (body.ai) ai = body.ai
      if (body.tags) applyTags(body.tags)
      if (!response.ok) aiMessage = body.ai?.error ?? body.message ?? t('editor.analysisFailed')
    } catch {
      aiMessage = t('editor.analysisFailed')
    } finally {
      analysing = false
    }
  }

  async function accept(fields: ('alt' | 'caption' | 'tags')[], overwrite = false) {
    try {
      const result = await api<{ alt: string | null; caption: string | null; tags: TagRow[] }>(`/api/assets/${props.assetId}/ai/accept`, {
        method: 'POST',
        body: JSON.stringify({ fields, overwrite }),
      })
      alt = saved.alt = result.alt ?? ''
      caption = saved.caption = result.caption ?? ''
      applyTags(result.tags)
    } catch (e) {
      failed(e, t('editor.notKept'))
    }
  }

  async function keepTag(tag: string) {
    const before = aiTags
    aiTags = aiTags.filter((t) => t !== tag)
    if (!(await saveTags([...tags, tag]))) aiTags = before
  }

  async function dropTag(tag: string) {
    const before = aiTags
    aiTags = aiTags.filter((t) => t !== tag)
    try {
      applyTags((await api<{ tags: TagRow[] }>(`/api/assets/${props.assetId}/ai/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' })).tags)
    } catch (e) {
      aiTags = before
      failed(e, t('editor.notDropped', { tag: leaf(tag) }))
    }
  }
  let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle')
  let message = $state('')

  function failed(e: unknown, what: string) {
    status = 'error'
    message = t('editor.failed', { what, why: e instanceof Error ? e.message : t('common.tryAgain') })
  }

  /** Save a change. False when it didn't save: the caller puts back what the server has. */
  async function save(patch: Record<string, unknown>): Promise<boolean> {
    if (!props.canEdit) return false
    status = 'saving'
    try {
      await api(`/api/assets/${props.assetId}`, { method: 'PATCH', body: JSON.stringify(patch) })
      status = 'saved'
      setTimeout(() => status === 'saved' && (status = 'idle'), 1500)
      return true
    } catch (e) {
      failed(e, t('editor.notSaved'))
      return false
    }
  }

  /** Title, caption and alt text as the server has them. */
  const saved = { title: props.title ?? '', caption: props.caption ?? '', alt: props.alt ?? '' }
  async function saveText(field: 'title' | 'caption' | 'alt') {
    const value = { title, caption, alt }[field]
    if (await save({ [field]: value })) saved[field] = value
    else if (field === 'title') title = saved.title
    else if (field === 'caption') caption = saved.caption
    else alt = saved.alt
  }

  /**
   * Save the keyword list, then show it as the server has it: an existing keyword's own spelling, the
   * levels a typed path created. On failure, the list as it was.
   */
  async function saveTags(next: string[]): Promise<boolean> {
    const before = tags
    tags = next
    if (!(await save({ tags: next }))) {
      tags = before
      return false
    }
    try {
      applyTags((await api<{ tags: TagRow[] }>(`/api/assets/${props.assetId}`)).tags)
    } catch {
      // Saved; the typed spelling shows until the page is reloaded.
    }
    return true
  }

  function addTag(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault()
      suggestionIndex = (suggestionIndex + 1) % suggestions.length
      return
    }
    if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault()
      suggestionIndex = (suggestionIndex - 1 + suggestions.length) % suggestions.length
      return
    }
    if (event.key === 'Escape') {
      closeSuggestions()
      return
    }
    if (event.key !== 'Enter' && event.key !== ',') return
    event.preventDefault()
    // A highlighted suggestion wins; otherwise what was typed (a name, or a path like Places > Norway).
    pickTag(suggestionIndex >= 0 ? suggestions[suggestionIndex]!.path : tagInput.trim())
  }

  function removeTag(tag: string) {
    void saveTags(tags.filter((t) => t !== tag))
  }

  let albums = $state<{ id: string; name: string }[]>([])
  let albumId = $state('')
  let albumMessage = $state('')
  let inAlbums = $state([...(props.inAlbums ?? [])])
  const otherAlbums = $derived(albums.filter((a) => !inAlbums.some((x) => x.id === a.id)))

  onMount(async () => {
    if (props.canEdit) albums = (await api<{ albums: { id: string; name: string }[] }>('/api/albums').catch(() => ({ albums: [] }))).albums
  })

  async function addToAlbum() {
    if (!albumId) return
    const name = albums.find((a) => a.id === albumId)?.name ?? t('editor.theAlbum')
    try {
      await api(`/api/albums/${albumId}/items`, { method: 'POST', body: JSON.stringify({ assetIds: [props.assetId] }) })
      inAlbums = [...inAlbums, { id: albumId, name }]
      albumId = ''
      albumMessage = t('editor.addedTo', { album: name })
    } catch (e) {
      albumMessage = t('editor.notAddedTo', { album: name, why: e instanceof Error ? e.message : t('common.tryAgain') })
    }
  }

  /** Out of one album only: the photo stays in the library and in its other albums. */
  async function leaveAlbum(album: { id: string; name: string }) {
    try {
      await api(`/api/albums/${album.id}/items`, { method: 'DELETE', body: JSON.stringify({ assetIds: [props.assetId] }) })
      inAlbums = inAlbums.filter((a) => a.id !== album.id)
      albumMessage = t('editor.takenOut', { album: album.name })
    } catch (e) {
      albumMessage = t('editor.stillIn', { album: album.name, why: e instanceof Error ? e.message : t('common.tryAgain') })
    }
  }

  async function rate(value: number) {
    const before = rating
    rating = rating === value ? 0 : value
    if (!(await save({ rating }))) rating = before
  }
</script>

<div class="stack editor">
  <div class="stars" role="radiogroup" aria-label={t('common.rating')}>
    {#each [1, 2, 3, 4, 5] as star (star)}
      <button
        type="button"
        role="radio"
        aria-checked={rating === star}
        aria-label={t('common.stars', { count: star })}
        class:on={star <= rating}
        disabled={!props.canEdit}
        onclick={() => rate(star)}>★</button
      >
    {/each}
    <span class="labels" role="radiogroup" aria-label={t('editor.colourLabel')}>
      {#each Object.entries(props.labelNames) as [value, name] (value)}
        <button
          type="button"
          role="radio"
          aria-checked={label === value}
          aria-label={name}
          title={name}
          class={`swatch label-${value}`}
          class:on={label === value}
          disabled={!props.canEdit}
          onclick={() => setLabel(value as Label)}
        ></button>
      {/each}
    </span>
    <span class="save-state muted">{status === 'saving' ? t('common.saving') : status === 'saved' ? t('common.saved') : ''}</span>
  </div>

  <div class="field">
    <label for="title">{t('editor.title')}</label>
    <input id="title" type="text" bind:value={title} disabled={!props.canEdit} onchange={() => saveText('title')} />
  </div>
  <div class="field">
    <label for="caption">{t('editor.caption')}</label>
    <textarea id="caption" rows="3" bind:value={caption} disabled={!props.canEdit} onchange={() => saveText('caption')}></textarea>
  </div>
  <div class="field">
    <label for="alt">{t('editor.alt')}</label>
    <input id="alt" type="text" bind:value={alt} disabled={!props.canEdit} onchange={() => saveText('alt')} placeholder={t('editor.altPlaceholder')} />
  </div>
  <div class="field">
    <span class="label">{t('editor.tags')}</span>
    <div class="tags">
      {#each tags as tag (tag)}
        <span class="tag" title={tag}>
          <a href={`/?tag=${encodeURIComponent(tag)}`}>{leaf(tag)}{#if tag.includes(' › ')}<small> · {tag.split(' › ').slice(0, -1).join(' › ')}</small>{/if}</a>
          {#if props.canEdit}<button type="button" aria-label={t('editor.removeTag', { tag })} onclick={() => removeTag(tag)}>×</button>{/if}
        </span>
      {/each}
      {#if props.canEdit}
        <span class="tag-entry">
          <input
            class="tag-input"
            type="text"
            placeholder={t('editor.keywordPlaceholder')}
            bind:value={tagInput}
            onkeydown={addTag}
            oninput={suggest}
            onblur={() => setTimeout(closeSuggestions, 150)}
            aria-label={t('editor.addKeyword')}
            aria-autocomplete="list"
          />
          {#if suggestions.length > 0}
            <ul class="suggest" role="listbox">
              {#each suggestions as s, i (s.id)}
                <li role="option" aria-selected={i === suggestionIndex}>
                  <button type="button" class:on={i === suggestionIndex} onmousedown={(e) => (e.preventDefault(), pickTag(s.path))}>
                    <strong>{leaf(s.path)}</strong>{#if s.path.includes(' › ')}<span class="muted"> · {s.path.split(' › ').slice(0, -1).join(' › ')}</span>{/if}
                    <span class="n">{s.total}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </span>
      {/if}
    </div>
  </div>
  {#if props.aiAvailable || ai.status}
    <section class="ai" aria-label={t('editor.ai')}>
      <header class="row">
        <span class="label">{t('editor.ai')}</span>
        {#if ai.quality}<span class="pill">{['excellent', 'good', 'fair', 'poor'].includes(ai.quality) ? t(`quality.${ai.quality}` as 'quality.good') : ai.quality}</span>{/if}
        {#if ai.people}<span class="pill">{t('editor.people', { count: ai.people })}</span>{/if}
        <span class="spacer"></span>
        {#if props.canRunAi && props.aiAvailable}
          <button class="btn btn-sm" type="button" onclick={analyse} disabled={analysing}>
            {analysing ? t('editor.looking') : ai.status === 'done' ? t('editor.again') : t('editor.analyse')}
          </button>
        {/if}
      </header>

      {#if analysing}
        <p class="muted small">{t('editor.lookingLead')}</p>
      {:else if ai.status === 'queued' || ai.status === 'running'}
        <p class="muted small">{t('editor.queued')}</p>
      {:else if ai.status === 'failed'}
        <p class="muted small">{t('editor.lastFailed', { error: ai.error ?? '' })}</p>
      {:else if !ai.status}
        <p class="muted small">{t('editor.notAnalysed')}</p>
      {/if}
      {#if aiMessage}<p class="alert alert-error small">{aiMessage}</p>{/if}

      {#if ai.alt && ai.alt !== alt}
        <div class="suggestion">
          <span class="muted small">{t('editor.alt')}</span>
          <p>{ai.alt}</p>
          {#if props.canEdit}<button class="link" type="button" onclick={() => accept(['alt'], true)}>{alt ? t('editor.replaceMine') : t('editor.useThis')}</button>{/if}
        </div>
      {/if}
      {#if ai.caption && ai.caption !== caption}
        <div class="suggestion">
          <span class="muted small">{t('editor.caption')}</span>
          <p>{ai.caption}</p>
          {#if props.canEdit}<button class="link" type="button" onclick={() => accept(['caption'], true)}>{caption ? t('editor.replaceMine') : t('editor.useThis')}</button>{/if}
        </div>
      {/if}
      {#if aiTags.length > 0}
        <div class="suggestion">
          <span class="muted small">{t('editor.aiTags')}</span>
          <div class="tags">
            {#each aiTags as tag (tag)}
              <span class="tag tag-ai" title={tag}>
                <a href={`/?tag=${encodeURIComponent(tag)}`}>{leaf(tag)}</a>
                {#if props.canEdit}
                  <button type="button" aria-label={t('editor.keepTag', { tag })} title={t('editor.keep')} onclick={() => keepTag(tag)}>✓</button>
                  <button type="button" aria-label={t('editor.dropTag', { tag })} title={t('editor.drop')} onclick={() => dropTag(tag)}>×</button>
                {/if}
              </span>
            {/each}
          </div>
          {#if props.canEdit}<button class="link" type="button" onclick={() => accept(['tags'])}>{t('editor.keepAll')}</button>{/if}
        </div>
      {/if}
      {#if ai.text}
        <div class="suggestion">
          <span class="muted small">{t('editor.textInPicture')}</span>
          <p class="ocr">{ai.text}</p>
        </div>
      {/if}
      {#if ai.description}
        <details>
          <summary class="muted small">{t('editor.modelSaw')}</summary>
          <p class="small">{ai.description}</p>
        </details>
      {/if}
    </section>
  {/if}
  {#if inAlbums.length > 0 || (props.canEdit && albums.length > 0)}
    <div class="field">
      <span class="label" id="albums-label">{t('editor.albums')}</span>
      {#if inAlbums.length > 0}
        <div class="tags" role="group" aria-labelledby="albums-label">
          {#each inAlbums as album (album.id)}
            <span class="tag">
              <a href={`/albums/${album.id}`}>{album.name}</a>
              {#if props.canEdit}<button type="button" aria-label={t('editor.takeOutOf', { album: album.name })} title={t('editor.takeOutTitle')} onclick={() => leaveAlbum(album)}>×</button>{/if}
            </span>
          {/each}
        </div>
      {:else}
        <span class="muted small">{t('editor.noAlbum')}</span>
      {/if}
      {#if props.canEdit && otherAlbums.length > 0}
        <div class="row">
          <select id="album" aria-label={t('library.addToAlbum')} bind:value={albumId} style="flex: 1">
            <option value="">{t('editor.addToAnAlbum')}</option>
            {#each otherAlbums as album (album.id)}<option value={album.id}>{album.name}</option>{/each}
          </select>
          <button class="btn" type="button" onclick={addToAlbum} disabled={!albumId}>{t('common.add')}</button>
        </div>
      {/if}
      {#if albumMessage}<span class="muted" role="status">{albumMessage}</span>{/if}
    </div>
  {/if}
  {#if status === 'error'}<div class="alert alert-error">{message}</div>{/if}
</div>

<style>
  .stars {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .stars button {
    font-size: 1.35rem;
    line-height: 1;
    background: none;
    border: 0;
    padding: 2px;
    color: var(--border-strong);
    cursor: pointer;
    transition: transform 120ms var(--ease), color 120ms var(--ease);
  }
  .stars button:hover:not(:disabled) {
    transform: scale(1.15);
  }
  .stars button.on {
    color: #fbbf24;
  }
  .save-state {
    margin-left: 10px;
    font-size: 0.8rem;
  }
  textarea {
    width: 100%;
    font: inherit;
    color: var(--text);
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    resize: vertical;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 4px 2px 10px;
    border-radius: 99px;
    font-size: 0.82rem;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .tag a {
    color: var(--text);
  }
  .tag button {
    border: 0;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0 4px;
  }
  .ai {
    display: grid;
    gap: 10px;
    padding: 12px;
    border-radius: var(--radius-sm);
    border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--border));
    background: color-mix(in srgb, var(--accent) 5%, transparent);
  }
  .ai header {
    gap: 6px;
    align-items: center;
  }
  .ai .spacer {
    flex: 1;
  }
  .ai p {
    margin: 0;
  }
  .small {
    font-size: 0.8rem;
  }
  .pill {
    font-size: 0.72rem;
    padding: 1px 8px;
    border-radius: 99px;
    background: var(--surface-strong);
    color: var(--text-muted);
    text-transform: capitalize;
  }
  .suggestion {
    display: grid;
    gap: 4px;
    font-size: 0.88rem;
  }
  .link {
    justify-self: start;
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }
  .ocr {
    font-family: var(--mono);
    font-size: 0.8rem;
    white-space: pre-wrap;
  }
  .tag-ai {
    background: transparent;
    border: 1px dashed color-mix(in srgb, var(--accent) 55%, var(--border));
  }
  .tag small {
    color: var(--text-faint);
    font-size: 0.72rem;
  }
  .tag-entry {
    position: relative;
    flex: 1 1 160px;
    display: flex;
  }
  .suggest {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 20;
    list-style: none;
    margin: 0;
    padding: 4px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    background: var(--surface-strong);
    box-shadow: var(--shadow);
  }
  .suggest button {
    display: flex;
    width: 100%;
    gap: 4px;
    align-items: baseline;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.84rem;
    text-align: left;
    cursor: pointer;
  }
  .suggest button:hover,
  .suggest button.on {
    background: var(--surface-hover);
  }
  .suggest .n {
    margin-left: auto;
    color: var(--text-faint);
    font-size: 0.75rem;
  }
  .labels {
    display: inline-flex;
    gap: 5px;
    margin-left: 12px;
  }
  .swatch {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid transparent;
    padding: 0;
    cursor: pointer;
    opacity: 0.45;
    transition: opacity 120ms var(--ease), transform 120ms var(--ease);
  }
  .swatch:hover:not(:disabled) {
    opacity: 0.85;
    transform: scale(1.1);
  }
  .swatch.on {
    opacity: 1;
    border-color: var(--text);
  }
  .label-red {
    background: var(--label-red);
  }
  .label-yellow {
    background: var(--label-yellow);
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
  .tag-input {
    flex: 1 1 120px;
    width: auto;
    padding: 4px 8px;
  }
</style>

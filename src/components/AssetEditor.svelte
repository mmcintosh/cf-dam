<script lang="ts">
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'

  interface Props {
    assetId: string
    title: string | null
    caption: string | null
    alt: string | null
    rating: number | null
    tags: string[]
    canEdit: boolean
  }
  let props: Props = $props()

  let title = $state(props.title ?? '')
  let caption = $state(props.caption ?? '')
  let alt = $state(props.alt ?? '')
  let rating = $state(props.rating ?? 0)
  let tags = $state<string[]>([...props.tags])
  let tagInput = $state('')
  let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle')
  let message = $state('')

  async function save(patch: Record<string, unknown>) {
    if (!props.canEdit) return
    status = 'saving'
    try {
      await api(`/api/assets/${props.assetId}`, { method: 'PATCH', body: JSON.stringify(patch) })
      status = 'saved'
      setTimeout(() => status === 'saved' && (status = 'idle'), 1500)
    } catch (e) {
      status = 'error'
      message = e instanceof Error ? e.message : 'Could not save.'
    }
  }

  function addTag(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ',') return
    event.preventDefault()
    const tag = tagInput.trim()
    if (tag && !tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      tags = [...tags, tag]
      void save({ tags })
    }
    tagInput = ''
  }

  function removeTag(tag: string) {
    tags = tags.filter((t) => t !== tag)
    void save({ tags })
  }

  let albums = $state<{ id: string; name: string }[]>([])
  let albumId = $state('')
  let albumMessage = $state('')

  onMount(async () => {
    if (props.canEdit) albums = (await api<{ albums: { id: string; name: string }[] }>('/api/albums')).albums
  })

  async function addToAlbum() {
    if (!albumId) return
    await api(`/api/albums/${albumId}/items`, { method: 'POST', body: JSON.stringify({ assetIds: [props.assetId] }) })
    albumMessage = `Added to ${albums.find((a) => a.id === albumId)?.name ?? 'the album'}.`
  }

  function rate(value: number) {
    rating = rating === value ? 0 : value
    void save({ rating })
  }
</script>

<div class="stack editor">
  <div class="stars" role="radiogroup" aria-label="Rating">
    {#each [1, 2, 3, 4, 5] as star (star)}
      <button
        type="button"
        role="radio"
        aria-checked={rating === star}
        aria-label={`${star} star${star > 1 ? 's' : ''}`}
        class:on={star <= rating}
        disabled={!props.canEdit}
        onclick={() => rate(star)}>★</button
      >
    {/each}
    <span class="save-state muted">{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}</span>
  </div>

  <div class="field">
    <label for="title">Title</label>
    <input id="title" type="text" bind:value={title} disabled={!props.canEdit} onchange={() => save({ title })} />
  </div>
  <div class="field">
    <label for="caption">Caption</label>
    <textarea id="caption" rows="3" bind:value={caption} disabled={!props.canEdit} onchange={() => save({ caption })}></textarea>
  </div>
  <div class="field">
    <label for="alt">Alt text</label>
    <input id="alt" type="text" bind:value={alt} disabled={!props.canEdit} onchange={() => save({ alt })} placeholder="Describe the image for people who can't see it" />
  </div>
  <div class="field">
    <span class="label">Tags</span>
    <div class="tags">
      {#each tags as tag (tag)}
        <span class="tag">
          <a href={`/?tag=${encodeURIComponent(tag)}`}>{tag}</a>
          {#if props.canEdit}<button type="button" aria-label={`Remove ${tag}`} onclick={() => removeTag(tag)}>×</button>{/if}
        </span>
      {/each}
      {#if props.canEdit}
        <input class="tag-input" type="text" placeholder="Add a tag…" bind:value={tagInput} onkeydown={addTag} aria-label="Add a tag" />
      {/if}
    </div>
  </div>
  {#if props.canEdit && albums.length > 0}
    <div class="field">
      <label for="album">Add to album</label>
      <div class="row">
        <select id="album" bind:value={albumId} style="flex: 1">
          <option value="">Choose an album…</option>
          {#each albums as album (album.id)}<option value={album.id}>{album.name}</option>{/each}
        </select>
        <button class="btn" type="button" onclick={addToAlbum} disabled={!albumId}>Add</button>
      </div>
      {#if albumMessage}<span class="muted">{albumMessage}</span>{/if}
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
  .tag-input {
    flex: 1 1 120px;
    width: auto;
    padding: 4px 8px;
  }
</style>

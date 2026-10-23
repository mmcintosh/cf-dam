<script lang="ts">
  import { t } from '@cf-dam/i18n/client'
  /** On an album's page: rename it, take photos out, choose its cover, or delete it (its photos stay in the library). */
  import { api } from '../lib/auth-client'

  interface Item {
    id: string
    name: string
    alt: string
    thumb: boolean
    version: string
  }
  interface Props {
    albumId: string
    name: string
    description: string
    /** Client gallery links made from this album; they go when it's deleted. */
    links: number
    items: Item[]
    coverId: string | null
  }
  let { albumId, name, description, links, items, coverId }: Props = $props()

  let mode = $state<'' | 'rename' | 'photos' | 'delete'>('')
  let busy = $state(false)
  let error = $state('')
  let newName = $state('')
  let newDescription = $state('')
  let picked = $state<string[]>([])

  function show(next: typeof mode) {
    mode = mode === next ? '' : next
    error = ''
    if (mode === 'rename') {
      newName = name
      newDescription = description
    }
    if (mode === 'photos') picked = []
  }

  async function run(work: () => Promise<unknown>, after: () => void) {
    busy = true
    error = ''
    try {
      await work()
      after()
    } catch (e) {
      error = e instanceof Error ? e.message : t('invite.failed')
      busy = false
    }
  }

  const rename = (event: SubmitEvent) => {
    event.preventDefault()
    void run(
      () => api(`/api/albums/${albumId}`, { method: 'PATCH', body: JSON.stringify({ name: newName, description: newDescription }) }),
      () => location.reload(),
    )
  }
  const takeOut = () =>
    run(
      () => api(`/api/albums/${albumId}/items`, { method: 'DELETE', body: JSON.stringify({ assetIds: picked }) }),
      () => location.reload(),
    )
  const makeCover = () =>
    run(
      () => api(`/api/albums/${albumId}`, { method: 'PATCH', body: JSON.stringify({ coverAssetId: picked[0] }) }),
      () => location.reload(),
    )
  const remove = () =>
    run(
      () => api(`/api/albums/${albumId}`, { method: 'DELETE' }),
      () => (location.href = '/albums'),
    )

</script>

<div class="tools stack">
  <div class="row">
    <button class="btn btn-sm" type="button" aria-expanded={mode === 'rename'} onclick={() => show('rename')}>{t('albumTools.rename')}</button>
    {#if items.length > 0}
      <button class="btn btn-sm" type="button" aria-expanded={mode === 'photos'} onclick={() => show('photos')}>{t('albumTools.photos')}</button>
    {/if}
    <button class="btn btn-sm" type="button" aria-expanded={mode === 'delete'} onclick={() => show('delete')}>{t('albumTools.delete')}</button>
  </div>

  {#if mode === 'rename'}
    <form class="card stack panel" onsubmit={rename}>
      <div class="field">
        <label class="label" for="album-name">{t('albumTools.name')}</label>
        <input id="album-name" type="text" required maxlength="200" bind:value={newName} />
      </div>
      <div class="field">
        <label class="label" for="album-description">{t('albumTools.description')} <span class="muted">{t('albumTools.descriptionNote')}</span></label>
        <textarea id="album-description" rows="2" maxlength="2000" bind:value={newDescription}></textarea>
      </div>
      <div class="row">
        <button class="btn btn-primary btn-sm" type="submit" disabled={busy || !newName.trim()}>{t('common.save')}</button>
        <button class="btn btn-sm" type="button" onclick={() => (mode = '')}>{t('common.cancel')}</button>
      </div>
    </form>
  {:else if mode === 'photos'}
    <div class="card stack panel">
      <p class="small">
        {t('albumTools.pickLead')}
      </p>
      <fieldset class="picker">
        <legend class="sr-only">{t('albumTools.inAlbum')}</legend>
        {#each items as item (item.id)}
          <label class="pick" class:on={picked.includes(item.id)}>
            <input type="checkbox" value={item.id} bind:group={picked} />
            {#if item.thumb}
              <img src={`/api/assets/${item.id}/renditions/thumb?v=${item.version}`} alt={item.alt} loading="lazy" />
            {:else}
              <span class="name">{item.name}</span>
            {/if}
            {#if item.id === coverId}<span class="cover">{t('albumTools.cover')}</span>{/if}
          </label>
        {/each}
      </fieldset>
      <div class="row">
        <button class="btn btn-sm btn-danger" type="button" onclick={takeOut} disabled={busy || picked.length === 0}>
          {picked.length ? t('albumTools.takeOutCount', { count: picked.length }) : t('albumTools.takeOut')}
        </button>
        <button class="btn btn-sm" type="button" onclick={makeCover} disabled={busy || picked.length !== 1 || picked[0] === coverId}>{t('albumTools.makeCover')}</button>
        <button class="btn btn-sm" type="button" onclick={() => (mode = '')}>{t('common.done')}</button>
        {#if picked.length}<span class="muted small">{t('albumTools.ticked', { photos: t('common.photos', { count: picked.length }) })}</span>{/if}
      </div>
    </div>
  {:else if mode === 'delete'}
    <div class="card stack panel warn" role="alert">
      <p>
        <strong>{t('albumTools.deleteQuestion', { name })}</strong>
        {t('albumTools.photosStay', { photos: t('common.photos', { count: items.length }) })}
        {#if links > 0}
          <strong>{t('albumTools.linksStop', { links: t('albumTools.links', { count: links }) })}</strong>
        {/if}
        {t('albumTools.cantUndo')}
      </p>
      <div class="row">
        <button class="btn btn-sm btn-danger" type="button" onclick={remove} disabled={busy}>{t('albumTools.delete')}</button>
        <button class="btn btn-sm" type="button" onclick={() => (mode = '')}>{t('albumTools.keep')}</button>
      </div>
    </div>
  {/if}
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
</div>

<style>
  .tools {
    margin-bottom: 20px;
  }
  .panel {
    max-width: 960px;
  }
  .panel p {
    margin: 0;
  }
  .warn {
    border-color: var(--danger, #dc2626);
  }
  .small {
    font-size: 0.875rem;
  }
  .picker {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 8px;
    margin: 0;
    padding: 0;
    border: 0;
    max-height: 420px;
    overflow: auto;
  }
  .pick {
    position: relative;
    aspect-ratio: 1;
    border-radius: 8px;
    overflow: hidden;
    border: 3px solid transparent;
    background: var(--surface-strong);
    cursor: pointer;
    display: grid;
    place-items: center;
  }
  .pick.on {
    border-color: var(--accent);
  }
  .pick:focus-within {
    outline: 3px solid var(--focus);
    outline-offset: 2px;
  }
  .pick input {
    position: absolute;
    top: 6px;
    left: 6px;
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .pick img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .name {
    padding: 6px;
    font-size: 0.75rem;
    overflow-wrap: anywhere;
    text-align: center;
  }
  .cover {
    position: absolute;
    right: 6px;
    bottom: 6px;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 99px;
    color: #fff;
    background: var(--accent-strong);
  }
</style>

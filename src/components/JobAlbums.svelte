<script lang="ts">
  /**
   * A job's albums on its page: make a gallery from one, take one out of the job, add an existing album, or
   * make a new one from the photos taken on the shoot dates.
   */
  import { t } from '@cf-dam/i18n/client'
  import type { JobAlbumJson } from '@cf-dam/api'
  import { api } from '../lib/auth-client'

  let { jobId, initial, hasDates }: { jobId: string; initial: JobAlbumJson[]; hasDates: boolean } = $props()

  // svelte-ignore state_referenced_locally
  let albums = $state<JobAlbumJson[]>(initial)
  let adding = $state(false)
  let free = $state<{ id: string; name: string }[] | null>(null)
  let chosen = $state('')
  let busy = $state(false)
  let error = $state('')
  let note = $state('')

  function startAdding() {
    adding = true
    error = ''
    if (free === null) {
      api<{ albums: { id: string; name: string }[] }>('/api/jobs/free-albums')
        .then((r) => (free = r.albums))
        .catch((e) => (error = e instanceof Error ? e.message : t('common.couldNotLoad')))
    }
  }

  async function add(body: Record<string, unknown>) {
    busy = true
    error = ''
    note = ''
    try {
      const result = await api<{ albums: JobAlbumJson[]; album?: { photos: number } }>(`/api/jobs/${jobId}/albums`, { method: 'POST', body: JSON.stringify(body) })
      albums = result.albums
      if (result.album) note = t('jobs.albumMade', { count: result.album.photos })
      adding = false
      chosen = ''
      free = null
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }

  async function takeOut(album: JobAlbumJson) {
    error = ''
    try {
      await api(`/api/jobs/${jobId}/albums/${album.id}`, { method: 'DELETE' })
      albums = albums.filter((a) => a.id !== album.id)
      note = t('jobs.albumOut', { name: album.name })
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    }
  }
</script>

<div class="stack">
  {#if albums.length === 0}
    <p class="muted">{t('jobs.noAlbums')}</p>
  {:else}
    <ul class="albums">
      {#each albums as album (album.id)}
        <li class="row">
          <span class="what">
            <a href={`/albums/${album.id}`}><strong>{album.name}</strong></a>
            <span class="muted small">{t('common.photos', { count: album.photos })} · {t('jobs.galleries', { count: album.galleries })}</span>
          </span>
          <span class="row actions">
            <a class="btn btn-sm" href={`/albums/${album.id}?share=new#share`}>{t('jobs.makeGallery')}</a>
            <button class="btn btn-sm" type="button" title={t('jobs.takeOutTitle')} onclick={() => takeOut(album)}>{t('jobs.takeOut')}</button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if adding}
    <form class="row add" onsubmit={(e) => (e.preventDefault(), add({ albumId: chosen }))}>
      {#if free === null}
        <span class="muted small">{t('common.loading')}</span>
      {:else if free.length === 0}
        <span class="muted small">{t('jobs.noFreeAlbums')}</span>
      {:else}
        <select aria-label={t('jobs.addAlbum')} required bind:value={chosen}>
          <option value="" disabled>{t('galleries.chooseAlbumMenu')}</option>
          {#each free as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
        </select>
        <button class="btn btn-primary btn-sm" type="submit" disabled={busy || !chosen}>{t('clientPeople.addButton')}</button>
      {/if}
      <button class="btn btn-sm" type="button" onclick={() => (adding = false)}>{t('common.cancel')}</button>
    </form>
  {:else}
    <div class="row buttons">
      <button class="btn btn-sm" type="button" onclick={startAdding}>{t('jobs.addAlbum')}</button>
      <button class="btn btn-sm" type="button" disabled={busy || !hasDates} title={hasDates ? undefined : t('jobs.needDates')} onclick={() => add({ photos: 'dates' })}>{t('jobs.albumFromDates')}</button>
    </div>
  {/if}
  {#if note}<p class="muted small" role="status">{note}</p>{/if}
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
</div>

<style>
  .albums {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .albums li {
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 6px 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .what {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .actions,
  .buttons,
  .add {
    gap: 8px;
    flex-wrap: wrap;
  }
  .add select {
    flex: 1 1 240px;
  }
  .small {
    font-size: 0.85rem;
  }
</style>

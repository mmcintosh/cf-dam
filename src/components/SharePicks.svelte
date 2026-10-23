<script lang="ts">
  import { format, t } from '@cf-dam/i18n/client'
  import type { VisitorJson } from '@cf-dam/api'
  import { api } from '../lib/auth-client'

  interface Photo {
    id: string
    filename: string
    hasThumb: boolean
  }
  interface Props {
    shareId: string
    photos: Photo[]
    visitors: VisitorJson[]
    /** Asset id → ids of the visitors who picked it. */
    picks: Record<string, string[]>
    downloads: { assetId: string; size: string; count: number }[]
  }
  let { shareId, photos, visitors, picks, downloads }: Props = $props()

  let chosen = $state<string[]>(visitors.map((v) => v.id))
  let mode = $state<'any' | 'all' | 'everything'>(visitors.length > 0 ? 'any' : 'everything')
  let albumName = $state('')
  let made = $state<{ albumId: string; count: number } | null>(null)
  let error = $state('')
  let busy = $state(false)

  const byId = $derived(new Map(visitors.map((v) => [v.id, v])))
  const pickedBy = (id: string) => (picks[id] ?? []).filter((v) => chosen.includes(v))
  const shown = $derived(
    mode === 'everything' ? photos
    : mode === 'all' ? photos.filter((p) => chosen.length > 0 && pickedBy(p.id).length === chosen.length)
    : photos.filter((p) => pickedBy(p.id).length > 0),
  )
  const downloadsOf = $derived(
    downloads.reduce<Record<string, string>>((map, d) => ((map[d.assetId] = `${map[d.assetId] ? `${map[d.assetId]}, ` : ''}${d.count}× ${d.size}`), map), {}),
  )
  const initials = (name: string) =>
    name
      .split(/\s+/)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .slice(0, 2)
      .join('')
  const fmt = (iso: string | null) => (iso ? format().dateTime(iso) : '')

  async function makeAlbum(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    busy = true
    try {
      made = await api<{ albumId: string; count: number }>(`/api/shares/${shareId}/picks/album`, {
        method: 'POST',
        body: JSON.stringify({ name: albumName, visitorIds: chosen, mode: mode === 'all' ? 'all' : 'any' }),
      })
    } catch (e) {
      error = e instanceof Error ? e.message : t('picks.makeFailed')
    } finally {
      busy = false
    }
  }
</script>

<div class="stack">
  {#if visitors.length === 0}
    <p class="muted">{t('picks.none')}</p>
  {:else}
    <table class="table">
      <thead><tr><th></th><th>{t('common.name')}</th><th>{t('common.favourites')}</th><th>{t('common.downloads')}</th><th>{t('common.status')}</th><th>{t('common.lastSeen')}</th></tr></thead>
      <tbody>
        {#each visitors as v (v.id)}
          <tr>
            <td><input type="checkbox" value={v.id} bind:group={chosen} aria-label={t('picks.include', { name: v.name })} /></td>
            <td><span class="who">{initials(v.name)}</span> {v.name}{#if v.email} <span class="muted">· {v.email}</span>{/if}</td>
            <td>{v.picks}</td>
            <td>{v.downloads}</td>
            <td>{#if v.submittedAt}<span class="badge badge-ok">{t('picks.doneOn', { date: fmt(v.submittedAt) })}</span>{:else}<span class="badge">{t('picks.stillPicking')}</span>{/if}</td>
            <td class="muted">{fmt(v.lastSeenAt)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <div class="row filters" role="radiogroup" aria-label={t('picks.which')}>
    <label class="check"><input type="radio" value="any" bind:group={mode} disabled={visitors.length === 0} /> {t('picks.any')}</label>
    <label class="check"><input type="radio" value="all" bind:group={mode} disabled={visitors.length === 0} /> {t('picks.all')}</label>
    <label class="check"><input type="radio" value="everything" bind:group={mode} /> {t('picks.everything')}</label>
    <span class="muted">{shown.length} {shown.length === 1 ? 'photo' : 'photos'}</span>
  </div>

  {#if mode !== 'everything' && shown.length > 0}
    <form class="row" onsubmit={makeAlbum}>
      <input type="text" required maxlength="200" placeholder={t('picks.albumPlaceholder')} bind:value={albumName} style="max-width: 320px" aria-label={t('albums.newName')} />
      <button class="btn btn-primary" type="submit" disabled={busy}>{t('picks.makeAlbum')}</button>
      {#if made}<span class="muted">{t('picks.made', { photos: t('common.photos', { count: made.count }) })} <a href={`/albums/${made.albumId}`}>{t('picks.openIt')}</a></span>{/if}
    </form>
    {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
  {/if}

  <div class="grid">
    {#each shown as photo (photo.id)}
      <a class="tile" href={`/assets/${photo.id}`}>
        {#if photo.hasThumb}<img src={`/api/assets/${photo.id}/renditions/thumb`} alt={photo.filename} loading="lazy" />{/if}
        <span class="pickers">
          {#each picks[photo.id] ?? [] as v (v)}
            <span class="who" title={byId.get(v)?.name}>{initials(byId.get(v)?.name ?? '?')}</span>
          {/each}
        </span>
        <span class="caption">
          <span class="name">{photo.filename}</span>
          {#if downloadsOf[photo.id]}<span class="muted">⤓ {downloadsOf[photo.id]}</span>{/if}
        </span>
      </a>
    {/each}
  </div>
</div>

<style>
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 0.9rem;
  }
  .filters {
    gap: 18px;
  }
  .who {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    font-size: 0.65rem;
    font-weight: 700;
    color: #fff;
    background: linear-gradient(135deg, var(--accent-strong), var(--accent-2));
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 12px;
  }
  .tile {
    position: relative;
    display: grid;
    gap: 4px;
    color: var(--text);
  }
  .tile:hover {
    text-decoration: none;
  }
  .tile img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 6px;
    background: var(--surface-strong);
  }
  .pickers {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    gap: 3px;
  }
  .caption {
    display: grid;
    font-size: 0.75rem;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

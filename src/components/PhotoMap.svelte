<script lang="ts">
  /**
   * Where photos were taken: GPS-tagged assets for the current filters, clustered, with thumbnails.
   * Photos without a location sit in a strip below; select some and click the map to place them
   * (city and country are then filled in from the place list).
   */
  import { onMount } from 'svelte'
  import 'leaflet/dist/leaflet.css'
  import 'leaflet.markercluster/dist/MarkerCluster.css'
  import { api } from '../lib/auth-client'

  interface Props {
    query: string
    /** An asset to place (from "Set on map" on its page). */
    placeId: string | null
    canEdit: boolean
  }
  let { query, placeId, canEdit }: Props = $props()

  interface Unplaced {
    id: string
    filename: string
    title: string | null
    renditions: string[]
  }

  let container: HTMLDivElement | undefined = $state()
  let count = $state<number | null>(null)
  let unplaced = $state<Unplaced[]>([])
  let unplacedTotal = $state(0)
  let selected = $state(new Set<string>())
  let message = $state('')

  const join = (...parts: string[]) => parts.filter(Boolean).join('&')

  /** Click selects one photo (or clears it); ⌘/Ctrl/Shift-click adds or removes. */
  function toggle(id: string, event: MouseEvent) {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      const next = new Set(selected)
      next.has(id) ? next.delete(id) : next.add(id)
      selected = next
    } else {
      selected = selected.has(id) && selected.size === 1 ? new Set() : new Set([id])
    }
  }

  onMount(() => {
    let map: import('leaflet').Map | undefined
    ;(async () => {
      const L = (await import('leaflet')).default
      await import('leaflet.markercluster')
      const [{ points }, list] = await Promise.all([
        api<{ points: { id: string; lat: number; lng: number }[] }>(`/api/assets/geo${query ? `?${query}` : ''}`),
        canEdit ? api<{ assets: Unplaced[]; total: number }>(`/api/assets?${join(query, 'gps=none', 'limit=200')}`) : Promise.resolve({ assets: [], total: 0 }),
      ])
      count = points.length
      unplaced = list.assets
      unplacedTotal = list.total
      if (placeId && canEdit) {
        if (!unplaced.some((a) => a.id === placeId)) {
          const one = await api<Unplaced>(`/api/assets/${placeId}`).catch(() => null)
          if (one) unplaced = [one, ...unplaced]
        }
        selected = new Set([placeId])
      }

      map = L.map(container!, { worldCopyJump: true }).setView([20, 0], 2)
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · places: <a href="https://www.geonames.org">GeoNames</a>',
      }).addTo(map)

      const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 })
      const pin = (id: string, lat: number, lng: number) => {
        const icon = L.divIcon({ className: 'photo-pin', html: `<img src="/api/assets/${id}/renditions/thumb" alt="" loading="lazy" />`, iconSize: [44, 44] })
        cluster.addLayer(L.marker([lat, lng], { icon }).on('click', () => (window.location.href = `/assets/${id}`)))
      }
      for (const p of points) pin(p.id, p.lat, p.lng)
      map.addLayer(cluster)
      if (points.length > 0) map.fitBounds(cluster.getBounds(), { padding: [40, 40], maxZoom: 13 })

      // Placing: click the map with photos selected.
      map.on('click', (event: import('leaflet').LeafletMouseEvent) => {
        if (!canEdit || selected.size === 0) return
        const ids = [...selected]
        const button = document.createElement('button')
        button.className = 'btn btn-primary btn-sm'
        button.textContent = `Place ${ids.length} ${ids.length === 1 ? 'photo' : 'photos'} here`
        const popup = L.popup().setLatLng(event.latlng).setContent(button).openOn(map!)
        button.onclick = async () => {
          const { lat, lng } = event.latlng.wrap()
          button.disabled = true
          try {
            await api('/api/assets/bulk', { method: 'POST', body: JSON.stringify({ ids, action: 'gps', lat, lng }) })
            for (const id of ids) pin(id, lat, lng)
            unplaced = unplaced.filter((a) => !ids.includes(a.id))
            unplacedTotal = Math.max(0, unplacedTotal - ids.length)
            selected = new Set()
            count = (count ?? 0) + ids.length
            const first = await api<{ iptc: { city: string | null; country: string | null } }>(`/api/assets/${ids[0]}`)
            const where = [first.iptc.city, first.iptc.country].filter(Boolean).join(', ')
            message = `Placed ${ids.length} ${ids.length === 1 ? 'photo' : 'photos'}${where ? ` · ${where}` : ''}`
            map!.closePopup(popup)
          } catch (e) {
            button.disabled = false
            message = e instanceof Error ? e.message : 'Could not place them.'
          }
        }
      })
    })()
    return () => map?.remove()
  })
</script>

<div class="map-wrap">
  <div class="map" class:placing={selected.size > 0} bind:this={container}></div>
  {#if count === 0 && unplaced.length === 0}<p class="none card">No photos with a location match these filters.</p>{/if}
  {#if selected.size > 0}<p class="hint card">Click the map where {selected.size === 1 ? 'this photo was' : `these ${selected.size} photos were`} taken.</p>{/if}
</div>

{#if canEdit && unplaced.length > 0}
  <section class="strip-wrap">
    <header class="row">
      <strong>Without a location</strong>
      <span class="muted">{unplacedTotal.toLocaleString()}{unplacedTotal > unplaced.length ? ` (showing ${unplaced.length})` : ''} · click to select, ⌘-click for more</span>
      <span class="spacer"></span>
      {#if selected.size > 0}<button class="btn btn-sm" type="button" onclick={() => (selected = new Set())}>Clear selection</button>{/if}
      <button class="btn btn-sm" type="button" onclick={() => (selected = new Set(unplaced.map((a) => a.id)))}>Select all</button>
    </header>
    <div class="strip">
      {#each unplaced as a (a.id)}
        <button type="button" class="thumb" class:on={selected.has(a.id)} title={a.title ?? a.filename} onclick={(e) => toggle(a.id, e)}>
          {#if a.renditions.includes('thumb')}
            <img src={`/api/assets/${a.id}/renditions/thumb`} alt={a.title ?? a.filename} loading="lazy" />
          {:else}
            <span>{a.filename}</span>
          {/if}
        </button>
      {/each}
    </div>
  </section>
{/if}
{#if message}<p class="toast card" role="status">{message}</p>{/if}

<style>
  .map-wrap {
    position: relative;
  }
  .map {
    height: calc(100vh - 300px);
    min-height: 420px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .map.placing {
    cursor: crosshair;
  }
  .map.placing :global(.leaflet-grab) {
    cursor: crosshair;
  }
  .none,
  .hint {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    z-index: 500;
    margin: 0;
  }
  .none {
    top: 50%;
  }
  .hint {
    top: 14px;
    padding: 8px 14px;
    font-size: 0.88rem;
  }
  .strip-wrap {
    margin-top: 14px;
  }
  .strip-wrap header {
    gap: 10px;
    align-items: baseline;
    margin-bottom: 8px;
    font-size: 0.88rem;
  }
  .spacer {
    flex: 1;
  }
  .strip {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 6px;
  }
  .thumb {
    flex: none;
    width: 92px;
    height: 92px;
    padding: 0;
    border-radius: 10px;
    border: 2px solid transparent;
    background: var(--surface-strong);
    overflow: hidden;
    cursor: pointer;
    color: var(--text-muted);
    font-size: 0.7rem;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .thumb.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-glow);
  }
  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    padding: 10px 16px;
  }
  :global(.photo-pin img) {
    width: 44px;
    height: 44px;
    object-fit: cover;
    border-radius: 10px;
    border: 2px solid #fff;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.4);
  }
  :global(.marker-cluster) {
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  :global(.marker-cluster div) {
    width: 30px;
    height: 30px;
    margin: 5px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--accent-strong);
    color: #fff;
    font: 600 12px var(--font);
  }
</style>

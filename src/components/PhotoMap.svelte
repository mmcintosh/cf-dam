<script lang="ts">
  /** Where photos were taken: GPS-tagged assets for the current filters, clustered, with thumbnails. */
  import { onMount } from 'svelte'
  import 'leaflet/dist/leaflet.css'
  import 'leaflet.markercluster/dist/MarkerCluster.css'
  import { api } from '../lib/auth-client'

  interface Props {
    query: string
  }
  let { query }: Props = $props()

  let container: HTMLDivElement | undefined = $state()
  let count = $state<number | null>(null)

  onMount(() => {
    let map: import('leaflet').Map | undefined
    ;(async () => {
      const L = (await import('leaflet')).default
      await import('leaflet.markercluster')
      const { points } = await api<{ points: { id: string; lat: number; lng: number }[] }>(`/api/assets/geo${query ? `?${query}` : ''}`)
      count = points.length
      map = L.map(container!, { worldCopyJump: true }).setView([20, 0], 2)
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map)

      const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 })
      for (const p of points) {
        const icon = L.divIcon({
          className: 'photo-pin',
          html: `<img src="/api/assets/${p.id}/renditions/thumb" alt="" loading="lazy" />`,
          iconSize: [44, 44],
        })
        cluster.addLayer(L.marker([p.lat, p.lng], { icon }).on('click', () => (window.location.href = `/assets/${p.id}`)))
      }
      map.addLayer(cluster)
      if (points.length > 0) map.fitBounds(cluster.getBounds(), { padding: [40, 40], maxZoom: 13 })
    })()
    return () => map?.remove()
  })
</script>

<div class="map-wrap">
  <div class="map" bind:this={container}></div>
  {#if count === 0}<p class="none card">No photos with a location match these filters.</p>{/if}
</div>

<style>
  .map-wrap {
    position: relative;
  }
  .map {
    height: calc(100vh - 170px);
    min-height: 420px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .none {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 500;
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

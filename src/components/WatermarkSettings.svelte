<script lang="ts">
  import type { WatermarkSettings } from '@cf-dam/api'
  import { api } from '../lib/auth-client'

  interface Props {
    initial: WatermarkSettings
    /** A photo to try the watermark on, if the library has one. */
    sampleAssetId: string | null
  }
  let { initial, sampleAssetId }: Props = $props()

  let settings = $state<WatermarkSettings>(initial)
  let text = $state('© ')
  let colour = $state<'white' | 'black'>('white')
  let error = $state('')
  let saved = $state('')
  let busy = $state(false)

  const POSITIONS: [WatermarkSettings['position'], string][] = [
    ['center', 'Centre'],
    ['bottom-right', 'Bottom right'],
    ['bottom-left', 'Bottom left'],
    ['tiled', 'Repeated across the photo'],
  ]
  const imageUrl = $derived(settings.version ? `/api/shares/watermark/image?v=${settings.version}` : null)

  async function upload(body: Blob) {
    error = ''
    saved = ''
    busy = true
    try {
      const response = await fetch('/api/shares/watermark/image', { method: 'PUT', body, headers: { 'Content-Type': body.type || 'image/png' } })
      const result = (await response.json()) as { watermark?: WatermarkSettings; message?: string }
      if (!response.ok || !result.watermark) throw new Error(result.message ?? 'Could not save the watermark.')
      settings = result.watermark
      saved = 'Watermark saved. Galleries with the watermark on use it from now on.'
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save the watermark.'
    } finally {
      busy = false
    }
  }

  /** Draw the text on a transparent canvas, with a soft shadow so it reads on light and dark photos. */
  async function fromText(event: SubmitEvent) {
    event.preventDefault()
    const size = 120
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    const font = `600 ${size}px Inter Variable, system-ui, sans-serif`
    context.font = font
    const width = Math.ceil(context.measureText(text).width) + size
    canvas.width = Math.min(width, 4000)
    canvas.height = Math.round(size * 1.6)
    context.font = font
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.shadowColor = colour === 'white' ? 'rgb(0 0 0 / 0.55)' : 'rgb(255 255 255 / 0.55)'
    context.shadowBlur = size / 8
    context.fillStyle = colour === 'white' ? '#ffffff' : '#000000'
    context.fillText(text, canvas.width / 2, canvas.height / 2)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (blob) await upload(blob)
  }

  async function fromFile(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0]
    if (file) await upload(file)
  }

  async function update(patch: Partial<WatermarkSettings>) {
    error = ''
    saved = ''
    try {
      settings = (await api<{ watermark: WatermarkSettings }>('/api/shares/watermark', { method: 'PATCH', body: JSON.stringify(patch) })).watermark
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save.'
    }
  }

  async function remove() {
    settings = (await api<{ watermark: WatermarkSettings }>('/api/shares/watermark/image', { method: 'DELETE' })).watermark
    saved = 'Watermark removed. Galleries show photos without one.'
  }
</script>

<div class="layout">
  <div class="stack">
    <form class="stack" onsubmit={fromText}>
      <div class="field">
        <label for="wm-text">Make one from text</label>
        <div class="row">
          <input id="wm-text" type="text" maxlength="80" required bind:value={text} placeholder="© Your Studio" />
          <select bind:value={colour} aria-label="Text colour" style="max-width: 120px">
            <option value="white">White</option>
            <option value="black">Black</option>
          </select>
          <button class="btn" type="submit" disabled={busy}>Use this text</button>
        </div>
      </div>
    </form>
    <div class="field">
      <label for="wm-file">Or upload your logo (a PNG with a transparent background works best)</label>
      <input id="wm-file" type="file" accept="image/png,image/webp,image/jpeg" onchange={fromFile} disabled={busy} />
    </div>
    {#if settings.version}
      <div class="field">
        <label for="wm-position">Where</label>
        <select id="wm-position" value={settings.position} onchange={(e) => update({ position: e.currentTarget.value as WatermarkSettings['position'] })}>
          {#each POSITIONS as [value, text] (value)}<option {value}>{text}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="wm-scale">Size: {Math.round(settings.scale * 100)}% of the photo's width</label>
        <input id="wm-scale" type="range" min="0.05" max="1" step="0.05" value={settings.scale} onchange={(e) => update({ scale: Number(e.currentTarget.value) })} />
      </div>
      <div class="field">
        <label for="wm-opacity">Strength: {Math.round(settings.opacity * 100)}%</label>
        <input id="wm-opacity" type="range" min="0.05" max="1" step="0.05" value={settings.opacity} onchange={(e) => update({ opacity: Number(e.currentTarget.value) })} />
      </div>
      <div><button class="btn btn-sm btn-danger" onclick={remove}>Remove the watermark</button></div>
    {/if}
    {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
    {#if saved}<div class="alert alert-success" role="status">{saved}</div>{/if}
  </div>

  <figure class="preview">
    {#if sampleAssetId}
      <img class="photo" src={`/api/assets/${sampleAssetId}/renditions/preview`} alt="" />
    {:else}
      <div class="photo blank"></div>
    {/if}
    {#if imageUrl}
      {#if settings.position === 'tiled'}
        <div class="tiles" style={`background-image:url(${imageUrl});background-size:${Math.min(settings.scale, 0.5) * 100}% auto;opacity:${settings.opacity}`}></div>
      {:else}
        <img class={`mark ${settings.position}`} src={imageUrl} alt="Watermark" style={`width:${settings.scale * 100}%;opacity:${settings.opacity}`} />
      {/if}
    {/if}
    <figcaption class="muted">{imageUrl ? 'Roughly how clients will see it' : 'No watermark yet'}</figcaption>
  </figure>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 24px;
    align-items: start;
  }
  .row input[type='text'] {
    flex: 1;
    min-width: 160px;
  }
  .preview {
    position: relative;
    margin: 0;
    display: grid;
    gap: 6px;
  }
  .photo {
    width: 100%;
    border-radius: var(--radius-sm);
    display: block;
  }
  .blank {
    aspect-ratio: 3 / 2;
    background: linear-gradient(135deg, #3a4a63, #b98a6e);
  }
  .mark,
  .tiles {
    position: absolute;
    pointer-events: none;
  }
  .mark.center {
    top: 50%;
    left: 50%;
    transform: translate(-50%, calc(-50% - 12px));
  }
  .mark.bottom-right {
    right: 3%;
    bottom: calc(3% + 26px);
  }
  .mark.bottom-left {
    left: 3%;
    bottom: calc(3% + 26px);
  }
  .tiles {
    inset: 0 0 26px 0;
    background-repeat: repeat;
  }
  figcaption {
    font-size: 0.8rem;
  }
  @media (max-width: 860px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>

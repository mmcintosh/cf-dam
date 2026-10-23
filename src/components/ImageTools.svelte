<script lang="ts">
  /** Under a photo: rotate and crop it (never touching the original), and download a copy in a chosen size. */
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'
  import { drag, fitRatio, FULL, isFull, mirror as mirrorCrop, turnAnticlockwise, turnClockwise, type Crop, type Handle } from '../lib/crop'

  interface Edit {
    rotate: 0 | 90 | 180 | 270
    mirror: boolean
    crop: Crop | null
  }

  let { assetId, edit = null, canEdit = false, moreLike = false }: { assetId: string; edit?: Edit | null; canEdit?: boolean; moreLike?: boolean } = $props()

  // ── Download a copy ────────────────────────────────────────────────────────────
  let sizes = $state<string[]>([])
  let hasWatermark = $state(false)
  let watermark = $state(false)
  let downloading = $state(false)
  const SIZE_LABELS: Record<string, string> = { small: 'Small (1024 px)', large: 'Large (2048 px)', full: 'Full size', cutout: 'Background removed (PNG)' }

  onMount(() => {
    api<{ sizes: string[]; watermark: boolean }>(`/api/assets/${assetId}/download`)
      .then((r) => {
        sizes = r.sizes
        hasWatermark = r.watermark
      })
      .catch(() => {})
  })
  const href = (size: string) => `/api/assets/${assetId}/download/${size}${watermark && (size === 'small' || size === 'large') ? '?watermark=1' : ''}`

  // ── Rotate and crop ────────────────────────────────────────────────────────────
  let editing = $state(false)
  let saving = $state(false)
  let error = $state('')
  let rotate = $state<Edit['rotate']>(0)
  let mirrored = $state(false)
  let crop = $state<Crop>({ ...FULL })
  let ratioChoice = $state('free')
  let image: HTMLImageElement | null = null
  let canvas = $state<HTMLCanvasElement | null>(null)
  let stage = $state<HTMLDivElement | null>(null)
  let loaded = $state(false)
  /** The picture as rotated, in its own pixels, and how much it's scaled down to fit. */
  let frame = $state({ width: 1, height: 1 })
  let scale = $state(1)

  const RATIOS: [string, string][] = [
    ['free', 'Free'],
    ['original', 'Original'],
    ['1', 'Square'],
    ['0.8', '4:5'],
    ['1.5', '3:2'],
    ['0.6667', '2:3'],
    ['1.7778', '16:9'],
  ]
  const ratio = $derived.by(() => {
    if (ratioChoice === 'free') return null
    if (ratioChoice === 'original') return frame.width / frame.height
    return Number(ratioChoice)
  })

  function open() {
    rotate = edit?.rotate ?? 0
    mirrored = edit?.mirror ?? false
    crop = edit?.crop ? { ...edit.crop } : { ...FULL }
    ratioChoice = 'free'
    error = ''
    editing = true
    loaded = false
    const img = new Image()
    img.onload = () => {
      image = img
      loaded = true
      layout()
    }
    // A photo still waiting for its large preview is edited on its thumbnail.
    img.onerror = () => {
      if (img.src.includes('/thumb')) error = 'Could not load the picture to edit.'
      else img.src = `/api/assets/${assetId}/renditions/thumb?base=1`
    }
    img.src = `/api/assets/${assetId}/renditions/preview?base=1`
  }

  function layout() {
    if (!image || !stage || !canvas) return
    const turned = rotate % 180 !== 0
    frame = turned ? { width: image.naturalHeight, height: image.naturalWidth } : { width: image.naturalWidth, height: image.naturalHeight }
    const box = stage.getBoundingClientRect()
    scale = Math.min(box.width / frame.width, Math.max(240, window.innerHeight * 0.62) / frame.height, 1)
    canvas.width = Math.round(frame.width * scale)
    canvas.height = Math.round(frame.height * scale)
    draw()
  }

  function draw() {
    if (!image || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { width: cw, height: ch } = canvas
    ctx.save()
    ctx.clearRect(0, 0, cw, ch)
    // Rotate, then mirror in the rotated frame: the order the server applies them in.
    ctx.translate(cw / 2, ch / 2)
    if (mirrored) ctx.scale(-1, 1)
    ctx.rotate((rotate * Math.PI) / 180)
    const w = image.naturalWidth * scale
    const h = image.naturalHeight * scale
    ctx.drawImage(image, -w / 2, -h / 2, w, h)
    ctx.restore()
    // Shade what's cut away, outline the crop, and thirds to compose by.
    const x = crop.x * cw
    const y = crop.y * ch
    const cwid = crop.width * cw
    const chei = crop.height * ch
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fillRect(0, 0, cw, y)
    ctx.fillRect(0, y + chei, cw, ch - y - chei)
    ctx.fillRect(0, y, x, chei)
    ctx.fillRect(x + cwid, y, cw - x - cwid, chei)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, cwid - 2, chei - 2)
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
    for (const t of [1 / 3, 2 / 3]) {
      ctx.beginPath()
      ctx.moveTo(x + cwid * t, y)
      ctx.lineTo(x + cwid * t, y + chei)
      ctx.moveTo(x, y + chei * t)
      ctx.lineTo(x + cwid, y + chei * t)
      ctx.stroke()
    }
    ctx.fillStyle = '#fff'
    for (const [hx, hy] of [
      [x, y],
      [x + cwid, y],
      [x, y + chei],
      [x + cwid, y + chei],
    ]) ctx.fillRect(hx! - 6, hy! - 6, 12, 12)
  }

  $effect(() => {
    // Redraw whenever the crop changes.
    void crop
    if (loaded) draw()
  })

  function turn(clockwise: boolean) {
    // On a mirrored picture a turn one way is a rotation the other way before the mirror.
    const step = clockwise !== mirrored ? 90 : 270
    rotate = ((rotate + step) % 360) as Edit['rotate']
    crop = clockwise ? turnClockwise(crop) : turnAnticlockwise(crop)
    layout()
    if (ratio) crop = fitRatio(frame, ratio, crop)
  }

  function flip() {
    mirrored = !mirrored
    crop = mirrorCrop(crop)
    draw()
  }

  function chooseRatio(value: string) {
    ratioChoice = value
    if (ratio) crop = fitRatio(frame, ratio, crop)
  }

  function reset() {
    rotate = 0
    mirrored = false
    crop = { ...FULL }
    ratioChoice = 'free'
    layout()
  }

  // Dragging: a corner resizes, inside moves.
  let dragging: { handle: Handle; start: Crop; px: number; py: number } | null = null
  function pointer(e: PointerEvent) {
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r }
  }
  function down(e: PointerEvent) {
    const p = pointer(e)
    if (!p) return
    // Corners are hit within 18 px.
    const near = (cx: number, cy: number) => Math.abs((p.x - cx) * p.r.width) < 18 && Math.abs((p.y - cy) * p.r.height) < 18
    const corners: [Handle, number, number][] = [
      ['nw', crop.x, crop.y],
      ['ne', crop.x + crop.width, crop.y],
      ['sw', crop.x, crop.y + crop.height],
      ['se', crop.x + crop.width, crop.y + crop.height],
    ]
    const corner = corners.find(([, cx, cy]) => near(cx, cy))
    const inside = p.x > crop.x && p.x < crop.x + crop.width && p.y > crop.y && p.y < crop.y + crop.height
    if (!corner && !inside) return
    dragging = { handle: corner ? corner[0] : 'move', start: { ...crop }, px: p.x, py: p.y }
    canvas?.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  function move(e: PointerEvent) {
    if (!dragging) return
    const p = pointer(e)
    if (!p) return
    crop = drag(dragging.start, dragging.handle, p.x - dragging.px, p.y - dragging.py, frame, ratio)
  }
  function up() {
    dragging = null
  }

  async function save() {
    saving = true
    error = ''
    const next = rotate === 0 && !mirrored && isFull(crop) ? null : { rotate, mirror: mirrored, crop: isFull(crop) ? null : crop }
    try {
      await api(`/api/assets/${assetId}/edit`, { method: 'PUT', body: JSON.stringify({ edit: next }) })
      // The page's images carry the new version: load it again to show them.
      window.location.reload()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save the edit.'
      saving = false
    }
  }

  function keys(e: KeyboardEvent) {
    if (editing && e.key === 'Escape') editing = false
  }
</script>

<svelte:window onresize={() => editing && layout()} onkeydown={keys} />

<div class="tools row">
  {#if canEdit}
    <button class="btn btn-sm" type="button" onclick={open}>Rotate and crop</button>
    {#if edit}<span class="muted small">Edited: the original is unchanged.</span>{/if}
  {/if}
  {#if moreLike}<a class="btn btn-sm" href={`/?like=${assetId}`}>More like this</a>{/if}
  {#if sizes.length > 0}
    <span class="spacer"></span>
    <details class="download" bind:open={downloading}>
      <summary class="btn btn-sm">Download a copy</summary>
      <div class="menu card stack">
        {#each sizes as size (size)}
          <a class="btn btn-sm" href={href(size)} download onclick={() => (downloading = false)}>{SIZE_LABELS[size] ?? size}</a>
        {/each}
        <a class="btn btn-sm" href={`/api/assets/${assetId}/xmp`} download onclick={() => (downloading = false)} title="Keywords, captions, rating and credits in a file Lightroom, Capture One and Bridge read">Metadata only (XMP)</a>
        {#if hasWatermark}
          <label class="small"><input type="checkbox" bind:checked={watermark} /> With the watermark (small and large)</label>
        {/if}
        <p class="muted small">{edit ? 'Rotated and cropped as shown' : 'As shown'}. Removing the background is done by Cloudflare’s AI and works best on a clear subject.</p>
      </div>
    </details>
  {/if}
</div>

{#if editing}
  <div class="overlay" role="dialog" aria-modal="true" aria-label="Rotate and crop">
    <div class="panel card stack">
      <div class="row bar">
        <button class="btn btn-sm" type="button" onclick={() => turn(false)} title="Turn left">⟲ Left</button>
        <button class="btn btn-sm" type="button" onclick={() => turn(true)} title="Turn right">⟳ Right</button>
        <button class="btn btn-sm" type="button" onclick={flip} class:btn-primary={mirrored}>Mirror</button>
        <select value={ratioChoice} onchange={(e) => chooseRatio(e.currentTarget.value)} aria-label="Crop shape">
          {#each RATIOS as [value, label] (value)}<option {value}>{label}</option>{/each}
        </select>
        <button class="btn btn-sm" type="button" onclick={reset}>Reset</button>
        <span class="spacer"></span>
        <button class="btn btn-sm" type="button" onclick={() => (editing = false)}>Cancel</button>
        <button class="btn btn-sm btn-primary" type="button" onclick={save} disabled={saving || !loaded}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
      <div class="stage-box" bind:this={stage}>
        <canvas bind:this={canvas} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} class:hidden={!loaded}></canvas>
        {#if !loaded && !error}<p class="muted">Loading…</p>{/if}
      </div>
      <p class="muted small">Drag a corner to crop, or inside the box to move it. The original file is never changed; Reset and Save undoes the edit.</p>
      {#if error}<div class="alert alert-error">{error}</div>{/if}
    </div>
  </div>
{/if}

<style>
  .tools {
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .spacer {
    flex: 1;
  }
  .download {
    position: relative;
  }
  .download summary {
    list-style: none;
    cursor: pointer;
  }
  .download summary::-webkit-details-marker {
    display: none;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 20;
    min-width: 230px;
    gap: 6px;
    box-shadow: var(--shadow);
  }
  .menu a {
    justify-content: flex-start;
  }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .panel {
    width: min(1100px, 100%);
    max-height: 100%;
    overflow: auto;
    background: var(--bg-elevated);
  }
  .bar {
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .stage-box {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 240px;
  }
  canvas {
    touch-action: none;
    cursor: crosshair;
    max-width: 100%;
  }
  .hidden {
    display: none;
  }
</style>

<script lang="ts">
  /**
   * The faces found on this photo (catalog/faces.ts, plans/PLAN-FN2-v2.md): each a chip cut from the unedited preview
   * (the boxes are on it), named or not. Click one to name it, set it aside (a passer-by, a poster) or clear it.
   * Naming tags the photo, so the names list above changes too (the `cf-dam:people` event, both ways). Never shown to
   * clients.
   */
  import { t } from '@cf-dam/i18n/client'
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'

  interface Face {
    id: number
    x: number
    y: number
    w: number
    h: number
    source: string
    personId: number | null
    name: string | null
    setAside: boolean
  }

  let { assetId, initial, canManage }: { assetId: string; initial: Face[]; canManage: boolean } = $props()

  let faces = $state<Face[]>([...initial])
  let everyone = $state<{ id: number; name: string }[]>([])
  let open = $state<number | null>(null)
  let name = $state('')
  let busy = $state(false)
  let error = $state('')
  let showAside = $state(false)

  const shown = $derived(faces.filter((f) => !f.setAside))
  const aside = $derived(faces.filter((f) => f.setAside))
  const src = `/api/assets/${assetId}/renditions/preview?base=1`

  /** The box fills the chip: the picture scaled so the box is the chip's size, moved so the box is in it. */
  const crop = (f: Face) =>
    `background-image:url(${src});background-size:${(1000 / f.w) * 100}% ${(1000 / f.h) * 100}%;background-position:${f.w >= 1000 ? 0 : (f.x / (1000 - f.w)) * 100}% ${f.h >= 1000 ? 0 : (f.y / (1000 - f.h)) * 100}%`

  async function reload() {
    faces = (await api<{ faces?: Face[] }>(`/api/assets/${assetId}`)).faces ?? []
  }

  onMount(() => {
    if (canManage) void api<{ people: { id: number; name: string }[] }>('/api/people').then((r) => (everyone = r.people)).catch(() => {})
    const changed = (e: Event) => {
      if ((e as CustomEvent<{ from: string }>).detail?.from !== 'faces') void reload().catch(() => {})
    }
    window.addEventListener('cf-dam:people', changed)
    return () => window.removeEventListener('cf-dam:people', changed)
  })

  function choose(f: Face) {
    if (!canManage) return
    open = open === f.id ? null : f.id
    name = f.name ?? ''
    error = ''
  }

  async function send(body: Record<string, unknown>) {
    if (open === null) return
    busy = true
    error = ''
    try {
      await api('/api/faces/choose', { method: 'POST', body: JSON.stringify({ faceIds: [open], ...body }) })
      open = null
      name = ''
      await reload()
      window.dispatchEvent(new CustomEvent('cf-dam:people', { detail: { from: 'faces' } }))
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }

  function named(event: SubmitEvent) {
    event.preventDefault()
    const typed = name.trim()
    if (!typed) return
    const known = everyone.find((p) => p.name.toLowerCase() === typed.toLowerCase())
    void send(known ? { personId: known.id } : { name: typed })
  }

  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape' && open !== null) {
      event.stopPropagation()
      open = null
    }
  }
</script>

{#if faces.length > 0}
  <h3>{t('photoFaces.title')}</h3>
  <ul class="faces" onkeydown={keys}>
    {#each shown as f (f.id)}
      <li>
        <button
          type="button"
          class="face"
          class:open={open === f.id}
          style={crop(f)}
          disabled={!canManage}
          aria-expanded={canManage ? open === f.id : undefined}
          aria-label={f.name ? t('photoFaces.named', { name: f.name }) : t('photoFaces.unnamed')}
          title={f.name ?? t('photoFaces.unnamed')}
          onclick={() => choose(f)}
        ></button>
        <span class="who small" class:muted={!f.name}>{f.name ?? t('photoFaces.who')}</span>
      </li>
    {/each}
  </ul>
  {#if open !== null}
    <form class="pick" onsubmit={named} onkeydown={keys}>
      <input type="text" list={`face-people-${assetId}`} maxlength="120" placeholder={t('photoFaces.namePlaceholder')} aria-label={t('photoFaces.namePlaceholder')} bind:value={name} />
      <datalist id={`face-people-${assetId}`}>{#each everyone as p (p.id)}<option value={p.name}></option>{/each}</datalist>
      <button class="btn btn-sm btn-primary" type="submit" disabled={busy || !name.trim()}>{t('photoFaces.name')}</button>
      <button class="btn btn-sm" type="button" disabled={busy} onclick={() => send({ setAside: true })}>{t('photoFaces.setAside')}</button>
      {#if faces.find((f) => f.id === open)?.name}<button class="btn btn-sm" type="button" disabled={busy} onclick={() => send({ clear: true })}>{t('photoFaces.clear')}</button>{/if}
      <button class="btn btn-sm btn-ghost" type="button" onclick={() => (open = null)}>{t('common.cancel')}</button>
    </form>
  {/if}
  {#if aside.length > 0}
    <p class="small muted">
      {t('photoFaces.aside', { count: aside.length })}
      <button class="link" type="button" aria-expanded={showAside} onclick={() => (showAside = !showAside)}>{showAside ? t('photoFaces.hide') : t('photoFaces.show')}</button>
    </p>
    {#if showAside}
      <ul class="faces">
        {#each aside as f (f.id)}
          <li>
            <button type="button" class="face dim" style={crop(f)} disabled={!canManage} aria-label={t('photoFaces.asideOne')} onclick={() => choose(f)}></button>
            {#if canManage && open === f.id}<button class="link small" type="button" onclick={() => send({ setAside: false })}>{t('photoFaces.putBack')}</button>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
  {#if error}<p class="alert alert-error small" role="alert">{error}</p>{/if}
{/if}

<style>
  h3 {
    font-size: 0.95rem;
    margin: 14px 0 6px;
  }
  .faces {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .faces li {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 72px;
  }
  .face {
    width: 64px;
    height: 64px;
    border-radius: 8px;
    border: 2px solid var(--border-strong);
    background-color: var(--surface-2, #ddd);
    background-repeat: no-repeat;
    padding: 0;
    cursor: pointer;
  }
  .face:disabled {
    cursor: default;
  }
  .face.open {
    border-color: var(--accent);
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .face.dim {
    opacity: 0.6;
  }
  .who {
    max-width: 72px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
  }
  .pick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }
  .pick input {
    flex: 1 1 160px;
    min-width: 0;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
  }
  .small {
    font-size: 0.8rem;
  }
</style>

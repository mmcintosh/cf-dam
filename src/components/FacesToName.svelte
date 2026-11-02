<script lang="ts">
  /**
   * Faces to name in an album or a job's albums (catalog/faces.ts unnamedFaces, plans/PLAN-FN2-v2.md FN2c): a grid of
   * the faces nobody has named or set aside, largest first, 60 at a time. Tick several, type or pick a name once, and
   * every ticked face is named (each photo is tagged); or set them aside. Each chip is cut from the photo's unedited
   * thumb when the face is big enough there, otherwise from its unedited preview.
   */
  import { t } from '@cf-dam/i18n/client'
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'
  import { chipStyle } from '../lib/face-chip'

  interface Face {
    id: number
    assetId: string
    x: number
    y: number
    w: number
    h: number
  }
  type Cursor = { area: number; id: number } | null

  let { scope, id }: { scope: 'album' | 'job'; id: string } = $props()

  let faces = $state<Face[] | null>(null)
  let total = $state(0)
  let next = $state<Cursor>(null)
  let ticked = $state<Set<number>>(new Set())
  let everyone = $state<{ id: number; name: string }[]>([])
  let name = $state('')
  let busy = $state(false)
  let error = $state('')
  let said = $state('')

  /** A face at least 100 per-mille wide is 48 px or more in the 480 px thumb, about 77 px with its margin. */
  const crop = (f: Face) => chipStyle(`/api/assets/${f.assetId}/renditions/${f.w >= 100 ? 'thumb' : 'preview'}?base=1`, f)

  async function load(more = false) {
    const cursor = more && next ? `&area=${next.area}&after=${next.id}` : ''
    const page = await api<{ faces: Face[]; total: number; next: Cursor }>(`/api/faces/unnamed?${scope}=${encodeURIComponent(id)}${cursor}`)
    faces = more && faces ? [...faces, ...page.faces] : page.faces
    total = page.total
    next = page.next
  }

  onMount(() => {
    void load().catch(() => (faces = []))
    void api<{ people: { id: number; name: string }[] }>('/api/people').then((r) => (everyone = r.people)).catch(() => {})
  })

  function toggle(faceId: number) {
    const s = new Set(ticked)
    if (s.has(faceId)) s.delete(faceId)
    else s.add(faceId)
    ticked = s
  }

  async function choose(body: Record<string, unknown>, done: string) {
    busy = true
    error = ''
    said = ''
    try {
      await api('/api/faces/choose', { method: 'POST', body: JSON.stringify({ faceIds: [...ticked], ...body }) })
      said = done
      ticked = new Set()
      name = ''
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }

  function named(event: SubmitEvent) {
    event.preventDefault()
    const typed = name.trim()
    if (!typed || ticked.size === 0) return
    const known = everyone.find((p) => p.name.toLowerCase() === typed.toLowerCase())
    void choose(known ? { personId: known.id } : { name: typed }, t('facesToName.named', { count: ticked.size, name: known?.name ?? typed }))
  }
</script>

{#if faces && (faces.length > 0 || said)}
  <section class="card" aria-labelledby={`faces-to-name-${id}`}>
    <h2 id={`faces-to-name-${id}`}>{total > 10_000 ? t('facesToName.titleMany') : t('facesToName.title', { count: total })}</h2>
    <p class="muted small">{t('facesToName.lead')}</p>
    {#if said}<p role="status">{said}</p>{/if}
    {#if faces.length > 0}
      <form class="bar" onsubmit={named}>
        <span class="small">{t('facesToName.ticked', { count: ticked.size })}</span>
        <input type="text" list={`faces-to-name-people-${id}`} maxlength="120" placeholder={t('photoFaces.namePlaceholder')} aria-label={t('photoFaces.namePlaceholder')} bind:value={name} disabled={busy} />
        <datalist id={`faces-to-name-people-${id}`}>{#each everyone as p (p.id)}<option value={p.name}></option>{/each}</datalist>
        <button class="btn btn-sm btn-primary" type="submit" disabled={busy || ticked.size === 0 || !name.trim()}>{t('photoFaces.name')}</button>
        <button class="btn btn-sm" type="button" disabled={busy || ticked.size === 0} onclick={() => choose({ setAside: true }, t('facesToName.setAside', { count: ticked.size }))}>{t('photoFaces.setAside')}</button>
        {#if ticked.size > 0}<button class="btn btn-sm btn-ghost" type="button" onclick={() => (ticked = new Set())}>{t('facesToName.untick')}</button>{/if}
      </form>
      <ul class="grid">
        {#each faces as f (f.id)}
          <li>
            <button type="button" class="face" class:on={ticked.has(f.id)} style={crop(f)} aria-pressed={ticked.has(f.id)} aria-label={t('facesToName.tick')} onclick={() => toggle(f.id)}></button>
            <a class="small" href={`/assets/${f.assetId}`}>{t('facesToName.photo')}</a>
          </li>
        {/each}
      </ul>
      {#if next}<button class="btn btn-sm" type="button" disabled={busy} onclick={() => load(true)}>{t('facesToName.more')}</button>{/if}
    {/if}
    {#if error}<p class="alert alert-error small" role="alert">{error}</p>{/if}
  </section>
{/if}

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 8px 0 12px;
  }
  .bar input {
    flex: 1 1 160px;
    min-width: 0;
  }
  .grid {
    list-style: none;
    margin: 0 0 10px;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    gap: 10px;
  }
  .grid li {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .face {
    width: 76px;
    height: 76px;
    border-radius: 8px;
    border: 3px solid transparent;
    outline: 1px solid var(--border-strong);
    background-color: var(--surface-2, #ddd);
    background-repeat: no-repeat;
    padding: 0;
    cursor: pointer;
  }
  .face.on {
    border-color: var(--accent);
  }
  .small {
    font-size: 0.8rem;
  }
</style>

<script lang="ts">
  /**
   * "Who's in this photo?" in the client gallery's viewer (plans/PLAN-G2-v2.md): the couple tick one of their chips
   * or type a name, for this photo and any others, and see what's waiting. Nothing is tagged until the photographer
   * checks it. The form is its own dialog: while it's open the viewer's keys and swipes leave the photo alone.
   */
  import { t } from '@cf-dam/i18n/client'

  interface Suggested {
    id: string
    label: string
    mine: boolean
  }
  interface Item {
    id: string
    hasThumb: boolean
    alt: string | null
    title: string | null
    filename: string | null
    suggested?: Suggested[]
  }
  interface Chip {
    key: number
    label: string
    kind: 'group' | 'person'
    count: number
  }
  interface Props {
    base: string
    item: Item
    items: Item[]
    chips: Chip[]
    thumb: (item: Item) => string
    /** Waiting suggestions by photo, after a send or a take-back. */
    onchange: (byPhoto: Record<string, Suggested[]>) => void
    /** Whether the form is open, so the viewer can leave keys and swipes alone. */
    onopen: (open: boolean) => void
  }
  let { base, item, items, chips, thumb, onchange, onopen }: Props = $props()

  const MAX_PHOTOS = 50
  const people = $derived(chips.filter((c) => c.kind === 'person'))

  let formOpen = $state(false)
  let chip = $state<number | null>(null)
  let name = $state('')
  let also = $state(new Set<string>())
  let showAll = $state(false)
  let busy = $state(false)
  let error = $state('')
  let thanks = $state('')
  let dialog = $state<HTMLDivElement | null>(null)

  function show(open: boolean) {
    formOpen = open
    onopen(open)
    if (open) {
      chip = null
      name = ''
      also = new Set([item.id])
      showAll = false
      error = ''
      thanks = ''
    }
  }

  function toggleAlso(id: string) {
    const next = new Set(also)
    if (next.has(id)) next.delete(id)
    else if (next.size < MAX_PHOTOS) next.add(id)
    also = next
  }

  async function send(event: SubmitEvent) {
    event.preventDefault()
    const picked = chip === null ? null : people.find((c) => c.key === chip)
    if (!picked && !name.trim()) {
      error = t('suggest.needName')
      return
    }
    busy = true
    error = ''
    try {
      const response = await fetch(`${base}/names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetIds: [...also], ...(picked ? { chip: { key: picked.key, label: picked.label } } : { name }) }),
      })
      const body = (await response.json().catch(() => ({}))) as { suggested?: Record<string, Suggested[]>; message?: string }
      if (!response.ok) throw new Error(body.message ?? t('common.error.generic', { status: String(response.status) }))
      onchange(body.suggested ?? {})
      formOpen = false
      onopen(false)
      thanks = t('suggest.thanks')
    } catch (e) {
      error = e instanceof Error ? e.message : t('suggest.failed')
    } finally {
      busy = false
    }
  }

  async function takeBack(s: Suggested) {
    error = ''
    const response = await fetch(`${base}/names/${s.id}`, { method: 'DELETE' })
    // Gone already (the photographer just checked it) is as good as taken back.
    if (response.ok || response.status === 404) onchange({ [item.id]: (item.suggested ?? []).filter((x) => x.id !== s.id) })
    else error = t('suggest.failed')
  }

  /** Escape closes only this form; Tab stays inside it. */
  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      show(false)
    } else if (event.key === 'Tab' && dialog) {
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled'))
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
  }

  const focus = (node: HTMLElement) => node.focus()
  const label = (i: Item) => i.title || i.filename || ''
</script>

<div class="suggest">
  <button class="btn btn-sm" onclick={() => show(true)}>{t('suggest.button')}</button>
  {#each item.suggested ?? [] as s (s.id)}
    <span class="waiting small">
      {t('suggest.waiting', { name: s.label })}
      {#if s.mine}<button class="link small" onclick={() => takeBack(s)}>{t('suggest.takeBack')}</button>{/if}
    </span>
  {/each}
  {#if thanks}<span class="muted small" role="status">{thanks}</span>{/if}
  {#if error && !formOpen}<span class="error small" role="alert">{error}</span>{/if}
</div>

{#if formOpen}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="backdrop" role="dialog" aria-modal="true" aria-labelledby="suggest-title" tabindex="-1" bind:this={dialog} onkeydown={onKey} ontouchend={(e) => e.stopPropagation()}>
    <form class="card stack form" onsubmit={send}>
      <h2 id="suggest-title">{t('suggest.title')}</h2>
      <p class="muted small">{t('suggest.lead')}</p>
      {#if people.length > 0}
        <div class="chips" role="group" aria-label={t('suggest.chipsLabel')}>
          {#each people as c (c.key)}
            <button type="button" class="btn btn-sm chip" class:on={chip === c.key} aria-pressed={chip === c.key} onclick={() => ((chip = chip === c.key ? null : c.key), (name = ''))}>{c.label}</button>
          {/each}
        </div>
      {/if}
      <div class="field">
        <label for="suggest-name">{people.length > 0 ? t('suggest.orName') : t('suggest.name')}</label>
        <input id="suggest-name" type="text" maxlength="80" autocomplete="off" bind:value={name} oninput={() => (chip = null)} use:focus />
      </div>
      <div class="field">
        <button type="button" class="link small" onclick={() => (showAll = !showAll)} aria-expanded={showAll}>
          {t('suggest.also', { count: also.size })}
        </button>
        {#if showAll}
          <p class="muted small">{t('suggest.alsoLead', { max: MAX_PHOTOS })}</p>
          <div class="strip">
            {#each items as other, i (other.id)}
              <label class="pick" class:on={also.has(other.id)}>
                <input type="checkbox" checked={also.has(other.id)} disabled={!also.has(other.id) && also.size >= MAX_PHOTOS} onchange={() => toggleAlso(other.id)} />
                {#if other.hasThumb}
                  <img src={thumb(other)} alt={other.alt ?? (label(other) || t('gallery.photoNumber', { number: i + 1 }))} loading="lazy" decoding="async" />
                {:else}
                  <span class="muted small">{i + 1}</span>
                {/if}
              </label>
            {/each}
          </div>
        {/if}
      </div>
      {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
      <div class="row">
        <button class="btn btn-primary" type="submit" disabled={busy || also.size === 0}>{t('suggest.send')}</button>
        <button class="btn" type="button" onclick={() => show(false)}>{t('common.cancel')}</button>
      </div>
    </form>
  </div>
{/if}

<style>
  .suggest {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: center;
    padding: 0 16px 12px;
  }
  .waiting {
    color: var(--text-muted);
  }
  .error {
    color: var(--danger);
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    background: rgb(5 6 9 / 0.8);
    padding: 16px;
  }
  .form {
    width: min(480px, 100%);
    max-height: calc(100vh - 32px);
    overflow: auto;
    background: var(--bg-elevated);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    border-radius: 999px;
  }
  .strip {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: 6px;
    max-height: 240px;
    overflow: auto;
  }
  .pick {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-hover);
    outline: 2px solid transparent;
    cursor: pointer;
  }
  .pick.on {
    outline-color: var(--accent);
  }
  .pick input {
    position: absolute;
    top: 4px;
    left: 4px;
  }
  .pick img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>

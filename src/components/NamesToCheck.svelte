<script lang="ts">
  /**
   * Names to check (catalog/name-suggestions.ts, plans/PLAN-G2-v2.md §4): what the couple suggested on the gallery's
   * photos, grouped by name. Accepting tags the ticked photos with the person chosen (or a new person of this client);
   * rejecting drops them. Unticked photos stay waiting. Several names can be accepted as one person.
   */
  import { t } from '@cf-dam/i18n/client'
  import type { NameGroup } from '@cf-dam/api'
  import { api } from '../lib/auth-client'

  let { shareId, initial }: { shareId: string; initial: { groups: NameGroup[]; count: number } } = $props()

  const SHOWN_PHOTOS = 24
  type Choice = { kind: 'person'; id: number } | { kind: 'other' } | { kind: 'new' }

  // svelte-ignore state_referenced_locally
  let groups = $state<NameGroup[]>(initial.groups)
  // svelte-ignore state_referenced_locally
  let count = $state(initial.count)
  /** Per group: the photos ticked (by asset id), the choice, the typed names and the ticks. */
  let ticked = $state<Record<string, string[]>>({})
  let choice = $state<Record<string, Choice>>({})
  let otherName = $state<Record<string, string>>({})
  let newName = $state<Record<string, string>>({})
  let child = $state<Record<string, boolean>>({})
  let listIt = $state<Record<string, boolean>>({})
  let expanded = $state<Record<string, boolean>>({})
  /** Names chosen to be decided together, as one person. */
  let together = $state<string[]>([])
  let everyone = $state<{ id: number; name: string }[] | null>(null)
  let busy = $state(false)
  let error = $state('')
  let done = $state('')
  let taken = $state<{ key: string; person: { id: number; name: string } } | null>(null)

  function reset(next: NameGroup[]) {
    groups = next
    ticked = Object.fromEntries(next.map((g) => [g.key, g.photos.map((p) => p.assetId)]))
    choice = Object.fromEntries(next.map((g) => [g.key, g.chosen !== null ? { kind: 'person', id: g.chosen } : g.candidates.length > 0 ? { kind: 'person', id: g.candidates[0]!.id } : { kind: 'new' }] as [string, Choice]))
    newName = Object.fromEntries(next.map((g) => [g.key, g.name]))
    otherName = {}
    child = {}
    listIt = {}
    together = together.filter((k) => next.some((g) => g.key === k))
  }
  // svelte-ignore state_referenced_locally
  reset(initial.groups)

  async function loadEveryone() {
    if (everyone !== null) return
    everyone = []
    everyone = (await api<{ people: { id: number; name: string }[] }>('/api/people')).people
  }

  /** The groups a decision on `group` covers: the names chosen together, if it's one of them. */
  const covered = (group: NameGroup) => (together.includes(group.key) ? groups.filter((g) => together.includes(g.key)) : [group])
  const idsOf = (list: NameGroup[]) => list.flatMap((g) => g.photos.filter((p) => ticked[g.key]?.includes(p.assetId)).flatMap((p) => p.suggestionIds))

  function toggleTick(group: NameGroup, assetId: string) {
    const now = ticked[group.key] ?? []
    ticked[group.key] = now.includes(assetId) ? now.filter((a) => a !== assetId) : [...now, assetId]
  }

  async function decide(group: NameGroup, what: 'accept' | 'reject') {
    const list = covered(group)
    const suggestionIds = idsOf(list)
    if (suggestionIds.length === 0) return
    const body: Record<string, unknown> = { keys: list.map((g) => g.key), suggestionIds }
    if (what === 'accept') {
      const chosen = choice[group.key] ?? { kind: 'new' }
      if (chosen.kind === 'person') body.personId = chosen.id
      else if (chosen.kind === 'other') {
        const typed = (otherName[group.key] ?? '').trim().toLowerCase()
        const found = everyone?.find((p) => p.name.toLowerCase() === typed)
        if (!found) {
          error = t('namesToCheck.pickSomeone')
          return
        }
        body.personId = found.id
      } else body.newName = newName[group.key] ?? group.name
      body.isChild = child[group.key] === true
      body.listInGallery = listIt[group.key] === true
    }
    busy = true
    error = ''
    done = ''
    taken = null
    try {
      const response = await fetch(`/api/shares/${shareId}/names/${what}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result = (await response.json().catch(() => ({}))) as {
        message?: string
        error?: string
        person?: { id: number; name: string }
        accepted?: number
        rejected?: number
        skipped?: number
        listed?: boolean
        groups?: NameGroup[]
        count?: number
      }
      if (response.status === 409 && result.error === 'name_taken' && result.person) {
        taken = { key: group.key, person: result.person }
        error = result.message ?? ''
        return
      }
      if (!response.ok) throw new Error(result.message ?? t('common.requestFailed', { status: String(response.status) }))
      const n = what === 'accept' ? (result.accepted ?? 0) : (result.rejected ?? 0)
      done = [
        what === 'accept' ? t('namesToCheck.accepted', { count: n }) : t('namesToCheck.rejected', { count: n }),
        result.skipped ? t('namesToCheck.skipped', { count: result.skipped }) : '',
        what === 'accept' && listIt[group.key] && !result.listed ? t('namesToCheck.notListed') : '',
      ]
        .filter(Boolean)
        .join(' ')
      together = together.filter((k) => !list.some((g) => g.key === k))
      count = result.count ?? 0
      reset(result.groups ?? [])
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }

  /** The name is someone's already: decide for them instead. */
  function useTaken() {
    if (!taken) return
    choice[taken.key] = { kind: 'person', id: taken.person.id }
    const group = groups.find((g) => g.key === taken!.key)
    if (group && !group.candidates.some((c) => c.id === taken!.person.id)) group.candidates = [...group.candidates, { id: taken.person.id, name: taken.person.name, clientName: null, where: 'archive' }]
    taken = null
    error = ''
  }

  const WHERE = { gallery: 'namesToCheck.inGallery', client: 'namesToCheck.clients', archive: 'namesToCheck.archive' } as const
  const photoTitle = (p: NameGroup['photos'][number]) =>
    [t('namesToCheck.by', { names: p.by.join(', ') }), p.names.length ? t('namesToCheck.named', { names: p.names.join(', ') }) : ''].filter(Boolean).join(' · ')
</script>

<div class="stack">
  <p class="muted small">{t('namesToCheck.lead')} <a href="/help/people-in-galleries">{t('galleryPeople.help')}</a></p>
  {#if done}<p class="note" role="status">{done}</p>{/if}
  {#if error}
    <div class="alert alert-error" role="alert">
      {error}
      {#if taken}<button class="btn btn-sm" type="button" onclick={useTaken}>{t('namesToCheck.useThem', { name: taken.person.name })}</button>{/if}
    </div>
  {/if}
  {#if groups.length === 0}
    <p class="muted small">{t('namesToCheck.none')}</p>
  {:else}
    <p class="muted small">{t('namesToCheck.waiting', { count })}</p>
    {#if together.length > 1}<p class="note small">{t('namesToCheck.together', { count: together.length })}</p>{/if}
    {#each groups as group (group.key)}
      {@const picked = ticked[group.key] ?? []}
      {@const chosen = choice[group.key] ?? { kind: 'new' }}
      <article class="group stack">
        <header class="row">
          <label class="check">
            <input type="checkbox" checked={together.includes(group.key)} onchange={(e) => (together = e.currentTarget.checked ? [...together, group.key] : together.filter((k) => k !== group.key))} />
            <span class="sr-only">{t('namesToCheck.select', { name: group.name })}</span>
          </label>
          <h3>“{group.name}”</h3>
          <span class="muted small">{t('common.photos', { count: group.photos.length })}</span>
        </header>

        <div class="photos">
          {#each expanded[group.key] ? group.photos : group.photos.slice(0, SHOWN_PHOTOS) as photo (photo.assetId)}
            <label class="photo" class:on={picked.includes(photo.assetId)} title={photoTitle(photo)}>
              <input type="checkbox" checked={picked.includes(photo.assetId)} onchange={() => toggleTick(group, photo.assetId)} aria-label={t('namesToCheck.tickPhoto', { name: photo.filename })} />
              <img src={`/api/assets/${photo.assetId}/renditions/thumb`} alt={photo.filename} loading="lazy" />
              {#if photo.alreadyTagged}<span class="tagged small">{t('namesToCheck.alreadyTagged')}</span>{/if}
            </label>
          {/each}
          {#if group.photos.length > SHOWN_PHOTOS && !expanded[group.key]}
            <button class="btn btn-sm more" type="button" onclick={() => (expanded[group.key] = true)}>+{group.photos.length - SHOWN_PHOTOS}</button>
          {/if}
        </div>
        <p class="muted small">{t('namesToCheck.suggestedBy', { names: [...new Set(group.photos.flatMap((p) => p.by))].join(', ') })}</p>

        <fieldset class="stack choose">
          <legend>{t('namesToCheck.isThis')}</legend>
          {#each group.candidates as c (c.id)}
            <label class="check">
              <input type="radio" name={`who-${group.key}`} checked={chosen.kind === 'person' && chosen.id === c.id} onchange={() => (choice[group.key] = { kind: 'person', id: c.id })} />
              <span>{c.name} <span class="muted small">· {c.clientName ? t('namesToCheck.ofClient', { client: c.clientName }) : t(WHERE[c.where])}</span></span>
            </label>
          {/each}
          {#if !group.person}
            <label class="check">
              <input type="radio" name={`who-${group.key}`} checked={chosen.kind === 'other'} onchange={() => ((choice[group.key] = { kind: 'other' }), loadEveryone())} />
              <span>{t('namesToCheck.someoneElse')}</span>
            </label>
            {#if chosen.kind === 'other'}
              <input type="text" list={`everyone-${group.key}`} maxlength="120" aria-label={t('namesToCheck.someoneElse')} bind:value={otherName[group.key]} />
              <datalist id={`everyone-${group.key}`}>{#each everyone ?? [] as p (p.id)}<option value={p.name}></option>{/each}</datalist>
            {/if}
            <label class="check">
              <input type="radio" name={`who-${group.key}`} checked={chosen.kind === 'new'} onchange={() => (choice[group.key] = { kind: 'new' })} />
              <span>{t('namesToCheck.newPerson')}</span>
            </label>
            {#if chosen.kind === 'new'}
              <input type="text" maxlength="120" aria-label={t('namesToCheck.newPerson')} bind:value={newName[group.key]} />
              <p class="muted small">{t('namesToCheck.newHint')}</p>
            {/if}
          {/if}
        </fieldset>

        <div class="row ticks">
          <label class="check small"><input type="checkbox" bind:checked={child[group.key]} /> {t('namesToCheck.child')}</label>
          <label class="check small"><input type="checkbox" bind:checked={listIt[group.key]} /> {t('namesToCheck.list')}</label>
        </div>
        {#if child[group.key]}<p class="muted small">{t('namesToCheck.childHint')}</p>{/if}

        <div class="row">
          <button class="btn btn-sm btn-primary" type="button" disabled={busy || idsOf(covered(group)).length === 0} onclick={() => decide(group, 'accept')}>
            {t('namesToCheck.accept', { count: covered(group).reduce((n, g) => n + (ticked[g.key]?.length ?? 0), 0) })}
          </button>
          <button class="btn btn-sm" type="button" disabled={busy || idsOf(covered(group)).length === 0} onclick={() => decide(group, 'reject')}>
            {t('namesToCheck.reject', { count: covered(group).reduce((n, g) => n + (ticked[g.key]?.length ?? 0), 0) })}
          </button>
          {#if picked.length < group.photos.length}<span class="muted small">{t('namesToCheck.untickedWait')}</span>{/if}
        </div>
      </article>
    {/each}
  {/if}
</div>

<style>
  .group {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px;
  }
  .group header {
    align-items: baseline;
    gap: 8px;
  }
  h3 {
    font-size: 1rem;
    margin: 0;
  }
  .photos {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .photo {
    position: relative;
    width: 88px;
    height: 88px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-hover);
    outline: 2px solid transparent;
    cursor: pointer;
  }
  .photo.on {
    outline-color: var(--accent);
  }
  .photo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .photo input {
    position: absolute;
    top: 4px;
    left: 4px;
  }
  .tagged {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 2px 4px;
    background: rgb(0 0 0 / 0.6);
    color: white;
  }
  .more {
    align-self: center;
  }
  .note {
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
  }
  .choose {
    border: 0;
    padding: 0;
    margin: 0;
    gap: 6px;
  }
  .choose legend {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .ticks {
    gap: 16px;
  }
</style>

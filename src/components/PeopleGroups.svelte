<script lang="ts">
  /**
   * A client's groups of people ("Bride's family", "The kids"): made from the people tagged on their jobs' photos
   * (catalog/gallery-people.ts). Galleries for this client can list them, so the couple finds everyone in one.
   */
  import { onMount } from 'svelte'
  import { t } from '@cf-dam/i18n/client'
  import type { GroupJson, GroupMember } from '@cf-dam/api'
  import { api } from '../lib/auth-client'

  interface Props {
    clientId: string
    /** Null: load them. */
    initial?: GroupJson[] | null
    /** After a group is made, changed or deleted (a gallery's settings read them again). */
    onchange?: () => void
  }
  let { clientId, initial = null, onchange }: Props = $props()

  // svelte-ignore state_referenced_locally
  let groups = $state<GroupJson[]>(initial ?? [])
  let candidates = $state<(GroupMember & { photos: number })[] | null>(null)
  /** The group being made ('new') or changed. */
  let editing = $state<number | 'new' | null>(null)
  let name = $state('')
  let chosen = $state<number[]>([])
  let busy = $state(false)
  let error = $state('')
  let confirming = $state<number | null>(null)

  async function load() {
    groups = (await api<{ groups: GroupJson[] }>(`/api/people/groups?client=${encodeURIComponent(clientId)}`)).groups
  }
  onMount(() => {
    if (initial === null) void load().catch(() => {})
  })

  async function start(group: GroupJson | null) {
    error = ''
    editing = group ? group.id : 'new'
    name = group?.name ?? ''
    chosen = group ? group.members.map((m) => m.id) : []
    if (candidates === null) {
      try {
        candidates = (await api<{ people: (GroupMember & { photos: number })[] }>(`/api/people/groups/candidates?client=${encodeURIComponent(clientId)}`)).people
      } catch (e) {
        error = e instanceof Error ? e.message : t('common.couldNotLoad')
      }
    }
  }

  /** The candidates, plus members who aren't among them (tagged only on other clients' photos). */
  const choices = $derived.by(() => {
    const list = candidates ?? []
    const group = typeof editing === 'number' ? groups.find((g) => g.id === editing) : null
    const extra = (group?.members ?? []).filter((m) => !list.some((c) => c.id === m.id)).map((m) => ({ ...m, photos: 0 }))
    return [...list, ...extra]
  })

  async function save(event: SubmitEvent) {
    event.preventDefault()
    busy = true
    error = ''
    try {
      if (editing === 'new') await api('/api/people/groups', { method: 'POST', body: JSON.stringify({ clientId, name, personIds: chosen }) })
      else await api(`/api/people/groups/${editing}`, { method: 'PATCH', body: JSON.stringify({ name, personIds: chosen }) })
      editing = null
      await load()
      onchange?.()
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }

  async function remove(group: GroupJson) {
    if (confirming !== group.id) {
      confirming = group.id
      setTimeout(() => confirming === group.id && (confirming = null), 4000)
      return
    }
    confirming = null
    try {
      await api(`/api/people/groups/${group.id}`, { method: 'DELETE' })
      await load()
      onchange?.()
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    }
  }
</script>

<div class="stack">
  <p class="muted small">{t('groups.lead')}</p>
  {#if groups.length > 0}
    <ul class="groups">
      {#each groups as group (group.id)}
        <li>
          <div>
            <strong>{group.name}</strong>
            <span class="muted small">
              {#if group.members.length === 0}{t('groups.empty')}{:else}{group.members.map((m) => m.name).join(', ')}{/if}
            </span>
          </div>
          <div class="row">
            <button class="btn btn-sm" type="button" onclick={() => start(group)}>{t('common.edit')}</button>
            <button class="btn btn-sm" class:btn-danger={confirming === group.id} type="button" onclick={() => remove(group)}>
              {confirming === group.id ? t('groups.deleteConfirm') : t('common.delete')}
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {:else if editing === null}
    <p class="muted">{t('groups.none')}</p>
  {/if}

  {#if editing === null}
    <div><button class="btn btn-sm" type="button" onclick={() => start(null)}>{t('groups.new')}</button></div>
  {:else}
    <form class="stack form" onsubmit={save}>
      <div class="field">
        <label for={`group-name-${clientId}`}>{t('groups.name')}</label>
        <input id={`group-name-${clientId}`} type="text" required maxlength="80" placeholder={t('groups.namePlaceholder')} bind:value={name} />
      </div>
      <fieldset>
        <legend class="label">{t('groups.who')}</legend>
        {#if candidates === null}
          <p class="muted small">{t('common.loading')}</p>
        {:else if choices.length === 0}
          <p class="muted small">{t('groups.noCandidates')}</p>
        {:else}
          <div class="choices">
            {#each choices as c (c.id)}
              <label class="check">
                <input type="checkbox" value={c.id} bind:group={chosen} />
                <span>{c.name}</span>
                <span class="muted small">
                  {t('common.photos', { count: c.photos })}{c.isChild ? ` · ${t('peoplePage.child')}` : ''}{c.hidden ? ` · ${t('peoplePage.hiddenBadge')}` : ''}
                </span>
              </label>
            {/each}
          </div>
        {/if}
      </fieldset>
      {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
      <div class="row">
        <button class="btn btn-primary" type="submit" disabled={busy || !name.trim()}>{editing === 'new' ? t('groups.make') : t('common.save')}</button>
        <button class="btn" type="button" onclick={() => (editing = null)}>{t('common.cancel')}</button>
      </div>
    </form>
  {/if}
  {#if error && editing === null}<div class="alert alert-error" role="alert">{error}</div>{/if}
</div>

<style>
  .small {
    font-size: 0.85rem;
  }
  .groups {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .groups li {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-top: 1px solid var(--border);
  }
  .groups li > div:first-child {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .form {
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 6px;
  }
  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 4px 16px;
    max-height: 320px;
    overflow-y: auto;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-size: 0.9rem;
    font-weight: 400;
    color: var(--text);
  }
</style>

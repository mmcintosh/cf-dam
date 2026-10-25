<script lang="ts">
  /** A person's name, notes and child flag; merging into someone else; deleting (every tag of them goes). */
  import { t } from '@cf-dam/i18n/client'
  import type { PersonJson } from '@cf-dam/api'
  import { api } from '../lib/auth-client'

  let { person, others, canManage }: { person: PersonJson; others: { id: number; name: string }[]; canManage: boolean } = $props()

  // svelte-ignore state_referenced_locally
  let form = $state({ name: person.name, notes: person.notes, isChild: person.isChild })
  let into = $state('')
  let busy = $state(false)
  let saved = $state(false)
  let error = $state('')
  let confirming = $state(false)

  async function save(event: SubmitEvent) {
    event.preventDefault()
    busy = true
    saved = false
    error = ''
    try {
      await api(`/api/people/${person.id}`, { method: 'PATCH', body: JSON.stringify(form) })
      saved = true
      if (form.name !== person.name) location.reload()
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }

  async function merge() {
    if (!into) return
    error = ''
    try {
      await api(`/api/people/${person.id}/merge`, { method: 'POST', body: JSON.stringify({ into: Number(into) }) })
      location.href = `/people/${into}`
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    }
  }

  async function remove() {
    if (!confirming) {
      confirming = true
      setTimeout(() => (confirming = false), 4000)
      return
    }
    try {
      await api(`/api/people/${person.id}`, { method: 'DELETE' })
      location.href = '/people'
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    }
  }
</script>

{#if canManage}
  <form class="stack" onsubmit={save} oninput={() => (saved = false)}>
    <div class="field">
      <label for="pd-name">{t('common.name')}</label>
      <input id="pd-name" type="text" required maxlength="120" bind:value={form.name} />
    </div>
    <div class="field">
      <label for="pd-notes">{t('clientsPage.notes')}</label>
      <textarea id="pd-notes" rows="3" maxlength="5000" bind:value={form.notes}></textarea>
    </div>
    <label class="row check"><input type="checkbox" bind:checked={form.isChild} /> {t('peoplePage.isChild')}</label>
    <div class="row actions">
      <button class="btn btn-primary" type="submit" disabled={busy || !form.name.trim()}>{t('common.save')}</button>
      {#if saved}<span class="muted small" role="status">{t('common.saved')}</span>{/if}
    </div>
  </form>

  {#if others.length > 0}
    <div class="row actions merge">
      <label for="pd-into" class="small">{t('peoplePage.mergeInto')}</label>
      <select id="pd-into" bind:value={into}>
        <option value="">{t('peoplePage.choose')}</option>
        {#each others as o (o.id)}<option value={String(o.id)}>{o.name}</option>{/each}
      </select>
      <button class="btn btn-sm" type="button" disabled={!into} onclick={merge}>{t('peoplePage.merge')}</button>
    </div>
    <p class="muted small">{t('peoplePage.mergeLead')}</p>
  {/if}

  <div class="row actions">
    <button class="btn" class:btn-danger={confirming} type="button" onclick={remove}>{confirming ? t('peoplePage.deleteConfirm', { count: person.photos }) : t('peoplePage.delete')}</button>
  </div>
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
{:else}
  {#if person.notes}<p>{person.notes}</p>{/if}
  {#if person.isChild}<p class="muted">{t('peoplePage.child')}</p>{/if}
{/if}

<style>
  .check,
  .actions {
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .merge {
    margin-top: 20px;
  }
  textarea {
    width: 100%;
    resize: vertical;
  }
  .small {
    font-size: 0.85rem;
  }
</style>

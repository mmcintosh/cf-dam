<script lang="ts">
  /** A job's details on its page, and deleting the job (its albums and galleries stay). */
  import { t } from '@cf-dam/i18n/client'
  import type { MessageKey } from '@cf-dam/i18n'
  import type { JobJson } from '@cf-dam/api'
  import { api } from '../lib/auth-client'

  const KINDS = ['wedding', 'portrait', 'family', 'event', 'commercial', 'editorial', 'other'] as const

  let { job, clients }: { job: JobJson; clients: { id: string; name: string }[] } = $props()

  // svelte-ignore state_referenced_locally
  let form = $state({
    title: job.title,
    clientTitle: job.clientTitle,
    clientId: job.client.id,
    kind: job.kind as string,
    kindOther: job.kindOther,
    shootStart: job.shootStart ?? '',
    shootEnd: job.shootEnd ?? '',
    place: job.place,
    dueOn: job.dueOn ?? '',
    notes: job.notes,
  })
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
      await api(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...form, shootStart: form.shootStart || null, shootEnd: form.shootEnd || null, dueOn: form.dueOn || null }),
      })
      saved = true
      if (form.title !== job.title || form.clientId !== job.client.id) location.reload()
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }

  async function remove() {
    if (!confirming) {
      confirming = true
      setTimeout(() => (confirming = false), 4000)
      return
    }
    try {
      await api(`/api/jobs/${job.id}`, { method: 'DELETE' })
      location.href = '/jobs'
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    }
  }
</script>

<form class="stack" onsubmit={save} oninput={() => (saved = false)}>
  <div class="grid">
    <div class="field">
      <label for="jd-title">{t('jobs.title')}</label>
      <input id="jd-title" type="text" required maxlength="200" bind:value={form.title} />
    </div>
    <div class="field">
      <label for="jd-client-title">{t('jobs.clientTitle')}</label>
      <input id="jd-client-title" type="text" maxlength="200" placeholder={t('jobs.clientTitlePlaceholder')} bind:value={form.clientTitle} />
    </div>
    <div class="field">
      <label for="jd-client">{t('jobs.client')}</label>
      <select id="jd-client" bind:value={form.clientId}>
        {#each clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="jd-kind">{t('jobs.kind')}</label>
      <select id="jd-kind" bind:value={form.kind}>
        {#each KINDS as k (k)}<option value={k}>{t((k === 'other' ? 'job.kind.misc' : `job.kind.${k}`) as MessageKey)}</option>{/each}
      </select>
    </div>
    {#if form.kind === 'other'}
      <div class="field">
        <label for="jd-kind-other">{t('jobs.kindOther')}</label>
        <input id="jd-kind-other" type="text" maxlength="100" bind:value={form.kindOther} />
      </div>
    {/if}
    <div class="field">
      <label for="jd-start">{t('jobs.shootStart')}</label>
      <input id="jd-start" type="date" bind:value={form.shootStart} />
    </div>
    <div class="field">
      <label for="jd-end">{t('jobs.shootEnd')}</label>
      <input id="jd-end" type="date" min={form.shootStart || undefined} bind:value={form.shootEnd} />
    </div>
    <div class="field">
      <label for="jd-place">{t('jobs.place')}</label>
      <input id="jd-place" type="text" maxlength="300" bind:value={form.place} />
    </div>
    <div class="field">
      <label for="jd-due">{t('jobs.dueOn')}</label>
      <input id="jd-due" type="date" bind:value={form.dueOn} />
    </div>
    <div class="field wide">
      <label for="jd-notes">{t('clientsPage.notes')}</label>
      <textarea id="jd-notes" rows="4" maxlength="10000" bind:value={form.notes}></textarea>
    </div>
  </div>
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
  <div class="row actions">
    <button class="btn btn-primary" type="submit" disabled={busy || !form.title.trim()}>{t('common.save')}</button>
    {#if saved}<span class="muted small" role="status">{t('common.saved')}</span>{/if}
    <span class="spacer"></span>
    <button class="btn" class:btn-danger={confirming} type="button" title={t('jobs.deleteTitle')} onclick={remove}>{confirming ? t('jobs.deleteConfirm') : t('jobs.delete')}</button>
  </div>
</form>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px 16px;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .actions {
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
  }
  .spacer {
    flex: 1;
  }
  .small {
    font-size: 0.85rem;
  }
</style>

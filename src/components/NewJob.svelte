<script lang="ts">
  /**
   * The New job form. From the Library ("New job from these photos") it carries the Library's filter, fills in the
   * shoot dates from the photos and offers to put them in the job's first album; from a client's page the client
   * is chosen already. A new client can be made here by name.
   */
  import { format, t } from '@cf-dam/i18n/client'
  import type { MessageKey } from '@cf-dam/i18n'
  import { api } from '../lib/auth-client'

  const KINDS = ['wedding', 'portrait', 'family', 'event', 'commercial', 'editorial', 'other'] as const
  const FIRST_STAGES = ['booked', 'shot', 'editing', 'proofing', 'final_edits', 'delivered', 'completed'] as const

  let {
    clients,
    clientId = '',
    from = '',
    summary = null,
  }: { clients: { id: string; name: string }[]; clientId?: string; from?: string; summary?: { photos: number; first: string | null; last: string | null } | null } = $props()

  // svelte-ignore state_referenced_locally
  let form = $state({
    clientId: clientId || (clients.length ? '' : 'new'),
    newClient: '',
    title: '',
    clientTitle: '',
    kind: 'wedding' as string,
    kindOther: '',
    shootStart: summary?.first ?? '',
    shootEnd: summary?.last && summary.last !== summary.first ? summary.last : '',
    place: '',
    dueOn: '',
    stage: from ? 'shot' : 'booked',
    album: Boolean(from && summary && summary.photos > 0),
  })
  let busy = $state(false)
  let error = $state('')
  const day = (d: string) => format().date(`${d}T12:00:00Z`)

  async function create(event: SubmitEvent) {
    event.preventDefault()
    busy = true
    error = ''
    try {
      const body: Record<string, unknown> = {
        title: form.title,
        clientTitle: form.clientTitle,
        kind: form.kind,
        kindOther: form.kindOther,
        shootStart: form.shootStart || null,
        shootEnd: form.shootEnd || null,
        place: form.place,
        dueOn: form.dueOn || null,
        stage: form.stage,
      }
      if (form.clientId === 'new') body.newClient = { name: form.newClient }
      else body.clientId = form.clientId
      if (form.album) body.photos = from ? { query: from } : 'dates'
      const { job } = await api<{ job: { id: string } }>('/api/jobs', { method: 'POST', body: JSON.stringify(body) })
      location.href = `/jobs/${encodeURIComponent(job.id)}`
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
      busy = false
    }
  }
</script>

<form class="card stack" onsubmit={create}>
  {#if from && summary}
    <p class="from">
      {#if summary.photos === 0}{t('jobs.fromNone')}
      {:else if summary.first && summary.last && summary.first !== summary.last}{t('jobs.fromRange', { count: summary.photos, first: day(summary.first), last: day(summary.last) })}
      {:else if summary.first}{t('jobs.fromDay', { count: summary.photos, day: day(summary.first) })}
      {:else}{t('jobs.fromUndated', { count: summary.photos })}{/if}
    </p>
  {/if}
  <div class="grid">
    <div class="field">
      <label for="nj-client">{t('jobs.client')}</label>
      <select id="nj-client" required bind:value={form.clientId}>
        <option value="" disabled>{t('jobs.chooseClient')}</option>
        {#each clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        <option value="new">{t('jobs.newClientOption')}</option>
      </select>
    </div>
    {#if form.clientId === 'new'}
      <div class="field">
        <label for="nj-new-client">{t('jobs.newClientName')}</label>
        <input id="nj-new-client" type="text" required maxlength="200" placeholder={t('clientsPage.namePlaceholder')} bind:value={form.newClient} />
      </div>
    {/if}
    <div class="field">
      <label for="nj-title">{t('jobs.title')}</label>
      <input id="nj-title" type="text" required maxlength="200" placeholder={t('jobs.titlePlaceholder')} bind:value={form.title} />
    </div>
    <div class="field">
      <label for="nj-client-title">{t('jobs.clientTitle')}</label>
      <input id="nj-client-title" type="text" maxlength="200" placeholder={t('jobs.clientTitlePlaceholder')} bind:value={form.clientTitle} />
    </div>
    <div class="field">
      <label for="nj-kind">{t('jobs.kind')}</label>
      <select id="nj-kind" bind:value={form.kind}>
        {#each KINDS as k (k)}<option value={k}>{t((k === 'other' ? 'job.kind.misc' : `job.kind.${k}`) as MessageKey)}</option>{/each}
      </select>
    </div>
    {#if form.kind === 'other'}
      <div class="field">
        <label for="nj-kind-other">{t('jobs.kindOther')}</label>
        <input id="nj-kind-other" type="text" maxlength="100" bind:value={form.kindOther} />
      </div>
    {/if}
    <div class="field">
      <label for="nj-start">{t('jobs.shootStart')}</label>
      <input id="nj-start" type="date" bind:value={form.shootStart} />
    </div>
    <div class="field">
      <label for="nj-end">{t('jobs.shootEnd')}</label>
      <input id="nj-end" type="date" min={form.shootStart || undefined} bind:value={form.shootEnd} />
    </div>
    <div class="field">
      <label for="nj-place">{t('jobs.place')}</label>
      <input id="nj-place" type="text" maxlength="300" bind:value={form.place} />
    </div>
    <div class="field">
      <label for="nj-due">{t('jobs.dueOn')}</label>
      <input id="nj-due" type="date" bind:value={form.dueOn} />
    </div>
    <div class="field">
      <label for="nj-stage">{t('jobs.stage')}</label>
      <select id="nj-stage" bind:value={form.stage}>
        {#each FIRST_STAGES as s (s)}<option value={s}>{t(`job.stage.${s}` as MessageKey)}</option>{/each}
      </select>
    </div>
  </div>
  {#if from}
    {#if summary && summary.photos > 0}
      <label class="check"><input type="checkbox" bind:checked={form.album} /> {t('jobs.albumOfThese', { count: summary.photos })}</label>
    {/if}
  {:else}
    <label class="check"><input type="checkbox" bind:checked={form.album} disabled={!form.shootStart} /> {t('jobs.albumOfDates')}</label>
  {/if}
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
  <div><button class="btn btn-primary" type="submit" disabled={busy || !form.title.trim() || !form.clientId}>{t('jobs.create')}</button></div>
</form>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px 16px;
  }
  .from {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
</style>

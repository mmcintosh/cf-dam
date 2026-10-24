<script lang="ts">
  /**
   * Where a job's originals are (catalog/job-storage.ts): readable now, needing a restore, only on a NAS, and with a
   * cold backup; and restoring the whole job, with what it costs first and its progress after.
   */
  import { format, t } from '@cf-dam/i18n/client'
  import { onDestroy } from 'svelte'
  import { api } from '../lib/auth-client'

  interface Storage {
    photos: number
    readable: number
    offerable: number
    nasOnly: number
    needsRestore: number
    restoring: number
    restoreBytes: number
    coldBackup: number
  }
  interface Restore {
    tier: string
    days: number
    createdAt: string
    photos: number
    waiting: number
    asked: number
    ready: number
    failed: number
    readyUntil: string | null
  }
  interface Estimate {
    photos: number
    bytes: number
    retrieval: number
    keeping: number
    downloading: number
    hours: [number, number]
  }

  let { jobId, initial, initialRestore, canRestore }: { jobId: string; initial: Storage; initialRestore: Restore | null; canRestore: boolean } = $props()

  // svelte-ignore state_referenced_locally
  let storage = $state<Storage>(initial)
  // svelte-ignore state_referenced_locally
  let restore = $state<Restore | null>(initialRestore)
  let open = $state(false)
  let tier = $state<'Bulk' | 'Standard'>('Bulk')
  let days = $state(7)
  let estimate = $state<Estimate | null>(null)
  let busy = $state(false)
  let error = $state('')

  const n = (v: number) => format().number(v)
  const money = (v: number) => format().number(v, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 3 : 2 })
  const toRestore = $derived(storage.needsRestore - storage.restoring)
  const running = $derived(restore !== null && (restore.waiting > 0 || restore.ready < restore.asked))

  async function refresh() {
    const result = await api<{ storage: Storage; restore: Restore | null }>(`/api/jobs/${jobId}/storage`)
    storage = result.storage
    restore = result.restore
  }
  // While a restore is under way, keep up with it.
  const timer = setInterval(() => running && refresh().catch(() => {}), 60_000)
  onDestroy(() => clearInterval(timer))

  async function price() {
    error = ''
    estimate = null
    try {
      estimate = (await api<{ estimate: Estimate }>(`/api/jobs/${jobId}/restore-estimate?tier=${tier}&days=${days}`)).estimate
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotLoad')
    }
  }

  async function start() {
    busy = true
    error = ''
    try {
      await api(`/api/jobs/${jobId}/restore`, { method: 'POST', body: JSON.stringify({ tier, days }) })
      open = false
      estimate = null
      await refresh()
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }
</script>

<div class="stack">
  {#if storage.photos === 0}
    <p class="muted">{t('jobStorage.none')}</p>
  {:else}
    <ul class="lines">
      <li class:ok={storage.readable === storage.photos}>{t('jobStorage.readable', { count: storage.readable, total: n(storage.photos) })}</li>
      {#if storage.needsRestore > 0}
        <li class="warn">{t('jobStorage.needsRestore', { count: storage.needsRestore, size: format().bytes(storage.restoreBytes) })}{#if storage.restoring > 0} · {t('jobStorage.restoring', { count: storage.restoring })}{/if}</li>
      {/if}
      {#if storage.nasOnly > 0}<li class="muted">{t('jobStorage.nasOnly', { count: storage.nasOnly })}</li>{/if}
      <li class:ok={storage.coldBackup === storage.photos}>{t('jobStorage.cold', { count: storage.coldBackup, total: n(storage.photos) })}</li>
    </ul>
  {/if}

  {#if restore}
    <p class="small" role="status">
      {t('jobStorage.restoreStatus', { date: format().dateTime(restore.createdAt), asked: n(restore.asked), total: n(restore.photos), ready: n(restore.ready) })}
      {#if restore.failed > 0}<span class="warn"> · {t('jobStorage.restoreFailed', { count: restore.failed })}</span>{/if}
      {#if restore.readyUntil}<span> · {t('jobStorage.readyUntil', { date: format().dateTime(restore.readyUntil) })}</span>{/if}
    </p>
  {/if}

  {#if toRestore > 0 && canRestore}
    {#if !open}
      <div><button class="btn" type="button" onclick={() => (open = true)}>{t('jobStorage.restore', { count: toRestore })}</button></div>
    {:else}
      <div class="restore stack">
        <div class="row choices">
          <div class="field">
            <label for="jr-tier">{t('jobStorage.speed')}</label>
            <select id="jr-tier" bind:value={tier} onchange={() => (estimate = null)}>
              <option value="Bulk">{t('jobStorage.bulk')}</option>
              <option value="Standard">{t('jobStorage.standard')}</option>
            </select>
          </div>
          <div class="field">
            <label for="jr-days">{t('jobStorage.days')}</label>
            <input id="jr-days" type="number" min="1" max="30" bind:value={days} oninput={() => (estimate = null)} />
          </div>
          <button class="btn" type="button" onclick={price}>{t('jobStorage.seeCost')}</button>
        </div>
        {#if estimate}
          <div class="estimate">
            <p>{t('jobStorage.estimate', { count: estimate.photos, size: format().bytes(estimate.bytes), hours: n(estimate.hours[1]) })}</p>
            <ul class="small">
              <li>{t('jobStorage.costRetrieval', { cost: money(estimate.retrieval) })}</li>
              <li>{t('jobStorage.costKeeping', { cost: money(estimate.keeping), days: n(days) })}</li>
              <li>{t('jobStorage.costDownloading', { cost: money(estimate.downloading) })}</li>
            </ul>
            <p class="muted small">{t('jobStorage.costNote')}</p>
          </div>
          <div class="row buttons">
            <button class="btn btn-primary" type="button" disabled={busy || estimate.photos === 0} onclick={start}>{t('jobStorage.confirm', { count: estimate.photos })}</button>
            <button class="btn" type="button" onclick={() => ((open = false), (estimate = null))}>{t('common.cancel')}</button>
          </div>
        {/if}
      </div>
    {/if}
  {:else if toRestore > 0}
    <p class="muted small">{t('jobStorage.askAdmin')}</p>
  {/if}
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
</div>

<style>
  .lines {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 4px;
  }
  .ok {
    color: var(--success, var(--text));
  }
  .warn {
    color: var(--danger);
  }
  .small {
    font-size: 0.85rem;
  }
  .restore {
    padding: 12px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }
  .choices,
  .buttons {
    gap: 12px;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .choices input {
    max-width: 100px;
  }
  .estimate p {
    margin: 0 0 4px;
  }
  .estimate ul {
    margin: 0 0 4px;
    padding-left: 18px;
  }
</style>

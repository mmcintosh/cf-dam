<script lang="ts">
  /**
   * A job's archive (catalog/archive-jobs.ts): when its originals get their cold copy, how far that has got, Keep hot,
   * and Archive now (with a class) for those who manage storage connections.
   */
  import { format, t } from '@cf-dam/i18n/client'
  import { onDestroy } from 'svelte'
  import { api } from '../lib/auth-client'

  interface Archive {
    keepHot: boolean
    state: string | null
    note: { copy: number; move: number; nas: number; bytes: number } | null
    archivedAt: string | null
    dueAt: string | null
    done: number
    waiting: number
    failed: number
    error: string | null
  }

  let { jobId, initial, canArchive }: { jobId: string; initial: Archive; canArchive: boolean } = $props()

  // svelte-ignore state_referenced_locally
  let archive = $state<Archive>(initial)
  let storageClass = $state<'DEEP_ARCHIVE' | 'GLACIER' | 'GLACIER_IR'>('DEEP_ARCHIVE')
  let busy = $state(false)
  let error = $state('')

  const day = (iso: string) => format().date(iso)
  const timer = setInterval(() => archive.state === 'queued' && refresh().catch(() => {}), 30_000)
  onDestroy(() => clearInterval(timer))

  async function refresh() {
    archive = (await api<{ archive: Archive }>(`/api/jobs/${jobId}/archive`)).archive
  }

  async function keepHot(value: boolean) {
    error = ''
    try {
      archive = (await api<{ archive: Archive }>(`/api/jobs/${jobId}/keep-hot`, { method: 'POST', body: JSON.stringify({ keepHot: value }) })).archive
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    }
  }

  async function now() {
    busy = true
    error = ''
    try {
      archive = (await api<{ archive: Archive }>(`/api/jobs/${jobId}/archive-now`, { method: 'POST', body: JSON.stringify({ storageClass }) })).archive
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }
</script>

<div class="stack">
  <p class="line" role="status">
    {#if archive.keepHot}{t('jobArchive.keptHot')}
    {:else if archive.state === 'queued'}{t('jobArchive.copying', { done: archive.done, total: archive.done + archive.waiting + archive.failed })}
    {:else if archive.state === 'done'}{t('jobArchive.done', { date: archive.archivedAt ? day(archive.archivedAt) : '' })}
    {:else if archive.state === 'blocked'}{t('jobArchive.blocked', { count: archive.note?.nas ?? 0 })} <a href="/sources">{t('nav.sources')}</a>
    {:else if archive.state === 'failed'}<span class="warn">{t('jobArchive.failed', { count: archive.failed, error: archive.error ?? '' })}</span>
    {:else if archive.dueAt}{t('jobArchive.due', { date: day(archive.dueAt) })}
    {:else}{t('jobArchive.notDue')}{/if}
  </p>
  <label class="check"><input type="checkbox" checked={archive.keepHot} onchange={(e) => keepHot(e.currentTarget.checked)} /> {t('jobArchive.keepHot')}</label>
  <p class="muted small">{t('jobArchive.keepHotLead')}</p>
  {#if canArchive && !archive.keepHot && archive.state !== 'queued'}
    <div class="row now">
      <select aria-label={t('archiveJobs.class')} bind:value={storageClass}>
        <option value="DEEP_ARCHIVE">{t('storageClass.DEEP_ARCHIVE')}</option>
        <option value="GLACIER">{t('storageClass.GLACIER')}</option>
        <option value="GLACIER_IR">{t('storageClass.GLACIER_IR')}</option>
      </select>
      <button class="btn btn-sm" type="button" disabled={busy} onclick={now}>{t('jobArchive.now')}</button>
    </div>
  {/if}
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
</div>

<style>
  .line {
    margin: 0;
  }
  .warn {
    color: var(--danger);
  }
  .small {
    font-size: 0.85rem;
  }
  .now {
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .now select {
    width: auto;
  }
</style>

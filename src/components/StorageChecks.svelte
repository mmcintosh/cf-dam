<script lang="ts">
  import { format, t } from '@cf-dam/i18n/client'
  import type { MessageKey } from '@cf-dam/i18n'
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'

  interface Problem {
    assetId: string
    filename: string
    connectionId: string
    connectionName: string | null
    key: string
    result: 'missing' | 'changed' | 'unreadable'
    detail: string | null
    checkedAt: string
  }
  interface Checks {
    cycleDays: number
    totals: { ok: number; missing: number; changed: number; unreadable: number; unchecked: number }
    lastCheckedAt: string | null
    problems: Problem[]
  }

  const RESULT: Record<Problem['result'], MessageKey> = { missing: 'checks.result.missing', changed: 'checks.result.changed', unreadable: 'checks.result.unreadable' }

  let checks = $state<Checks | null>(null)
  let error = $state('')
  let requeued = $state<Set<string>>(new Set())

  const fmt = (iso: string | null) => (iso ? format().dateTime(iso) : t('checks.notYet'))
  const n = (value: number) => format().number(value)
  const problems = $derived(checks ? checks.totals.missing + checks.totals.changed + checks.totals.unreadable : 0)

  async function load() {
    try {
      checks = await api<Checks>('/api/storage-checks')
    } catch (e) {
      error = e instanceof Error ? e.message : t('checks.loadFailed')
    }
  }
  onMount(load)

  async function recheck(p: Problem) {
    await api('/api/storage-checks/recheck', { method: 'POST', body: JSON.stringify({ assetId: p.assetId, connectionId: p.connectionId }) })
    requeued = new Set([...requeued, `${p.assetId}:${p.connectionId}`])
  }
</script>

<section class="card stack">
  <div>
    <h2>{t('checks.title')}</h2>
    <p class="muted">{t('checks.lead', { days: checks?.cycleDays ?? 30 })}</p>
  </div>

  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}

  {#if checks}
    <div class="totals">
      <div><strong>{n(checks.totals.ok)}</strong><span class="muted">{t('checks.fine')}</span></div>
      <div class:bad={problems > 0}><strong>{n(problems)}</strong><span class="muted">{t('checks.problems', { count: problems })}</span></div>
      <div><strong>{n(checks.totals.unchecked)}</strong><span class="muted">{t('checks.unchecked')}</span></div>
      <div><strong class="when">{fmt(checks.lastCheckedAt)}</strong><span class="muted">{t('checks.last')}</span></div>
    </div>

    {#if checks.problems.length > 0}
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>{t('common.photo')}</th><th>{t('common.where')}</th><th>{t('checks.what')}</th><th>{t('checks.checked')}</th><th></th></tr></thead>
          <tbody>
            {#each checks.problems as p (`${p.assetId}:${p.connectionId}`)}
              <tr>
                <td><a href={`/assets/${p.assetId}`}>{p.filename}</a></td>
                <td class="where"><span>{p.connectionName ?? t('common.removedConnection')}</span><span class="muted mono">{p.key}</span></td>
                <td><span class="badge badge-warn">{t(RESULT[p.result])}</span> <span class="muted">{p.detail}</span></td>
                <td class="muted">{fmt(p.checkedAt)}</td>
                <td class="end">
                  {#if requeued.has(`${p.assetId}:${p.connectionId}`)}
                    <span class="muted small">{t('checks.withinMinute')}</span>
                  {:else}
                    <button class="btn btn-sm" onclick={() => recheck(p)}>{t('checks.again')}</button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</section>

<style>
  .totals {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
  }
  .totals > div {
    display: grid;
    gap: 2px;
  }
  .totals strong {
    font-size: 1.4rem;
    font-variant-numeric: tabular-nums;
  }
  .totals strong.when {
    font-size: 1rem;
  }
  .bad strong {
    color: var(--danger);
  }
  .table-wrap {
    overflow-x: auto;
  }
  .where {
    display: grid;
    max-width: 320px;
  }
  .mono {
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }
  .badge-warn {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 45%, transparent);
  }
  .end {
    text-align: right;
    white-space: nowrap;
  }
  .small {
    font-size: 0.8rem;
  }
</style>

<script lang="ts">
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

  const RESULT: Record<Problem['result'], string> = { missing: 'Missing', changed: 'Changed', unreadable: "Couldn't check" }

  let checks = $state<Checks | null>(null)
  let error = $state('')
  let requeued = $state<Set<string>>(new Set())

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'not yet')
  const n = (value: number) => value.toLocaleString()
  const problems = $derived(checks ? checks.totals.missing + checks.totals.changed + checks.totals.unreadable : 0)

  async function load() {
    try {
      checks = await api<Checks>('/api/storage-checks')
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not load the checks.'
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
    <h2>Checks</h2>
    <p class="muted">
      Every original outside a NAS is checked once every {checks?.cycleDays ?? 30} days: still there, the same size, the same file. Originals in the
      built-in R2 bucket are also read back and compared with what was uploaded. Originals on a NAS are checked by its agent on each scan.
    </p>
  </div>

  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}

  {#if checks}
    <div class="totals">
      <div><strong>{n(checks.totals.ok)}</strong><span class="muted">fine</span></div>
      <div class:bad={problems > 0}><strong>{n(problems)}</strong><span class="muted">{problems === 1 ? 'problem' : 'problems'}</span></div>
      <div><strong>{n(checks.totals.unchecked)}</strong><span class="muted">not checked yet</span></div>
      <div><strong class="when">{fmt(checks.lastCheckedAt)}</strong><span class="muted">last check</span></div>
    </div>

    {#if checks.problems.length > 0}
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Photo</th><th>Where</th><th>What</th><th>Checked</th><th></th></tr></thead>
          <tbody>
            {#each checks.problems as p (`${p.assetId}:${p.connectionId}`)}
              <tr>
                <td><a href={`/assets/${p.assetId}`}>{p.filename}</a></td>
                <td class="where"><span>{p.connectionName ?? 'A removed connection'}</span><span class="muted mono">{p.key}</span></td>
                <td><span class="badge badge-warn">{RESULT[p.result]}</span> <span class="muted">{p.detail}</span></td>
                <td class="muted">{fmt(p.checkedAt)}</td>
                <td class="end">
                  {#if requeued.has(`${p.assetId}:${p.connectionId}`)}
                    <span class="muted small">Within a minute</span>
                  {:else}
                    <button class="btn btn-sm" onclick={() => recheck(p)}>Check again</button>
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

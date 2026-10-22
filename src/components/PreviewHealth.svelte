<script lang="ts">
  /** Missing previews: a check of every one, and photos waiting for theirs to be made again. */
  import { onDestroy, onMount } from 'svelte'
  import { api } from '../lib/auth-client'

  type Route = 'agent' | 'worker' | 'archived' | 'unreadable'
  interface Status {
    check: { startedAt: string; checked: number; missing: number } | null
    waiting: Record<Route, number>
    stuck: { assetId: string; filename: string; route: Route; error: string | null }[]
  }

  let status = $state<Status | null>(null)
  let error = $state('')
  let busy = $state(false)

  const n = (value: number) => value.toLocaleString()
  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const stuck = $derived(status ? status.waiting.archived + status.waiting.unreadable : 0)
  const busyMaking = $derived(status ? status.waiting.agent + status.waiting.worker : 0)

  async function load() {
    try {
      status = await api<Status>('/api/previews')
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not load the previews.'
    }
  }

  async function act(path: string) {
    error = ''
    busy = true
    try {
      status = await api<Status>(path, { method: 'POST' })
    } catch (e) {
      error = e instanceof Error ? e.message : 'That didn’t work.'
    } finally {
      busy = false
    }
  }

  onMount(load)
  // While something is happening, keep up with it.
  const timer = setInterval(() => (status?.check || busyMaking > 0) && load(), 15_000)
  onDestroy(() => clearInterval(timer))
</script>

<section class="card stack">
  <div>
    <h2>Previews</h2>
    <p class="muted">
      Thumbnails and previews are kept in the built-in R2 bucket and aren’t in backups. After a restore into a new account, or if any go missing,
      they’re made again: by each photo’s helper from its computer or NAS, or here from the original.
    </p>
  </div>

  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}

  {#if status}
    <div class="totals">
      <div><strong>{n(status.waiting.agent)}</strong><span class="muted">waiting for their agent</span></div>
      <div><strong>{n(status.waiting.worker)}</strong><span class="muted">being made here</span></div>
      <div class:bad={stuck > 0}><strong>{n(stuck)}</strong><span class="muted">can’t be made yet</span></div>
    </div>

    {#if status.check}
      <p>Checking every preview: {n(status.check.checked)} so far, {n(status.check.missing)} missing. Started {fmt(status.check.startedAt)}.</p>
    {:else}
      <div class="row">
        <button class="btn btn-sm" type="button" disabled={busy} onclick={() => act('/api/previews/check')}>Check every preview</button>
        {#if stuck > 0}<button class="btn btn-sm" type="button" disabled={busy} onclick={() => act('/api/previews/retry')}>Try the stuck ones again</button>{/if}
      </div>
      <p class="muted small">A check asks R2 about each preview; at a million photos it takes some hours, and costs well under a dollar.</p>
    {/if}

    {#if status.stuck.length > 0}
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Photo</th><th>Why</th></tr></thead>
          <tbody>
            {#each status.stuck as s (s.assetId)}
              <tr><td><a href={`/assets/${s.assetId}`}>{s.filename}</a></td><td class="muted">{s.error}</td></tr>
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
  .bad strong {
    color: var(--danger);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .table-wrap {
    overflow-x: auto;
  }
  .small {
    font-size: 0.8rem;
  }
  p {
    margin: 0;
  }
</style>

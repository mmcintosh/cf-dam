<script lang="ts">
  /** Alerts: what needs someone now, what was dismissed, and what was put right lately. */
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'

  interface Alert {
    id: string
    kind: string
    message: string
    link: string | null
    openedAt: string
    seenAt: string
    dismissedAt: string | null
    dismissedBy: string | null
    resolvedAt: string | null
  }

  let open = $state<Alert[]>([])
  let resolved = $state<Alert[]>([])
  let stalledSince = $state<string | null>(null)
  let loading = $state(true)
  let error = $state('')
  let busy = $state<string | null>(null)

  const active = $derived(open.filter((a) => !a.dismissedAt))
  const dismissed = $derived(open.filter((a) => a.dismissedAt))
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const LINKS: Record<string, string> = { '/sources': 'NAS agents', '/settings/storage': 'Storage' }

  async function load() {
    error = ''
    try {
      const data = await api<{ open: Alert[]; resolved: Alert[]; sweepStalledSince: string | null }>('/api/alerts')
      open = data.open
      resolved = data.resolved
      stalledSince = data.sweepStalledSince
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not load the alerts.'
    } finally {
      loading = false
    }
  }

  async function act(alert: Alert, action: 'dismiss' | 'restore') {
    busy = alert.id
    error = ''
    try {
      await api(`/api/alerts/${alert.id}/${action}`, { method: 'POST' })
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not change the alert.'
    } finally {
      busy = null
    }
  }

  onMount(load)
</script>

<div class="stack">
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}

  {#if stalledSince}
    <section class="card problem">
      <p class="what">Background work hasn’t run since {when(stalledSince)}: new photos aren’t being processed, and nothing is being checked or backed up.</p>
      <p class="muted small">It runs every minute on Cloudflare. Look for errors in the Worker’s logs in the Cloudflare dashboard, or deploy again.</p>
    </section>
  {/if}

  {#if !loading && active.length === 0 && !stalledSince}
    <section class="card"><p class="muted">Nothing needs anyone right now. Problems are looked for every five minutes.</p></section>
  {/if}

  {#each active as alert (alert.id)}
    <section class="card problem">
      <p class="what">{alert.message}</p>
      <p class="muted small">Since {when(alert.openedAt)}{alert.seenAt !== alert.openedAt ? `, still so at ${when(alert.seenAt)}` : ''}.</p>
      <div class="row">
        {#if alert.link}<a class="btn btn-sm" href={alert.link}>Go to {LINKS[alert.link] ?? 'the page'}</a>{/if}
        <button class="btn btn-sm" type="button" disabled={busy === alert.id} onclick={() => act(alert, 'dismiss')}>Dismiss</button>
      </div>
    </section>
  {/each}

  {#if dismissed.length > 0}
    <section class="card">
      <h2>Dismissed, still there</h2>
      <p class="muted small">Out of the count until they’re put right. They count again if they come back after that.</p>
      <ul>
        {#each dismissed as alert (alert.id)}
          <li>
            <span class="what">{alert.message}</span>
            <span class="muted small">Dismissed {when(alert.dismissedAt!)}{alert.dismissedBy ? ` by ${alert.dismissedBy}` : ''}</span>
            <button class="btn btn-sm" type="button" disabled={busy === alert.id} onclick={() => act(alert, 'restore')}>Count it again</button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if resolved.length > 0}
    <section class="card">
      <h2>Put right in the last two weeks</h2>
      <ul>
        {#each resolved as alert (alert.id)}
          <li>
            <span class="what">{alert.message}</span>
            <span class="muted small">{when(alert.openedAt)} to {when(alert.resolvedAt!)}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .problem {
    display: grid;
    gap: 8px;
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  }
  .problem .what {
    font-weight: 550;
  }
  p {
    margin: 0;
  }
  h2 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin: 0 0 8px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 12px;
    align-items: baseline;
    padding: 7px 0;
    border-bottom: 1px solid var(--border);
  }
  li:last-child {
    border-bottom: 0;
  }
  .what {
    overflow-wrap: anywhere;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .small {
    font-size: 0.8rem;
  }
  @media (max-width: 560px) {
    li {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>

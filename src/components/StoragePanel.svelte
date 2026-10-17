<script lang="ts">
  import { api } from '../lib/auth-client'

  interface Location {
    connectionId: string
    connectionName: string
    storageClass: string
    state: string
    archived: boolean
    restoreExpiresAt: string | null
    offeredClasses: string[]
    /** Set when the original is on a NAS, indexed in place by an agent. */
    nasPath: string | null
  }
  interface Props {
    assetId: string
    location: Location | null
    canManage: boolean
  }
  let { assetId, location: initial, canManage }: Props = $props()

  let location = $state(initial)
  let target = $state(initial?.storageClass ?? 'STANDARD')
  let days = $state(7)
  let tier = $state<'Expedited' | 'Standard' | 'Bulk'>('Standard')
  let busy = $state(false)
  let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const LABELS: Record<string, string> = {
    STANDARD: 'Standard',
    INTELLIGENT_TIERING: 'Intelligent-Tiering',
    STANDARD_IA: 'Infrequent Access',
    ONEZONE_IA: 'One Zone-IA',
    GLACIER_IR: 'Glacier Instant Retrieval',
    GLACIER: 'Glacier Flexible Retrieval',
    DEEP_ARCHIVE: 'Glacier Deep Archive',
    NAS: 'On the NAS (indexed in place)',
  }
  const TIER_NOTES: Record<string, string> = {
    Expedited: 'minutes (Flexible only; extra cost)',
    Standard: 'Flexible 3–5 h, Deep Archive within 12 h',
    Bulk: 'cheapest: Flexible 5–12 h, Deep Archive within 48 h',
  }

  async function act(run: () => Promise<string>) {
    busy = true
    message = null
    try {
      message = { kind: 'ok', text: await run() }
    } catch (e) {
      message = { kind: 'error', text: e instanceof Error ? e.message : 'That did not work.' }
    } finally {
      busy = false
    }
  }

  const changeClass = () =>
    act(async () => {
      const result = await api<{ storageClass: string; state: string }>(`/api/assets/${assetId}/storage-class`, {
        method: 'POST',
        body: JSON.stringify({ storageClass: target }),
      })
      location = { ...location!, storageClass: result.storageClass, state: result.state, archived: result.state === 'archived' }
      return `Moved to ${LABELS[result.storageClass] ?? result.storageClass}.`
    })

  const restore = () =>
    act(async () => {
      const result = await api<{ result: string }>(`/api/assets/${assetId}/restore`, { method: 'POST', body: JSON.stringify({ days, tier }) })
      location = { ...location!, state: 'restoring' }
      return result.result === 'already-restored'
        ? 'Already restored; the restore was extended.'
        : `Restore requested. Check back in a few hours; the copy stays available for ${days} days.`
    })

  const refresh = () =>
    act(async () => {
      const result = await api<{ state: string; storageClass: string; restoreExpiresAt: string | null }>(`/api/assets/${assetId}/refresh`, { method: 'POST' })
      location = { ...location!, state: result.state, storageClass: result.storageClass, restoreExpiresAt: result.restoreExpiresAt }
      return result.state === 'restored' ? 'Restored and ready to download.' : `Status: ${result.state}.`
    })
</script>

{#if location?.nasPath}
  <div class="stack">
    <dl class="facts">
      <dt>On</dt>
      <dd>{location.connectionName}</dd>
      <dt>Path</dt>
      <dd class="path">{location.nasPath}</dd>
      <dt>State</dt>
      <dd>{location.state === 'missing' ? 'Missing: not found in the last scan (moved or deleted on the NAS)' : 'Present'}</dd>
    </dl>
    <p class="muted small">The original stays on the NAS. cf-dam has its metadata and previews; lifecycle rules (Phase 6) will move originals to cloud storage.</p>
  </div>
{:else if location}
  <div class="stack">
    <dl class="facts">
      <dt>Stored in</dt>
      <dd>{location.connectionName}</dd>
      <dt>Class</dt>
      <dd>{LABELS[location.storageClass] ?? location.storageClass}</dd>
      <dt>State</dt>
      <dd>
        {location.state}{location.restoreExpiresAt ? ` until ${new Date(location.restoreExpiresAt).toLocaleDateString()}` : ''}
      </dd>
    </dl>

    <div class="row">
      {#if !location.archived || location.state === 'restored'}
        <a class="btn btn-primary" href={`/api/assets/${assetId}/original`}>Download original</a>
      {/if}
      <button class="btn" onclick={refresh} disabled={busy}>Check status</button>
    </div>

    {#if canManage && location.archived && location.state !== 'restored'}
      <div class="subpanel stack">
        <strong>Restore from deep storage</strong>
        <div class="row">
          <div class="field">
            <label for="tier">Speed</label>
            <select id="tier" bind:value={tier}>
              {#each ['Expedited', 'Standard', 'Bulk'] as t (t)}<option value={t}>{t}: {TIER_NOTES[t]}</option>{/each}
            </select>
          </div>
          <div class="field days">
            <label for="days">Keep restored for</label>
            <select id="days" bind:value={days}>
              {#each [1, 3, 7, 14, 30] as d (d)}<option value={d}>{d} day{d > 1 ? 's' : ''}</option>{/each}
            </select>
          </div>
        </div>
        <div><button class="btn btn-primary" onclick={restore} disabled={busy || location.state === 'restoring'}>Request restore</button></div>
      </div>
    {/if}

    {#if canManage && location.offeredClasses.length > 1}
      <div class="subpanel stack">
        <strong>Move to another class</strong>
        <div class="row">
          <select bind:value={target} aria-label="Target storage class">
            {#each location.offeredClasses as cls (cls)}<option value={cls}>{LABELS[cls] ?? cls}</option>{/each}
          </select>
          <button class="btn" onclick={changeClass} disabled={busy || target === location.storageClass}>Move</button>
        </div>
        <p class="muted note">S3 bills a minimum stay: 30 days for the IA classes, 90 for Glacier, 180 for Deep Archive.</p>
      </div>
    {/if}

    {#if message}
      <div class="alert" class:alert-error={message.kind === 'error'} class:alert-success={message.kind === 'ok'}>{message.text}</div>
    {/if}
  </div>
{:else}
  <p class="muted">No stored original.</p>
{/if}

<style>
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 16px;
    margin: 0;
    font-size: 0.9rem;
  }
  .facts dt {
    color: var(--text-muted);
  }
  .facts dd {
    margin: 0;
  }
  .subpanel {
    padding: 14px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    gap: 10px;
  }
  .subpanel .row > .field {
    flex: 1 1 200px;
  }
  .days {
    flex: 0 1 160px !important;
  }
  .row > select {
    flex: 1;
  }
  .note {
    margin: 0;
    font-size: 0.8rem;
  }
  .path {
    font-family: var(--mono);
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }
  .small {
    font-size: 0.8rem;
  }
</style>

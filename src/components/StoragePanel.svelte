<script lang="ts">
  import { format, t } from '@cf-dam/i18n/client'
  import type { MessageKey } from '@cf-dam/i18n'
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
    /** The agent folder it is in: a drive's name, and whether it is offline. */
    nasFolder?: { sourceName: string; root: { volume: { label: string | null } | null; offlineSince: string | null } } | null
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

  // AWS's own class names, except where a word describes them.
  const LABELS: Record<string, string> = {
    INTELLIGENT_TIERING: 'Intelligent-Tiering',
    ONEZONE_IA: 'One Zone-IA',
    GLACIER_IR: 'Glacier Instant Retrieval',
    GLACIER: 'Glacier Flexible Retrieval',
    DEEP_ARCHIVE: 'Glacier Deep Archive',
  }
  const LABEL_KEYS: Record<string, MessageKey> = { STANDARD: 'storage.cls.STANDARD', STANDARD_IA: 'storage.cls.STANDARD_IA', NAS: 'storage.cls.NAS' }
  const className = (cls: string) => (LABEL_KEYS[cls] ? t(LABEL_KEYS[cls]!) : (LABELS[cls] ?? cls))
  const TIERS: ['Expedited' | 'Standard' | 'Bulk', MessageKey][] = [
    ['Expedited', 'storage.tier.Expedited'],
    ['Standard', 'storage.tier.Standard'],
    ['Bulk', 'storage.tier.Bulk'],
  ]
  const STATES = new Set(['stored', 'archived', 'restoring', 'restored', 'pending', 'missing', 'gone'])
  const stateName = (state: string) => (STATES.has(state) ? t(`storage.state.${state}` as MessageKey) : state)

  async function act(run: () => Promise<string>) {
    busy = true
    message = null
    try {
      message = { kind: 'ok', text: await run() }
    } catch (e) {
      message = { kind: 'error', text: e instanceof Error ? e.message : t('common.didNotWork') }
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
      return t('storage.moved', { class: className(result.storageClass) })
    })

  const restore = () =>
    act(async () => {
      const result = await api<{ result: string }>(`/api/assets/${assetId}/restore`, { method: 'POST', body: JSON.stringify({ days, tier }) })
      location = { ...location!, state: 'restoring' }
      return result.result === 'already-restored'
        ? t('storage.alreadyRestored')
        : t('storage.restoreRequested', { days: t('common.days', { count: days }) })
    })

  const refresh = () =>
    act(async () => {
      const result = await api<{ state: string; storageClass: string; restoreExpiresAt: string | null }>(`/api/assets/${assetId}/refresh`, { method: 'POST' })
      location = { ...location!, state: result.state, storageClass: result.storageClass, restoreExpiresAt: result.restoreExpiresAt }
      return result.state === 'restored' ? t('storage.restoredReady') : t('storage.status', { state: stateName(result.state) })
    })
</script>

{#if location?.nasPath}
  <div class="stack">
    <dl class="facts">
      <dt>{t('storage.on')}</dt>
      <dd>{location.connectionName}</dd>
      <dt>{t('storage.path')}</dt>
      <dd class="path">{location.nasPath}</dd>
      {#if location.nasFolder?.root.volume}
        <dt>{t('storage.drive')}</dt>
        <dd>{location.nasFolder.root.volume.label ?? t('storage.unnamedDrive')}</dd>
      {/if}
      <dt>State</dt>
      <dd>
        {#if location.state === 'missing'}
          {t('storage.missing')}
        {:else if location.nasFolder?.root.offlineSince}
          {t('storage.offline', {
            date: format().date(location.nasFolder.root.offlineSince),
            what: location.nasFolder.root.volume ? `“${location.nasFolder.root.volume.label ?? t('storage.theDrive')}”` : t('storage.theFolder'),
            source: location.nasFolder.sourceName,
          })}
        {:else}
          {t('storage.present')}
        {/if}
      </dd>
    </dl>
    <p class="muted small">{location.nasFolder ? t('storage.staysOn', { source: location.nasFolder.sourceName }) : t('storage.stays')}</p>
  </div>
{:else if location}
  <div class="stack">
    <dl class="facts">
      <dt>{t('storage.storedIn')}</dt>
      <dd>{location.connectionName}</dd>
      <dt>{t('storage.class')}</dt>
      <dd>{className(location.storageClass)}</dd>
      <dt>State</dt>
      <dd>
        {location.restoreExpiresAt ? t('storage.until', { state: stateName(location.state), date: format().date(location.restoreExpiresAt) }) : stateName(location.state)}
      </dd>
    </dl>

    <div class="row">
      {#if !location.archived || location.state === 'restored'}
        <a class="btn btn-primary" href={`/api/assets/${assetId}/original`}>{t('storage.downloadOriginal')}</a>
      {/if}
      <button class="btn" onclick={refresh} disabled={busy}>{t('storage.checkStatus')}</button>
    </div>

    {#if canManage && location.archived && location.state !== 'restored'}
      <div class="subpanel stack">
        <strong>{t('storage.restoreTitle')}</strong>
        <div class="row">
          <div class="field">
            <label for="tier">{t('storage.speed')}</label>
            <select id="tier" bind:value={tier}>
              {#each TIERS as [value, note] (value)}<option {value}>{t(note)}</option>{/each}
            </select>
          </div>
          <div class="field days">
            <label for="days">{t('storage.keepFor')}</label>
            <select id="days" bind:value={days}>
              {#each [1, 3, 7, 14, 30] as d (d)}<option value={d}>{t('common.days', { count: d })}</option>{/each}
            </select>
          </div>
        </div>
        <div><button class="btn btn-primary" onclick={restore} disabled={busy || location.state === 'restoring'}>{t('storage.requestRestore')}</button></div>
      </div>
    {/if}

    {#if canManage && location.offeredClasses.length > 1}
      <div class="subpanel stack">
        <strong>{t('storage.moveTitle')}</strong>
        <div class="row">
          <select bind:value={target} aria-label={t('storage.targetClass')}>
            {#each location.offeredClasses as cls (cls)}<option value={cls}>{className(cls)}</option>{/each}
          </select>
          <button class="btn" onclick={changeClass} disabled={busy || target === location.storageClass}>{t('storage.move')}</button>
        </div>
        <p class="muted note">{t('storage.minimumStay')}</p>
      </div>
    {/if}

    {#if message}
      <div class="alert" class:alert-error={message.kind === 'error'} class:alert-success={message.kind === 'ok'}>{message.text}</div>
    {/if}
  </div>
{:else}
  <p class="muted">{t('storage.none')}</p>
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

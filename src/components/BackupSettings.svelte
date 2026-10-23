<script lang="ts">
  import { format, lang, t } from '@cf-dam/i18n/client'
  import { intlTag } from '@cf-dam/i18n/languages'
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'

  interface Config {
    connectionId: string | null
    hour: number
    keepDays: number
  }
  interface Connection {
    id: string
    name: string
    provider: 'r2-binding' | 's3' | 'nas'
  }
  interface Backup {
    id: string
    connectionName: string | null
    status: 'running' | 'done' | 'failed'
    startedAt: string
    finishedAt: string | null
    rows: number
    bytes: number
    error: string | null
  }
  interface Running {
    tablesDone: number
    tables: number
    rows: number
    failures: number
  }

  let config = $state<Config | null>(null)
  let draft = $state<Config>({ connectionId: null, hour: 3, keepDays: 30 })
  let connections = $state<Connection[]>([])
  let backups = $state<Backup[]>([])
  let running = $state<Running | null>(null)
  let error = $state('')
  let notice = $state('')
  let busy = $state(false)

  const destinations = $derived(connections.filter((c) => c.provider !== 'nas'))
  const builtIn = $derived(connections.find((c) => c.id === draft.connectionId)?.provider === 'r2-binding')
  const changed = $derived(config !== null && JSON.stringify(config) !== JSON.stringify(draft))
  const fmt = (iso: string) => format().dateTime(iso)
  const size = (bytes: number) => format().bytes(bytes)
  /** The UTC hour as this browser's local time, so "03:00 UTC" means something. */
  const local = (hour: number) => {
    const d = new Date()
    d.setUTCHours(hour, 0, 0, 0)
    return d.toLocaleTimeString(intlTag(lang()), { hour: 'numeric', minute: '2-digit' })
  }

  async function load() {
    const [b, c] = await Promise.all([
      api<{ config: Config; running: Running | null; backups: Backup[] }>('/api/backups'),
      api<{ connections: Connection[] }>('/api/connections'),
    ])
    config = b.config
    draft = { ...b.config }
    running = b.running
    backups = b.backups
    connections = c.connections
  }
  onMount(load)

  async function save(event: SubmitEvent) {
    event.preventDefault()
    error = notice = ''
    busy = true
    try {
      await api('/api/backups/config', { method: 'PUT', body: JSON.stringify(draft) })
      notice = draft.connectionId ? t('backup.saved') : t('backup.isOff')
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }

  async function runNow() {
    error = notice = ''
    busy = true
    try {
      await api('/api/backups/run', { method: 'POST' })
      notice = t('backup.started')
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : t('backup.startFailed')
    } finally {
      busy = false
    }
  }
</script>

<section class="card stack">
  <div>
    <h2>{t('backup.title')}</h2>
    <p class="muted">{t('backup.lead')}</p>
  </div>

  {#if config}
    <form class="settings" onsubmit={save}>
      <label class="field">
        <span>{t('backup.to')}</span>
        <select bind:value={draft.connectionId}>
          <option value={null}>{t('backup.off')}</option>
          {#each destinations as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span>{t('backup.at')}</span>
        <select bind:value={draft.hour} disabled={!draft.connectionId}>
          {#each Array.from({ length: 24 }, (_, h) => h) as h (h)}
            <option value={h}>{String(h).padStart(2, '0')}:00 · {t('backup.here', { time: local(h) })}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span>{t('backup.keep')}</span>
        <input type="number" min="1" max="365" bind:value={draft.keepDays} disabled={!draft.connectionId} />
      </label>
      <div class="actions">
        <button class="btn btn-primary" type="submit" disabled={busy || !changed}>{t('common.save')}</button>
        <button class="btn" type="button" disabled={busy || !config.connectionId || running !== null} onclick={runNow}>{t('backup.now')}</button>
      </div>
    </form>

    {#if builtIn}
      <p class="alert note">
        {t('backup.builtIn')}
      </p>
    {/if}
  {/if}

  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
  {#if notice}<div class="alert alert-success" role="status">{notice}</div>{/if}

  {#if running}
    <p class="muted">
      {running.failures > 0
        ? t('backup.runningRetried', { done: running.tablesDone, tables: running.tables, rows: running.rows, tries: t('backup.failedTries', { count: running.failures }) })
        : t('backup.running', { done: running.tablesDone, tables: running.tables, rows: running.rows })}
    </p>
  {/if}

  {#if backups.length > 0}
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>{t('backup.started2')}</th><th>{t('common.where')}</th><th>{t('backup.rows')}</th><th>{t('backup.size')}</th><th>{t('backup.state')}</th></tr></thead>
        <tbody>
          {#each backups as b (b.id)}
            <tr>
              <td>{fmt(b.startedAt)}</td>
              <td>{b.connectionName ?? t('common.removedConnection')}</td>
              <td class="num">{b.status === 'done' ? format().number(b.rows) : ''}</td>
              <td class="num">{b.status === 'done' ? size(b.bytes) : ''}</td>
              <td>
                {#if b.status === 'done'}<span class="badge badge-ok">{t('backup.finished')}</span>
                {:else if b.status === 'running'}<span class="badge">{t('backup.runningBadge')}</span>
                {:else}<span class="badge badge-warn">{t('backup.failed')}</span> <span class="muted small">{b.error}</span>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if config?.connectionId}
    <p class="muted">{t('backup.first')}</p>
  {/if}
</section>

<style>
  .settings {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px 16px;
  }
  .field {
    display: grid;
    gap: 4px;
    font-size: 0.85rem;
  }
  .field select,
  .field input {
    width: auto;
    min-width: 140px;
    max-width: 100%;
    padding: 6px 10px;
  }
  .field input {
    width: 100px;
    min-width: 0;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .note {
    color: var(--text);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    margin: 0;
  }
  .table-wrap {
    overflow-x: auto;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .badge-warn {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 45%, transparent);
  }
  .small {
    font-size: 0.8rem;
  }
</style>

<script lang="ts">
  /** One agent's archiving: where originals go, when, how fast, and how far along it is. */
  import { api } from '../lib/auth-client'

  export interface ArchiveSettings {
    connectionId?: string | null
    storageClass?: string
    fromHour?: number
    toHour?: number
    maxMbps?: number
  }
  export interface ArchiveProgress {
    phase?: 'idle' | 'archiving' | 'waiting'
    current?: string | null
    filesDone?: number
    bytesSent?: number
    speed?: number
    filesLeft?: number
    bytesLeft?: number
    lastError?: string | null
  }
  interface Connection {
    id: string
    name: string
    provider: string
    storageClasses: string[]
    defaultClass: string
  }

  interface Props {
    sourceId: string
    settings: ArchiveSettings
    progress: ArchiveProgress | undefined
    connections: Connection[]
    onchange: () => void
  }
  let { sourceId, settings, progress, connections, onchange }: Props = $props()

  const CLASS_NAMES: Record<string, string> = {
    DEEP_ARCHIVE: 'Deep Archive',
    GLACIER: 'Glacier Flexible Retrieval',
    GLACIER_IR: 'Glacier Instant Retrieval',
    STANDARD_IA: 'Standard-IA',
    STANDARD: 'Standard',
    INTELLIGENT_TIERING: 'Intelligent-Tiering',
    ONEZONE_IA: 'One Zone-IA',
  }
  const buckets = $derived(connections.filter((c) => c.provider === 's3'))
  const on = $derived(!!settings.connectionId)
  const bucket = $derived(connections.find((c) => c.id === settings.connectionId))
  let editing = $state(false)
  let draft = $state<Required<ArchiveSettings>>({ connectionId: '', storageClass: '', fromHour: 22, toHour: 7, maxMbps: 0 })
  let error = $state('')
  let busy = $state(false)
  let confirmingStop = $state(false)

  const hour = (h: number) => `${String(h).padStart(2, '0')}:00`
  const hours = (s: ArchiveSettings) => (s.fromHour ?? 0) === (s.toHour ?? 0) ? 'any time' : `${hour(s.fromHour ?? 0)}–${hour(s.toHour ?? 0)}`
  const size = (bytes = 0) =>
    bytes >= 1e12 ? `${(bytes / 1e12).toFixed(1)} TB` : bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(0)} MB` : `${Math.ceil(bytes / 1e3)} KB`
  /** Time to send what's left at the current speed, as people say it. */
  function eta(bytes = 0, speed = 0): string | null {
    if (!speed || !bytes) return null
    const hoursLeft = bytes / speed / 3600
    return hoursLeft < 1 ? 'under an hour' : hoursLeft < 48 ? `about ${Math.round(hoursLeft)} hours` : `about ${Math.round(hoursLeft / 24)} days`
  }

  function edit() {
    const first = bucket ?? buckets[0]
    draft = {
      connectionId: first?.id ?? '',
      storageClass: settings.storageClass ?? (first?.storageClasses.includes('DEEP_ARCHIVE') ? 'DEEP_ARCHIVE' : (first?.defaultClass ?? '')),
      fromHour: settings.fromHour ?? 22,
      toHour: settings.toHour ?? 7,
      maxMbps: settings.maxMbps ?? 0,
    }
    error = ''
    editing = true
  }

  function pickBucket(id: string) {
    const c = buckets.find((b) => b.id === id)
    draft.connectionId = id
    if (c && !c.storageClasses.includes(draft.storageClass)) draft.storageClass = c.storageClasses.includes('DEEP_ARCHIVE') ? 'DEEP_ARCHIVE' : c.defaultClass
  }

  async function save(archive: ArchiveSettings | null) {
    error = ''
    busy = true
    try {
      await api(`/api/sources/${sourceId}`, { method: 'PATCH', body: JSON.stringify({ archive }) })
      editing = false
      confirmingStop = false
      onchange()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save.'
    } finally {
      busy = false
    }
  }

  function stop() {
    if (!confirmingStop) {
      confirmingStop = true
      setTimeout(() => (confirmingStop = false), 4000)
      return
    }
    void save(null)
  }
</script>

<div class="archive">
  <h3>Archive originals</h3>
  {#if !editing}
    {#if on}
      <p>
        To <strong>{bucket?.name ?? 'a removed bucket'}</strong> in {CLASS_NAMES[settings.storageClass ?? ''] ?? settings.storageClass},
        {hours(settings)} (the agent's own clock){settings.maxMbps ? `, up to ${settings.maxMbps} Mbps` : ''}.
      </p>
      {#if progress?.phase === 'archiving'}
        <p class="state">
          Sending{progress.current ? ` ${progress.current}` : ''}: {progress.filesDone ?? 0} files ({size(progress.bytesSent)}) this run at {size(progress.speed)}/s.
          {progress.filesLeft ?? 0} files ({size(progress.bytesLeft)}) to go{eta(progress.bytesLeft, progress.speed) ? `, ${eta(progress.bytesLeft, progress.speed)} at this speed` : ''}.
        </p>
      {:else if progress?.phase === 'waiting'}
        <p class="state">Waiting for the archive hours. {progress.filesLeft ?? 0} files ({size(progress.bytesLeft)}) to go.</p>
      {:else if progress && (progress.filesLeft ?? 0) === 0}
        <p class="state">Everything settled is archived. New photos follow once they've been left alone for a day.</p>
      {:else if progress}
        <p class="state">{progress.filesLeft} files ({size(progress.bytesLeft)}) to go; it carries on between scans.</p>
      {/if}
      {#if progress?.lastError}<p class="muted small">Last problem: {progress.lastError}</p>{/if}
      <div class="row">
        <button class="btn btn-sm" type="button" onclick={edit}>Change</button>
        <button class="btn btn-sm btn-danger" type="button" disabled={busy} onclick={stop} onblur={() => (confirmingStop = false)}>
          {confirmingStop ? 'Click again to stop archiving' : 'Stop archiving'}
        </button>
      </div>
    {:else}
      <p class="muted small">
        Copies each original to an S3 bucket (Deep Archive is about $1 a month per TB), checked part by part as it lands. Files are read, never changed;
        a copy is made once a file has been left alone for a day.
      </p>
      {#if buckets.length === 0}
        <p class="muted small">Add an S3 bucket on the <a href="/settings/storage">Storage</a> page first.</p>
      {:else}
        <div><button class="btn btn-sm" type="button" onclick={edit}>Set up archiving</button></div>
      {/if}
    {/if}
  {:else}
    <form class="settings" onsubmit={(e) => (e.preventDefault(), save(draft))}>
      <label class="field">
        <span>Bucket</span>
        <select value={draft.connectionId} onchange={(e) => pickBucket(e.currentTarget.value)}>
          {#each buckets as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span>Storage class</span>
        <select bind:value={draft.storageClass}>
          {#each buckets.find((b) => b.id === draft.connectionId)?.storageClasses ?? [] as c (c)}<option value={c}>{CLASS_NAMES[c] ?? c}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span>From</span>
        <select bind:value={draft.fromHour}>{#each Array.from({ length: 24 }, (_, h) => h) as h (h)}<option value={h}>{hour(h)}</option>{/each}</select>
      </label>
      <label class="field">
        <span>Until</span>
        <select bind:value={draft.toHour}>{#each Array.from({ length: 24 }, (_, h) => h) as h (h)}<option value={h}>{hour(h)}</option>{/each}</select>
      </label>
      <label class="field">
        <span>Speed limit (Mbps)</span>
        <input type="number" min="0" step="1" bind:value={draft.maxMbps} />
      </label>
      <div class="actions">
        <button class="btn btn-sm btn-primary" type="submit" disabled={busy || !draft.connectionId}>{on ? 'Save' : 'Start archiving'}</button>
        <button class="btn btn-sm" type="button" onclick={() => (editing = false)}>Cancel</button>
      </div>
      <p class="muted small hint">Same hours in From and Until means any time. 0 Mbps means no limit. Hours are the agent's own clock.</p>
    </form>
  {/if}
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
</div>

<style>
  .archive {
    display: grid;
    gap: 8px;
  }
  .archive h3 {
    margin: 0;
  }
  .archive p {
    margin: 0;
  }
  .state {
    font-variant-numeric: tabular-nums;
  }
  .settings {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px 14px;
  }
  .field {
    display: grid;
    gap: 4px;
    font-size: 0.85rem;
  }
  .field select,
  .field input {
    width: auto;
    max-width: 100%;
    padding: 6px 10px;
  }
  .field input {
    width: 110px;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .hint {
    flex-basis: 100%;
  }
  .small {
    font-size: 0.8rem;
  }
</style>

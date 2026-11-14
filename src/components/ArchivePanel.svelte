<script lang="ts">
  import { format, t, tHtml } from '@cf-dam/i18n/client'
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
    /** From helpers that count what archiving couldn't do (older ones send none of these). */
    gaveUp?: { files: number; bytes: number }
    cantRead?: { new: number; archived: number }
    notReadYet?: number
    bucket?: { refusing: string | null; until: string | null }
    lastGaveUp?: { path: string; error: string | null; at: string | null } | null
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
  /** "Try them again" pressed, until the count goes down. */
  let retryAsked = $state<number | null>(null)
  const gaveUp = $derived(progress?.gaveUp?.files ?? 0)
  $effect(() => {
    if (retryAsked !== null && gaveUp < retryAsked) retryAsked = null
  })
  /** Nothing archiving couldn't do: only a helper that counts can say so. */
  const allClear = $derived(
    !progress?.gaveUp || (gaveUp === 0 && (progress.cantRead?.new ?? 0) === 0 && (progress.cantRead?.archived ?? 0) === 0 && !progress.bucket?.refusing),
  )

  async function retry() {
    error = ''
    try {
      await api(`/api/sources/${sourceId}/archive/retry`, { method: 'POST' })
      retryAsked = gaveUp
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    }
  }

  const hour = (h: number) => `${String(h).padStart(2, '0')}:00`
  const hours = (s: ArchiveSettings) => (s.fromHour ?? 0) === (s.toHour ?? 0) ? t('archive.anyTime') : `${hour(s.fromHour ?? 0)}–${hour(s.toHour ?? 0)}`
  const size = (bytes = 0) => format().bytes(bytes)
  const files = (count = 0) => t('archive.files', { count })
  /** Time to send what's left at the current speed, as people say it. */
  function eta(bytes = 0, speed = 0): string | null {
    if (!speed || !bytes) return null
    const hoursLeft = bytes / speed / 3600
    return hoursLeft < 1 ? t('archive.underHour') : hoursLeft < 48 ? t('archive.aboutHours', { count: Math.round(hoursLeft) }) : t('archive.aboutDays', { count: Math.round(hoursLeft / 24) })
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
      error = e instanceof Error ? e.message : t('common.couldNotSave')
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
  <h3>{t('archive.title')}</h3>
  {#if !editing}
    {#if on}
      <p>
        {@html tHtml(settings.maxMbps ? 'archive.summaryLimit' : 'archive.summary', { bucket: bucket?.name ?? t('archive.removedBucket'), class: CLASS_NAMES[settings.storageClass ?? ''] ?? settings.storageClass ?? '', hours: hours(settings), mbps: settings.maxMbps ?? 0 })}
      </p>
      {#if progress?.phase === 'archiving'}
        <p class="state">
          {t('archive.sending', { current: progress.current ? ` ${progress.current}` : '', files: files(progress.filesDone), sent: size(progress.bytesSent), speed: size(progress.speed) })}
          {eta(progress.bytesLeft, progress.speed) ? t('archive.toGoEta', { files: files(progress.filesLeft), size: size(progress.bytesLeft), eta: eta(progress.bytesLeft, progress.speed) ?? '' }) : t('archive.toGo', { files: files(progress.filesLeft), size: size(progress.bytesLeft) })}
        </p>
      {:else if progress?.phase === 'waiting'}
        <p class="state">{t('archive.waiting', { files: files(progress.filesLeft), size: size(progress.bytesLeft) })}</p>
      {:else if progress && (progress.filesLeft ?? 0) === 0 && allClear}
        <p class="state">{t('archive.settled')}</p>
      {:else if progress}
        <p class="state">{t('archive.carriesOn', { files: files(progress.filesLeft), size: size(progress.bytesLeft) })}</p>
      {/if}
      {#if progress?.bucket?.refusing}
        <p class="problem" role="status">{t('archive.bucketRefusing', { code: progress.bucket.refusing, time: progress.bucket.until ? format().time(progress.bucket.until) : '' })}</p>
      {/if}
      {#if gaveUp > 0}
        <p class="problem">
          {t('archive.gaveUp', { count: gaveUp, last: progress?.lastGaveUp ? `${progress.lastGaveUp.path}${progress.lastGaveUp.error ? `, ${progress.lastGaveUp.error}` : ''}` : '' })}
          {#if retryAsked !== null}
            <span class="muted">{t('archive.tryAgainAsked')}</span>
          {:else}
            <button class="btn btn-sm" type="button" onclick={retry}>{t('archive.tryAgain')}</button>
          {/if}
        </p>
      {/if}
      {#if (progress?.cantRead?.archived ?? 0) > 0}<p class="problem">{t('archive.cantReadArchived', { count: progress!.cantRead!.archived })}</p>{/if}
      {#if (progress?.cantRead?.new ?? 0) > 0}<p class="muted small">{t('archive.cantReadNew', { count: progress!.cantRead!.new })}</p>{/if}
      {#if progress?.lastError && !progress.bucket?.refusing}<p class="muted small">{t('sources.lastProblem', { error: progress.lastError })}</p>{/if}
      <div class="row">
        <button class="btn btn-sm" type="button" onclick={edit}>{t('archive.change')}</button>
        <button class="btn btn-sm btn-danger" type="button" disabled={busy} onclick={stop} onblur={() => (confirmingStop = false)}>
          {confirmingStop ? t('archive.clickStop') : t('archive.stop')}
        </button>
      </div>
    {:else}
      <p class="muted small">
        {t('archive.lead')}
      </p>
      {#if buckets.length === 0}
        <p class="muted small"><a href="/settings/storage">{t('archive.addBucketFirst')}</a></p>
      {:else}
        <div><button class="btn btn-sm" type="button" onclick={edit}>{t('archive.setUp')}</button></div>
      {/if}
    {/if}
  {:else}
    <form class="settings" onsubmit={(e) => (e.preventDefault(), save(draft))}>
      <label class="field">
        <span>{t('conn.bucket')}</span>
        <select value={draft.connectionId} onchange={(e) => pickBucket(e.currentTarget.value)}>
          {#each buckets as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span>{t('upload.class')}</span>
        <select bind:value={draft.storageClass}>
          {#each buckets.find((b) => b.id === draft.connectionId)?.storageClasses ?? [] as c (c)}<option value={c}>{CLASS_NAMES[c] ?? c}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span>{t('archive.from')}</span>
        <select bind:value={draft.fromHour}>{#each Array.from({ length: 24 }, (_, h) => h) as h (h)}<option value={h}>{hour(h)}</option>{/each}</select>
      </label>
      <label class="field">
        <span>{t('archive.until')}</span>
        <select bind:value={draft.toHour}>{#each Array.from({ length: 24 }, (_, h) => h) as h (h)}<option value={h}>{hour(h)}</option>{/each}</select>
      </label>
      <label class="field">
        <span>{t('archive.speedLimit')}</span>
        <input type="number" min="0" step="1" bind:value={draft.maxMbps} />
      </label>
      <div class="actions">
        <button class="btn btn-sm btn-primary" type="submit" disabled={busy || !draft.connectionId}>{on ? t('common.save') : t('archive.start')}</button>
        <button class="btn btn-sm" type="button" onclick={() => (editing = false)}>{t('common.cancel')}</button>
      </div>
      <p class="muted small hint">{t('archive.hint')}</p>
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
  .problem {
    color: var(--warning, var(--text));
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

<script lang="ts">
  import { format, t } from '@cf-dam/i18n/client'
  import type { MessageKey } from '@cf-dam/i18n'
  import { uploadFile, type Progress } from '../lib/uploader'

  interface ConnectionOption {
    id: string
    name: string
    storageClasses: string[]
    defaultClass: string
    isDefault: boolean
  }
  interface Props {
    connections: ConnectionOption[]
    /** Open with the drop zone expanded (the empty library). */
    open?: boolean
  }
  let { connections, open = false }: Props = $props()

  const CLASS_LABELS: Record<string, MessageKey> = {
    STANDARD: 'storageClass.STANDARD',
    INTELLIGENT_TIERING: 'storageClass.INTELLIGENT_TIERING',
    STANDARD_IA: 'storageClass.STANDARD_IA',
    ONEZONE_IA: 'storageClass.ONEZONE_IA',
    GLACIER_IR: 'storageClass.GLACIER_IR',
    GLACIER: 'storageClass.GLACIER',
    DEEP_ARCHIVE: 'storageClass.DEEP_ARCHIVE',
  }

  interface Item {
    id: number
    file: File
    state: 'queued' | 'working' | 'done' | 'duplicate' | 'failed' | 'cancelled'
    progress: Progress | null
    message: string
    assetId?: string
    controller: AbortController
  }

  const initial = connections.find((c) => c.isDefault) ?? connections[0]
  let expanded = $state(open)
  let connectionId = $state(initial?.id ?? '')
  let storageClass = $state(initial?.defaultClass ?? 'STANDARD')
  let items = $state<Item[]>([])
  let dragging = $state(false)
  let running = $state(false)
  let counter = 0

  const connection = $derived(connections.find((c) => c.id === connectionId))
  const finished = $derived(items.filter((i) => i.state === 'done').length)

  function pickConnection(id: string) {
    connectionId = id
    const chosen = connections.find((c) => c.id === id)
    if (chosen) storageClass = chosen.defaultClass
  }

  function add(files: FileList | File[]) {
    for (const file of files) {
      items.push({ id: ++counter, file, state: 'queued', progress: null, message: '', controller: new AbortController() })
    }
    void run()
  }

  /**
   * What was dropped: files as they are, and folders opened up (and the folders inside them), as the
   * browser otherwise hands over a folder as one unreadable "file". Hidden files (.DS_Store) are left out.
   */
  async function dropped(data: DataTransfer): Promise<File[]> {
    const entries = [...data.items].map((item) => item.webkitGetAsEntry?.() ?? null)
    if (entries.some((e) => e === null)) return [...data.files]
    const files: File[] = []
    const walk = async (entry: FileSystemEntry): Promise<void> => {
      if (entry.name.startsWith('.')) return
      if (entry.isFile) {
        files.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)))
        return
      }
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      // A folder's entries come a hundred or so at a time, until an empty batch.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
        if (batch.length === 0) break
        for (const child of batch) await walk(child)
      }
    }
    for (const entry of entries) await walk(entry!)
    return files.sort((a, b) => a.name.localeCompare(b.name))
  }

  async function run() {
    if (running) return
    running = true
    try {
      for (let item = items.find((i) => i.state === 'queued'); item; item = items.find((i) => i.state === 'queued')) {
        const current = item
        current.state = 'working'
        try {
          const outcome = await uploadFile(current.file, { connectionId, storageClass }, (p) => (current.progress = p), current.controller.signal)
          current.assetId = outcome.assetId
          current.state = outcome.kind === 'duplicate' ? 'duplicate' : 'done'
          current.message = outcome.kind === 'duplicate' ? t('upload.duplicate') : (outcome.note ?? '')
        } catch (error) {
          const aborted = error instanceof DOMException && error.name === 'AbortError'
          current.state = aborted ? 'cancelled' : 'failed'
          current.message = aborted ? t('upload.cancelled') : error instanceof Error ? error.message : t('upload.failed')
        }
      }
    } finally {
      running = false
    }
  }

  function percent(item: Item): number {
    if (item.state === 'done' || item.state === 'duplicate') return 100
    if (!item.progress || item.progress.total === 0) return 0
    return Math.round((item.progress.sent / item.progress.total) * 100)
  }

  function label(item: Item): string {
    if (item.state === 'working') {
      const phase = item.progress?.phase
      return phase === 'hashing' ? t('upload.hashing') : phase === 'preparing' ? t('upload.preparing') : phase === 'finishing' ? t('upload.finishing') : `${percent(item)}%`
    }
    return { queued: t('upload.waiting'), done: item.message || t('upload.uploaded'), duplicate: item.message, failed: item.message, cancelled: t('upload.cancelled'), working: '' }[item.state]
  }

  const size = (bytes: number) => format().bytes(bytes)
</script>

{#if !expanded}
  <button class="btn btn-primary" onclick={() => (expanded = true)}>
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 20h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
    {t('upload.button')}
  </button>
{:else}
  <section class="card uploader">
    <div class="row head">
      <div class="field">
        <label for="dest">{t('upload.dest')}</label>
        <select id="dest" value={connectionId} onchange={(e) => pickConnection(e.currentTarget.value)}>
          {#each connections as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="class">{t('upload.class')}</label>
        <select id="class" bind:value={storageClass}>
          {#each connection?.storageClasses ?? [] as cls (cls)}<option value={cls}>{CLASS_LABELS[cls] ? t(CLASS_LABELS[cls]!) : cls}</option>{/each}
        </select>
      </div>
      {#if !open}<button class="btn btn-sm close" onclick={() => (expanded = false)} aria-label={t('upload.close')}>✕</button>{/if}
    </div>

    {#if storageClass === 'GLACIER' || storageClass === 'DEEP_ARCHIVE'}
      <p class="hint">
        {t('upload.deep')}
      </p>
    {/if}

    <label
      class="drop"
      class:dragging
      ondragover={(e) => {
        e.preventDefault()
        dragging = true
      }}
      ondragleave={() => (dragging = false)}
      ondrop={(e) => {
        e.preventDefault()
        dragging = false
        const data = e.dataTransfer
        if (data?.items.length)
          void dropped(data)
            .then((files) => files.length > 0 && add(files))
            .catch(() => add(data.files))
      }}
    >
      <input type="file" multiple class="sr-only" onchange={(e) => e.currentTarget.files && add(e.currentTarget.files)} />
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a5 5 0 0 1-.6-9.96A6 6 0 0 1 18 9a4 4 0 0 1 0 8M12 12v9m0-9-3 3m3-3 3 3" /></svg>
      <strong>{t('upload.drop')}</strong>
      <span class="muted">{t('upload.dropLead')}</span>
    </label>

    {#if items.length > 0}
      <p class="muted summary">{t('upload.progress', { done: finished, count: items.length })}</p>
      <ul class="queue">
        {#each items as item (item.id)}
          <li class={`state-${item.state}`}>
            <div class="name">
              <span>{item.file.name}</span>
              <span class="muted">{size(item.file.size)}</span>
            </div>
            <div class="bar"><span style={`width:${percent(item)}%`}></span></div>
            <div class="status">
              {#if item.assetId && (item.state === 'done' || item.state === 'duplicate')}
                <a href={`/assets/${item.assetId}`}>{label(item)}</a>
              {:else}
                <span>{label(item)}</span>
              {/if}
              {#if item.state === 'working' || item.state === 'queued'}
                <button class="btn btn-sm" onclick={() => (item.state === 'queued' ? (item.state = 'cancelled') : item.controller.abort())}>{t('common.cancel')}</button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
      {#if !running && finished > 0}
        <div><a class="btn" href="/">{t('upload.refresh')}</a></div>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .uploader {
    display: grid;
    gap: 16px;
  }
  .head {
    align-items: flex-end;
  }
  .head .field {
    flex: 1 1 220px;
  }
  .close {
    margin-left: auto;
  }
  .hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--warning);
  }
  .drop {
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: 40px 20px;
    border: 1.5px dashed var(--border-strong);
    border-radius: var(--radius);
    cursor: pointer;
    text-align: center;
    transition: border-color 150ms var(--ease), background 150ms var(--ease);
  }
  .drop svg {
    width: 36px;
    height: 36px;
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .drop:hover,
  .drop.dragging {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .summary {
    margin: 0;
    font-size: 0.85rem;
  }
  .queue {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
    max-height: 320px;
    overflow: auto;
  }
  .queue li {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(80px, 1fr) minmax(0, 1.4fr);
    gap: 12px;
    align-items: center;
    font-size: 0.88rem;
  }
  .name {
    display: grid;
    min-width: 0;
  }
  .name span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar {
    height: 6px;
    border-radius: 99px;
    background: var(--surface-hover);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--accent-strong), var(--accent-2));
    transition: width 200ms var(--ease);
  }
  .status {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
    min-width: 0;
  }
  .status span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state-failed .status span {
    color: var(--danger);
    white-space: normal;
  }
  .state-done .bar span {
    background: var(--success);
  }
</style>

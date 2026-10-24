<script lang="ts">
  /**
   * Archiving delivered jobs (catalog/archive-jobs.ts), on the Storage page: on or off, which S3 connection and cold
   * class, and how many days after delivery. Before saving, what it would archive at once and what that costs.
   */
  import { format, t } from '@cf-dam/i18n/client'
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'

  interface Settings {
    enabled: boolean
    connectionId: string | null
    storageClass: 'DEEP_ARCHIVE' | 'GLACIER' | 'GLACIER_IR'
    afterDays: number
  }
  interface Preview {
    jobs: number
    photos: number
    bytes: number
    monthly: number
    once: number
  }

  let form = $state<Settings | null>(null)
  let saved = $state<Settings | null>(null)
  let connections = $state<{ id: string; name: string; provider: string; storageClasses: string[] }[]>([])
  let preview = $state<Preview | null>(null)
  let previewed = $state(false)
  let busy = $state(false)
  let error = $state('')
  let note = $state('')

  const money = (v: number) => format().number(v, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 3 : 2 })
  const s3 = $derived(connections.filter((c) => c.provider === 's3'))
  const turningOn = $derived(form !== null && form.enabled && !saved?.enabled)

  onMount(async () => {
    try {
      const [archive, list] = await Promise.all([
        api<{ settings: Settings; preview: Preview }>('/api/archive/jobs'),
        api<{ connections: { id: string; name: string; provider: string; storageClasses: string[] }[] }>('/api/connections'),
      ])
      form = { ...archive.settings }
      saved = archive.settings
      connections = list.connections
      if (!form.connectionId && s3.length > 0) form.connectionId = s3[0]!.id
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotLoad')
    }
  })

  async function look() {
    if (!form) return
    error = ''
    try {
      preview = (await api<{ preview: Preview }>('/api/archive/jobs/preview', { method: 'POST', body: JSON.stringify(form) })).preview
      previewed = true
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotLoad')
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault()
    if (!form) return
    // Turning it on archives every past delivered job at once: show what that means first.
    if (turningOn && !previewed) return look()
    busy = true
    error = ''
    note = ''
    try {
      const result = await api<{ settings: Settings; preview: Preview }>('/api/archive/jobs', { method: 'PUT', body: JSON.stringify(form) })
      saved = result.settings
      form = { ...result.settings }
      previewed = false
      preview = null
      note = t('common.saved')
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }
</script>

<section class="card stack">
  <div>
    <h2>{t('archiveJobs.title')}</h2>
    <p class="muted">{t('archiveJobs.lead')}</p>
  </div>
  {#if form}
    {#if s3.length === 0}
      <p class="muted">{t('archiveJobs.noS3')}</p>
    {:else}
      <form class="stack" onsubmit={save} oninput={() => ((previewed = false), (note = ''))}>
        <label class="check"><input type="checkbox" bind:checked={form.enabled} /> {t('archiveJobs.enabled')}</label>
        <div class="row choices">
          <div class="field">
            <label for="aj-connection">{t('archiveJobs.to')}</label>
            <select id="aj-connection" bind:value={form.connectionId}>
              {#each s3 as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
            </select>
          </div>
          <div class="field">
            <label for="aj-class">{t('archiveJobs.class')}</label>
            <select id="aj-class" bind:value={form.storageClass}>
              <option value="DEEP_ARCHIVE">{t('storageClass.DEEP_ARCHIVE')}</option>
              <option value="GLACIER">{t('storageClass.GLACIER')}</option>
              <option value="GLACIER_IR">{t('storageClass.GLACIER_IR')}</option>
            </select>
          </div>
          <div class="field">
            <label for="aj-days">{t('archiveJobs.afterDays')}</label>
            <input id="aj-days" type="number" min="0" max="3650" bind:value={form.afterDays} />
          </div>
        </div>
        {#if preview}
          <p class="preview" role="status">
            {t('archiveJobs.preview', { jobs: preview.jobs, photos: format().number(preview.photos), size: format().bytes(preview.bytes), monthly: money(preview.monthly), once: money(preview.once) })}
          </p>
        {/if}
        <div class="row buttons">
          <button class="btn btn-primary" type="submit" disabled={busy}>{turningOn && !previewed ? t('archiveJobs.check') : t('common.save')}</button>
          <button class="btn" type="button" onclick={look}>{t('archiveJobs.whatNow')}</button>
          {#if note}<span class="muted small" role="status">{note}</span>{/if}
        </div>
        <p class="muted small">{t('archiveJobs.note')}</p>
      </form>
    {/if}
  {/if}
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
</section>

<style>
  .choices,
  .buttons {
    gap: 12px;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .choices input {
    max-width: 110px;
  }
  .preview {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .small {
    font-size: 0.85rem;
  }
</style>

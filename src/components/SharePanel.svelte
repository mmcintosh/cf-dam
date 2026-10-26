<script lang="ts">
  import { format, t } from '@cf-dam/i18n/client'
  import type { MessageKey } from '@cf-dam/i18n'
  import { onMount } from 'svelte'
  import type { ShareJson } from '@cf-dam/api'
  import { api } from '../lib/auth-client'
  import ShareClients from './ShareClients.svelte'
  import GallerySelling from './GallerySelling.svelte'
  import { LANGUAGES } from '@cf-dam/i18n/languages'

  interface Props {
    albumId: string
    albumName: string
    /** Whether a watermark image has been set (Galleries page). */
    hasWatermark: boolean
    /** Open the new-gallery form at once (arriving from "New client gallery" or "Share with a client"). */
    startNew?: boolean
    /** The album belongs to a job: offer "Final delivery", which moves the job to Delivered. */
    inJob?: boolean
    /** Originals in the album clients couldn't download now: archived, or only on a NAS. */
    originals?: { needsRestore: number; nasOnly: number } | null
  }
  let { albumId, albumName, hasWatermark, startNew = false, inJob = false, originals = null }: Props = $props()
  let panel: HTMLElement | undefined = $state()

  type Size = 'small' | 'large' | 'original'
  const SIZES: [Size, MessageKey][] = [
    ['small', 'share.sizes.small'],
    ['large', 'share.sizes.large'],
    ['original', 'share.sizes.original'],
  ]
  const SIZE_WORDS: Record<Size, MessageKey> = { small: 'share.size.small', large: 'share.size.large', original: 'share.size.original' }

  interface Draft {
    name: string
    title: string
    message: string
    password: string
    removePassword: boolean
    expires: string
    downloadSizes: Size[]
    watermark: boolean
    proofing: boolean
    showFilenames: boolean
    finalDelivery: boolean
    /** '' for each visitor's own language. */
    language: string
  }
  const blank = (): Draft => ({ name: '', title: albumName, message: '', password: '', removePassword: false, expires: '', downloadSizes: [], watermark: hasWatermark, proofing: true, showFilenames: true, finalDelivery: false, language: '' })

  let shares = $state<ShareJson[]>([])
  let editing = $state<string | null>(null)
  let draft = $state<Draft>(blank())
  let error = $state('')
  let busy = $state(false)
  let copied = $state<string | null>(null)
  let confirming = $state<string | null>(null)
  let lapse: ReturnType<typeof setTimeout> | undefined

  const live = $derived(shares.filter((s) => s.status !== 'revoked'))
  const linkFor = (s: ShareJson) => `${location.origin}/s/${s.token}`
  const fmt = (iso: string | null) => (iso ? format().date(iso) : '')

  async function load() {
    shares = (await api<{ shares: ShareJson[] }>(`/api/shares?albumId=${encodeURIComponent(albumId)}`)).shares
  }
  onMount(async () => {
    await load()
    if (startNew) {
      start(null)
      panel?.scrollIntoView({ block: 'start' })
    }
  })

  function start(share: ShareJson | null) {
    error = ''
    if (!share) {
      editing = 'new'
      draft = blank()
      return
    }
    editing = share.id
    draft = {
      name: share.name,
      title: share.title,
      message: share.message,
      password: '',
      removePassword: false,
      // A date input shows the last day the link works.
      expires: share.expiresAt ? new Date(new Date(share.expiresAt).getTime() - 1).toISOString().slice(0, 10) : '',
      downloadSizes: [...share.downloadSizes],
      watermark: share.watermark,
      proofing: share.proofing,
      showFilenames: share.showFilenames,
      finalDelivery: share.finalDelivery,
      language: share.language ?? '',
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    busy = true
    try {
      // The link works through the whole of the chosen day, in this browser's time zone.
      const expiresAt = draft.expires ? new Date(new Date(`${draft.expires}T00:00`).getTime() + 86_400_000).toISOString() : null
      const body: Record<string, unknown> = {
        name: draft.name,
        title: draft.title,
        message: draft.message,
        expiresAt,
        downloadSizes: draft.downloadSizes,
        watermark: draft.watermark,
        proofing: draft.proofing,
        showFilenames: draft.showFilenames,
        language: draft.language || null,
        ...(inJob ? { finalDelivery: draft.finalDelivery } : {}),
      }
      if (draft.password) body.password = draft.password
      else if (draft.removePassword) body.password = null
      if (editing === 'new') await api('/api/shares', { method: 'POST', body: JSON.stringify({ albumId, ...body }) })
      else await api(`/api/shares/${editing}`, { method: 'PATCH', body: JSON.stringify(body) })
      editing = null
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : t('share.saveFailed')
    } finally {
      busy = false
    }
  }

  function arm(id: string | null) {
    clearTimeout(lapse)
    confirming = id
    if (id) lapse = setTimeout(() => (confirming = null), 4000)
  }

  async function revoke(share: ShareJson) {
    if (confirming !== share.id) return arm(share.id)
    arm(null)
    await api(`/api/shares/${share.id}/revoke`, { method: 'POST' })
    await load()
  }

  async function copy(share: ShareJson) {
    await navigator.clipboard.writeText(linkFor(share))
    copied = share.id
    setTimeout(() => copied === share.id && (copied = null), 2000)
  }
</script>

<section class="card stack" id="share" bind:this={panel}>
  <div class="row head">
    <div>
      <h2>{t('share.title')}</h2>
      <p class="muted small">{t('share.lead')}</p>
    </div>
    {#if editing === null}<button class="btn btn-primary btn-sm" onclick={() => start(null)}>{t('share.new')}</button>{/if}
  </div>

  {#if live.length > 0}
    <ul class="links">
      {#each live as share (share.id)}
        <li>
          <div class="what">
            <strong>{share.name}</strong>
            <span class="row small">
              {#if share.status === 'expired'}<span class="badge">{t('share.expiredOn', { date: fmt(share.expiresAt) })}</span>{:else if share.expiresAt}<span class="badge">{t('share.until', { date: fmt(new Date(new Date(share.expiresAt).getTime() - 1).toISOString()) })}</span>{/if}
              {#if share.hasPassword}<span class="badge">{t('share.password')}</span>{/if}
              {#if share.watermark}<span class="badge">{t('share.watermark')}</span>{/if}
              {#if share.language}<span class="badge">{t('share.in', { language: LANGUAGES.find((l) => l.code === share.language)?.name ?? share.language })}</span>{/if}
              {#if share.downloadSizes.length > 0}<span class="badge">{t('share.downloadsBadge', { sizes: format().list(share.downloadSizes.map((s) => t(SIZE_WORDS[s]))) })}</span>{/if}
            </span>
            <span class="muted small">
              {t('share.stats', { opens: t('share.opens', { count: share.stats.opens }), picking: share.stats.visitors, favourites: share.stats.picks, downloads: share.stats.downloads })}
            </span>
          </div>
          <div class="row">
            <code class="url">{linkFor(share)}</code>
            <button class="btn btn-sm" onclick={() => copy(share)}>{copied === share.id ? t('share.copied') : t('share.copy')}</button>
            <a class="btn btn-sm" href={`/galleries/${share.id}`}>{t('share.picksStats')}</a>
            <button class="btn btn-sm" onclick={() => start(share)}>{t('common.edit')}</button>
            <button class="btn btn-sm btn-danger" onclick={() => revoke(share)} onblur={() => confirming === share.id && arm(null)}>
              {confirming === share.id ? t('share.clickRevoke') : t('share.revoke')}
            </button>
          </div>
          {#if share.status === 'active'}<ShareClients shareId={share.id} />{/if}
          {#if share.status === 'active'}<GallerySelling shareId={share.id} />{/if}
        </li>
      {/each}
    </ul>
  {:else if editing === null}
    <p class="muted">{t('share.none')}</p>
  {/if}

  {#if editing !== null}
    <form class="stack form" onsubmit={save}>
      <div class="grid">
        <div class="field">
          <label for="share-name">{t('share.whoFor')}</label>
          <input id="share-name" type="text" required maxlength="200" placeholder={t('share.whoForPlaceholder')} bind:value={draft.name} />
        </div>
        <div class="field">
          <label for="share-title">{t('share.galleryTitle')}</label>
          <input id="share-title" type="text" maxlength="200" bind:value={draft.title} />
        </div>
      </div>
      <div class="field">
        <label for="share-message">{t('share.message')}</label>
        <textarea id="share-message" rows="3" maxlength="2000" bind:value={draft.message}></textarea>
      </div>
      <div class="grid">
        <div class="field">
          <label for="share-password">{editing !== 'new' && shares.find((s) => s.id === editing)?.hasPassword ? t('share.newPassword') : t('share.passwordOptional')}</label>
          <input id="share-password" type="text" autocomplete="off" minlength="4" maxlength="200" bind:value={draft.password} disabled={draft.removePassword} />
          {#if editing !== 'new' && shares.find((s) => s.id === editing)?.hasPassword}
            <label class="check"><input type="checkbox" bind:checked={draft.removePassword} /> {t('share.removePassword')}</label>
          {/if}
        </div>
        <div class="field">
          <label for="share-expires">{t('share.openUntil')}</label>
          <input id="share-expires" type="date" bind:value={draft.expires} />
        </div>
        <div class="field">
          <label for="share-language">{t('share.language')}</label>
          <select id="share-language" bind:value={draft.language}>
            <option value="">{t('share.languageVisitor')}</option>
            {#each LANGUAGES as language (language.code)}<option value={language.code}>{language.name}</option>{/each}
          </select>
          {#if editing !== 'new'}
            {@const share = shares.find((s) => s.id === editing)}
            {#if share}
              <span class="muted small">{t('share.preview')}
                {#each LANGUAGES as language, i (language.code)}{i ? ' · ' : ''}<a href={`/s/${share.token}?lang=${language.code}`} target="_blank" rel="noopener">{language.name}</a>{/each}
              </span>
            {/if}
          {/if}
        </div>
      </div>
      <fieldset>
        <legend class="label">{t('share.downloads')}</legend>
        {#each SIZES as [size, text] (size)}
          <label class="check"><input type="checkbox" value={size} bind:group={draft.downloadSizes} /> {t(text)}</label>
        {/each}
        {#if draft.downloadSizes.includes('original')}
          <p class="muted small">{t('share.originalsNote')}</p>
          {#if originals && originals.needsRestore > 0}<p class="warn small" role="note">{t('share.originalsArchived', { count: originals.needsRestore })}</p>{/if}
          {#if originals && originals.nasOnly > 0}<p class="warn small" role="note">{t('share.originalsNasOnly', { count: originals.nasOnly })}</p>{/if}
        {/if}
      </fieldset>
      <fieldset>
        <legend class="label">{t('share.options')}</legend>
        <label class="check"><input type="checkbox" bind:checked={draft.proofing} /> {t('share.proofing')}</label>
        <label class="check"><input type="checkbox" bind:checked={draft.showFilenames} /> {t('share.showFilenames')}</label>
        {#if !draft.showFilenames}<p class="muted small">{t('share.showFilenamesHint')}</p>{/if}
        {#if inJob}
          <label class="check"><input type="checkbox" bind:checked={draft.finalDelivery} /> {t('share.finalDelivery')} <span class="muted small">{t('share.finalDeliveryLead')}</span></label>
        {/if}
        <label class="check">
          <input type="checkbox" bind:checked={draft.watermark} /> {t('share.watermarkOption')}
          {#if !hasWatermark}<a class="muted small" href="/galleries">{t('share.setWatermarkFirst')}</a>{/if}
        </label>
      </fieldset>
      {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
      <div class="row">
        <button class="btn btn-primary" type="submit" disabled={busy}>{editing === 'new' ? t('share.make') : t('common.save')}</button>
        <button class="btn" type="button" onclick={() => (editing = null)}>{t('common.cancel')}</button>
      </div>
    </form>
  {/if}
</section>

<style>
  .head {
    justify-content: space-between;
    align-items: flex-start;
  }
  .small {
    font-size: 0.85rem;
  }
  .head p {
    margin: 4px 0 0;
  }
  .links {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 12px;
  }
  .links li {
    display: grid;
    gap: 10px;
    padding: 12px 0;
    border-top: 1px solid var(--border);
  }
  .what {
    display: grid;
    gap: 4px;
  }
  .url {
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: min(420px, 100%);
  }
  .form {
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
  }
  textarea,
  input[type='date'] {
    width: 100%;
    font: inherit;
    color: var(--text);
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 6px;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 0.9rem;
    color: var(--text);
    font-weight: 400;
  }
  .warn {
    color: var(--danger);
  }
</style>

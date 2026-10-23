<script lang="ts">
  import { onMount } from 'svelte'
  import type { ShareJson } from '@cf-dam/api'
  import { api } from '../lib/auth-client'
  import ShareClients from './ShareClients.svelte'
  import { LANGUAGES } from '@cf-dam/i18n/languages'

  interface Props {
    albumId: string
    albumName: string
    /** Whether a watermark image has been set (Galleries page). */
    hasWatermark: boolean
  }
  let { albumId, albumName, hasWatermark }: Props = $props()

  type Size = 'small' | 'large' | 'original'
  const SIZES: [Size, string][] = [
    ['small', 'Small JPEG (1024 px)'],
    ['large', 'Large JPEG (2048 px)'],
    ['original', 'Original files'],
  ]

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
    /** '' for each visitor's own language. */
    language: string
  }
  const blank = (): Draft => ({ name: '', title: albumName, message: '', password: '', removePassword: false, expires: '', downloadSizes: [], watermark: hasWatermark, proofing: true, showFilenames: true, language: '' })

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
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '')

  async function load() {
    shares = (await api<{ shares: ShareJson[] }>(`/api/shares?albumId=${encodeURIComponent(albumId)}`)).shares
  }
  onMount(load)

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
      }
      if (draft.password) body.password = draft.password
      else if (draft.removePassword) body.password = null
      if (editing === 'new') await api('/api/shares', { method: 'POST', body: JSON.stringify({ albumId, ...body }) })
      else await api(`/api/shares/${editing}`, { method: 'PATCH', body: JSON.stringify(body) })
      editing = null
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save the link.'
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

<section class="card stack">
  <div class="row head">
    <div>
      <h2>Share with clients</h2>
      <p class="muted small">A link shows this album to someone without an account. Each link has its own password, expiry and downloads. You can also invite clients to sign in and see it.</p>
    </div>
    {#if editing === null}<button class="btn btn-primary btn-sm" onclick={() => start(null)}>New link</button>{/if}
  </div>

  {#if live.length > 0}
    <ul class="links">
      {#each live as share (share.id)}
        <li>
          <div class="what">
            <strong>{share.name}</strong>
            <span class="row small">
              {#if share.status === 'expired'}<span class="badge">Expired {fmt(share.expiresAt)}</span>{:else if share.expiresAt}<span class="badge">Until {fmt(new Date(new Date(share.expiresAt).getTime() - 1).toISOString())}</span>{/if}
              {#if share.hasPassword}<span class="badge">Password</span>{/if}
              {#if share.watermark}<span class="badge">Watermark</span>{/if}
              {#if share.language}<span class="badge">In {LANGUAGES.find((l) => l.code === share.language)?.name}</span>{/if}
              {#if share.downloadSizes.length > 0}<span class="badge">Downloads: {share.downloadSizes.join(', ')}</span>{/if}
            </span>
            <span class="muted small">
              {share.stats.opens} {share.stats.opens === 1 ? 'open' : 'opens'} · {share.stats.visitors} picking · {share.stats.picks} favourites · {share.stats.downloads} downloads
            </span>
          </div>
          <div class="row">
            <code class="url">{linkFor(share)}</code>
            <button class="btn btn-sm" onclick={() => copy(share)}>{copied === share.id ? 'Copied' : 'Copy link'}</button>
            <a class="btn btn-sm" href={`/galleries/${share.id}`}>Picks and stats</a>
            <button class="btn btn-sm" onclick={() => start(share)}>Edit</button>
            <button class="btn btn-sm btn-danger" onclick={() => revoke(share)} onblur={() => confirming === share.id && arm(null)}>
              {confirming === share.id ? 'Click again to revoke' : 'Revoke'}
            </button>
          </div>
          {#if share.status === 'active'}<ShareClients shareId={share.id} />{/if}
        </li>
      {/each}
    </ul>
  {:else if editing === null}
    <p class="muted">No links yet.</p>
  {/if}

  {#if editing !== null}
    <form class="stack form" onsubmit={save}>
      <div class="grid">
        <div class="field">
          <label for="share-name">Who it's for (only you see this)</label>
          <input id="share-name" type="text" required maxlength="200" placeholder="e.g. The Smiths" bind:value={draft.name} />
        </div>
        <div class="field">
          <label for="share-title">Gallery title</label>
          <input id="share-title" type="text" maxlength="200" bind:value={draft.title} />
        </div>
      </div>
      <div class="field">
        <label for="share-message">Message to the client</label>
        <textarea id="share-message" rows="3" maxlength="2000" bind:value={draft.message}></textarea>
      </div>
      <div class="grid">
        <div class="field">
          <label for="share-password">{editing !== 'new' && shares.find((s) => s.id === editing)?.hasPassword ? 'New password (leave empty to keep it)' : 'Password (optional)'}</label>
          <input id="share-password" type="text" autocomplete="off" minlength="4" maxlength="200" bind:value={draft.password} disabled={draft.removePassword} />
          {#if editing !== 'new' && shares.find((s) => s.id === editing)?.hasPassword}
            <label class="check"><input type="checkbox" bind:checked={draft.removePassword} /> Remove the password</label>
          {/if}
        </div>
        <div class="field">
          <label for="share-expires">Open until (optional)</label>
          <input id="share-expires" type="date" bind:value={draft.expires} />
        </div>
        <div class="field">
          <label for="share-language">Gallery language</label>
          <select id="share-language" bind:value={draft.language}>
            <option value="">Each visitor's own (their browser)</option>
            {#each LANGUAGES as language (language.code)}<option value={language.code}>{language.name}</option>{/each}
          </select>
          {#if editing !== 'new'}
            {@const share = shares.find((s) => s.id === editing)}
            {#if share}
              <span class="muted small">Preview:
                {#each LANGUAGES as language, i (language.code)}{i ? ' · ' : ''}<a href={`/s/${share.token}?lang=${language.code}`} target="_blank" rel="noopener">{language.name}</a>{/each}
              </span>
            {/if}
          {/if}
        </div>
      </div>
      <fieldset>
        <legend class="label">Downloads</legend>
        {#each SIZES as [size, text] (size)}
          <label class="check"><input type="checkbox" value={size} bind:group={draft.downloadSizes} /> {text}</label>
        {/each}
        {#if draft.downloadSizes.includes('original')}
          <p class="muted small">Originals are never watermarked. Ones on a NAS or in deep storage can't be downloaded from a gallery.</p>
        {/if}
      </fieldset>
      <fieldset>
        <legend class="label">Options</legend>
        <label class="check"><input type="checkbox" bind:checked={draft.proofing} /> Clients can pick favourites</label>
        <label class="check"><input type="checkbox" bind:checked={draft.showFilenames} /> Show filenames</label>
        <label class="check">
          <input type="checkbox" bind:checked={draft.watermark} /> Watermark what clients see and download
          {#if !hasWatermark}<span class="muted small">(set one on the <a href="/galleries">Galleries</a> page first)</span>{/if}
        </label>
      </fieldset>
      {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
      <div class="row">
        <button class="btn btn-primary" type="submit" disabled={busy}>{editing === 'new' ? 'Make the link' : 'Save'}</button>
        <button class="btn" type="button" onclick={() => (editing = null)}>Cancel</button>
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
</style>

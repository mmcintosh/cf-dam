<script lang="ts">
  /** Bring a catalog back from a backup into this fresh install: find it, load it, choose your sign-in. */
  import { onDestroy } from 'svelte'

  export interface RestoreView {
    id: string
    backupId: string
    status: 'running' | 'restored' | 'finished' | 'failed'
    phase: 'tables' | 'bands' | 'reseed'
    rows: number
    totalRows: number
    error: string | null
    startedAt: string
  }
  interface Backup {
    id: string
    startedAt: string
    finishedAt: string
    rows: number
    photos: number
    problem: string | null
  }
  interface Props {
    tokenRequired: boolean
    blocked: boolean
    restore: RestoreView | null
  }
  let { tokenRequired, blocked, restore: initial }: Props = $props()

  let restore = $state<RestoreView | null>(initial)
  let token = $state('')
  let kind = $state<'r2' | 's3'>('r2')
  let s3 = $state({ endpoint: 'https://s3.us-east-1.amazonaws.com', region: 'us-east-1', bucket: '', accessKeyId: '', secretAccessKey: '', forcePathStyle: false })
  let backups = $state<Backup[] | null>(null)
  let chosen = $state('')
  let name = $state('')
  let email = $state('')
  let password = $state('')
  let confirm = $state('')
  let error = $state('')
  let busy = $state(false)

  const MESSAGES: Record<string, string> = {
    invalid_setup_token: 'That setup token is not right.',
    setup_token_not_configured: 'This deployment has no SETUP_TOKEN. Set it with `wrangler secret put SETUP_TOKEN`, then reload.',
    already_set_up: 'Setup is already done. Sign in instead.',
  }
  const PHASES: Record<RestoreView['phase'], string> = {
    tables: 'Loading the catalog',
    bands: 'Rebuilding look-alike matching',
    reseed: 'Finishing off',
  }
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const count = (n: number) => n.toLocaleString()
  /** A backup's id is when it started, with : and . made safe for keys. */
  const backupTime = (id: string) => id.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, 'T$1:$2:$3.$4Z')
  const percent = $derived(restore && restore.totalRows > 0 ? Math.min(100, Math.floor((restore.rows / restore.totalRows) * 100)) : 0)
  const source = () => (kind === 'r2' ? { kind } : { kind, ...s3 })

  async function post<T>(path: string, body: Record<string, unknown>): Promise<{ ok: true; data: T; response: Response } | { ok: false }> {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, token: token || undefined }) })
    if (response.ok) return { ok: true, data: (await response.json().catch(() => ({}))) as T, response }
    const failure = (await response.json().catch(() => ({}))) as { error?: string; message?: string }
    error = (failure.error && MESSAGES[failure.error]) || failure.message || `That didn’t work (${response.status}).`
    return { ok: false }
  }

  async function look(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    busy = true
    try {
      const result = await post<{ backups: Backup[] }>('/api/setup/restore/backups', { source: source() })
      if (result.ok) {
        backups = result.data.backups
        chosen = backups.find((b) => !b.problem)?.id ?? ''
      }
    } finally {
      busy = false
    }
  }

  async function start(backupId: string) {
    error = ''
    busy = true
    try {
      const result = await post<{ restore: RestoreView }>('/api/setup/restore', { source: source(), backupId })
      if (result.ok) restore = result.data.restore
    } finally {
      busy = false
    }
  }

  async function finish(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    if (password !== confirm) {
      error = 'The passwords do not match.'
      return
    }
    busy = true
    try {
      const result = await post('/api/setup/restore/finish', { name, email, password })
      if (result.ok) window.location.href = '/'
    } finally {
      busy = false
    }
  }

  // While it loads, ask how far it has got.
  const timer = setInterval(async () => {
    if (restore?.status !== 'running') return
    const state = (await fetch('/api/setup')
      .then((r) => r.json())
      .catch(() => null)) as { restore: RestoreView | null } | null
    if (state?.restore) restore = state.restore
  }, 5000)
  onDestroy(() => clearInterval(timer))
</script>

{#snippet tokenField()}
  {#if tokenRequired}
    <div class="field">
      <label for="restore-token">Setup token</label>
      <input id="restore-token" type="password" autocomplete="off" required bind:value={token} />
    </div>
  {/if}
{/snippet}

{#snippet sourceFields()}
  <fieldset class="field">
    <legend>Where the backups are</legend>
    <label class="choice"><input type="radio" bind:group={kind} value="r2" /> This install’s built-in storage (R2), if it still has them</label>
    <label class="choice"><input type="radio" bind:group={kind} value="s3" /> An S3 bucket (Amazon S3, or any S3-compatible store)</label>
  </fieldset>
  {#if kind === 's3'}
    <div class="field"><label for="s3-endpoint">Endpoint</label><input id="s3-endpoint" type="url" required bind:value={s3.endpoint} /></div>
    <div class="row">
      <div class="field"><label for="s3-region">Region</label><input id="s3-region" type="text" bind:value={s3.region} /></div>
      <div class="field"><label for="s3-bucket">Bucket</label><input id="s3-bucket" type="text" required bind:value={s3.bucket} /></div>
    </div>
    <div class="field"><label for="s3-key">Access key ID</label><input id="s3-key" type="text" autocomplete="off" required bind:value={s3.accessKeyId} /></div>
    <div class="field"><label for="s3-secret">Secret access key</label><input id="s3-secret" type="password" autocomplete="off" required bind:value={s3.secretAccessKey} /></div>
    <label class="choice"><input type="checkbox" bind:checked={s3.forcePathStyle} /> Path-style addresses (most stores other than Amazon need this)</label>
    <p class="muted small">Read-only keys are enough. They’re kept, sealed, only until the restore has finished.</p>
  {/if}
{/snippet}

<div class="stack">
  {#if blocked}
    <div class="alert alert-error">
      This deployment has no <code>SETUP_TOKEN</code> secret. Set one with
      <code>wrangler secret put SETUP_TOKEN</code>, then reload this page.
    </div>
  {/if}

  {#if restore?.status === 'running'}
    <div>
      <p><strong>{PHASES[restore.phase]}</strong> from the backup of {when(backupTime(restore.backupId))}.</p>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}><span style:width="{percent}%"></span></div>
      <p class="muted small">{count(restore.rows)} of {count(restore.totalRows)} rows. It carries on by itself, a part each minute; you can close this page and come back.</p>
      {#if restore.error}<p class="muted small">Last problem, being tried again: {restore.error}</p>{/if}
    </div>
  {:else if restore?.status === 'failed'}
    <form class="stack" onsubmit={(e) => (e.preventDefault(), start(restore!.backupId))}>
      <div class="alert alert-error" role="alert">The restore stopped after {count(restore.rows)} of {count(restore.totalRows)} rows: {restore.error}</div>
      <p class="muted small">Try again: it carries on where it stopped. Say again where the backup is.</p>
      {@render sourceFields()}
      {@render tokenField()}
      <button class="btn btn-primary" type="submit" disabled={busy || blocked}>{busy ? 'Starting…' : 'Try again'}</button>
    </form>
  {:else if restore?.status === 'restored'}
    <form class="stack" onsubmit={finish}>
      <p>The catalog is back: {count(restore.rows)} rows. Choose how you’ll sign in.</p>
      <p class="muted small">
        If your email was in the backup, that account becomes yours again, as an administrator. Nobody else has a password yet: set temporary
        ones on the People page. Agents need connecting again.
      </p>
      <div class="field"><label for="r-name">Your name</label><input id="r-name" type="text" autocomplete="name" required bind:value={name} /></div>
      <div class="field"><label for="r-email">Email</label><input id="r-email" type="email" autocomplete="email" required bind:value={email} /></div>
      <div class="field"><label for="r-password">Password</label><input id="r-password" type="password" autocomplete="new-password" minlength="12" required bind:value={password} /></div>
      <div class="field"><label for="r-confirm">Confirm password</label><input id="r-confirm" type="password" autocomplete="new-password" minlength="12" required bind:value={confirm} /></div>
      {@render tokenField()}
      <button class="btn btn-primary" type="submit" disabled={busy || blocked}>{busy ? 'Signing in…' : 'Sign in to the restored archive'}</button>
    </form>
  {:else}
    <form class="stack" onsubmit={look}>
      {@render sourceFields()}
      {@render tokenField()}
      <button class="btn" type="submit" disabled={busy || blocked}>{busy && !backups ? 'Looking…' : 'Look for backups'}</button>
    </form>
    {#if backups}
      {#if backups.length === 0}
        <p class="muted">No finished backups there. cf-dam keeps them under <code>cf-dam-backups/</code> at the top of the bucket.</p>
      {:else}
        <fieldset class="field">
          <legend>Choose a backup</legend>
          {#each backups as b (b.id)}
            <label class="choice" class:disabled={b.problem}>
              <input type="radio" bind:group={chosen} value={b.id} disabled={!!b.problem} />
              <span>
                {when(b.startedAt)}: {count(b.photos)} photos, {count(b.rows)} rows
                {#if b.problem}<span class="muted small"> {b.problem}</span>{/if}
              </span>
            </label>
          {/each}
        </fieldset>
        <button class="btn btn-primary" type="button" disabled={busy || !chosen || blocked} onclick={() => start(chosen)}>{busy ? 'Starting…' : 'Restore this backup'}</button>
      {/if}
    {/if}
  {/if}

  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
</div>

<style>
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  legend {
    margin-bottom: 4px;
  }
  .choice {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-weight: normal;
  }
  .choice input {
    width: auto;
  }
  .choice.disabled {
    opacity: 0.6;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .bar {
    height: 8px;
    border-radius: 999px;
    background: var(--border);
    overflow: hidden;
    margin: 8px 0;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .small {
    font-size: 0.8rem;
  }
  p {
    margin: 0;
  }
</style>

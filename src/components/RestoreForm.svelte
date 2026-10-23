<script lang="ts">
  import { format, t, tHtml } from '@cf-dam/i18n/client'
  import type { MessageKey } from '@cf-dam/i18n'
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

  const MESSAGES: Record<string, MessageKey> = {
    invalid_setup_token: 'setup.badToken',
    already_set_up: 'setup.alreadyDone',
  }
  const PHASES: Record<RestoreView['phase'], MessageKey> = {
    tables: 'restore.phase.tables',
    bands: 'restore.phase.bands',
    reseed: 'restore.phase.reseed',
  }
  const when = (iso: string) => format().dateTime(iso)
  /** A backup's id is when it started, with : and . made safe for keys. */
  const backupTime = (id: string) => id.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, 'T$1:$2:$3.$4Z')
  const percent = $derived(restore && restore.totalRows > 0 ? Math.min(100, Math.floor((restore.rows / restore.totalRows) * 100)) : 0)
  const source = () => (kind === 'r2' ? { kind } : { kind, ...s3 })

  async function post<T>(path: string, body: Record<string, unknown>): Promise<{ ok: true; data: T; response: Response } | { ok: false }> {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, token: token || undefined }) })
    if (response.ok) return { ok: true, data: (await response.json().catch(() => ({}))) as T, response }
    const failure = (await response.json().catch(() => ({}))) as { error?: string; message?: string }
    const known = failure.error === 'setup_token_not_configured' ? t('setup.noToken', { command: 'wrangler secret put SETUP_TOKEN' }) : failure.error && MESSAGES[failure.error] ? t(MESSAGES[failure.error]!) : null
    error = known || failure.message || t('restore.failedStatus', { status: String(response.status) })
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
      error = t('setup.mismatch')
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
      <label for="restore-token">{t('setup.token')}</label>
      <input id="restore-token" type="password" autocomplete="off" required bind:value={token} />
    </div>
  {/if}
{/snippet}

{#snippet sourceFields()}
  <fieldset class="field">
    <legend>{t('restore.where')}</legend>
    <label class="choice"><input type="radio" bind:group={kind} value="r2" /> {t('restore.r2')}</label>
    <label class="choice"><input type="radio" bind:group={kind} value="s3" /> {t('restore.s3')}</label>
  </fieldset>
  {#if kind === 's3'}
    <div class="field"><label for="s3-endpoint">{t('conn.endpoint')}</label><input id="s3-endpoint" type="url" required bind:value={s3.endpoint} /></div>
    <div class="row">
      <div class="field"><label for="s3-region">{t('conn.region')}</label><input id="s3-region" type="text" bind:value={s3.region} /></div>
      <div class="field"><label for="s3-bucket">{t('conn.bucket')}</label><input id="s3-bucket" type="text" required bind:value={s3.bucket} /></div>
    </div>
    <div class="field"><label for="s3-key">{t('conn.accessKeyId')}</label><input id="s3-key" type="text" autocomplete="off" required bind:value={s3.accessKeyId} /></div>
    <div class="field"><label for="s3-secret">{t('conn.secret')}</label><input id="s3-secret" type="password" autocomplete="off" required bind:value={s3.secretAccessKey} /></div>
    <label class="choice"><input type="checkbox" bind:checked={s3.forcePathStyle} /> {t('restore.pathStyle')}</label>
    <p class="muted small">{t('restore.keysNote')}</p>
  {/if}
{/snippet}

<div class="stack">
  {#if blocked}
    <div class="alert alert-error">
      {t('setup.noToken', { command: 'wrangler secret put SETUP_TOKEN' })}
    </div>
  {/if}

  {#if restore?.status === 'running'}
    <div>
      <p>{@html tHtml('restore.running', { phase: t(PHASES[restore.phase]), date: when(backupTime(restore.backupId)) })}</p>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}><span style:width="{percent}%"></span></div>
      <p class="muted small">{t('restore.progress', { done: restore.rows, total: restore.totalRows })}</p>
      {#if restore.error}<p class="muted small">{t('restore.retrying', { error: restore.error })}</p>{/if}
    </div>
  {:else if restore?.status === 'failed'}
    <form class="stack" onsubmit={(e) => (e.preventDefault(), start(restore!.backupId))}>
      <div class="alert alert-error" role="alert">{t('restore.stopped', { done: restore.rows, total: restore.totalRows, error: restore.error ?? '' })}</div>
      <p class="muted small">{t('restore.tryAgainLead')}</p>
      {@render sourceFields()}
      {@render tokenField()}
      <button class="btn btn-primary" type="submit" disabled={busy || blocked}>{busy ? t('restore.starting') : t('restore.tryAgain')}</button>
    </form>
  {:else if restore?.status === 'restored'}
    <form class="stack" onsubmit={finish}>
      <p>{t('restore.back', { rows: restore.rows })}</p>
      <p class="muted small">{t('restore.backLead')}</p>
      <div class="field"><label for="r-name">{t('setup.yourName')}</label><input id="r-name" type="text" autocomplete="name" required bind:value={name} /></div>
      <div class="field"><label for="r-email">{t('common.email')}</label><input id="r-email" type="email" autocomplete="email" required bind:value={email} /></div>
      <div class="field"><label for="r-password">{t('common.password')}</label><input id="r-password" type="password" autocomplete="new-password" minlength="12" required bind:value={password} /></div>
      <div class="field"><label for="r-confirm">{t('setup.confirm')}</label><input id="r-confirm" type="password" autocomplete="new-password" minlength="12" required bind:value={confirm} /></div>
      {@render tokenField()}
      <button class="btn btn-primary" type="submit" disabled={busy || blocked}>{busy ? t('auth.signIn.busy') : t('restore.signInRestored')}</button>
    </form>
  {:else}
    <form class="stack" onsubmit={look}>
      {@render sourceFields()}
      {@render tokenField()}
      <button class="btn" type="submit" disabled={busy || blocked}>{busy && !backups ? t('restore.looking') : t('restore.look')}</button>
    </form>
    {#if backups}
      {#if backups.length === 0}
        <p class="muted">{@html tHtml('restore.none')}</p>
      {:else}
        <fieldset class="field">
          <legend>{t('restore.choose')}</legend>
          {#each backups as b (b.id)}
            <label class="choice" class:disabled={b.problem}>
              <input type="radio" bind:group={chosen} value={b.id} disabled={!!b.problem} />
              <span>
                {t('restore.item', { date: when(b.startedAt), photos: t('common.photos', { count: b.photos }), rows: b.rows })}
                {#if b.problem}<span class="muted small"> {b.problem}</span>{/if}
              </span>
            </label>
          {/each}
        </fieldset>
        <button class="btn btn-primary" type="button" disabled={busy || !chosen || blocked} onclick={() => start(chosen)}>{busy ? t('restore.starting') : t('restore.restoreThis')}</button>
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

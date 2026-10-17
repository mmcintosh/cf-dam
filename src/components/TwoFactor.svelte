<script lang="ts">
  import { renderSVG } from 'uqr'
  import { authClient } from '../lib/auth-client'

  interface Props {
    enabled: boolean
  }
  let { enabled: initiallyEnabled }: Props = $props()

  let enabled = $state(initiallyEnabled)
  let stage = $state<'idle' | 'password' | 'scan' | 'codes' | 'disable'>('idle')
  let password = $state('')
  let code = $state('')
  let totpUri = $state('')
  let backupCodes = $state<string[]>([])
  let error = $state('')
  let busy = $state(false)

  const qr = $derived(totpUri ? renderSVG(totpUri, { border: 1 }) : '')
  const secret = $derived(totpUri ? (new URL(totpUri).searchParams.get('secret') ?? '') : '')

  async function start(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    busy = true
    const { data, error: failure } = await authClient.twoFactor.enable({ password })
    busy = false
    if (failure || !data) {
      error = failure?.message ?? 'Could not start enrolment. Check your password.'
      return
    }
    totpUri = data.totpURI
    backupCodes = data.backupCodes
    password = ''
    stage = 'scan'
  }

  async function confirm(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    busy = true
    const { error: failure } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') })
    busy = false
    if (failure) {
      error = 'That code did not match. Check the time on your phone and try the next code.'
      return
    }
    code = ''
    enabled = true
    stage = 'codes'
  }

  async function disable(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    busy = true
    const { error: failure } = await authClient.twoFactor.disable({ password })
    busy = false
    if (failure) {
      error = failure.message ?? 'Could not turn off two-factor sign-in.'
      return
    }
    password = ''
    enabled = false
    stage = 'idle'
  }
</script>

<div class="stack">
  <div class="row">
    <span class="badge" class:badge-ok={enabled} class:badge-off={!enabled}>{enabled ? 'On' : 'Off'}</span>
    <span class="muted">
      {enabled ? 'Sign-in asks for a code from your authenticator app.' : 'Add a code from an authenticator app to every sign-in.'}
    </span>
  </div>

  {#if stage === 'idle'}
    <div>
      {#if enabled}
        <button class="btn btn-danger" onclick={() => (stage = 'disable')}>Turn off</button>
      {:else}
        <button class="btn" onclick={() => (stage = 'password')}>Set up two-factor sign-in</button>
      {/if}
    </div>
  {:else if stage === 'password' || stage === 'disable'}
    <form class="stack" onsubmit={stage === 'password' ? start : disable}>
      <div class="field">
        <label for="tf-password">Confirm your password</label>
        <input id="tf-password" type="password" autocomplete="current-password" required bind:value={password} />
      </div>
      <div class="row">
        <button class="btn btn-primary" type="submit" disabled={busy}>{stage === 'password' ? 'Continue' : 'Turn off'}</button>
        <button class="btn" type="button" onclick={() => ((stage = 'idle'), (error = ''))}>Cancel</button>
      </div>
    </form>
  {:else if stage === 'scan'}
    <form class="stack" onsubmit={confirm}>
      <p class="muted">Scan this with your authenticator app, then enter the code it shows.</p>
      <div class="qr">{@html qr}</div>
      <p class="muted">Can't scan? Enter this key: <code class="secret">{secret}</code></p>
      <div class="field">
        <label for="tf-code">Code</label>
        <input id="tf-code" type="text" inputmode="numeric" autocomplete="one-time-code" required bind:value={code} />
      </div>
      <div><button class="btn btn-primary" type="submit" disabled={busy}>Verify and turn on</button></div>
    </form>
  {:else if stage === 'codes'}
    <div class="stack">
      <div class="alert alert-success">Two-factor sign-in is on.</div>
      <p class="muted">Save these backup codes somewhere safe. Each one works once if you lose your phone. They won't be shown again.</p>
      <div class="codes mono">
        {#each backupCodes as backupCode (backupCode)}<span>{backupCode}</span>{/each}
      </div>
      <div><button class="btn" onclick={() => (stage = 'idle')}>I've saved them</button></div>
    </div>
  {/if}

  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
</div>

<style>
  .qr {
    width: 200px;
    padding: 10px;
    border-radius: var(--radius);
    background: #fff;
  }
  .qr :global(svg) {
    display: block;
    width: 100%;
    height: auto;
  }
  .secret {
    word-break: break-all;
  }
  .codes {
    display: grid;
    grid-template-columns: repeat(2, max-content);
    gap: 6px 24px;
    padding: 14px 16px;
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
  }
</style>

<script lang="ts">
  import { onMount } from 'svelte'
  import { authClient, safeNext } from '../lib/auth-client'

  let email = $state('')
  let password = $state('')
  let code = $state('')
  let useBackupCode = $state(false)
  let step = $state<'password' | 'second-factor'>('password')
  let error = $state('')
  let busy = $state(false)

  function done() {
    window.location.href = safeNext(new URLSearchParams(window.location.search).get('next'))
  }

  async function signIn(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    busy = true
    const { data, error: failure } = await authClient.signIn.email({ email, password })
    busy = false
    if (failure) {
      error =
        failure.status === 429 ? 'Too many attempts. Wait a minute and try again.'
        : failure.code === 'ACCOUNT_LOCKED' ? (failure.message ?? 'Too many wrong passwords. Try again later, or sign in with a passkey.')
        : failure.code === 'USE_PASSKEY' ? (failure.message ?? 'This account signs in with a passkey.')
        : 'Wrong email or password.'
      return
    }
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
      step = 'second-factor'
      return
    }
    done()
  }

  /** A passkey (1Password, iCloud Keychain, Windows Hello…) signs in on its own: no password, no code. */
  async function passkey() {
    error = ''
    busy = true
    const { data, error: failure } = await authClient.signIn.passkey()
    busy = false
    if (data) return done()
    if (failure) {
      error =
        failure.status === 429 ? 'Too many attempts. Wait a minute and try again.'
        : failure.status === 401 ? (failure.message ?? 'That passkey is not one this archive knows.')
        : 'No passkey was used. Try again, or sign in with your password.'
    }
  }

  // Offer saved passkeys in the email field's autofill, where the browser and password manager support it.
  onMount(() => {
    void (async () => {
      if (!(await window.PublicKeyCredential?.isConditionalMediationAvailable?.())) return
      const { data } = await authClient.signIn.passkey({ autoFill: true })
      if (data) done()
    })()
  })

  async function verify(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    busy = true
    const result = useBackupCode
      ? await authClient.twoFactor.verifyBackupCode({ code: code.trim() })
      : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') })
    busy = false
    if (result.error) {
      error = result.error.status === 429 ? 'Too many attempts. Wait a minute.' : 'That code did not work.'
      return
    }
    done()
  }
</script>

{#if step === 'password'}
  <form class="stack" onsubmit={signIn}>
    <div>
      <h2>Sign in</h2>
      <p class="lead">Welcome back to your archive.</p>
    </div>
    <div class="field">
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="username webauthn" required bind:value={email} />
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input id="password" type="password" autocomplete="current-password" required bind:value={password} />
    </div>
    {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
    <button class="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    <div class="or" aria-hidden="true"><span>or</span></div>
    <button class="btn" type="button" onclick={passkey} disabled={busy}>Sign in with a passkey</button>
  </form>
{:else}
  <form class="stack" onsubmit={verify}>
    <div>
      <h2>Two-factor check</h2>
      <p class="lead">
        {useBackupCode ? 'Enter one of your backup codes.' : 'Enter the six-digit code from your authenticator app.'}
      </p>
    </div>
    <div class="field">
      <label for="code">{useBackupCode ? 'Backup code' : 'Code'}</label>
      <input
        id="code"
        type="text"
        inputmode={useBackupCode ? 'text' : 'numeric'}
        autocomplete="one-time-code"
        required
        bind:value={code}
      />
    </div>
    {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
    <button class="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Verify'}</button>
    <button class="btn btn-sm" type="button" onclick={() => ((useBackupCode = !useBackupCode), (code = ''))}>
      {useBackupCode ? 'Use the authenticator code' : 'Use a backup code instead'}
    </button>
  </form>
{/if}

<style>
  .or {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--text-faint);
    font-size: 0.8rem;
  }
  .or::before,
  .or::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--border);
  }
</style>

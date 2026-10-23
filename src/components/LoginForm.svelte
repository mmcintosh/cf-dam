<script lang="ts">
  import { onMount } from 'svelte'
  import { authClient, safeNext } from '../lib/auth-client'
  import { t } from '@cf-dam/i18n/client'

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
        failure.status === 429 ? t('auth.error.tooMany')
        : failure.code === 'ACCOUNT_LOCKED' ? (failure.message ?? t('auth.error.locked'))
        : failure.code === 'USE_PASSKEY' ? (failure.message ?? t('auth.error.usePasskey'))
        : t('auth.error.wrong')
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
        failure.status === 429 ? t('auth.error.tooMany')
        : failure.status === 401 ? t('auth.passkey.unknown')
        : t('auth.passkey.none')
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
      error = result.error.status === 429 ? t('auth.twoFactor.tooMany') : t('auth.twoFactor.wrong')
      return
    }
    done()
  }
</script>

{#if step === 'password'}
  <form class="stack" onsubmit={signIn}>
    <div>
      <h2>{t('auth.signIn.title')}</h2>
      <p class="lead">{t('auth.signIn.lead')}</p>
    </div>
    <div class="field">
      <label for="email">{t('common.email')}</label>
      <input id="email" type="email" autocomplete="username webauthn" required bind:value={email} />
    </div>
    <div class="field">
      <label for="password">{t('common.password')}</label>
      <input id="password" type="password" autocomplete="current-password" required bind:value={password} />
    </div>
    {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
    <button class="btn btn-primary" type="submit" disabled={busy}>{busy ? t('auth.signIn.busy') : t('auth.signIn.submit')}</button>
    <div class="or" aria-hidden="true"><span>{t('common.or')}</span></div>
    <button class="btn" type="button" onclick={passkey} disabled={busy}>{t('auth.signIn.passkey')}</button>
  </form>
{:else}
  <form class="stack" onsubmit={verify}>
    <div>
      <h2>{t('auth.twoFactor.title')}</h2>
      <p class="lead">
        {useBackupCode ? t('auth.twoFactor.backupLead') : t('auth.twoFactor.codeLead')}
      </p>
    </div>
    <div class="field">
      <label for="code">{useBackupCode ? t('auth.twoFactor.backupLabel') : t('auth.twoFactor.codeLabel')}</label>
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
    <button class="btn btn-primary" type="submit" disabled={busy}>{busy ? t('auth.twoFactor.busy') : t('auth.twoFactor.verify')}</button>
    <button class="btn btn-sm" type="button" onclick={() => ((useBackupCode = !useBackupCode), (code = ''))}>
      {useBackupCode ? t('auth.twoFactor.useCode') : t('auth.twoFactor.useBackup')}
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

<script lang="ts">
  import { t } from '@cf-dam/i18n/client'
  import { renderSVG } from 'uqr'
  import { authClient } from '../lib/auth-client'

  interface Props {
    enabled: boolean
    /** Where to go once codes are on and the backup codes saved (two-factor being required). */
    next?: string
  }
  let { enabled: initiallyEnabled, next }: Props = $props()

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
      error = failure?.code === 'INVALID_PASSWORD' ? t('account.wrongPassword') : t('twoFactor.startFailed')
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
      error = t('twoFactor.noMatch')
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
      error = failure.code === 'INVALID_PASSWORD' ? t('account.wrongPassword') : t('twoFactor.offFailed')
      return
    }
    password = ''
    enabled = false
    stage = 'idle'
  }
</script>

<div class="stack">
  <div class="row">
    <span class="badge" class:badge-ok={enabled} class:badge-off={!enabled}>{enabled ? t('common.on') : t('common.off')}</span>
    <span class="muted">
      {enabled ? t('twoFactor.onLead') : t('twoFactor.offLead')}
    </span>
  </div>

  {#if stage === 'idle'}
    <div>
      {#if enabled}
        <button class="btn btn-danger" onclick={() => (stage = 'disable')}>{t('twoFactor.turnOff')}</button>
      {:else}
        <button class="btn" onclick={() => (stage = 'password')}>{t('twoFactor.setUp')}</button>
      {/if}
    </div>
  {:else if stage === 'password' || stage === 'disable'}
    <form class="stack" onsubmit={stage === 'password' ? start : disable}>
      <div class="field">
        <label for="tf-password">{t('twoFactor.confirmPassword')}</label>
        <input id="tf-password" type="password" autocomplete="current-password" required bind:value={password} />
      </div>
      <div class="row">
        <button class="btn btn-primary" type="submit" disabled={busy}>{stage === 'password' ? t('common.continue') : t('twoFactor.turnOff')}</button>
        <button class="btn" type="button" onclick={() => ((stage = 'idle'), (error = ''))}>{t('common.cancel')}</button>
      </div>
    </form>
  {:else if stage === 'scan'}
    <form class="stack" onsubmit={confirm}>
      <p class="muted">{t('twoFactor.scan')}</p>
      <div class="qr">{@html qr}</div>
      <p class="muted">{t('twoFactor.cantScan')} <code class="secret">{secret}</code></p>
      <div class="field">
        <label for="tf-code">{t('auth.twoFactor.codeLabel')}</label>
        <input id="tf-code" type="text" inputmode="numeric" autocomplete="one-time-code" required bind:value={code} />
      </div>
      <div><button class="btn btn-primary" type="submit" disabled={busy}>{t('twoFactor.verifyOn')}</button></div>
    </form>
  {:else if stage === 'codes'}
    <div class="stack">
      <div class="alert alert-success">{t('twoFactor.isOn')}</div>
      <p class="muted">{t('twoFactor.saveCodes')}</p>
      <div class="codes mono">
        {#each backupCodes as backupCode (backupCode)}<span>{backupCode}</span>{/each}
      </div>
      <div><button class="btn" onclick={() => (next ? location.assign(next) : (stage = 'idle'))}>{t('twoFactor.saved')}</button></div>
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

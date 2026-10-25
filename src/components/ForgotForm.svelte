<script lang="ts">
  /** "Forgot your password?": asks for a reset link. The answer is the same whether or not the address has an account. */
  import { t } from '@cf-dam/i18n/client'

  let email = $state('')
  let busy = $state(false)
  let sent = $state(false)
  let error = $state('')

  async function send(event: SubmitEvent) {
    event.preventDefault()
    busy = true
    error = ''
    try {
      const response = await fetch('/api/auth/request-password-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) })
      if (response.status === 429) error = t('auth.error.tooMany')
      else if (!response.ok) error = t('auth.forgot.failed')
      else sent = true
    } catch {
      error = t('auth.forgot.failed')
    } finally {
      busy = false
    }
  }
</script>

{#if sent}
  <div class="stack">
    <h2>{t('auth.forgot.sentTitle')}</h2>
    <p class="muted">{t('auth.forgot.sentLead', { email: email.trim() })}</p>
    <p><a class="btn" href="/login">{t('auth.forgot.back')}</a></p>
  </div>
{:else}
  <form class="stack" onsubmit={send}>
    <div>
      <h2>{t('auth.forgot.title')}</h2>
      <p class="lead">{t('auth.forgot.lead')}</p>
    </div>
    <div class="field">
      <label for="forgot-email">{t('common.email')}</label>
      <input id="forgot-email" type="email" autocomplete="username" required maxlength="254" bind:value={email} />
    </div>
    {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
    <button class="btn btn-primary" type="submit" disabled={busy}>{t('auth.forgot.submit')}</button>
    <a class="back" href="/login">{t('auth.forgot.back')}</a>
  </form>
{/if}

<style>
  .back {
    text-align: center;
    font-size: 0.88rem;
  }
</style>

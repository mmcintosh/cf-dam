<script lang="ts">
  /** A reset link from an email: choose a new password. Every other sign-in of the account is ended. */
  import { t } from '@cf-dam/i18n/client'

  let { token, signedIn }: { token: string; signedIn: boolean } = $props()

  let password = $state('')
  let again = $state('')
  let show = $state(false)
  let busy = $state(false)
  let done = $state(false)
  let error = $state('')

  async function reset(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    if (password !== again) {
      error = t('invite.mismatch')
      return
    }
    busy = true
    try {
      const response = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword: password, token }) })
      const body = (await response.json().catch(() => ({}))) as { code?: string }
      if (response.ok) done = true
      else if (response.status === 429) error = t('auth.error.tooMany')
      else if (body.code === 'INVALID_TOKEN' || body.code === 'USER_NOT_FOUND') error = t('auth.reset.expired')
      else if (body.code === 'PASSWORD_TOO_SHORT') error = t('auth.reset.tooShort')
      else error = t('auth.reset.failed')
    } catch {
      error = t('auth.reset.failed')
    } finally {
      busy = false
    }
  }
</script>

{#if !token}
  <div class="stack">
    <h2>{t('auth.reset.title')}</h2>
    <p class="muted">{t('auth.reset.expired')}</p>
    <p><a class="btn" href="/forgot-password">{t('auth.reset.again')}</a></p>
  </div>
{:else if done}
  <div class="stack">
    <h2>{t('auth.reset.doneTitle')}</h2>
    <p class="muted">{t('auth.reset.doneLead')}</p>
    <p><a class="btn btn-primary" href="/login">{t('auth.reset.signIn')}</a></p>
  </div>
{:else}
  <form class="stack" onsubmit={reset}>
    <div>
      <h2>{t('auth.reset.title')}</h2>
      <p class="lead">{t('auth.reset.lead')}</p>
      {#if signedIn}<p class="muted note">{t('auth.reset.signedIn')}</p>{/if}
    </div>
    <div class="field">
      <label for="reset-password">{t('auth.reset.new')} <span class="muted">{t('invite.minLength')}</span></label>
      <input id="reset-password" type={show ? 'text' : 'password'} autocomplete="new-password" required minlength="12" maxlength="256" bind:value={password} />
    </div>
    <div class="field">
      <label for="reset-again">{t('invite.again')}</label>
      <input id="reset-again" type={show ? 'text' : 'password'} autocomplete="new-password" required minlength="12" maxlength="256" bind:value={again} />
    </div>
    <label class="check"><input type="checkbox" bind:checked={show} /> {t('invite.show')}</label>
    {#if error}
      <div class="alert alert-error" role="alert">{error}</div>
      <a class="again" href="/forgot-password">{t('auth.reset.again')}</a>
    {/if}
    <button class="btn btn-primary" type="submit" disabled={busy}>{t('auth.reset.submit')}</button>
  </form>
{/if}

<style>
  .note,
  .again {
    font-size: 0.88rem;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
  }
</style>

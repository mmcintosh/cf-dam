<script lang="ts">
  /** A new client choosing their password from their invite link, then signed straight in. */
  import { authClient } from '../lib/auth-client'
  import { t } from '@cf-dam/i18n/client'

  let { token, name, email }: { token: string; name: string; email: string } = $props()

  let password = $state('')
  let again = $state('')
  let show = $state(false)
  let error = $state('')
  let busy = $state(false)

  async function join(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    if (password !== again) {
      error = t('invite.mismatch')
      return
    }
    busy = true
    try {
      const response = await fetch(`/api/invites/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string }
        error = response.status === 429 ? t('auth.error.tooMany') : (body.message ?? t('invite.failed'))
        busy = false
        return
      }
      const { error: failure } = await authClient.signIn.email({ email, password })
      // The password is set either way; if signing in hiccups, the sign-in page works with it.
      window.location.href = failure ? '/login' : '/'
    } catch {
      error = t('invite.offline')
      busy = false
    }
  }
</script>

<form class="stack" onsubmit={join}>
  <div>
    <h1>{t('invite.welcome', { name: name.split(/\s+/)[0] || name })}</h1>
    {@const [before, after = ''] = t('invite.lead', { email: '\u0000' }).split('\u0000')}
    <p class="muted">{before}<strong>{email}</strong>{after}</p>
  </div>
  <input type="email" autocomplete="username" value={email} hidden readonly />
  <div class="field">
    <label for="new-password">{t('invite.choose')} <span class="muted">{t('invite.minLength')}</span></label>
    <input id="new-password" type={show ? 'text' : 'password'} autocomplete="new-password" required minlength="12" maxlength="256" bind:value={password} />
  </div>
  <div class="field">
    <label for="new-password-again">{t('invite.again')}</label>
    <input id="new-password-again" type={show ? 'text' : 'password'} autocomplete="new-password" required minlength="12" maxlength="256" bind:value={again} />
  </div>
  <label class="check"><input type="checkbox" bind:checked={show} /> {t('invite.show')}</label>
  {@const [tipBefore, tipAfter = ''] = t('invite.tip', { example: '\u0000' }).split('\u0000')}
  <p class="muted small">{tipBefore}<em>{t('invite.tipExample')}</em>{tipAfter}</p>
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
  <button class="btn btn-primary" type="submit" disabled={busy}>{busy ? t('invite.busy') : t('invite.submit')}</button>
</form>

<style>
  h1 {
    font-size: 1.4rem;
    margin-bottom: 6px;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 0.9rem;
  }
  .small {
    font-size: 0.85rem;
  }
</style>

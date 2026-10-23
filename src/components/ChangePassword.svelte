<script lang="ts">
  import { authClient } from '../lib/auth-client'
  import { t } from '@cf-dam/i18n/client'

  interface Props {
    /** Where to go once the password is changed (a temporary password being replaced). */
    next?: string
  }
  let { next }: Props = $props()

  let currentPassword = $state('')
  let newPassword = $state('')
  let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null)
  let busy = $state(false)

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    busy = true
    // Other sessions end: a password change is when you'd want a stolen session gone.
    const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true })
    busy = false
    if (error) {
      // Better Auth's own messages are English: say it in the reader's language from the code.
      const text =
        error.code === 'INVALID_PASSWORD' ? t('account.password.wrongCurrent')
        : error.code === 'PASSWORD_TOO_SHORT' ? t('account.password.tooShort')
        : error.code === 'SAME_PASSWORD' ? (error.message ?? t('account.password.failed'))
        : t('account.password.failed')
      message = { kind: 'error', text }
      return
    }
    currentPassword = newPassword = ''
    if (next) return location.assign(next)
    message = { kind: 'ok', text: t('account.password.changed') }
  }
</script>

<form class="stack" onsubmit={submit}>
  <div class="field">
    <label for="current-password">{t('account.password.current')}</label>
    <input id="current-password" type="password" autocomplete="current-password" required bind:value={currentPassword} />
  </div>
  <div class="field">
    <label for="new-password">{t('account.password.new')}</label>
    <input id="new-password" type="password" autocomplete="new-password" minlength="12" required bind:value={newPassword} />
  </div>
  {#if message}
    <div class="alert" class:alert-error={message.kind === 'error'} class:alert-success={message.kind === 'ok'}>{message.text}</div>
  {/if}
  <div><button class="btn" type="submit" disabled={busy}>{t('account.password.change')}</button></div>
</form>

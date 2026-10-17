<script lang="ts">
  import { authClient } from '../lib/auth-client'

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
      message = { kind: 'error', text: error.message ?? 'Could not change the password.' }
      return
    }
    currentPassword = newPassword = ''
    message = { kind: 'ok', text: 'Password changed. Your other sessions were signed out.' }
  }
</script>

<form class="stack" onsubmit={submit}>
  <div class="field">
    <label for="current-password">Current password</label>
    <input id="current-password" type="password" autocomplete="current-password" required bind:value={currentPassword} />
  </div>
  <div class="field">
    <label for="new-password">New password</label>
    <input id="new-password" type="password" autocomplete="new-password" minlength="12" required bind:value={newPassword} />
  </div>
  {#if message}
    <div class="alert" class:alert-error={message.kind === 'error'} class:alert-success={message.kind === 'ok'}>{message.text}</div>
  {/if}
  <div><button class="btn" type="submit" disabled={busy}>Change password</button></div>
</form>

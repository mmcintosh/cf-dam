<script lang="ts">
  /** A new client choosing their password from their invite link, then signed straight in. */
  import { authClient } from '../lib/auth-client'

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
      error = "The two passwords aren't the same."
      return
    }
    busy = true
    try {
      const response = await fetch(`/api/invites/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string }
        error = response.status === 429 ? 'Too many attempts. Wait a minute and try again.' : (body.message ?? 'That did not work. Try again.')
        busy = false
        return
      }
      const { error: failure } = await authClient.signIn.email({ email, password })
      // The password is set either way; if signing in hiccups, the sign-in page works with it.
      window.location.href = failure ? '/login' : '/'
    } catch {
      error = 'That did not work. Check your connection and try again.'
      busy = false
    }
  }
</script>

<form class="stack" onsubmit={join}>
  <div>
    <h1>Welcome, {name.split(/\s+/)[0] || name}</h1>
    <p class="muted">Your photographer has shared photos with you. Choose a password to see them. Next time, sign in with <strong>{email}</strong> and this password.</p>
  </div>
  <input type="email" autocomplete="username" value={email} hidden readonly />
  <div class="field">
    <label for="new-password">Choose a password <span class="muted">(at least 12 characters)</span></label>
    <input id="new-password" type={show ? 'text' : 'password'} autocomplete="new-password" required minlength="12" maxlength="256" bind:value={password} />
  </div>
  <div class="field">
    <label for="new-password-again">Type it again</label>
    <input id="new-password-again" type={show ? 'text' : 'password'} autocomplete="new-password" required minlength="12" maxlength="256" bind:value={again} />
  </div>
  <label class="check"><input type="checkbox" bind:checked={show} /> Show the password</label>
  <p class="muted small">A few words you'll remember make a good password, such as <em>blue kettle summer garden</em>. A password manager can make and keep one for you.</p>
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
  <button class="btn btn-primary" type="submit" disabled={busy}>{busy ? 'One moment…' : 'See my photos'}</button>
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

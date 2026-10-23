<script lang="ts">
  import { authClient } from '../lib/auth-client'

  /** Where to go after: the sign-in page, or (on an invite) back to the same page. */
  let { to = '/login' }: { to?: string } = $props()
  let busy = $state(false)

  async function signOut() {
    busy = true
    await authClient.signOut()
    window.location.href = to
  }
</script>

<button class="btn btn-sm" onclick={signOut} disabled={busy}>Sign out</button>

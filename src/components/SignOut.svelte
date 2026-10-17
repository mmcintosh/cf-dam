<script lang="ts">
  import { authClient } from '../lib/auth-client'

  let busy = $state(false)

  async function signOut() {
    busy = true
    await authClient.signOut()
    window.location.href = '/login'
  }
</script>

<button class="btn btn-sm" onclick={signOut} disabled={busy}>Sign out</button>

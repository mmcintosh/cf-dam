<script lang="ts">
  import { authClient } from '../lib/auth-client'
  import { t } from '@cf-dam/i18n/client'

  /** Where to go after: the sign-in page, or (on an invite) back to the same page. */
  let { to = '/login' }: { to?: string } = $props()
  let busy = $state(false)

  async function signOut() {
    busy = true
    await authClient.signOut()
    window.location.href = to
  }
</script>

<button class="btn btn-sm" onclick={signOut} disabled={busy}>{t('common.signOut')}</button>

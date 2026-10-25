<script lang="ts">
  /** On a client's "Your galleries": emails about this gallery (reminders, new photos) on or off. */
  import { t } from '@cf-dam/i18n/client'
  import { api } from '../lib/auth-client'

  let { token, off }: { token: string; off: boolean } = $props()
  // svelte-ignore state_referenced_locally
  let isOff = $state(off)
  let busy = $state(false)

  async function toggle() {
    busy = true
    try {
      await api(`/api/me/galleries/${token}/emails`, { method: 'PUT', body: JSON.stringify({ on: isOff }) })
      isOff = !isOff
    } finally {
      busy = false
    }
  }
</script>

<span class="emails small">
  <span class="muted">{isOff ? t('mine.emailsOff') : t('mine.emailsOn')}</span>
  <button class="btn btn-sm" type="button" disabled={busy} onclick={toggle}>{isOff ? t('mine.turnOn') : t('mine.turnOff')}</button>
</span>

<style>
  .emails {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
</style>

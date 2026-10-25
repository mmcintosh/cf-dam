<script lang="ts">
  /** On Account, for those who see alerts: an email when something new needs attention. */
  import { t } from '@cf-dam/i18n/client'
  import { api } from '../lib/auth-client'

  let { initial, mailOn }: { initial: boolean; mailOn: boolean } = $props()
  // svelte-ignore state_referenced_locally
  let on = $state(initial)
  let saved = $state(false)

  async function change() {
    saved = false
    await api('/api/me/preferences', { method: 'PUT', body: JSON.stringify({ alertEmails: on }) })
    saved = true
  }
</script>

<label class="row check">
  <input type="checkbox" bind:checked={on} onchange={change} />
  {t('account.alertEmails.label')}
  {#if saved}<span class="muted small" role="status">{t('common.saved')}</span>{/if}
</label>
{#if !mailOn}<p class="muted small">{t('account.alertEmails.mailOff')}</p>{/if}

<style>
  .check {
    gap: 8px;
    align-items: center;
  }
  .small {
    font-size: 0.85rem;
  }
</style>

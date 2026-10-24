<script lang="ts">
  /** Erase a client and their logins, after typing their name. Galleries, albums and photos stay. */
  import { t } from '@cf-dam/i18n/client'
  import { api } from '../lib/auth-client'

  let { clientId, name }: { clientId: string; name: string } = $props()

  let open = $state(false)
  let typed = $state('')
  let busy = $state(false)
  let error = $state('')
  const matches = $derived(typed.trim().toLowerCase() === name.trim().toLowerCase())

  async function erase(event: SubmitEvent) {
    event.preventDefault()
    busy = true
    error = ''
    try {
      await api(`/api/clients/${clientId}/erase`, { method: 'POST', body: JSON.stringify({ confirm: typed }) })
      location.href = '/clients'
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
      busy = false
    }
  }
</script>

<div class="stack">
  <p class="muted small">{t('clientsPage.eraseLead')}</p>
  {#if !open}
    <div><button class="btn btn-danger" type="button" onclick={() => (open = true)}>{t('clientsPage.erase')}</button></div>
  {:else}
    <form class="stack" onsubmit={erase}>
      <div class="field">
        <label for="erase-confirm">{t('clientsPage.eraseType', { name })}</label>
        <input id="erase-confirm" type="text" autocomplete="off" bind:value={typed} />
      </div>
      {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
      <div class="row buttons">
        <button class="btn btn-danger" type="submit" disabled={busy || !matches}>{t('clientsPage.eraseButton')}</button>
        <button class="btn" type="button" onclick={() => ((open = false), (typed = ''))}>{t('common.cancel')}</button>
      </div>
    </form>
  {/if}
</div>

<style>
  .buttons {
    gap: 8px;
  }
  .small {
    font-size: 0.85rem;
  }
  input {
    max-width: 360px;
  }
</style>

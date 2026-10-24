<script lang="ts">
  /** "New client" on the Clients page: a name is enough; the client's page opens to fill in the rest. */
  import { t } from '@cf-dam/i18n/client'
  import { api } from '../lib/auth-client'

  let open = $state(false)
  let name = $state('')
  let company = $state('')
  let email = $state('')
  let phone = $state('')
  let busy = $state(false)
  let error = $state('')

  async function create(event: SubmitEvent) {
    event.preventDefault()
    busy = true
    error = ''
    try {
      const { client } = await api<{ client: { id: string } }>('/api/clients', { method: 'POST', body: JSON.stringify({ name, company, email, phone }) })
      location.href = `/clients/${encodeURIComponent(client.id)}`
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
      busy = false
    }
  }
</script>

<div class="stack new">
  <div><button class="btn btn-primary" type="button" aria-expanded={open} onclick={() => (open = !open)}>{open ? t('common.cancel') : t('clientsPage.new')}</button></div>
  {#if open}
    <form class="card stack" onsubmit={create}>
      <p class="muted small">{t('clientsPage.newLead')}</p>
      <div class="grid">
        <div class="field">
          <label for="client-name">{t('clientsPage.name')}</label>
          <input id="client-name" type="text" required maxlength="200" placeholder={t('clientsPage.namePlaceholder')} bind:value={name} />
        </div>
        <div class="field">
          <label for="client-company">{t('clientsPage.company')}</label>
          <input id="client-company" type="text" maxlength="200" bind:value={company} />
        </div>
        <div class="field">
          <label for="client-email">{t('clientsPage.email')}</label>
          <input id="client-email" type="email" maxlength="254" bind:value={email} />
        </div>
        <div class="field">
          <label for="client-phone">{t('clientsPage.phone')}</label>
          <input id="client-phone" type="tel" maxlength="60" bind:value={phone} />
        </div>
      </div>
      {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
      <div><button class="btn btn-primary" type="submit" disabled={busy || !name.trim()}>{t('clientsPage.create')}</button></div>
    </form>
  {/if}
</div>

<style>
  .new {
    margin-bottom: 20px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px 16px;
  }
</style>

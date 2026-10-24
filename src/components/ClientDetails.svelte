<script lang="ts">
  /** A client's contact details and notes, on their page; and marking them as a past client. */
  import { t } from '@cf-dam/i18n/client'
  import { LANGUAGES } from '@cf-dam/i18n/languages'
  import type { ClientJson } from '@cf-dam/api'
  import { api } from '../lib/auth-client'

  let { client }: { client: ClientJson } = $props()

  // svelte-ignore state_referenced_locally
  let form = $state({ name: client.name, company: client.company, email: client.email, phone: client.phone, address: client.address, language: client.language ?? '', notes: client.notes })
  let busy = $state(false)
  let saved = $state(false)
  let error = $state('')

  async function save(event: SubmitEvent) {
    event.preventDefault()
    busy = true
    saved = false
    error = ''
    try {
      await api(`/api/clients/${client.id}`, { method: 'PATCH', body: JSON.stringify({ ...form, language: form.language || null }) })
      saved = true
      if (form.name !== client.name) location.reload()
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }

  async function setPast(past: boolean) {
    error = ''
    try {
      await api(`/api/clients/${client.id}/past`, { method: 'POST', body: JSON.stringify({ past }) })
      location.reload()
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    }
  }
</script>

<form class="stack" onsubmit={save} oninput={() => (saved = false)}>
  <div class="grid">
    <div class="field">
      <label for="cd-name">{t('clientsPage.name')}</label>
      <input id="cd-name" type="text" required maxlength="200" bind:value={form.name} />
    </div>
    <div class="field">
      <label for="cd-company">{t('clientsPage.company')}</label>
      <input id="cd-company" type="text" maxlength="200" bind:value={form.company} />
    </div>
    <div class="field">
      <label for="cd-email">{t('clientsPage.email')}</label>
      <input id="cd-email" type="email" maxlength="254" bind:value={form.email} />
    </div>
    <div class="field">
      <label for="cd-phone">{t('clientsPage.phone')}</label>
      <input id="cd-phone" type="tel" maxlength="60" bind:value={form.phone} />
    </div>
    <div class="field">
      <label for="cd-language">{t('clientsPage.language')}</label>
      <select id="cd-language" bind:value={form.language}>
        <option value="">{t('clientsPage.languageNone')}</option>
        {#each LANGUAGES as language (language.code)}<option value={language.code} lang={language.code}>{language.name}</option>{/each}
      </select>
    </div>
    <div class="field wide">
      <label for="cd-address">{t('clientsPage.address')}</label>
      <textarea id="cd-address" rows="3" maxlength="1000" bind:value={form.address}></textarea>
    </div>
    <div class="field wide">
      <label for="cd-notes">{t('clientsPage.notes')}</label>
      <textarea id="cd-notes" rows="5" maxlength="10000" placeholder={t('clientsPage.notesPlaceholder')} bind:value={form.notes}></textarea>
    </div>
  </div>
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
  <div class="row actions">
    <button class="btn btn-primary" type="submit" disabled={busy || !form.name.trim()}>{t('common.save')}</button>
    {#if saved}<span class="muted small" role="status">{t('common.saved')}</span>{/if}
    <span class="spacer"></span>
    {#if client.pastAt}
      <button class="btn" type="button" onclick={() => setPast(false)}>{t('clientsPage.makeCurrent')}</button>
    {:else}
      <button class="btn" type="button" title={t('clientsPage.markPastTitle')} onclick={() => setPast(true)}>{t('clientsPage.markPast')}</button>
    {/if}
  </div>
</form>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px 16px;
  }
  .wide {
    grid-column: 1 / -1;
  }
  textarea {
    width: 100%;
    resize: vertical;
  }
  .actions {
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
  }
  .spacer {
    flex: 1;
  }
</style>

<script lang="ts">
  /**
   * The language cf-dam speaks to this person (catalog/preferences.ts). A new language needs the page
   * rebuilt in it, so the choice is saved at once and the page reloads.
   */
  import { api } from '../lib/auth-client'
  import { t } from '@cf-dam/i18n/client'
  import { LANGUAGES } from '@cf-dam/i18n/languages'

  /** 'auto' follows the browser. */
  let { initial }: { initial: string } = $props()
  let error = $state('')

  async function choose(language: string) {
    try {
      await api('/api/me/preferences', { method: 'PUT', body: JSON.stringify({ language }) })
      location.reload()
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    }
  }
</script>

<div class="stack">
  <div class="field">
    <label for="account-language">{t('language.label')}</label>
    <select id="account-language" value={initial} onchange={(e) => choose(e.currentTarget.value)}>
      <option value="auto">{t('language.browser')}</option>
      {#each LANGUAGES as language (language.code)}<option value={language.code} lang={language.code}>{language.name}</option>{/each}
    </select>
  </div>
  <p class="muted small">{t('account.language.note')}</p>
  {#if error}<div class="alert alert-error">{error}</div>{/if}
</div>

<style>
  select {
    max-width: 320px;
  }
</style>

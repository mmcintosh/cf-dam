<script lang="ts">
  /**
   * The language picker. Signed out (sign-in, invites, client galleries) it remembers the choice in a
   * cookie; signed in (the menu) it saves it as the person's preference, as Account → Appearance does.
   * Either way the page reloads in the new language.
   */
  import { LANGUAGES, PSEUDO } from '@cf-dam/i18n/languages'
  import { lang, t } from '@cf-dam/i18n/client'
  import { api } from '../lib/auth-client'

  /** Offer the pseudo-language too (staging); `signedIn` saves to the person's preferences. */
  let { pseudo = false, signedIn = false }: { pseudo?: boolean; signedIn?: boolean } = $props()
  const current = lang()

  async function choose(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value
    // The pseudo-language isn't a preference: follow the cookie for it.
    if (signedIn) await api('/api/me/preferences', { method: 'PUT', body: JSON.stringify({ language: value === PSEUDO ? 'auto' : value }) }).catch(() => {})
    if (!signedIn || value === PSEUDO) {
      const secure = location.protocol === 'https:' ? '; Secure' : ''
      document.cookie = `cfdam_lang=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
    }
    location.reload()
  }
</script>

<label class="switch">
  <span class="sr-only">{t('language.label')}</span>
  <select aria-label={t('language.label')} value={current} onchange={choose}>
    {#each LANGUAGES as language (language.code)}<option value={language.code} lang={language.code}>{language.name}</option>{/each}
    {#if pseudo}<option value={PSEUDO}>Pseudo (test)</option>{/if}<!-- i18n-ok: a testing aid, not shown to real people -->
  </select>
</label>

<style>
  .switch select {
    font: inherit;
    font-size: 0.85rem;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text);
  }
</style>

<script lang="ts">
  /**
   * The language picker for pages without an account menu (sign-in, invites, client galleries). It
   * remembers the choice in a cookie and reloads; signed-in people choose in Account → Appearance.
   */
  import { LANGUAGES, PSEUDO } from '@cf-dam/i18n/languages'
  import { lang, t } from '@cf-dam/i18n/client'

  /** Offer the pseudo-language too (staging). */
  let { pseudo = false }: { pseudo?: boolean } = $props()
  const current = lang()

  function choose(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value
    const secure = location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `cfdam_lang=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
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

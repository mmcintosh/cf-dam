<script lang="ts">
  import { t } from '@cf-dam/i18n/client'
  /** Light or dark, in one click: switches at once and is kept with the person's other choices. */
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'

  let { theme = 'system' }: { theme?: 'system' | 'light' | 'dark' } = $props()
  let dark = $state(true)

  const effective = () =>
    theme === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme

  onMount(() => {
    dark = effective() === 'dark'
  })

  async function toggle() {
    theme = dark ? 'light' : 'dark'
    dark = !dark
    document.documentElement.dataset.theme = theme
    await api('/api/me/preferences', { method: 'PUT', body: JSON.stringify({ theme }) }).catch(() => {})
  }
</script>

<button class="btn btn-sm switch" type="button" onclick={toggle} aria-label={dark ? t('theme.toLight') : t('theme.toDark')} title={dark ? t('theme.light') : t('theme.dark')}>
  {#if dark}
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4V2 M12 22v-2 M4 12H2 M22 12h-2 M5.6 5.6 4.2 4.2 M19.8 19.8l-1.4-1.4 M5.6 18.4l-1.4 1.4 M19.8 4.2l-1.4 1.4 M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" /></svg>
  {:else}
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></svg>
  {/if}
</button>

<style>
  .switch {
    padding-inline: 8px;
  }
  svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>

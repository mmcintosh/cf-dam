<script lang="ts">
  /** The button on the "don't email me about this gallery" page. */
  import { t } from '@cf-dam/i18n/client'

  let { s, u, k }: { s: string; u: string; k: string } = $props()
  let state = $state<'ask' | 'done' | 'bad'>('ask')
  let gallery = $state('')
  let busy = $state(false)

  async function off() {
    busy = true
    try {
      const query = new URLSearchParams({ s, u, k })
      const response = await fetch(`/api/public/email-off?${query}`, { method: 'POST' })
      if (response.ok) {
        gallery = ((await response.json()) as { gallery?: string }).gallery ?? ''
        state = 'done'
      } else state = 'bad'
    } catch {
      state = 'bad'
    } finally {
      busy = false
    }
  }
</script>

<div class="stack">
  {#if state === 'ask'}
    <h2>{t('emailOff.title')}</h2>
    <p class="muted">{t('emailOff.lead')}</p>
    <div><button class="btn btn-primary" type="button" disabled={busy || !s || !u || !k} onclick={off}>{t('emailOff.button')}</button></div>
  {:else if state === 'done'}
    <h2>{t('emailOff.doneTitle')}</h2>
    <p class="muted">{gallery ? t('emailOff.done', { gallery }) : t('emailOff.doneNoName')}</p>
  {:else}
    <h2>{t('emailOff.title')}</h2>
    <p class="muted">{t('emailOff.bad')}</p>
  {/if}
</div>

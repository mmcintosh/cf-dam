<script lang="ts">
  /**
   * Cloudflare Images used this month (lib/images.ts): each preview, thumbnail, AI copy and watermarked image is
   * a transformation, billed beyond the plan's allowance. An alert is raised at the threshold set here.
   */
  import { format, lang, t } from '@cf-dam/i18n/client'
  import { intlTag } from '@cf-dam/i18n/languages'
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'

  interface Usage {
    month: string
    count: number
    alertAt: number
  }

  let usage = $state<Usage | null>(null)
  let alertAt = $state(0)
  let error = $state('')
  let saved = $state(false)

  const n = (value: number) => format().number(value)
  const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(intlTag(lang()), { month: 'long', year: 'numeric' })

  onMount(async () => {
    try {
      usage = (await api<{ images: Usage }>('/api/usage')).images
      alertAt = usage.alertAt
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotLoad')
    }
  })

  async function save(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    saved = false
    try {
      usage = (await api<{ images: Usage }>('/api/usage/images', { method: 'PUT', body: JSON.stringify({ alertAt: Math.max(0, Math.round(alertAt)) }) })).images
      saved = true
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    }
  }
</script>

<section class="card stack">
  <div>
    <h2>{t('imagesUsage.title')}</h2>
    <p class="muted">{t('imagesUsage.lead')}</p>
  </div>
  {#if usage}
    <p class="big"><strong>{n(usage.count)}</strong> <span class="muted">{t('imagesUsage.thisMonth', { month: monthName(usage.month) })}</span></p>
    {#if usage.alertAt > 0}
      <div class="bar" role="img" aria-label={t('imagesUsage.ofLimit', { count: n(usage.count), limit: n(usage.alertAt) })}>
        <i style:width={`${Math.min(100, (usage.count / usage.alertAt) * 100)}%`} class:over={usage.count >= usage.alertAt}></i>
      </div>
    {/if}
    <form class="row" onsubmit={save} oninput={() => (saved = false)}>
      <div class="field">
        <label for="images-alert">{t('imagesUsage.alertAt')}</label>
        <input id="images-alert" type="number" min="0" step="100" bind:value={alertAt} />
      </div>
      <button class="btn" type="submit">{t('common.save')}</button>
      {#if saved}<span class="muted small" role="status">{t('common.saved')}</span>{/if}
    </form>
    <p class="muted small">{t('imagesUsage.note')}</p>
  {/if}
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
</section>

<style>
  .big {
    margin: 0;
    font-size: 1.1rem;
  }
  .bar {
    height: 8px;
    border-radius: 99px;
    background: var(--border);
    overflow: hidden;
    max-width: 480px;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .bar i.over {
    background: var(--danger);
  }
  form {
    gap: 12px;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .field input {
    max-width: 180px;
  }
  .small {
    font-size: 0.85rem;
  }
</style>

<script lang="ts">
  /**
   * Library facets from TypeSafe's Jev (catalog/jev-facets.ts), on the AI review page: how many photos have been
   * looked at for people, and a button for the ones never asked.
   */
  import { format, t } from '@cf-dam/i18n/client'
  import { api } from '../lib/auth-client'

  interface Stats {
    available: boolean
    done: number
    waiting: number
    failed: number
    skipped: number
    unasked: number
    withPeople: number
  }

  let { initial }: { initial: Stats } = $props()
  // svelte-ignore state_referenced_locally
  let stats = $state<Stats>(initial)
  let busy = $state(false)
  let error = $state('')

  const n = (v: number) => format().number(v)
  const toAsk = $derived(stats.unasked + stats.failed)

  async function queue() {
    busy = true
    error = ''
    try {
      stats = (await api<{ stats: Stats }>('/api/ai/facets/queue', { method: 'POST' })).stats
    } catch (e) {
      error = e instanceof Error ? e.message : t('ai.couldNotQueue')
    } finally {
      busy = false
    }
  }

  async function refresh() {
    try {
      stats = (await api<{ stats: Stats }>('/api/ai/facets')).stats
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotLoad')
    }
  }
</script>

<section class="card stack">
  <div>
    <h2>{t('peopleFacets.title')}</h2>
    <p class="muted">{t('peopleFacets.lead')}</p>
  </div>
  {#if !stats.available}
    <p class="muted">{t('peopleFacets.notSetUp')}</p>
  {:else}
    <p role="status">
      {t('peopleFacets.counts', { done: n(stats.done), people: n(stats.withPeople), waiting: n(stats.waiting), failed: n(stats.failed), skipped: n(stats.skipped) })}
      {#if stats.waiting > 0}<button class="link" type="button" onclick={refresh}>{t('common.refresh')}</button>{/if}
    </p>
    {#if toAsk > 0}
      <div>
        <button class="btn btn-primary" type="button" onclick={queue} disabled={busy}>{t('peopleFacets.find', { count: n(toAsk) })}</button>
      </div>
    {:else if stats.waiting === 0}
      <p class="muted">{t('peopleFacets.allDone')}</p>
    {/if}
    <p class="muted small">{t('peopleFacets.privacy')}</p>
  {/if}
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
</section>

<style>
  p {
    margin: 0;
  }
  .small {
    font-size: 0.85rem;
  }
</style>

<script lang="ts">
  /** Under a gallery link, for those who set up payments: which price list it sells with (plans/PLAN-SELL-v2.md S1). */
  import { onMount } from 'svelte'
  import { t } from '@cf-dam/i18n/client'
  import { api } from '../lib/auth-client'

  let { shareId }: { shareId: string } = $props()
  let lists = $state<{ id: string; name: string }[] | null>(null)
  let chosen = $state('')
  let saved = $state(false)

  onMount(async () => {
    try {
      const [r, g] = await Promise.all([api<{ priceLists: { id: string; name: string }[] }>('/api/payments/price-lists'), api<{ priceListId: string | null }>(`/api/payments/galleries/${shareId}`)])
      lists = r.priceLists
      chosen = g.priceListId ?? ''
    } catch {
      lists = null
    }
  })

  async function change() {
    saved = false
    await api(`/api/payments/galleries/${shareId}`, { method: 'PUT', body: JSON.stringify({ priceListId: chosen || null }) })
    saved = true
  }
</script>

{#if lists && lists.length > 0}
  <label class="row selling small">
    <span>{t('prices.sellsWith')}</span>
    <select bind:value={chosen} onchange={change}>
      <option value="">{t('prices.sellsNothing')}</option>
      {#each lists as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
    </select>
    {#if saved}<span class="muted" role="status">{t('common.saved')}</span>{/if}
  </label>
{/if}

<style>
  .selling {
    gap: 8px;
    align-items: center;
  }
  .small {
    font-size: 0.85rem;
  }
</style>

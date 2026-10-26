<script lang="ts">
  /** A buyer's order: its status, asking again while Stripe settles, then each bought file to download. */
  import { onMount } from 'svelte'
  import { format, t } from '@cf-dam/i18n/client'
  import type { MessageKey } from '@cf-dam/i18n'

  let { id, key, token }: { id: string; key: string; token: string } = $props()

  interface Order {
    status: string
    gallery: string
    currency: string
    total: number | null
    subtotal: number
    email: string | null
    paidAt: string | null
    /** label: the real filename, only when the gallery showed filenames; otherwise "Photo {n}". */
    items: { id: string; label: string | null; n: number | null; size: string; refunded: boolean }[]
  }
  let order = $state<Order | null>(null)
  let missing = $state(false)
  let tries = 0

  const money = (amount: number, currency: string) => format().number(amount / (currency === 'jpy' ? 1 : 100), { style: 'currency', currency: currency.toUpperCase() })
  const SIZE: Record<string, MessageKey> = { small: 'gallery.size.small', large: 'gallery.size.large', full: 'gallery.buy.full' }
  // svelte-ignore state_referenced_locally
  const query = `k=${encodeURIComponent(key)}`

  async function load() {
    const response = await fetch(`/api/public/orders/${id}?${query}`)
    if (!response.ok) {
      missing = true
      return
    }
    order = ((await response.json()) as { order: Order }).order
    // Still settling with Stripe: ask again for a minute or so.
    if (order.status === 'open' && tries++ < 20) setTimeout(load, 3000)
  }
  onMount(load)
</script>

{#if missing}
  <h1>{t('order.missingTitle')}</h1>
  <p class="muted">{t('order.missing')}</p>
{:else if !order}
  <p class="muted">{t('common.loading')}</p>
{:else}
  <h1>{order.status === 'paid' ? t('order.paidTitle') : order.status === 'open' ? t('order.openTitle') : t('order.title')}</h1>
  <p class="muted">{order.gallery}{order.total !== null ? ` · ${money(order.total, order.currency)}` : ''}{order.email ? ` · ${order.email}` : ''}</p>
  {#if order.status === 'open'}
    <p>{t('order.open')}</p>
  {:else if order.status === 'paid'}
    <p>{t('order.keep')}</p>
    <ul class="files">
      {#each order.items as item (item.id)}
        <li>
          <span>{item.label ?? (item.n !== null ? t('order.photoN', { n: item.n }) : t('order.photo'))} <span class="muted small">· {t(SIZE[item.size] ?? 'gallery.size.large')}</span></span>
          {#if item.refunded}<span class="muted small">{t('order.refunded')}</span>{:else}<a class="btn btn-sm" href={`/api/public/orders/${id}/items/${item.id}?${query}`} download>⤓ {t('order.download')}</a>{/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p>{t(`order.status.${order.status}` as MessageKey)}</p>
  {/if}
  <p><a href={`/s/${token}`}>{t('order.back')}</a></p>
{/if}

<style>
  .files {
    list-style: none;
    margin: 16px 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .files li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    overflow-wrap: anywhere;
  }
  .small {
    font-size: 0.85rem;
  }
</style>

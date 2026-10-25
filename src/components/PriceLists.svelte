<script lang="ts">
  /** Price lists (plans/PLAN-SELL-v2.md S1): what Small, Large, Full size and the whole gallery cost; empty: not sold. */
  import { onMount } from 'svelte'
  import { t } from '@cf-dam/i18n/client'
  import { api } from '../lib/auth-client'

  interface PriceList {
    id: string
    name: string
    small: number | null
    large: number | null
    full: number | null
    all: number | null
  }
  type Draft = { id: string | null; name: string; small: string; large: string; full: string; all: string }

  let lists = $state<PriceList[]>([])
  let currency = $state('usd')
  let draft = $state<Draft | null>(null)
  let error = $state('')

  const unit = $derived(currency === 'jpy' ? 1 : 100)
  const shown = (v: number | null) => (v === null ? '' : String(v / unit))
  const minor = (v: string) => (v.trim() === '' ? null : Math.round(Number(v.replace(',', '.')) * unit))

  async function load() {
    const r = await api<{ priceLists: PriceList[]; currency: string }>('/api/payments/price-lists')
    lists = r.priceLists
    currency = r.currency
  }
  onMount(() => void load().catch(() => {}))

  const edit = (l: PriceList | null) =>
    (draft = l ? { id: l.id, name: l.name, small: shown(l.small), large: shown(l.large), full: shown(l.full), all: shown(l.all) } : { id: null, name: '', small: '', large: '', full: '', all: '' })

  async function save(event: SubmitEvent) {
    event.preventDefault()
    if (!draft) return
    error = ''
    try {
      const body = JSON.stringify({ name: draft.name, small: minor(draft.small), large: minor(draft.large), full: minor(draft.full), all: minor(draft.all) })
      await api(draft.id ? `/api/payments/price-lists/${draft.id}` : '/api/payments/price-lists', { method: draft.id ? 'PUT' : 'POST', body })
      draft = null
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    }
  }
</script>

<h2>{t('prices.title')}</h2>
<p class="muted small">{t('prices.lead', { currency: currency.toUpperCase() })}</p>
{#if lists.length > 0}
  <ul class="lists">
    {#each lists as l (l.id)}
      <li>
        <strong>{l.name}</strong>
        <span class="muted small">{t('gallery.size.small')} {shown(l.small) || '—'} · {t('gallery.size.large')} {shown(l.large) || '—'} · {t('gallery.buy.full')} {shown(l.full) || '—'} · {t('prices.all')} {shown(l.all) || '—'}</span>
        <button class="btn btn-sm" type="button" onclick={() => edit(l)}>{t('common.edit')}</button>
      </li>
    {/each}
  </ul>
{/if}
{#if draft}
  <form class="stack" onsubmit={save}>
    <div class="grid">
      <div class="field wide"><label for="pl-name">{t('common.name')}</label><input id="pl-name" required maxlength="100" bind:value={draft.name} /></div>
      <div class="field"><label for="pl-small">{t('gallery.size.small')}</label><input id="pl-small" inputmode="decimal" bind:value={draft.small} /></div>
      <div class="field"><label for="pl-large">{t('gallery.size.large')}</label><input id="pl-large" inputmode="decimal" bind:value={draft.large} /></div>
      <div class="field"><label for="pl-full">{t('gallery.buy.full')}</label><input id="pl-full" inputmode="decimal" bind:value={draft.full} /></div>
      <div class="field"><label for="pl-all">{t('prices.all')}</label><input id="pl-all" inputmode="decimal" bind:value={draft.all} /></div>
    </div>
    <p class="muted small">{t('prices.emptyLead')}</p>
    <div class="row actions">
      <button class="btn btn-primary" type="submit">{t('common.save')}</button>
      <button class="btn" type="button" onclick={() => (draft = null)}>{t('common.cancel')}</button>
    </div>
  </form>
{:else}
  <button class="btn" type="button" onclick={() => edit(null)}>{t('prices.new')}</button>
{/if}
{#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}

<style>
  h2 {
    font-size: 1.05rem;
    margin: 0 0 4px;
  }
  .lists {
    list-style: none;
    margin: 12px 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .lists li {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .actions {
    gap: 8px;
  }
  .small {
    font-size: 0.85rem;
  }
</style>

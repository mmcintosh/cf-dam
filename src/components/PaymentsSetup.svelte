<script lang="ts">
  /**
   * Connecting Stripe (plans/PLAN-SELL-v2.md §3): the restricted key and the webhook signing secret (never shown
   * again once saved), the webhook address and events to set up in Stripe, a check, and the seller's details.
   */
  import { onMount } from 'svelte'
  import { format, t } from '@cf-dam/i18n/client'
  import { api } from '../lib/auth-client'

  let { origin }: { origin: string } = $props()

  interface Status {
    configured: boolean
    keySet: boolean
    keyEnds: string | null
    webhookSet: boolean
    mode: 'test' | 'live' | null
    lastEventAt: string | null
    currencyLocked: boolean
    settings: { currency: string; business: string; terms: string }
    currencies: string[]
    webhookPath: string
  }
  let status = $state<Status | null>(null)
  let key = $state('')
  let secret = $state('')
  let form = $state({ currency: 'usd', business: '', terms: '' })
  let busy = $state(false)
  let note = $state('')
  let error = $state('')

  const EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed']

  async function load() {
    status = await api<Status>('/api/payments')
    form = { ...status.settings }
  }
  onMount(() => void load().catch((e) => (error = e instanceof Error ? e.message : t('common.couldNotLoad'))))

  async function run(work: () => Promise<unknown>, done: string) {
    busy = true
    error = ''
    note = ''
    try {
      await work()
      await load()
      note = done
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }
  const saveKeys = () =>
    run(async () => {
      await api('/api/payments/keys', { method: 'PUT', body: JSON.stringify({ ...(key.trim() ? { stripeKey: key.trim() } : {}), ...(secret.trim() ? { webhookSecret: secret.trim() } : {}) }) })
      key = ''
      secret = ''
    }, t('common.saved'))
  const check = () =>
    run(async () => {
      await api('/api/payments/check', { method: 'POST' })
    }, t('payments.checkOk'))
  const saveSettings = () => run(() => api('/api/payments', { method: 'PUT', body: JSON.stringify(form) }), t('common.saved'))
</script>

<h2>{t('payments.title')}</h2>
{#if status}
  <p>
    {#if status.configured}<span class="badge badge-ok">{t('payments.connected')}</span>{:else}<span class="badge">{t('payments.notConnected')}</span>{/if}
    {#if status.mode === 'test'}<span class="badge badge-warn">{t('payments.testMode')}</span>{/if}
    {#if status.keyEnds}<span class="muted small"> {t('payments.keyEnds', { last: status.keyEnds })}</span>{/if}
    {#if status.lastEventAt}<span class="muted small"> · {t('payments.lastEvent', { when: format().dateTime(status.lastEventAt) })}</span>{/if}
  </p>
  <ol class="steps small">
    <li>{t('payments.step1')}</li>
    <li>{t('payments.step2')} <code>{origin}{status.webhookPath}</code><br /><span class="muted">{t('payments.events')} {EVENTS.join(', ')}</span></li>
    <li>{t('payments.step3')}</li>
  </ol>
  <div class="grid">
    <div class="field">
      <label for="pay-key">{t('payments.key')}</label>
      <input id="pay-key" type="password" autocomplete="off" placeholder={status.keySet ? t('payments.replace') : 'rk_test_…'} bind:value={key} />
    </div>
    <div class="field">
      <label for="pay-secret">{t('payments.webhookSecret')}</label>
      <input id="pay-secret" type="password" autocomplete="off" placeholder={status.webhookSet ? t('payments.replace') : 'whsec_…'} bind:value={secret} />
    </div>
  </div>
  <div class="row actions">
    <button class="btn btn-primary" type="button" disabled={busy || (!key.trim() && !secret.trim())} onclick={saveKeys}>{t('payments.saveKeys')}</button>
    <button class="btn" type="button" disabled={busy || !status.keySet} onclick={check}>{t('payments.check')}</button>
  </div>

  <h3>{t('payments.seller')}</h3>
  <p class="muted small">{t('payments.sellerLead')}</p>
  <div class="grid">
    <div class="field">
      <label for="pay-currency">{t('payments.currency')}</label>
      <select id="pay-currency" bind:value={form.currency} disabled={status.currencyLocked}>
        {#each status.currencies as c (c)}<option value={c}>{c.toUpperCase()}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="pay-business">{t('payments.business')}</label>
      <input id="pay-business" type="text" maxlength="200" bind:value={form.business} />
    </div>
    <div class="field wide">
      <label for="pay-terms">{t('payments.terms')}</label>
      <textarea id="pay-terms" rows="3" maxlength="1000" placeholder={t('payments.termsPlaceholder')} bind:value={form.terms}></textarea>
    </div>
  </div>
  <div class="row actions"><button class="btn" type="button" disabled={busy} onclick={saveSettings}>{t('common.save')}</button></div>
{/if}
{#if note}<p class="muted small" role="status">{note}</p>{/if}
{#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}

<style>
  h2 {
    font-size: 1.05rem;
    margin: 0 0 8px;
  }
  h3 {
    font-size: 0.95rem;
    margin: 20px 0 4px;
  }
  .steps {
    padding-left: 20px;
    display: grid;
    gap: 6px;
    overflow-wrap: anywhere;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px 16px;
  }
  .wide {
    grid-column: 1 / -1;
  }
  textarea {
    width: 100%;
  }
  .actions {
    gap: 8px;
    margin-top: 10px;
  }
  .small {
    font-size: 0.85rem;
  }
</style>

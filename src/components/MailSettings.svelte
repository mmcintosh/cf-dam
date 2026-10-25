<script lang="ts">
  /**
   * Setup → Email (plans/PLAN-E-v2.md §5): whether this install can send, from which address, turning email on (which
   * fixes the address links are built from), the studio's name and reply address, and a test email.
   */
  import { format, t } from '@cf-dam/i18n/client'
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'

  interface Settings {
    on: boolean
    origin: string | null
    studio: string
    replyTo: string
    stopped: { code: string; message: string; at: string } | null
  }
  interface State {
    available: boolean
    from: string | null
    allowTo: string | null
    ready: boolean
    here: string
    settings: Settings
    status: { lastSentAt: string | null; lastError: string | null; lastErrorAt: string | null; today: number; waiting: number }
  }

  let state = $state<State | null>(null)
  let form = $state({ studio: '', replyTo: '' })
  let busy = $state(false)
  let error = $state('')
  let saved = $state(false)
  let test = $state<{ ok: boolean; text: string } | null>(null)

  async function load() {
    try {
      state = await api<State>('/api/mail')
      form = { studio: state.settings.studio, replyTo: state.settings.replyTo }
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotLoad')
    }
  }
  onMount(load)

  async function put(body: Record<string, unknown>) {
    busy = true
    error = ''
    saved = false
    try {
      await api('/api/mail', { method: 'PUT', body: JSON.stringify(body) })
      await load()
      saved = true
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }

  async function sendTest() {
    busy = true
    test = null
    try {
      const r = await api<{ ok: boolean; to: string }>('/api/mail/test', { method: 'POST' })
      test = { ok: true, text: t('mailPage.testSent', { to: r.to }) }
      await load()
    } catch (e) {
      test = { ok: false, text: t('mailPage.testFailed', { reason: e instanceof Error ? e.message : '' }) }
    } finally {
      busy = false
    }
  }

  const when = (iso: string | null) => (iso ? format().dateTime(iso) : '—')
</script>

{#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
{#if state}
  <section class="card stack">
    <h2>{t('mailPage.sending')}</h2>
    {#if !state.available}
      <p>{t('mailPage.unavailable')}</p>
      <ol class="steps">
        <li>{t('mailPage.step1')}</li>
        <li>{t('mailPage.step2')}</li>
        <li>{t('mailPage.step3')}</li>
      </ol>
      <p class="muted small">{t('mailPage.dnsCaution')} <a href="/help/email">{t('mailPage.helpLink')}</a></p>
    {:else}
      <dl class="facts">
        <dt>{t('mailPage.from')}</dt>
        <dd><code>{state.from}</code></dd>
        {#if state.allowTo}
          <dt>{t('mailPage.allowTo')}</dt>
          <dd><code>{state.allowTo}</code> <span class="muted small">{t('mailPage.allowToNote')}</span></dd>
        {/if}
        <dt>{t('mailPage.state')}</dt>
        <dd>
          {#if state.settings.stopped}
            <span class="badge badge-warn">{t('mailPage.stopped')}</span>
          {:else if state.settings.on}
            <span class="badge badge-ok">{t('mailPage.on')}</span>
          {:else}
            <span class="badge">{t('mailPage.off')}</span>
          {/if}
        </dd>
        {#if state.settings.on && state.settings.origin}
          <dt>{t('mailPage.links')}</dt>
          <dd><code>{state.settings.origin}</code></dd>
        {/if}
        <dt>{t('mailPage.lastSent')}</dt>
        <dd>{when(state.status.lastSentAt)} · {t('mailPage.today', { count: state.status.today })}{#if state.status.waiting > 0} · {t('mailPage.waiting', { count: state.status.waiting })}{/if}</dd>
        {#if state.status.lastError}
          <dt>{t('mailPage.lastError')}</dt>
          <dd class="small">{when(state.status.lastErrorAt)}: <code>{state.status.lastError}</code></dd>
        {/if}
      </dl>
      {#if state.settings.stopped}
        <div class="alert alert-error" role="alert">{t('mailPage.stoppedLead', { code: state.settings.stopped.code })}</div>
      {/if}
      {#if state.settings.on && state.settings.origin && state.settings.origin !== state.here}
        <p class="small">{t('mailPage.otherAddress', { here: state.here, origin: state.settings.origin })} <button class="btn btn-sm" type="button" disabled={busy} onclick={() => put({ on: true })}>{t('mailPage.useHere')}</button></p>
      {/if}
      <div class="row actions">
        {#if state.settings.on}
          <button class="btn" type="button" disabled={busy} onclick={() => put({ on: false })}>{t('mailPage.turnOff')}</button>
        {:else}
          <button class="btn btn-primary" type="button" disabled={busy} onclick={() => put({ on: true })}>{t('mailPage.turnOn')}</button>
          <span class="muted small">{t('mailPage.turnOnNote', { here: state.here })}</span>
        {/if}
      </div>
      <div class="row actions">
        <button class="btn" type="button" disabled={busy} onclick={sendTest}>{t('mailPage.sendTest')}</button>
        {#if test}<span class:ok={test.ok} class:bad={!test.ok} class="small" role="status">{test.text}</span>{/if}
      </div>
    {/if}
  </section>

  <section class="card stack">
    <h2>{t('mailPage.looks')}</h2>
    <form class="stack" onsubmit={(e) => { e.preventDefault(); put({ studio: form.studio, replyTo: form.replyTo }) }} oninput={() => (saved = false)}>
      <div class="grid">
        <div class="field">
          <label for="mail-studio">{t('mailPage.studio')}</label>
          <input id="mail-studio" type="text" required maxlength="80" bind:value={form.studio} />
          <span class="muted small">{t('mailPage.studioHint')}</span>
        </div>
        <div class="field">
          <label for="mail-reply">{t('mailPage.replyTo')}</label>
          <input id="mail-reply" type="email" maxlength="254" placeholder="studio@example.com" bind:value={form.replyTo} />
          <span class="muted small">{t('mailPage.replyToHint')}</span>
        </div>
      </div>
      <div class="row actions">
        <button class="btn btn-primary" type="submit" disabled={busy || !form.studio.trim()}>{t('common.save')}</button>
        {#if saved}<span class="muted small" role="status">{t('common.saved')}</span>{/if}
      </div>
    </form>
  </section>
{:else if !error}
  <p class="muted">{t('common.loading')}</p>
{/if}

<style>
  section + section {
    margin-top: 20px;
  }
  h2 {
    font-size: 1.05rem;
    margin: 0;
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 16px;
    margin: 0;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .steps {
    margin: 0;
    padding-left: 20px;
    display: grid;
    gap: 4px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px 16px;
  }
  .actions {
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
  }
  .small {
    font-size: 0.85rem;
  }
  .ok {
    color: var(--success, var(--accent));
  }
  .bad {
    color: var(--danger);
  }
</style>

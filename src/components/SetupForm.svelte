<script lang="ts">
  import RestoreForm, { type RestoreView } from './RestoreForm.svelte'
  import { lang, t } from '@cf-dam/i18n/client'
  import { LANGUAGES } from '@cf-dam/i18n/languages'
  import type { MessageKey } from '@cf-dam/i18n'

  interface Props {
    tokenRequired: boolean
    blocked: boolean
    /** A restore from a backup under way, waiting for a sign-in, or failed. */
    restore: RestoreView | null
  }
  let { tokenRequired, blocked, restore }: Props = $props()
  let mode = $state<'new' | 'restore'>(restore ? 'restore' : 'new')

  let name = $state('')
  let email = $state('')
  let password = $state('')
  let confirm = $state('')
  let token = $state('')
  let error = $state('')
  let busy = $state(false)

  const MESSAGES: Record<string, MessageKey> = {
    invalid_setup_token: 'setup.badToken',
    already_set_up: 'setup.alreadyDone',
  }
  /** The archive starts in the language this page is shown in (the menu at the bottom changes it). */
  const archiveLanguage = LANGUAGES.find((l) => l.code === lang())
  const tokenCommand = 'wrangler secret put SETUP_TOKEN'

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    if (password !== confirm) {
      error = t('setup.mismatch')
      return
    }
    busy = true
    try {
      const response = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, token: token || undefined, language: archiveLanguage?.code }),
      })
      if (response.ok) {
        window.location.href = '/'
        return
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string }
      const known = body.error === 'setup_token_not_configured' ? t('setup.noToken', { command: tokenCommand }) : body.error && MESSAGES[body.error] ? t(MESSAGES[body.error]!) : null
      error = known || body.message || t('setup.failed', { status: String(response.status) })
    } finally {
      busy = false
    }
  }
</script>

<div class="stack">
  <div>
    <h2>{t('setup.title')}</h2>
    {#if mode === 'new'}
      <p class="lead">{t('setup.newLead')}</p>
    {:else}
      <p class="lead">{t('setup.restoreLead')}</p>
    {/if}
  </div>
  {#if !restore}
    <div class="tabs" role="tablist">
      <button type="button" role="tab" aria-selected={mode === 'new'} class:active={mode === 'new'} onclick={() => (mode = 'new')}>{t('setup.tabNew')}</button>
      <button type="button" role="tab" aria-selected={mode === 'restore'} class:active={mode === 'restore'} onclick={() => (mode = 'restore')}>{t('setup.tabRestore')}</button>
    </div>
  {/if}

{#if mode === 'restore'}
  <RestoreForm {tokenRequired} {blocked} {restore} />
{:else}
<form class="stack" onsubmit={submit}>

  {#if blocked}
    <div class="alert alert-error">{t('setup.noToken', { command: tokenCommand })}</div>
  {/if}

  <div class="field">
    <label for="name">{t('setup.yourName')}</label>
    <input id="name" type="text" autocomplete="name" required bind:value={name} />
  </div>
  <div class="field">
    <label for="email">{t('common.email')}</label>
    <input id="email" type="email" autocomplete="email" required bind:value={email} />
  </div>
  <div class="field">
    <label for="password">{t('common.password')}</label>
    <input id="password" type="password" autocomplete="new-password" minlength="12" required bind:value={password} />
  </div>
  <div class="field">
    <label for="confirm">{t('setup.confirm')}</label>
    <input id="confirm" type="password" autocomplete="new-password" minlength="12" required bind:value={confirm} />
  </div>
  {#if tokenRequired}
    <div class="field">
      <label for="token">{t('setup.token')}</label>
      <input id="token" type="password" autocomplete="off" required bind:value={token} />
    </div>
  {/if}

  {#if archiveLanguage}<p class="muted small">{t('setup.language', { language: archiveLanguage.name })}</p>{/if}
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}

  <button class="btn btn-primary" type="submit" disabled={busy || blocked}>
    {busy ? t('setup.busy') : t('setup.submit')}
  </button>
</form>
{/if}
</div>

<style>
  .small {
    font-size: 0.85rem;
    margin: 0;
  }
  .tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    background: none;
    border: 0;
    border-bottom: 2px solid transparent;
    padding: 6px 10px;
    color: var(--text-muted);
    cursor: pointer;
  }
  .tabs button.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
</style>

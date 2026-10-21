<script lang="ts">
  import RestoreForm, { type RestoreView } from './RestoreForm.svelte'

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

  const MESSAGES: Record<string, string> = {
    invalid_setup_token: 'That setup token is not right.',
    setup_token_not_configured: 'This deployment has no SETUP_TOKEN. Set it with `wrangler secret put SETUP_TOKEN`, then reload.',
    already_set_up: 'Setup is already done. Sign in instead.',
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    if (password !== confirm) {
      error = 'The passwords do not match.'
      return
    }
    busy = true
    try {
      const response = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, token: token || undefined }),
      })
      if (response.ok) {
        window.location.href = '/'
        return
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string }
      error = (body.error && MESSAGES[body.error]) || body.message || `Setup failed (${response.status}).`
    } finally {
      busy = false
    }
  }
</script>

<div class="stack">
  <div>
    <h2>Set up your archive</h2>
    {#if mode === 'new'}
      <p class="lead">Create the first administrator. You can invite everyone else afterwards.</p>
    {:else}
      <p class="lead">Bring your catalog back from a backup: its photos’ details, keywords, albums, galleries and people.</p>
    {/if}
  </div>
  {#if !restore}
    <div class="tabs" role="tablist">
      <button type="button" role="tab" aria-selected={mode === 'new'} class:active={mode === 'new'} onclick={() => (mode = 'new')}>Start a new archive</button>
      <button type="button" role="tab" aria-selected={mode === 'restore'} class:active={mode === 'restore'} onclick={() => (mode = 'restore')}>Restore from a backup</button>
    </div>
  {/if}

{#if mode === 'restore'}
  <RestoreForm {tokenRequired} {blocked} {restore} />
{:else}
<form class="stack" onsubmit={submit}>

  {#if blocked}
    <div class="alert alert-error">
      This deployment has no <code>SETUP_TOKEN</code> secret. Set one with
      <code>wrangler secret put SETUP_TOKEN</code>, then reload this page.
    </div>
  {/if}

  <div class="field">
    <label for="name">Your name</label>
    <input id="name" type="text" autocomplete="name" required bind:value={name} />
  </div>
  <div class="field">
    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="email" required bind:value={email} />
  </div>
  <div class="field">
    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="new-password" minlength="12" required bind:value={password} />
  </div>
  <div class="field">
    <label for="confirm">Confirm password</label>
    <input id="confirm" type="password" autocomplete="new-password" minlength="12" required bind:value={confirm} />
  </div>
  {#if tokenRequired}
    <div class="field">
      <label for="token">Setup token</label>
      <input id="token" type="password" autocomplete="off" required bind:value={token} />
    </div>
  {/if}

  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}

  <button class="btn btn-primary" type="submit" disabled={busy || blocked}>
    {busy ? 'Creating…' : 'Create administrator'}
  </button>
</form>
{/if}
</div>

<style>
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

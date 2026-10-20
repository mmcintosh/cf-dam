<script lang="ts">
  import { onMount } from 'svelte'
  import { api, authClient } from '../lib/auth-client'

  interface Props {
    /** Where to go once a passkey is added (two-factor being required). */
    next?: string
  }
  let { next }: Props = $props()

  interface PasskeyRecord {
    id: string
    name: string | null
    createdAt: string | null
    backedUp: boolean
  }

  let passkeys = $state<PasskeyRecord[]>([])
  let name = $state('')
  let error = $state('')
  let added = $state('')
  let busy = $state(false)
  let stale = $state(false)
  let confirming = $state<string | null>(null)
  let lapse: ReturnType<typeof setTimeout> | undefined

  const supported = typeof window !== 'undefined' && 'PublicKeyCredential' in window
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '')

  async function load() {
    passkeys = await api<PasskeyRecord[]>('/api/auth/passkey/list-user-passkeys')
  }
  onMount(load)

  async function add(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    added = ''
    stale = false
    busy = true
    const result = await authClient.passkey.addPasskey({ name: name.trim() || undefined })
    busy = false
    if (result?.error) {
      const code = 'code' in result.error ? result.error.code : undefined
      if (code === 'SESSION_NOT_FRESH') stale = true
      else error = result.error.status === 429 ? 'Too many attempts. Wait a minute.' : 'No passkey was saved. Try again; if your password manager asked, let it save the passkey.'
      return
    }
    if (next) return location.assign(next)
    added = 'Passkey saved. Next time, choose "Sign in with a passkey".'
    name = ''
    await load()
  }

  function arm(id: string | null) {
    clearTimeout(lapse)
    confirming = id
    if (id) lapse = setTimeout(() => (confirming = null), 4000)
  }

  async function remove(passkey: PasskeyRecord) {
    if (confirming !== passkey.id) return arm(passkey.id)
    arm(null)
    await api('/api/auth/passkey/delete-passkey', { method: 'POST', body: JSON.stringify({ id: passkey.id }) })
    await load()
  }
</script>

<div class="stack">
  {#if passkeys.length > 0}
    <ul class="keys">
      {#each passkeys as passkey (passkey.id)}
        <li>
          <span>
            <strong>{passkey.name || 'Passkey'}</strong>
            <span class="muted small">added {fmt(passkey.createdAt)}{passkey.backedUp ? ' · synced' : ''}</span>
          </span>
          <button class="btn btn-sm btn-danger" onclick={() => remove(passkey)} onblur={() => confirming === passkey.id && arm(null)}>
            {confirming === passkey.id ? 'Click again to remove' : 'Remove'}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if !supported}
    <p class="muted">This browser can't use passkeys.</p>
  {:else}
    <form class="row" onsubmit={add}>
      <input type="text" maxlength="100" placeholder="Name, e.g. 1Password" bind:value={name} aria-label="Passkey name" style="max-width: 240px" />
      <button class="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Waiting for your passkey…' : 'Add a passkey'}</button>
    </form>
  {/if}
  {#if stale}
    <div class="alert alert-error" role="alert">For safety, adding a passkey needs a sign-in from the last 15 minutes. Sign out, sign in again, then add it.</div>
  {/if}
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
  {#if added}<div class="alert alert-success" role="status">{added}</div>{/if}
</div>

<style>
  .keys {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .keys li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .keys li > span {
    display: grid;
  }
  .small {
    font-size: 0.8rem;
  }
</style>

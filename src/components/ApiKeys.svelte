<script lang="ts">
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'

  interface Props {
    /** Scopes this user may grant: their own permissions. */
    grantable: string[]
  }
  let { grantable }: Props = $props()

  interface KeyRecord {
    id: string
    name: string
    prefix: string
    scopes: string[]
    expiresAt: string | null
    lastUsedAt: string | null
    revokedAt: string | null
    createdAt: string
  }

  let keys = $state<KeyRecord[]>([])
  let name = $state('')
  let scopes = $state<string[]>(grantable.includes('assets:read') ? ['assets:read'] : [])
  let expiresInDays = $state<string>('90')
  let created = $state<{ key: string; name: string } | null>(null)
  let copied = $state(false)
  let error = $state('')
  let busy = $state(false)

  const live = $derived(keys.filter((k) => !k.revokedAt))
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—')

  async function load() {
    keys = (await api<{ keys: KeyRecord[] }>('/api/me/api-keys')).keys
  }
  onMount(load)

  async function create(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    busy = true
    try {
      const body = { name, scopes, expiresInDays: expiresInDays === 'never' ? null : Number(expiresInDays) }
      const result = await api<{ key: string; record: KeyRecord }>('/api/me/api-keys', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      created = { key: result.key, name: result.record.name }
      copied = false
      name = ''
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not create the key.'
    } finally {
      busy = false
    }
  }

  async function revoke(key: KeyRecord) {
    if (!confirm(`Revoke "${key.name}"? Anything using it stops working immediately.`)) return
    await api(`/api/me/api-keys/${key.id}`, { method: 'DELETE' })
    await load()
  }

  async function copy() {
    if (!created) return
    await navigator.clipboard.writeText(created.key)
    copied = true
  }
</script>

<div class="stack">
  {#if created}
    <div class="reveal">
      <strong>Copy your new key for “{created.name}” now.</strong>
      <span class="muted">It won't be shown again.</span>
      <div class="row">
        <code class="key">{created.key}</code>
        <button class="btn btn-sm" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <button class="btn btn-sm" onclick={() => (created = null)}>Done</button>
      </div>
    </div>
  {/if}

  {#if live.length > 0}
    <table class="table">
      <thead><tr><th>Name</th><th>Key</th><th>Scopes</th><th>Last used</th><th>Expires</th><th></th></tr></thead>
      <tbody>
        {#each live as key (key.id)}
          <tr>
            <td>{key.name}</td>
            <td><code>{key.prefix}…</code></td>
            <td><div class="row">{#each key.scopes as scope (scope)}<span class="badge">{scope}</span>{/each}</div></td>
            <td class="muted">{fmt(key.lastUsedAt)}</td>
            <td class="muted">{key.expiresAt ? fmt(key.expiresAt) : 'Never'}</td>
            <td><button class="btn btn-sm btn-danger" onclick={() => revoke(key)}>Revoke</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <p class="muted">No keys yet. Scripts and integrations use keys to reach your archive.</p>
  {/if}

  <form class="stack new" onsubmit={create}>
    <div class="row grow">
      <div class="field">
        <label for="key-name">New key name</label>
        <input id="key-name" type="text" placeholder="e.g. Studio NAS" required maxlength="100" bind:value={name} />
      </div>
      <div class="field">
        <label for="key-expiry">Expires</label>
        <select id="key-expiry" bind:value={expiresInDays}>
          <option value="30">In 30 days</option>
          <option value="90">In 90 days</option>
          <option value="365">In a year</option>
          <option value="never">Never</option>
        </select>
      </div>
    </div>
    <fieldset class="scopes">
      <legend class="label">Scopes</legend>
      {#each grantable as scope (scope)}
        <label class="scope"><input type="checkbox" value={scope} bind:group={scopes} /> <code>{scope}</code></label>
      {/each}
    </fieldset>
    {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
    <div><button class="btn btn-primary" type="submit" disabled={busy || scopes.length === 0}>Create key</button></div>
  </form>
</div>

<style>
  .reveal {
    display: grid;
    gap: 8px;
    padding: 14px 16px;
    border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .key {
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    word-break: break-all;
  }
  .new {
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  .grow > .field:first-child {
    flex: 1 1 240px;
  }
  .scopes {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
  }
  .scopes legend {
    margin-bottom: 8px;
  }
  .scope {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    cursor: pointer;
  }
</style>

<script lang="ts">
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'

  interface Props {
    selfId: string
  }
  let { selfId }: Props = $props()

  interface User {
    id: string
    name: string
    email: string
    isActive: boolean
    twoFactorEnabled: boolean
    lastLoginAt: string | null
    roles: string[]
  }
  interface Role {
    name: string
    label: string
    description: string
  }

  let users = $state<User[]>([])
  let roles = $state<Role[]>([])
  let showCreate = $state(false)
  let draft = $state({ name: '', email: '', password: '', role: 'viewer' })
  let error = $state('')
  let busy = $state(false)

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'

  async function load() {
    const [u, r] = await Promise.all([api<{ users: User[] }>('/api/users'), api<{ roles: Role[] }>('/api/roles')])
    users = u.users
    roles = r.roles
  }
  onMount(load)

  async function create(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    busy = true
    try {
      await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({ name: draft.name, email: draft.email, password: draft.password, roles: [draft.role] }),
      })
      draft = { name: '', email: '', password: '', role: 'viewer' }
      showCreate = false
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not create the user.'
    } finally {
      busy = false
    }
  }

  async function update(user: User, patch: { roles?: string[]; isActive?: boolean }) {
    error = ''
    try {
      await api(`/api/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not update the user.'
    }
    await load()
  }
</script>

<div class="stack">
  <div class="row between">
    <span class="muted">{users.length} {users.length === 1 ? 'person' : 'people'}</span>
    <button class="btn btn-primary" onclick={() => (showCreate = !showCreate)}>{showCreate ? 'Cancel' : 'Add person'}</button>
  </div>

  {#if showCreate}
    <form class="card stack" onsubmit={create}>
      <div class="grid">
        <div class="field"><label for="u-name">Name</label><input id="u-name" type="text" required bind:value={draft.name} /></div>
        <div class="field"><label for="u-email">Email</label><input id="u-email" type="email" required bind:value={draft.email} /></div>
        <div class="field">
          <label for="u-password">Temporary password</label>
          <input id="u-password" type="password" minlength="12" autocomplete="new-password" required bind:value={draft.password} />
        </div>
        <div class="field">
          <label for="u-role">Role</label>
          <select id="u-role" bind:value={draft.role}>
            {#each roles as role (role.name)}<option value={role.name}>{role.label}</option>{/each}
          </select>
        </div>
      </div>
      <div><button class="btn btn-primary" type="submit" disabled={busy}>Create</button></div>
    </form>
  {/if}

  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}

  <div class="card table-card">
    <table class="table">
      <thead><tr><th>Person</th><th>Role</th><th>Two-factor</th><th>Last sign-in</th><th>Status</th></tr></thead>
      <tbody>
        {#each users as user (user.id)}
          <tr class:inactive={!user.isActive}>
            <td>
              <div class="person">
                <strong>{user.name || user.email}</strong>
                <span class="muted">{user.email}{user.id === selfId ? ' · you' : ''}</span>
              </div>
            </td>
            <td>
              <select
                aria-label={`Role for ${user.email}`}
                value={user.roles[0] ?? ''}
                onchange={(e) => update(user, { roles: [e.currentTarget.value] })}
              >
                {#each roles as role (role.name)}<option value={role.name}>{role.label}</option>{/each}
              </select>
            </td>
            <td><span class="badge" class:badge-ok={user.twoFactorEnabled} class:badge-off={!user.twoFactorEnabled}>{user.twoFactorEnabled ? 'On' : 'Off'}</span></td>
            <td class="muted">{fmt(user.lastLoginAt)}</td>
            <td>
              <button class="btn btn-sm" class:btn-danger={user.isActive} onclick={() => update(user, { isActive: !user.isActive })}>
                {user.isActive ? 'Deactivate' : 'Reactivate'}
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .between {
    justify-content: space-between;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 14px;
  }
  .table-card {
    padding: 16px 8px 8px;
    overflow-x: auto;
  }
  .person {
    display: grid;
  }
  select {
    width: auto;
    padding: 6px 10px;
  }
  tr.inactive td {
    opacity: 0.55;
  }
</style>

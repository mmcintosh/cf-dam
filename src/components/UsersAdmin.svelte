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
    passkeys: number
    sessions: number
    mustChangePassword: boolean
    lockedUntil: string | null
    lastLoginAt: string | null
    roles: string[]
  }
  interface Role {
    name: string
    label: string
    description: string
  }

  type Scope = 'nobody' | 'admins' | 'everyone'
  let users = $state<User[]>([])
  let required = $state<Scope>('nobody')
  let roles = $state<Role[]>([])
  /** Clients (only the Client role) are listed apart; they're invited from an album's sharing panel. */
  const isClient = (user: User) => user.roles.length > 0 && user.roles.every((r) => r === 'client')
  const team = $derived(users.filter((u) => !isClient(u)))
  const clients = $derived(users.filter(isClient))
  const teamRoles = $derived(roles.filter((r) => r.name !== 'client'))
  let showCreate = $state(false)
  let draft = $state({ name: '', email: '', password: '', role: 'viewer' })
  let error = $state('')
  let notice = $state('')
  let busy = $state(false)
  /** The person whose recovery actions are open. */
  let open = $state<string | null>(null)
  let temporary = $state('')
  /** An action waiting for its second click, as `<action>:<user id>`. */
  let confirming = $state<string | null>(null)
  let lapse: ReturnType<typeof setTimeout> | undefined

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'
  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { timeStyle: 'short' })
  const who = (user: User) => user.name || user.email

  async function load() {
    const [u, r, p] = await Promise.all([
      api<{ users: User[] }>('/api/users'),
      api<{ roles: Role[] }>('/api/roles'),
      api<{ twoFactorRequiredFor: Scope }>('/api/users/policy'),
    ])
    users = u.users
    roles = r.roles
    required = p.twoFactorRequiredFor
  }

  async function setRequired(scope: Scope) {
    error = ''
    notice = ''
    try {
      await api('/api/users/policy', { method: 'PUT', body: JSON.stringify({ twoFactorRequiredFor: scope }) })
      notice =
        scope === 'nobody'
          ? 'Two-factor sign-in is optional.'
          : `From their next page, ${scope === 'everyone' ? 'everyone' : 'administrators'} without a code or passkey will be asked to set one up before anything else.`
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not change the setting.'
    }
    await load()
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
      notice = `${draft.name || draft.email} can now sign in with the temporary password, and will be asked to choose their own.`
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

  function toggle(user: User) {
    open = open === user.id ? null : user.id
    temporary = ''
    arm(null)
  }

  function arm(key: string | null) {
    clearTimeout(lapse)
    confirming = key
    if (key) lapse = setTimeout(() => (confirming = null), 4000)
  }

  /** Run a recovery action; `confirm` ones need a second click within four seconds. */
  async function run(user: User, action: string, request: () => Promise<unknown>, done: string, confirm = false) {
    const key = `${action}:${user.id}`
    if (confirm && confirming !== key) return arm(key)
    arm(null)
    error = ''
    notice = ''
    busy = true
    try {
      await request()
      notice = done
      if (action === 'delete') open = null
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : 'That did not work.'
    } finally {
      busy = false
    }
  }

  const post = (user: User, path: string, body: unknown = {}) => () =>
    api(`/api/users/${user.id}/${path}`, { method: 'POST', body: JSON.stringify(body) })

  function setPassword(event: SubmitEvent, user: User) {
    event.preventDefault()
    const password = temporary
    void run(user, 'password', post(user, 'password', { password }), `${who(user)} is signed out. Give them the temporary password; they'll choose their own when they sign in.`).then(
      () => (temporary = ''),
    )
  }

  const signInLabel = (user: User) =>
    [user.twoFactorEnabled ? 'Code' : null, user.passkeys > 0 ? (user.passkeys === 1 ? 'Passkey' : `${user.passkeys} passkeys`) : null].filter(Boolean).join(' · ') ||
    'Password only'
</script>

{#snippet people(list: User[])}
  <div class="card table-card">
    <table class="table">
      <thead><tr><th>Person</th><th>Role</th><th>Signs in with</th><th>Last sign-in</th><th></th></tr></thead>
      <tbody>
        {#each list as user (user.id)}
          <tr class:inactive={!user.isActive}>
            <td>
              <div class="person">
                <strong>{who(user)}</strong>
                <span class="muted">{user.email}{user.id === selfId ? ' · you' : ''}</span>
                <span class="flags">
                  {#if !user.isActive}<span class="badge">Deactivated</span>{/if}
                  {#if user.lockedUntil}<span class="badge badge-warn">Password locked until {time(user.lockedUntil)}</span>{/if}
                  {#if user.mustChangePassword}<span class="badge">Temporary password</span>{/if}
                </span>
              </div>
            </td>
            <td>
              {#if isClient(user)}
                <span class="muted">Client</span>
              {:else}
                <select
                  aria-label={`Role for ${user.email}`}
                  value={user.roles[0] ?? ''}
                  onchange={(e) => update(user, { roles: [e.currentTarget.value] })}
                >
                  {#each teamRoles as role (role.name)}<option value={role.name}>{role.label}</option>{/each}
                </select>
              {/if}
            </td>
            <td>
              <span class="badge" class:badge-ok={user.twoFactorEnabled || user.passkeys > 0} class:badge-off={!user.twoFactorEnabled && user.passkeys === 0}>
                {signInLabel(user)}
              </span>
            </td>
            <td class="muted">{fmt(user.lastLoginAt)}</td>
            <td class="end">
              <button class="btn btn-sm" aria-expanded={open === user.id} onclick={() => toggle(user)}>{open === user.id ? 'Close' : 'Manage'}</button>
            </td>
          </tr>
          {#if open === user.id}
            <tr class="manage">
              <td colspan="5">
                {#if user.id === selfId}
                  <p class="muted">Your own password, codes, passkeys and sign-ins are on <a href="/account">Account</a>.</p>
                {:else}
                  <div class="actions">
                    <form class="action" onsubmit={(e) => setPassword(e, user)}>
                      <div>
                        <strong>Temporary password</strong>
                        <p class="muted small">Signs them out. They choose their own at the next sign-in. Also lifts a password lock.</p>
                      </div>
                      <div class="row">
                        <input
                          type="password"
                          minlength="12"
                          required
                          autocomplete="new-password"
                          placeholder="At least 12 characters"
                          aria-label={`Temporary password for ${user.email}`}
                          bind:value={temporary}
                        />
                        <button class="btn btn-sm" type="submit" disabled={busy}>Set</button>
                      </div>
                    </form>

                    <div class="action">
                      <div>
                        <strong>Lost phone or passkey</strong>
                        <p class="muted small">Turns their codes off{user.passkeys > 0 ? ', and optionally removes their passkeys' : ''}, and signs them out. They can set them up again on Account.</p>
                      </div>
                      <div class="row">
                        <button
                          class="btn btn-sm"
                          disabled={busy || !user.twoFactorEnabled}
                          onclick={() => run(user, 'codes', post(user, 'two-factor/reset'), `${who(user)}'s codes are off.`, true)}
                        >
                          {confirming === `codes:${user.id}` ? 'Click again to confirm' : 'Reset codes'}
                        </button>
                        {#if user.passkeys > 0}
                          <button
                            class="btn btn-sm"
                            disabled={busy}
                            onclick={() => run(user, 'passkeys', post(user, 'two-factor/reset', { passkeys: true }), `${who(user)}'s codes and passkeys are removed.`, true)}
                          >
                            {confirming === `passkeys:${user.id}` ? 'Click again to confirm' : 'Reset codes and passkeys'}
                          </button>
                        {/if}
                      </div>
                    </div>

                    {#if user.lockedUntil}
                      <div class="action">
                        <div>
                          <strong>Locked out</strong>
                          <p class="muted small">Too many wrong passwords. It lifts by itself at {time(user.lockedUntil)}.</p>
                        </div>
                        <div class="row"><button class="btn btn-sm" disabled={busy} onclick={() => run(user, 'unlock', post(user, 'unlock'), `${who(user)} can sign in again.`)}>Unlock now</button></div>
                      </div>
                    {/if}

                    <div class="action">
                      <div>
                        <strong>Sign out everywhere</strong>
                        <p class="muted small">{user.sessions === 0 ? 'Not signed in anywhere right now.' : `Signed in on ${user.sessions} ${user.sessions === 1 ? 'browser' : 'browsers'}.`}</p>
                      </div>
                      <div class="row">
                        <button class="btn btn-sm" disabled={busy || user.sessions === 0} onclick={() => run(user, 'sign-out', post(user, 'sign-out'), `${who(user)} is signed out everywhere.`)}>Sign out</button>
                      </div>
                    </div>

                    <div class="action">
                      <div>
                        <strong>{user.isActive ? 'Deactivate' : 'Reactivate'}</strong>
                        <p class="muted small">{user.isActive ? 'Stops them signing in, and keeps the account for later.' : 'Lets them sign in again.'}</p>
                      </div>
                      <div class="row">
                        <button class="btn btn-sm" class:btn-danger={user.isActive} disabled={busy} onclick={() => update(user, { isActive: !user.isActive })}>
                          {user.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </div>
                    </div>

                    <div class="action">
                      <div>
                        <strong>Delete</strong>
                        <p class="muted small">Removes the person and their sign-ins. Photos, albums and galleries they made stay.</p>
                      </div>
                      <div class="row">
                        <button
                          class="btn btn-sm btn-danger"
                          disabled={busy}
                          onblur={() => confirming === `delete:${user.id}` && arm(null)}
                          onclick={() => run(user, 'delete', () => api(`/api/users/${user.id}`, { method: 'DELETE' }), `${who(user)} is deleted.`, true)}
                        >
                          {confirming === `delete:${user.id}` ? "Click again: can't be undone" : 'Delete'}
                        </button>
                      </div>
                    </div>
                  </div>
                {/if}
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}

<div class="stack">
  <div class="card policy">
    <div>
      <strong>Two-factor sign-in</strong>
      <p class="muted small">A code from an authenticator app, or a passkey. Required people without one are asked to set it up before anything else.</p>
    </div>
    <label class="row">
      <span class="muted">Required for</span>
      <select value={required} onchange={(e) => setRequired(e.currentTarget.value as Scope)}>
        <option value="nobody">Nobody</option>
        <option value="admins">Administrators</option>
        <option value="everyone">Everyone on the team</option>
      </select>
    </label>
  </div>

  <div class="row between">
    <span class="muted">{team.length} {team.length === 1 ? 'person' : 'people'} on the team</span>
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
            {#each teamRoles as role (role.name)}<option value={role.name}>{role.label}</option>{/each}
          </select>
        </div>
      </div>
      <p class="muted small">They'll be asked to choose their own password the first time they sign in.</p>
      <div><button class="btn btn-primary" type="submit" disabled={busy}>Create</button></div>
    </form>
  {/if}

  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
  {#if notice}<div class="alert alert-success" role="status">{notice}</div>{/if}

  {@render people(team)}

  {#if clients.length > 0}
    <div>
      <h2 class="section">Clients</h2>
      <p class="muted small">
        People invited to client galleries. They sign in and see only their galleries. Invite them, or take them off a gallery, under <strong>Share with clients</strong> on the album.
      </p>
    </div>
    {@render people(clients)}
  {/if}
</div>

<style>
  .section {
    font-size: 1.1rem;
    margin: 12px 0 4px;
  }
  .between {
    justify-content: space-between;
  }
  .policy {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 10px 20px;
  }
  .policy > div {
    flex: 1 1 280px;
    min-width: 0;
  }
  .policy p {
    margin: 2px 0 0;
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
    gap: 2px;
  }
  .flags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .flags:empty {
    display: none;
  }
  .badge-warn {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 45%, transparent);
  }
  select {
    width: auto;
    padding: 6px 10px;
  }
  tr.inactive td {
    opacity: 0.55;
  }
  .end {
    text-align: right;
  }
  tr.manage td {
    background: color-mix(in srgb, var(--text) 3%, transparent);
  }
  .actions {
    display: grid;
    gap: 2px;
  }
  .action {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 8px 16px;
    padding: 10px 4px;
    border-bottom: 1px solid var(--border);
  }
  .action:last-child {
    border-bottom: 0;
  }
  .action > div:first-child {
    min-width: 0;
    flex: 1 1 260px;
  }
  .action p {
    margin: 2px 0 0;
  }
  .action input {
    width: 220px;
    max-width: 100%;
  }
  .small {
    font-size: 0.8rem;
  }
</style>

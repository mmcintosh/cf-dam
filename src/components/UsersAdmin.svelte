<script lang="ts">
  import { format, t } from '@cf-dam/i18n/client'
  import type { MessageKey } from '@cf-dam/i18n'
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
    /** The client this login belongs to, if any. */
    client: { id: string; name: string } | null
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
  /** Clients (only the Client role) are listed apart; they're invited from a gallery or a client's page. */
  const isClient = (user: User) => user.roles.length > 0 && user.roles.every((r) => r === 'client')
  const team = $derived(users.filter((u) => !isClient(u)))
  const clients = $derived(users.filter(isClient))
  const teamRoles = $derived(roles.filter((r) => r.name !== 'client'))
  /** Team or Clients, and a search over names and emails that ignores case and accents ("muller" finds Müller). */
  let tab = $state<'team' | 'clients'>('team')
  let query = $state('')
  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()
  const matching = (list: User[]) => {
    const q = fold(query.trim())
    return q ? list.filter((u) => fold(`${u.name ?? ''} ${u.email}`).includes(q)) : list
  }
  const shown = $derived(matching(tab === 'team' ? team : clients))
  let showCreate = $state(false)
  let draft = $state({ name: '', email: '', password: '', role: 'viewer', byEmail: true })
  /** Whether email works: a new person can then get a set-your-password email instead of a temporary password. */
  let mailOn = $state(false)
  /** A set-your-password link just made, to copy when it couldn't be emailed. */
  let teamLink = $state<{ url: string; emailed: boolean; email: string } | null>(null)
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
    iso ? format().dateTime(iso) : t('common.never')
  const time = (iso: string) => format().time(iso)
  const who = (user: User) => user.name || user.email

  async function load() {
    const [u, r, p] = await Promise.all([
      api<{ users: User[]; mailOn: boolean }>('/api/users'),
      api<{ roles: Role[] }>('/api/roles'),
      api<{ twoFactorRequiredFor: Scope }>('/api/users/policy'),
    ])
    users = u.users
    mailOn = u.mailOn
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
          ? t('people.optional')
          : t(scope === 'everyone' ? 'people.requiredEveryone' : 'people.requiredAdmins')
    } catch (e) {
      error = e instanceof Error ? e.message : t('people.settingFailed')
    }
    await load()
  }
  onMount(load)

  async function create(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    busy = true
    try {
      const byEmail = mailOn && draft.byEmail
      const result = await api<{ invite: { token: string } | null; emailed: boolean }>('/api/users', {
        method: 'POST',
        body: JSON.stringify(byEmail ? { name: draft.name, email: draft.email, sendEmail: true, roles: [draft.role] } : { name: draft.name, email: draft.email, password: draft.password, roles: [draft.role] }),
      })
      notice = t('people.created', { name: draft.name || draft.email })
      teamLink = result.invite ? { url: `${location.origin}/invite/${result.invite.token}`, emailed: result.emailed, email: draft.email } : null
      draft = { name: '', email: '', password: '', role: 'viewer', byEmail: true }
      showCreate = false
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : t('people.createFailed')
    } finally {
      busy = false
    }
  }

  async function update(user: User, patch: { roles?: string[]; isActive?: boolean }) {
    error = ''
    try {
      await api(`/api/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
    } catch (e) {
      error = e instanceof Error ? e.message : t('people.updateFailed')
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
      error = e instanceof Error ? e.message : t('common.didNotWork')
    } finally {
      busy = false
    }
  }

  const post = (user: User, path: string, body: unknown = {}) => () =>
    api(`/api/users/${user.id}/${path}`, { method: 'POST', body: JSON.stringify(body) })

  function setPassword(event: SubmitEvent, user: User) {
    event.preventDefault()
    const password = temporary
    void run(user, 'password', post(user, 'password', { password }), t('people.passwordSet', { name: who(user) })).then(
      () => (temporary = ''),
    )
  }

  const signInLabel = (user: User) =>
    [user.twoFactorEnabled ? t('people.signInCode') : null, user.passkeys > 0 ? t('people.passkeys', { count: user.passkeys }) : null].filter(Boolean).join(' · ') ||
    t('people.passwordOnly')
</script>

{#snippet people(list: User[])}
  <div class="card table-card">
    <table class="table">
      <thead><tr><th>{t('people.person')}</th><th>{t('people.role')}</th><th>{t('people.signsInWith')}</th><th>{t('people.lastSignIn')}</th><th></th></tr></thead>
      <tbody>
        {#each list as user (user.id)}
          <tr class:inactive={!user.isActive}>
            <td>
              <div class="person">
                <strong>{who(user)}</strong>
                <span class="muted">{user.email}{user.id === selfId ? ` · ${t('people.you')}` : ''}</span>
                <span class="flags">
                  {#if !user.isActive}<span class="badge">{t('people.deactivated')}</span>{/if}
                  {#if user.lockedUntil}<span class="badge badge-warn">{t('people.lockedUntil', { time: time(user.lockedUntil) })}</span>{/if}
                  {#if user.mustChangePassword}<span class="badge">{t('people.temporary')}</span>{/if}
                </span>
              </div>
            </td>
            <td>
              {#if isClient(user)}
                <span class="muted">{t('role.client')}</span>
                {#if user.client}<a class="small" href={`/clients/${user.client.id}`}>{user.client.name}</a>{/if}
              {:else}
                <select
                  aria-label={t('people.roleFor', { email: user.email })}
                  value={user.roles[0] ?? ''}
                  onchange={(e) => update(user, { roles: [e.currentTarget.value] })}
                >
                  {#each teamRoles as role (role.name)}<option value={role.name}>{['admin', 'editor', 'viewer'].includes(role.name) ? t(`role.${role.name}` as MessageKey) : role.label}</option>{/each}
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
              <button class="btn btn-sm" aria-expanded={open === user.id} onclick={() => toggle(user)}>{open === user.id ? t('common.close') : t('common.manage')}</button>
            </td>
          </tr>
          {#if open === user.id}
            <tr class="manage">
              <td colspan="5">
                {#if user.id === selfId}
                  <p class="muted"><a href="/account">{t('people.ownOnAccount')}</a></p>
                {:else}
                  <div class="actions">
                    <form class="action" onsubmit={(e) => setPassword(e, user)}>
                      <div>
                        <strong>{t('people.temporary')}</strong>
                        <p class="muted small">{t('people.temporaryLead')}</p>
                      </div>
                      <div class="row">
                        <input
                          type="password"
                          minlength="12"
                          required
                          autocomplete="new-password"
                          placeholder={t('people.atLeast12')}
                          aria-label={t('people.temporaryFor', { email: user.email })}
                          bind:value={temporary}
                        />
                        <button class="btn btn-sm" type="submit" disabled={busy}>{t('people.set')}</button>
                      </div>
                    </form>

                    <div class="action">
                      <div>
                        <strong>{t('people.lost')}</strong>
                        <p class="muted small">{user.passkeys > 0 ? t('people.lostLeadPasskeys') : t('people.lostLead')}</p>
                      </div>
                      <div class="row">
                        <button
                          class="btn btn-sm"
                          disabled={busy || !user.twoFactorEnabled}
                          onclick={() => run(user, 'codes', post(user, 'two-factor/reset'), t('people.codesOff', { name: who(user) }), true)}
                        >
                          {confirming === `codes:${user.id}` ? t('common.clickAgainConfirm') : t('people.resetCodes')}
                        </button>
                        {#if user.passkeys > 0}
                          <button
                            class="btn btn-sm"
                            disabled={busy}
                            onclick={() => run(user, 'passkeys', post(user, 'two-factor/reset', { passkeys: true }), t('people.codesPasskeysRemoved', { name: who(user) }), true)}
                          >
                            {confirming === `passkeys:${user.id}` ? t('common.clickAgainConfirm') : t('people.resetCodesPasskeys')}
                          </button>
                        {/if}
                      </div>
                    </div>

                    {#if user.lockedUntil}
                      <div class="action">
                        <div>
                          <strong>{t('people.lockedOut')}</strong>
                          <p class="muted small">{t('people.lockedLead', { time: time(user.lockedUntil) })}</p>
                        </div>
                        <div class="row"><button class="btn btn-sm" disabled={busy} onclick={() => run(user, 'unlock', post(user, 'unlock'), t('people.canSignIn', { name: who(user) }))}>{t('people.unlock')}</button></div>
                      </div>
                    {/if}

                    <div class="action">
                      <div>
                        <strong>{t('people.signOutEverywhere')}</strong>
                        <p class="muted small">{user.sessions === 0 ? t('people.notSignedIn') : t('people.signedInOn', { count: user.sessions })}</p>
                      </div>
                      <div class="row">
                        <button class="btn btn-sm" disabled={busy || user.sessions === 0} onclick={() => run(user, 'sign-out', post(user, 'sign-out'), t('people.signedOutEverywhere', { name: who(user) }))}>{t('common.signOut')}</button>
                      </div>
                    </div>

                    <div class="action">
                      <div>
                        <strong>{user.isActive ? t('people.deactivate') : t('people.reactivate')}</strong>
                        <p class="muted small">{user.isActive ? t('people.deactivateLead') : t('people.reactivateLead')}</p>
                      </div>
                      <div class="row">
                        <button class="btn btn-sm" class:btn-danger={user.isActive} disabled={busy} onclick={() => update(user, { isActive: !user.isActive })}>
                          {user.isActive ? t('people.deactivate') : t('people.reactivate')}
                        </button>
                      </div>
                    </div>

                    <div class="action">
                      <div>
                        <strong>{t('common.delete')}</strong>
                        <p class="muted small">{t('people.deleteLead')}</p>
                      </div>
                      <div class="row">
                        <button
                          class="btn btn-sm btn-danger"
                          disabled={busy}
                          onblur={() => confirming === `delete:${user.id}` && arm(null)}
                          onclick={() => run(user, 'delete', () => api(`/api/users/${user.id}`, { method: 'DELETE' }), t('people.deleted', { name: who(user) }), true)}
                        >
                          {confirming === `delete:${user.id}` ? t('people.deleteConfirm') : t('common.delete')}
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
      <strong>{t('account.twoFactor.title')}</strong>
      <p class="muted small">{t('people.twoFactorLead')}</p>
    </div>
    <label class="row">
      <span class="muted">{t('people.requiredFor')}</span>
      <select value={required} onchange={(e) => setRequired(e.currentTarget.value as Scope)}>
        <option value="nobody">{t('people.nobody')}</option>
        <option value="admins">{t('people.admins')}</option>
        <option value="everyone">{t('people.everyone')}</option>
      </select>
    </label>
  </div>

  <div class="row between">
    <span class="muted">{t('people.onTeam', { count: team.length })}</span>
    <button class="btn btn-primary" onclick={() => (showCreate = !showCreate)}>{showCreate ? t('common.cancel') : t('people.add')}</button>
  </div>

  {#if showCreate}
    <form class="card stack" onsubmit={create}>
      <div class="grid">
        <div class="field"><label for="u-name">{t('common.name')}</label><input id="u-name" type="text" required bind:value={draft.name} /></div>
        <div class="field"><label for="u-email">{t('common.email')}</label><input id="u-email" type="email" required bind:value={draft.email} /></div>
        {#if !(mailOn && draft.byEmail)}
          <div class="field">
            <label for="u-password">{t('people.temporary')}</label>
            <input id="u-password" type="password" minlength="12" autocomplete="new-password" required bind:value={draft.password} />
          </div>
        {/if}
        <div class="field">
          <label for="u-role">{t('people.role')}</label>
          <select id="u-role" bind:value={draft.role}>
            {#each teamRoles as role (role.name)}<option value={role.name}>{['admin', 'editor', 'viewer'].includes(role.name) ? t(`role.${role.name}` as MessageKey) : role.label}</option>{/each}
          </select>
        </div>
      </div>
      {#if mailOn}<label class="row small by-email"><input type="checkbox" bind:checked={draft.byEmail} /> {t('people.byEmail')}</label>{/if}
      <p class="muted small">{mailOn && draft.byEmail ? t('people.byEmailNote') : t('people.chooseOwn')}</p>
      <div><button class="btn btn-primary" type="submit" disabled={busy}>{t('common.create')}</button></div>
    </form>
  {/if}

  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
  {#if notice}<div class="alert alert-success" role="status">{notice}</div>{/if}
  {#if teamLink}
    <div class="card stack" role="status">
      <p class="small">{teamLink.emailed ? t('people.linkEmailed', { email: teamLink.email }) : t('people.linkToSend', { email: teamLink.email })}</p>
      <div class="row"><code class="team-link">{teamLink.url}</code><button class="btn btn-sm" type="button" onclick={() => (teamLink = null)}>{t('common.done')}</button></div>
    </div>
  {/if}

  <div class="row between tabs-row">
    <div class="tabs" role="tablist">
      <button role="tab" type="button" class="tab" class:on={tab === 'team'} aria-selected={tab === 'team'} onclick={() => (tab = 'team')}>{t('people.tab.team')} <span class="count">{team.length}</span></button>
      <button role="tab" type="button" class="tab" class:on={tab === 'clients'} aria-selected={tab === 'clients'} onclick={() => (tab = 'clients')}>{t('people.tab.clients')} <span class="count">{clients.length}</span></button>
    </div>
    <input class="search" type="search" placeholder={t('people.search')} aria-label={t('people.search')} bind:value={query} />
  </div>
  {#if tab === 'clients'}<p class="muted small">{clients.length > 0 ? t('people.clientsLead') : t('people.noClients')}</p>{/if}
  {#if shown.length > 0}
    {@render people(shown)}
  {:else if query.trim()}
    <p class="muted">{t('people.noMatch', { query: query.trim() })}</p>
  {/if}
</div>

<style>
  .by-email {
    gap: 6px;
    align-items: center;
  }
  .team-link {
    overflow-wrap: anywhere;
    flex: 1;
  }
  .tabs-row {
    gap: 12px;
    flex-wrap: wrap;
    align-items: center;
  }
  .tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--border);
  }
  .tab {
    font: inherit;
    padding: 8px 14px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }
  .tab.on {
    color: var(--text);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }
  .count {
    color: var(--text-muted);
    font-weight: 400;
    margin-left: 4px;
  }
  .search {
    flex: 0 1 280px;
  }
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

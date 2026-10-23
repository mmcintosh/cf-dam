<script lang="ts">
  /**
   * Under a gallery link: the clients with an account who see it, and inviting another. An invite is a
   * one-time link shown once, for the photographer to send themselves (cf-dam sends no email).
   */
  import { onMount } from 'svelte'
  import type { MemberJson } from '@cf-dam/api'
  import { api } from '../lib/auth-client'

  let { shareId }: { shareId: string } = $props()

  let members = $state<MemberJson[]>([])
  let inviting = $state(false)
  let name = $state('')
  let email = $state('')
  let busy = $state(false)
  let error = $state('')
  /** The invite just made: shown once, with who it's for. */
  let fresh = $state<{ name: string; url: string; expires: string } | null>(null)
  let note = $state('')
  let copied = $state(false)

  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
  const inviteUrl = (token: string) => `${location.origin}/invite/${token}`

  async function load() {
    members = (await api<{ members: MemberJson[] }>(`/api/shares/${shareId}/members`)).members
  }
  onMount(() => void load().catch(() => {}))

  async function invite(event: SubmitEvent) {
    event.preventDefault()
    busy = true
    error = ''
    note = ''
    fresh = null
    try {
      const result = await api<{ member: MemberJson; invite: { token: string; expiresAt: string } | null }>(`/api/shares/${shareId}/members`, {
        method: 'POST',
        body: JSON.stringify({ name, email }),
      })
      if (result.invite) fresh = { name: result.member.name, url: inviteUrl(result.invite.token), expires: day(result.invite.expiresAt) }
      else note = `${result.member.name} already has an account: this gallery is now on their list the next time they sign in.`
      name = ''
      email = ''
      inviting = false
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not invite them.'
    } finally {
      busy = false
    }
  }

  async function reinvite(member: MemberJson) {
    error = ''
    note = ''
    try {
      const { invite } = await api<{ invite: { token: string; expiresAt: string } }>(`/api/shares/${shareId}/members/${member.userId}/invite`, { method: 'POST' })
      fresh = { name: member.name, url: inviteUrl(invite.token), expires: day(invite.expiresAt) }
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not make a new invite.'
    }
  }

  async function remove(member: MemberJson) {
    error = ''
    try {
      await api(`/api/shares/${shareId}/members/${member.userId}`, { method: 'DELETE' })
      note = `${member.name} no longer sees this gallery.`
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not take them off.'
    }
  }

  async function copy() {
    if (!fresh) return
    await navigator.clipboard.writeText(fresh.url)
    copied = true
    setTimeout(() => (copied = false), 2000)
  }
</script>

<div class="clients stack">
  <div class="row head">
    <span class="small"><strong>Clients with an account</strong> <span class="muted">sign in and see only their galleries; no password needed for this link.</span></span>
    {#if !inviting}<button class="btn btn-sm" type="button" onclick={() => ((inviting = true), (fresh = null), (note = ''))}>Invite a client</button>{/if}
  </div>

  {#if members.length > 0}
    <ul class="members">
      {#each members as member (member.userId)}
        <li class="row">
          <span class="who">
            <strong>{member.name}</strong> <span class="muted small">{member.email}</span>
          </span>
          <span class="muted small">
            {#if !member.isActive}Account turned off
            {:else if member.joined}{member.lastLoginAt ? `Last signed in ${day(member.lastLoginAt)}` : 'Joined'}
            {:else if member.inviteExpiresAt && member.inviteExpiresAt > new Date().toISOString()}Invited: hasn't chosen a password yet
            {:else}Invite expired{/if}
          </span>
          <span class="row actions">
            {#if !member.joined}<button class="btn btn-sm" type="button" onclick={() => reinvite(member)}>New invite link</button>{/if}
            <button class="btn btn-sm" type="button" onclick={() => remove(member)} title="They keep their account for other galleries">Take off this gallery</button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if inviting}
    <form class="row invite" onsubmit={invite}>
      <input type="text" aria-label="Their name" placeholder="Their name" required maxlength="100" bind:value={name} />
      <input type="email" aria-label="Their email" placeholder="Their email" required maxlength="254" bind:value={email} />
      <button class="btn btn-primary btn-sm" type="submit" disabled={busy}>Invite</button>
      <button class="btn btn-sm" type="button" onclick={() => (inviting = false)}>Cancel</button>
    </form>
  {/if}

  {#if fresh}
    <div class="fresh stack" role="status">
      <p class="small">
        <strong>Send {fresh.name} this invite.</strong> cf-dam doesn't send email, so copy it into your own message. It works once, until {fresh.expires}:
        they choose a password and land in this gallery. This is the only time it's shown; you can make a new one later.
      </p>
      <div class="row">
        <code class="url">{fresh.url}</code>
        <button class="btn btn-sm btn-primary" type="button" onclick={copy}>{copied ? 'Copied' : 'Copy invite'}</button>
        <button class="btn btn-sm" type="button" onclick={() => (fresh = null)}>Done</button>
      </div>
    </div>
  {/if}
  {#if note}<p class="muted small" role="status">{note}</p>{/if}
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
</div>

<style>
  .clients {
    gap: 8px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent) 5%, transparent);
  }
  .head {
    justify-content: space-between;
  }
  .small {
    font-size: 0.85rem;
  }
  .members {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .members li {
    justify-content: space-between;
    gap: 6px 14px;
  }
  .who {
    min-width: 200px;
  }
  .actions {
    margin-left: auto;
  }
  .invite input {
    flex: 1 1 180px;
  }
  .fresh {
    gap: 8px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .fresh p {
    margin: 0;
  }
  .url {
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: min(460px, 100%);
  }
</style>

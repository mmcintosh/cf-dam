<script lang="ts">
  import { format, t } from '@cf-dam/i18n/client'
  /**
   * Under a gallery link: the clients with an account who see it, and inviting another. An invite is a
   * one-time link shown once; when email works it's also emailed to them (plans/PLAN-E-v2.md §4).
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
  let fresh = $state<{ name: string; url: string; expires: string; emailedTo: string | null } | null>(null)
  /** Whether email works here, and whether to use it for this invite. */
  let mailOn = $state(false)
  let sendEmail = $state(true)
  let note = $state('')
  let copied = $state(false)

  const day = (iso: string) => format().date(iso)
  const inviteUrl = (token: string) => `${location.origin}/invite/${token}`

  async function load() {
    const result = await api<{ members: MemberJson[]; mailOn: boolean }>(`/api/shares/${shareId}/members`)
    members = result.members
    mailOn = result.mailOn
  }
  onMount(() => void load().catch(() => {}))

  async function invite(event: SubmitEvent) {
    event.preventDefault()
    busy = true
    error = ''
    note = ''
    fresh = null
    try {
      const result = await api<{ member: MemberJson; invite: { token: string; expiresAt: string } | null; emailed: boolean }>(`/api/shares/${shareId}/members`, {
        method: 'POST',
        body: JSON.stringify({ name, email, sendEmail: mailOn && sendEmail }),
      })
      if (result.invite) fresh = { name: result.member.name, url: inviteUrl(result.invite.token), expires: day(result.invite.expiresAt), emailedTo: result.emailed ? result.member.email : null }
      else note = t('clients.alreadyHas', { name: result.member.name })
      name = ''
      email = ''
      inviting = false
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : t('clients.inviteFailed')
    } finally {
      busy = false
    }
  }

  async function reinvite(member: MemberJson) {
    error = ''
    note = ''
    try {
      const { invite, emailed } = await api<{ invite: { token: string; expiresAt: string }; emailed: boolean }>(`/api/shares/${shareId}/members/${member.userId}/invite`, {
        method: 'POST',
        body: JSON.stringify({ sendEmail: mailOn && sendEmail }),
      })
      fresh = { name: member.name, url: inviteUrl(invite.token), expires: day(invite.expiresAt), emailedTo: emailed ? member.email : null }
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : t('clients.reinviteFailed')
    }
  }

  async function remove(member: MemberJson) {
    error = ''
    try {
      await api(`/api/shares/${shareId}/members/${member.userId}`, { method: 'DELETE' })
      note = t('clients.removed', { name: member.name })
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : t('clients.removeFailed')
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
    <span class="small"><strong>{t('clients.title')}</strong> <span class="muted">{t('clients.lead')}</span></span>
    {#if !inviting}<button class="btn btn-sm" type="button" onclick={() => ((inviting = true), (fresh = null), (note = ''))}>{t('clients.invite')}</button>{/if}
  </div>

  {#if members.length > 0}
    <ul class="members">
      {#each members as member (member.userId)}
        <li class="row">
          <span class="who">
            <strong>{member.name}</strong> <span class="muted small">{member.email}</span>
          </span>
          <span class="muted small">
            {#if !member.isActive}{t('clients.off')}
            {:else if member.joined}{member.lastLoginAt ? t('clients.lastSignedIn', { date: day(member.lastLoginAt) }) : t('clients.joined')}
            {:else if member.inviteExpiresAt && member.inviteExpiresAt > new Date().toISOString()}{t('clients.invited')}
            {:else}{t('clients.expired')}{/if}
          </span>
          <span class="row actions">
            {#if !member.joined}<button class="btn btn-sm" type="button" onclick={() => reinvite(member)}>{t('clients.newInvite')}</button>{/if}
            <button class="btn btn-sm" type="button" onclick={() => remove(member)} title={t('clients.takeOffTitle')}>{t('clients.takeOff')}</button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if inviting}
    <form class="row invite" onsubmit={invite}>
      <input type="text" aria-label={t('clients.theirName')} placeholder={t('clients.theirName')} required maxlength="100" bind:value={name} />
      <input type="email" aria-label={t('clients.theirEmail')} placeholder={t('clients.theirEmail')} required maxlength="254" bind:value={email} />
      <button class="btn btn-primary btn-sm" type="submit" disabled={busy}>{t('clients.inviteButton')}</button>
      <button class="btn btn-sm" type="button" onclick={() => (inviting = false)}>{t('common.cancel')}</button>
      {#if mailOn}<label class="send small"><input type="checkbox" bind:checked={sendEmail} /> {t('clients.sendByEmail')}</label>{/if}
    </form>
  {/if}

  {#if fresh}
    <div class="fresh stack" role="status">
      {#if fresh.emailedTo}
        <p class="small"><strong>{t('clients.emailed', { email: fresh.emailedTo })}</strong> {t('clients.emailedLead', { date: fresh.expires })}</p>
      {:else}
        <p class="small">
          <strong>{t('clients.send', { name: fresh.name })}</strong> {t('clients.sendLead', { date: fresh.expires })}
        </p>
      {/if}
      <div class="row">
        <code class="url">{fresh.url}</code>
        <button class="btn btn-sm btn-primary" type="button" onclick={copy}>{copied ? t('share.copied') : t('clients.copyInvite')}</button>
        <button class="btn btn-sm" type="button" onclick={() => (fresh = null)}>{t('common.done')}</button>
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
  .send {
    display: flex;
    gap: 6px;
    align-items: center;
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

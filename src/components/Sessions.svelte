<script lang="ts">
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'
  import { format, t } from '@cf-dam/i18n/client'
  import { describeUserAgent } from '../lib/user-agent'

  interface Session {
    id: string
    userAgent: string | null
    ipAddress: string | null
    signedInAt: string
    lastActiveAt: string
    current: boolean
  }

  let sessions = $state<Session[]>([])
  let error = $state('')
  let notice = $state('')
  let busy = $state(false)
  let confirming = $state(false)
  let lapse: ReturnType<typeof setTimeout> | undefined

  const others = $derived(sessions.filter((s) => !s.current))
  const date = (iso: string) => format().date(iso)
  /** Sessions are refreshed at most once a day, so "active" is only as fine as the day. */
  function active(iso: string): string {
    const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
    return days < 1 ? t('sessions.activeToday') : days < 2 ? t('sessions.activeYesterday') : t('sessions.activeOn', { date: date(iso) })
  }

  async function load() {
    sessions = (await api<{ sessions: Session[] }>('/api/me/sessions')).sessions
  }
  onMount(load)

  async function end(session: Session) {
    error = notice = ''
    busy = true
    try {
      await api(`/api/me/sessions/${session.id}`, { method: 'DELETE' })
      notice = t('sessions.signedOut', { browser: describeUserAgent(session.userAgent) })
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : t('sessions.couldNotOne')
    } finally {
      busy = false
    }
  }

  async function endOthers() {
    if (!confirming) {
      confirming = true
      clearTimeout(lapse)
      lapse = setTimeout(() => (confirming = false), 4000)
      return
    }
    clearTimeout(lapse)
    confirming = false
    error = notice = ''
    busy = true
    try {
      const { ended } = await api<{ ended: number }>('/api/me/sessions/sign-out-others', { method: 'POST' })
      notice = t('sessions.signedOutOthers', { count: ended })
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : t('sessions.couldNotOthers')
    } finally {
      busy = false
    }
  }
</script>

<div class="stack">
  <ul class="sessions">
    {#each sessions as session (session.id)}
      <li>
        <span class="what">
          <strong>{describeUserAgent(session.userAgent)}</strong>
          {#if session.current}<span class="badge badge-ok">{t('sessions.thisBrowser')}</span>{/if}
          <span class="muted small">
            {session.ipAddress ?? t('sessions.unknownAddress')} · {t('sessions.signedIn', { date: date(session.signedInAt) })} · {active(session.lastActiveAt)}
          </span>
        </span>
        {#if !session.current}
          <button class="btn btn-sm" disabled={busy} onclick={() => end(session)}>{t('common.signOut')}</button>
        {/if}
      </li>
    {/each}
  </ul>
  {#if others.length > 1}
    <div>
      <button class="btn btn-sm btn-danger" disabled={busy} onclick={endOthers} onblur={() => (confirming = false)}>
        {confirming ? t('common.clickAgainConfirm') : t('sessions.signOutAll', { count: others.length })}
      </button>
    </div>
  {/if}
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
  {#if notice}<div class="alert alert-success" role="status">{notice}</div>{/if}
</div>

<style>
  .sessions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  .sessions li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }
  .sessions li:last-child {
    border-bottom: 0;
  }
  .what {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
    min-width: 0;
  }
  .what .small {
    flex-basis: 100%;
    overflow-wrap: anywhere;
  }
  .small {
    font-size: 0.8rem;
  }
</style>

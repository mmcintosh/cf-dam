<script lang="ts">
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'
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
  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
  /** Sessions are refreshed at most once a day, so "active" is only as fine as the day. */
  function active(iso: string): string {
    const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
    return days < 1 ? 'active today' : days < 2 ? 'active yesterday' : `active ${date(iso)}`
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
      notice = `Signed out ${describeUserAgent(session.userAgent)}.`
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not sign it out.'
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
      notice = `Signed out of ${ended} other ${ended === 1 ? 'browser' : 'browsers'}.`
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not sign them out.'
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
          {#if session.current}<span class="badge badge-ok">This browser</span>{/if}
          <span class="muted small">
            {session.ipAddress ?? 'Unknown address'} · signed in {date(session.signedInAt)} · {active(session.lastActiveAt)}
          </span>
        </span>
        {#if !session.current}
          <button class="btn btn-sm" disabled={busy} onclick={() => end(session)}>Sign out</button>
        {/if}
      </li>
    {/each}
  </ul>
  {#if others.length > 1}
    <div>
      <button class="btn btn-sm btn-danger" disabled={busy} onclick={endOthers} onblur={() => (confirming = false)}>
        {confirming ? 'Click again to confirm' : `Sign out all ${others.length} others`}
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

<script lang="ts">
  import { lang, t } from '@cf-dam/i18n/client'
  import { intlTag } from '@cf-dam/i18n/languages'
  import type { MessageKey } from '@cf-dam/i18n'
  import { onMount } from 'svelte'
  import { describeActivity, type ActivityEntry } from '../lib/activity-text'
  import { api } from '../lib/auth-client'

  interface Person {
    id: string
    name: string
    email: string
  }

  const KINDS: [string, MessageKey][] = [
    ['', 'activity.kind.all'],
    ['sign-ins', 'activity.kind.signIns'],
    ['accounts', 'activity.kind.accounts'],
    ['photos', 'activity.kind.photos'],
    ['sharing', 'activity.kind.sharing'],
    ['agents', 'activity.kind.agents'],
    ['backups', 'activity.kind.backups'],
    ['alerts', 'activity.kind.alerts'],
  ]

  /** A client's or a job's page: only its history, without the filters. */
  let { client = null, job = null }: { client?: string | null; job?: string | null } = $props()

  let entries = $state<ActivityEntry[]>([])
  let next = $state<string | null>(null)
  let people = $state<Person[]>([])
  let kind = $state('')
  let person = $state('')
  let loading = $state(true)
  let error = $state('')

  const day = (iso: string) => new Date(iso).toLocaleDateString(intlTag(lang()), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const clock = (iso: string) => new Date(iso).toLocaleTimeString(intlTag(lang()), { timeStyle: 'short' })
  /** Entries under a heading per day, in the order they came. */
  const days = $derived.by(() => {
    const groups: { day: string; entries: ActivityEntry[] }[] = []
    for (const e of entries) {
      const d = day(e.at)
      if (groups.at(-1)?.day !== d) groups.push({ day: d, entries: [] })
      groups.at(-1)!.entries.push(e)
    }
    return groups
  })
  const failure = (e: ActivityEntry) => e.action === 'auth.sign_in_failed' || e.action === 'auth.locked' || e.action === 'auth.passkey_required'

  async function load(more = false) {
    loading = true
    error = ''
    const query = new URLSearchParams()
    if (kind) query.set('kind', kind)
    if (person) query.set('person', person)
    if (client) query.set('client', client)
    if (job) query.set('job', job)
    if (more && next) query.set('before', next)
    try {
      const page = await api<{ entries: ActivityEntry[]; next: string | null }>(`/api/activity?${query}`)
      entries = more ? [...entries, ...page.entries] : page.entries
      next = page.next
    } catch (e) {
      error = e instanceof Error ? e.message : t('activity.loadFailed')
    } finally {
      loading = false
    }
  }

  onMount(async () => {
    await load()
    if (!client && !job) people = (await api<{ users: Person[] }>('/api/users')).users
  })
</script>

<div class="stack">
  {#if !client && !job}<div class="filters">
    <label class="field">
      <span>{t('activity.kind')}</span>
      <select bind:value={kind} onchange={() => load()}>
        {#each KINDS as [value, label] (value)}<option {value}>{t(label)}</option>{/each}
      </select>
    </label>
    <label class="field">
      <span>{t('activity.person')}</span>
      <select bind:value={person} onchange={() => load()}>
        <option value="">{t('activity.everyone')}</option>
        {#each people as p (p.id)}<option value={p.id}>{p.name || p.email}</option>{/each}
      </select>
    </label>
  </div>{/if}

  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}

  {#if !loading && entries.length === 0 && !error}
    <p class="muted">{kind || person ? t('activity.noneMatch') : t('activity.none')}</p>
  {/if}

  {#each days as group (group.day)}
    <section class="card day">
      <h2>{group.day}</h2>
      <ul>
        {#each group.entries as entry (entry.id)}
          <li class:failure={failure(entry)}>
            <time datetime={entry.at}>{clock(entry.at)}</time>
            <span class="what">{describeActivity(entry)}</span>
            {#if entry.ipAddress}<span class="muted ip">{entry.ipAddress}</span>{/if}
          </li>
        {/each}
      </ul>
    </section>
  {/each}

  {#if next}
    <div><button class="btn" disabled={loading} onclick={() => load(true)}>{loading ? t('common.loading') : t('activity.older')}</button></div>
  {/if}
</div>

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 16px;
  }
  .filters .field {
    display: grid;
    gap: 4px;
    font-size: 0.85rem;
  }
  .filters select {
    width: auto;
    min-width: 200px;
    max-width: 100%;
    padding: 6px 10px;
  }
  .day h2 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin: 0 0 8px;
  }
  .day ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  .day li {
    display: grid;
    grid-template-columns: 5.5em minmax(0, 1fr) auto;
    gap: 12px;
    align-items: baseline;
    padding: 7px 0;
    border-bottom: 1px solid var(--border);
  }
  .day li:last-child {
    border-bottom: 0;
  }
  time {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
  }
  .what {
    overflow-wrap: anywhere;
  }
  li.failure .what {
    color: var(--danger);
  }
  .ip {
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 560px) {
    .day li {
      grid-template-columns: 4.5em minmax(0, 1fr);
    }
    .ip {
      grid-column: 2;
    }
  }
</style>

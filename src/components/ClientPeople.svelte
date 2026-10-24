<script lang="ts">
  /**
   * The people (client logins) who belong to a client, on the client's page: add someone new (they get a
   * one-time invite link to send), link a login that already exists, send a new invite, or unlink.
   * Linking grants nothing: each gallery is still shared with people one by one.
   */
  import { format, t } from '@cf-dam/i18n/client'
  import type { ClientPersonJson } from '@cf-dam/api'
  import { api } from '../lib/auth-client'

  let { clientId, initial }: { clientId: string; initial: ClientPersonJson[] } = $props()

  // svelte-ignore state_referenced_locally
  let people = $state<ClientPersonJson[]>(initial)
  let mode = $state<'' | 'new' | 'existing'>('')
  let name = $state('')
  let email = $state('')
  let candidates = $state<{ userId: string; name: string; email: string; suggested: boolean }[] | null>(null)
  let chosen = $state('')
  let busy = $state(false)
  let error = $state('')
  let note = $state('')
  let fresh = $state<{ name: string; url: string; expires: string } | null>(null)
  let copied = $state(false)

  const day = (iso: string) => format().date(iso)
  const inviteUrl = (token: string) => `${location.origin}/invite/${token}`

  function start(next: 'new' | 'existing') {
    mode = next
    error = ''
    note = ''
    fresh = null
    if (next === 'existing' && candidates === null) {
      api<{ candidates: typeof candidates }>(`/api/clients/${clientId}/candidates`)
        .then((r) => {
          candidates = r.candidates
          chosen = r.candidates?.find((c) => c.suggested)?.userId ?? ''
        })
        .catch((e) => (error = e instanceof Error ? e.message : t('common.couldNotLoad')))
    }
  }

  async function add(body: Record<string, string>, who: string) {
    busy = true
    error = ''
    note = ''
    fresh = null
    try {
      const result = await api<{ people: ClientPersonJson[]; invite: { token: string; expiresAt: string } | null }>(`/api/clients/${clientId}/people`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      people = result.people
      if (result.invite) fresh = { name: who, url: inviteUrl(result.invite.token), expires: day(result.invite.expiresAt) }
      else note = t('clientPeople.added', { name: who })
      mode = ''
      name = ''
      email = ''
      candidates = null
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }

  async function unlink(person: ClientPersonJson) {
    error = ''
    note = ''
    try {
      await api(`/api/clients/${clientId}/people/${person.userId}`, { method: 'DELETE' })
      people = people.filter((p) => p.userId !== person.userId)
      note = t('clientPeople.unlinked', { name: person.name })
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    }
  }

  async function copy() {
    if (!fresh) return
    await navigator.clipboard.writeText(fresh.url)
    copied = true
    setTimeout(() => (copied = false), 2000)
  }
</script>

<div class="stack">
  {#if people.length === 0}
    <p class="muted">{t('clientPeople.none')}</p>
  {:else}
    <ul class="people">
      {#each people as person (person.userId)}
        <li class="row">
          <span class="who"><strong>{person.name}</strong> <span class="muted small">{person.email}</span></span>
          <span class="muted small">
            {#if !person.isActive}{t('clients.off')}
            {:else if person.joined}{person.lastLoginAt ? t('clients.lastSignedIn', { date: day(person.lastLoginAt) }) : t('clients.joined')}
            {:else if person.inviteExpiresAt && person.inviteExpiresAt > new Date().toISOString()}{t('clients.invited')}
            {:else}{t('clients.expired')}{/if}
            · {t('clientPeople.galleries', { count: person.galleries })}
          </span>
          <span class="row actions">
            {#if !person.joined}<button class="btn btn-sm" type="button" onclick={() => add({ name: person.name, email: person.email }, person.name)}>{t('clients.newInvite')}</button>{/if}
            <button class="btn btn-sm" type="button" title={t('clientPeople.unlinkTitle')} onclick={() => unlink(person)}>{t('clientPeople.unlink')}</button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if mode === ''}
    <div class="row buttons">
      <button class="btn btn-sm" type="button" onclick={() => start('new')}>{t('clientPeople.addNew')}</button>
      <button class="btn btn-sm" type="button" onclick={() => start('existing')}>{t('clientPeople.linkExisting')}</button>
    </div>
  {:else if mode === 'new'}
    <form class="row add" onsubmit={(e) => (e.preventDefault(), add({ name, email }, name))}>
      <input type="text" aria-label={t('clients.theirName')} placeholder={t('clients.theirName')} required maxlength="100" bind:value={name} />
      <input type="email" aria-label={t('clients.theirEmail')} placeholder={t('clients.theirEmail')} required maxlength="254" bind:value={email} />
      <button class="btn btn-primary btn-sm" type="submit" disabled={busy}>{t('clientPeople.addButton')}</button>
      <button class="btn btn-sm" type="button" onclick={() => (mode = '')}>{t('common.cancel')}</button>
    </form>
  {:else}
    <form class="row add" onsubmit={(e) => (e.preventDefault(), add({ userId: chosen }, candidates?.find((c) => c.userId === chosen)?.name ?? ''))}>
      {#if candidates === null}
        <span class="muted small">{t('common.loading')}</span>
      {:else if candidates.length === 0}
        <span class="muted small">{t('clientPeople.noCandidates')}</span>
      {:else}
        <select aria-label={t('clientPeople.linkExisting')} required bind:value={chosen}>
          <option value="" disabled>{t('clientPeople.choose')}</option>
          {#each candidates as c (c.userId)}<option value={c.userId}>{c.name} · {c.email}{c.suggested ? ` (${t('clientPeople.likely')})` : ''}</option>{/each}
        </select>
        <button class="btn btn-primary btn-sm" type="submit" disabled={busy || !chosen}>{t('clientPeople.linkButton')}</button>
      {/if}
      <button class="btn btn-sm" type="button" onclick={() => (mode = '')}>{t('common.cancel')}</button>
    </form>
  {/if}

  {#if fresh}
    <div class="fresh stack" role="status">
      <p class="small"><strong>{t('clients.send', { name: fresh.name })}</strong> {t('clients.sendLead', { date: fresh.expires })}</p>
      <div class="row">
        <code class="url">{fresh.url}</code>
        <button class="btn btn-sm btn-primary" type="button" onclick={copy}>{copied ? t('share.copied') : t('clients.copyInvite')}</button>
        <button class="btn btn-sm" type="button" onclick={() => (fresh = null)}>{t('common.done')}</button>
      </div>
    </div>
  {/if}
  {#if note}<p class="muted small" role="status">{note}</p>{/if}
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
  <p class="muted small">{t('clientPeople.lead')}</p>
</div>

<style>
  .people {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .people li {
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 6px 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .who {
    flex: 1 1 220px;
  }
  .actions,
  .buttons,
  .add {
    gap: 8px;
    flex-wrap: wrap;
  }
  .add input,
  .add select {
    flex: 1 1 200px;
  }
  .small {
    font-size: 0.85rem;
  }
  .fresh {
    gap: 6px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .url {
    flex: 1 1 260px;
    overflow-wrap: anywhere;
    font-size: 0.8rem;
  }
</style>

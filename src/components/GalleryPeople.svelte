<script lang="ts">
  /**
   * People in this gallery (catalog/gallery-people.ts, plans/PLAN-FN-GALLERY-v3.md §4.2): which groups and people the
   * gallery's client's own invited people can find photos of, under which names, with a preview of exactly what they
   * get and warnings for names that slip out another way.
   */
  import { t } from '@cf-dam/i18n/client'
  import type { MessageKey } from '@cf-dam/i18n'
  import type { SharePeopleJson } from '@cf-dam/api'
  import { api } from '../lib/auth-client'
  import PeopleGroups from './PeopleGroups.svelte'

  let { shareId, initial }: { shareId: string; initial: SharePeopleJson } = $props()

  interface Row {
    kind: 'person' | 'group'
    id: number
    name: string
    label: string
    isChild: boolean
    hidden: boolean
  }
  // svelte-ignore state_referenced_locally
  let data = $state<SharePeopleJson>(initial)
  // svelte-ignore state_referenced_locally
  let rows = $state<Row[]>(initial.entries.map((e) => ({ ...e })))
  let dirty = $state(false)
  let busy = $state(false)
  let error = $state('')
  let saved = $state('')
  let suggesting = $state(false)
  let ticked = $state<number[]>([])
  let addGroup = $state('')

  const WHY: Record<string, MessageKey> = {
    no_photos: 'galleryPeople.why.noPhotos',
    hidden: 'galleryPeople.why.hidden',
    child: 'galleryPeople.why.child',
    child_rule: 'galleryPeople.why.childRule',
  }
  const listed = (kind: Row['kind'], id: number) => rows.some((r) => r.kind === kind && r.id === id)
  const unlistedGroups = $derived(data.groups.filter((g) => !listed('group', g.id)))
  const suggestions = $derived(data.tagged.filter((p) => !listed('person', p.id)))
  /** "Anna" from "Anna Smith", "Anna" from "Smith, Anna" (the same as the server's default). */
  const firstName = (name: string) => {
    const comma = name.indexOf(',')
    const given = comma > 0 ? name.slice(comma + 1).trim() : ''
    return (given || name.trim().split(/\s+/)[0] || name).slice(0, 60)
  }

  function take(next: SharePeopleJson) {
    data = next
    rows = next.entries.map((e) => ({ ...e }))
    dirty = false
  }

  async function reload() {
    take((await api<{ people: SharePeopleJson }>(`/api/shares/${shareId}/people`)).people)
  }

  async function send(body: Record<string, unknown>) {
    busy = true
    error = ''
    saved = ''
    try {
      take((await api<{ people: SharePeopleJson }>(`/api/shares/${shareId}/people`, { method: 'PUT', body: JSON.stringify(body) })).people)
      saved = t('common.saved')
      setTimeout(() => (saved = ''), 2000)
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }

  const saveList = () => send({ entries: rows.map((r) => (r.kind === 'group' ? { groupId: r.id, label: r.label } : { personId: r.id, label: r.label })) })

  function move(i: number, by: number) {
    const j = i + by
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    rows = next
    dirty = true
  }

  function drop(i: number) {
    rows = rows.filter((_, k) => k !== i)
    dirty = true
  }

  function addChosenGroup() {
    const group = data.groups.find((g) => String(g.id) === addGroup)
    if (!group) return
    rows = [...rows, { kind: 'group', id: group.id, name: group.name, label: group.name.slice(0, 60), isChild: false, hidden: false }]
    addGroup = ''
    dirty = true
  }

  function suggest() {
    suggesting = true
    // Names read from files start unticked: they were the camera's or another program's, not yours.
    ticked = suggestions.filter((p) => !p.fromFile && !p.hidden).map((p) => p.id)
  }

  function addTicked() {
    const add = suggestions.filter((p) => ticked.includes(p.id))
    rows = [...rows, ...add.map((p) => ({ kind: 'person' as const, id: p.id, name: p.name, label: firstName(p.name), isChild: p.isChild, hidden: p.hidden }))]
    suggesting = false
    dirty = true
  }

  /** "Is this a child?" changes the person everywhere, not only here. */
  async function setChild(id: number, isChild: boolean) {
    error = ''
    try {
      await api(`/api/people/${id}`, { method: 'PATCH', body: JSON.stringify({ isChild }) })
      data.tagged = data.tagged.map((p) => (p.id === id ? { ...p, isChild } : p))
      rows = rows.map((r) => (r.kind === 'person' && r.id === id ? { ...r, isChild } : r))
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    }
  }
</script>

<div class="stack">
  <p class="muted small">{t('galleryPeople.lead')} <a href="/help/people-in-galleries">{t('galleryPeople.help')}</a></p>

  {#if !data.client}
    <p class="note">{t('galleryPeople.noClient')}</p>
  {:else}
    <div class="stack switches">
      <label class="check">
        <input type="checkbox" checked={data.peopleShown} disabled={busy} onchange={(e) => send({ peopleShown: e.currentTarget.checked })} />
        <span>{t('galleryPeople.show', { client: data.client.name })}</span>
      </label>
      <label class="check">
        <input type="checkbox" checked={data.childrenNamed} disabled={busy} onchange={(e) => send({ childrenNamed: e.currentTarget.checked })} />
        <span>{t('galleryPeople.childrenNamed')}<br /><span class="muted small">{t('galleryPeople.childrenNamedHint')}</span></span>
      </label>
      <label class="check">
        <input type="checkbox" checked={data.suggestionsOn} disabled={busy || !data.peopleShown} onchange={(e) => send({ suggestionsOn: e.currentTarget.checked })} />
        <span>{t('galleryPeople.suggestions')}<br /><span class="muted small">{data.peopleShown ? t('galleryPeople.suggestionsHint') : t('galleryPeople.suggestionsNeedPeople')}</span></span>
      </label>
    </div>

    <div class="stack">
      <h3>{t('galleryPeople.listTitle')}</h3>
      {#if rows.length === 0}
        <p class="muted small">{t('galleryPeople.listEmpty')}</p>
      {:else}
        <ul class="rows">
          {#each rows as row, i (`${row.kind}:${row.id}`)}
            <li>
              <span class="badge">{row.kind === 'group' ? t('galleryPeople.group') : t('galleryPeople.person')}</span>
              <span class="who">
                <span class="muted small">{row.name}{row.isChild ? ` · ${t('peoplePage.child')}` : ''}{row.hidden ? ` · ${t('peoplePage.hiddenBadge')}` : ''}</span>
                <input type="text" maxlength="60" aria-label={t('galleryPeople.label', { name: row.name })} bind:value={row.label} oninput={() => (dirty = true)} />
              </span>
              <span class="row tools">
                <button class="btn btn-sm" type="button" disabled={i === 0} onclick={() => move(i, -1)} aria-label={t('galleryPeople.up')}>↑</button>
                <button class="btn btn-sm" type="button" disabled={i === rows.length - 1} onclick={() => move(i, 1)} aria-label={t('galleryPeople.down')}>↓</button>
                <button class="btn btn-sm" type="button" onclick={() => drop(i)} aria-label={t('galleryPeople.remove', { name: row.name })}>✕</button>
              </span>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="row adders">
        {#if unlistedGroups.length > 0}
          <select bind:value={addGroup} aria-label={t('galleryPeople.addGroup')}>
            <option value="">{t('galleryPeople.addGroup')}</option>
            {#each unlistedGroups as g (g.id)}<option value={String(g.id)}>{g.name}</option>{/each}
          </select>
          <button class="btn btn-sm" type="button" disabled={!addGroup} onclick={addChosenGroup}>{t('galleryPeople.add')}</button>
        {/if}
        {#if suggestions.length > 0 && !suggesting}
          <button class="btn btn-sm" type="button" onclick={suggest}>{t('galleryPeople.suggest')}</button>
        {/if}
      </div>

      {#if suggesting}
        <div class="stack suggest">
          <p class="muted small">{t('galleryPeople.suggestLead')}</p>
          {#each suggestions as s (s.id)}
            <div class="row suggestion">
              <label class="check"><input type="checkbox" value={s.id} bind:group={ticked} disabled={s.hidden} /> {s.name}</label>
              <span class="muted small">{t('common.photos', { count: s.photos })}{s.fromFile ? ` · ${t('galleryPeople.fromFile')}` : ''}{s.hidden ? ` · ${t('peoplePage.hiddenBadge')}` : ''}</span>
              <label class="check small"><input type="checkbox" checked={s.isChild} onchange={(e) => setChild(s.id, e.currentTarget.checked)} /> {t('galleryPeople.isChild')}</label>
            </div>
          {/each}
          <p class="muted small">{t('galleryPeople.isChildHint')}</p>
          <div class="row">
            <button class="btn btn-sm btn-primary" type="button" disabled={ticked.length === 0} onclick={addTicked}>{t('galleryPeople.addTicked', { count: ticked.length })}</button>
            <button class="btn btn-sm" type="button" onclick={() => (suggesting = false)}>{t('common.cancel')}</button>
          </div>
        </div>
      {/if}

      <div class="row">
        <button class="btn btn-primary" type="button" disabled={busy || !dirty || rows.some((r) => !r.label.trim())} onclick={saveList}>{t('galleryPeople.save')}</button>
        {#if dirty}<button class="btn" type="button" onclick={() => take(data)}>{t('galleryPeople.undo')}</button>{/if}
        {#if saved}<span class="muted small" role="status">{saved}</span>{/if}
      </div>
      {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
    </div>

    <div class="stack preview">
      <h3>{t('galleryPeople.previewTitle')}</h3>
      {#if dirty}<p class="muted small">{t('galleryPeople.previewSaved')}</p>{/if}
      {#if data.preview.length === 0}
        <p class="muted small">{t('galleryPeople.previewNone')}</p>
      {:else}
        <div class="chips">
          {#each data.preview as chip, i (i)}<span class="chip">{chip.label} <span class="muted">{chip.count}</span></span>{/each}
        </div>
      {/if}
      {#if !data.peopleShown && data.preview.length > 0}<p class="muted small">{t('galleryPeople.previewOff')}</p>{/if}
      {#if data.peopleShown && data.suggestionsOn}<p class="muted small">{t('galleryPeople.suggestionsPreview')}</p>{/if}
      {#if data.left.length > 0}
        <p class="muted small">{t('galleryPeople.leftTitle')}</p>
        <ul class="notes">
          {#each data.left as l (`${l.kind}:${l.id}`)}<li class="small"><strong>{l.label}</strong>: {t(WHY[l.why]!)}</li>{/each}
        </ul>
      {/if}
    </div>

    {#if data.labelWarnings.length > 0 || data.captionWarnings.length > 0}
      <div class="stack warnings" role="note">
        <h3>{t('galleryPeople.warningsTitle')}</h3>
        <ul class="notes">
          {#each data.labelWarnings as w, i (i)}<li class="small">{t('galleryPeople.labelWarning', { label: w.label, name: w.name })}</li>{/each}
          {#each data.captionWarnings as w, i (i)}
            <li class="small">{t('galleryPeople.captionWarning', { name: w.name })} <a href={`/assets/${w.assetId}`}>{w.filename}</a></li>
          {/each}
        </ul>
      </div>
    {/if}

    <details>
      <summary>{t('galleryPeople.groupsTitle', { client: data.client.name })}</summary>
      <PeopleGroups clientId={data.client.id} initial={data.groups} onchange={() => void reload().catch(() => {})} />
    </details>
  {/if}
</div>

<style>
  h3 {
    font-size: 0.95rem;
    margin: 0;
  }
  .small {
    font-size: 0.85rem;
  }
  .note {
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-size: 0.9rem;
    font-weight: 400;
    color: var(--text);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .rows li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
  }
  .who {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .who input {
    max-width: 280px;
  }
  .tools,
  .adders,
  .suggestion {
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .suggest {
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
  }
  .suggestion {
    gap: 12px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--border-strong);
    font-size: 0.85rem;
  }
  .notes {
    margin: 0;
    padding-left: 18px;
  }
  .warnings {
    color: var(--danger);
  }
  .warnings a {
    color: inherit;
  }
  details summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 0.95rem;
  }
  @media (max-width: 560px) {
    .rows li {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .rows .badge {
      grid-column: 1 / -1;
      justify-self: start;
    }
  }
</style>

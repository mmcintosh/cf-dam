<script lang="ts">
  /**
   * People in photos (catalog/jev-facets.ts, plans/PLAN-F2-v2.md), on the AI review page: what TypeSafe's Jev has
   * found, linked to the Library's People filter; the switches; the photos it couldn't look at.
   */
  import { format, t } from '@cf-dam/i18n/client'
  import { api } from '../lib/auth-client'

  interface Stats {
    available: boolean
    on: boolean
    auto: boolean
    done: number
    withPeople: number
    withoutPeople: number
    waiting: number
    unasked: number
    couldNot: number
    failedForGood: number
  }
  interface Problem {
    id: string
    filename: string
    status: 'skipped' | 'failed'
    error: string | null
  }

  let { initial, initialProblems, canManage }: { initial: Stats; initialProblems: Problem[]; canManage: boolean } = $props()
  // svelte-ignore state_referenced_locally
  let stats = $state<Stats>(initial)
  // svelte-ignore state_referenced_locally
  let problems = $state<Problem[]>(initialProblems)
  let busy = $state(false)
  let error = $state('')
  let saved = $state('')
  // Asked in this visit: the Library's counts are a few minutes behind.
  let asked = $state(false)

  const n = (v: number) => format().number(v)

  function reason(p: Problem): string {
    if (p.status === 'failed') return t('peopleFacets.reasonFailed', { error: p.error ?? '' })
    if (p.error?.startsWith('Smaller than')) return t('peopleFacets.reasonSmall')
    return t('peopleFacets.reasonRefused', { error: p.error ?? '' })
  }

  async function queue(body: Record<string, unknown>) {
    busy = true
    error = ''
    try {
      const result = await api<{ stats: Stats; problems: Problem[] }>('/api/ai/facets/queue', { method: 'POST', body: JSON.stringify(body) })
      stats = result.stats
      problems = result.problems
      asked = true
    } catch (e) {
      error = e instanceof Error ? e.message : t('ai.couldNotQueue')
    } finally {
      busy = false
    }
  }

  async function refresh() {
    try {
      const result = await api<{ stats: Stats; problems: Problem[] }>('/api/ai/facets')
      stats = result.stats
      problems = result.problems
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotLoad')
    }
  }

  async function save(patch: { people?: boolean; peopleAuto?: boolean }) {
    error = ''
    try {
      const { settings } = await api<{ settings: { people: boolean; peopleAuto: boolean } }>('/api/ai/settings', { method: 'PUT', body: JSON.stringify(patch) })
      stats = { ...stats, on: settings.people, auto: settings.peopleAuto }
      saved = t('common.saved')
      setTimeout(() => (saved = ''), 1500)
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
      // Put the switch back: it was flipped in the browser but not saved.
      stats = { ...stats }
    }
  }
</script>

<section class="card stack people">
  <div>
    <h2>{t('peopleFacets.title')}</h2>
    <p class="muted">{t('peopleFacets.lead')}</p>
  </div>
  {#if !stats.available}
    <p class="muted">{t('peopleFacets.notSetUp')}</p>
  {:else}
    <div class="stats">
      <a href="/?people=yes"><strong>{n(stats.withPeople)}</strong><span class="muted">{t('peopleFacets.withPeople')}</span></a>
      <a href="/?people=no"><strong>{n(stats.withoutPeople)}</strong><span class="muted">{t('peopleFacets.withoutPeople')}</span></a>
      <div>
        <strong>{n(stats.waiting)}</strong>
        <span class="muted">
          {stats.on ? t('peopleFacets.waiting') : t('peopleFacets.paused')}
          {#if stats.waiting > 0}· <button class="link" type="button" onclick={refresh}>{t('common.refresh')}</button>{/if}
        </span>
      </div>
      <div><strong>{n(stats.unasked)}</strong><span class="muted">{t('peopleFacets.notLooked')}</span></div>
      <div class:bad={stats.couldNot > 0}><strong>{n(stats.couldNot)}</strong><span class="muted">{t('peopleFacets.couldNot')}</span></div>
    </div>

    <div class="stack switches">
      <label class="check">
        <input type="checkbox" checked={stats.on} disabled={!canManage} onchange={(e) => save({ people: e.currentTarget.checked })} />
        <span><strong>{t('peopleFacets.switch')}</strong><br /><span class="muted">{t('peopleFacets.switchNote')}</span></span>
      </label>
      <label class="check">
        <input type="checkbox" checked={stats.auto} disabled={!canManage || !stats.on} onchange={(e) => save({ peopleAuto: e.currentTarget.checked })} />
        <span><strong>{t('peopleFacets.auto')}</strong><br /><span class="muted">{t('peopleFacets.autoNote')}</span></span>
      </label>
      {#if saved}<span class="muted small">{saved}</span>{/if}
      {#if !canManage}<p class="muted small">{t('ai.adminsOnly')}</p>{/if}
    </div>

    {#if stats.on && stats.unasked > 0}
      <div>
        <button class="btn btn-primary" type="button" onclick={() => queue({ which: 'unasked' })} disabled={busy}>{t('peopleFacets.lookAt', { count: n(stats.unasked) })}</button>
      </div>
    {:else if stats.on && stats.waiting === 0}
      <p class="muted">{stats.auto ? t('peopleFacets.allDone') : t('peopleFacets.allDoneManual')}</p>
    {/if}
    {#if stats.waiting > 0 || asked}<p class="muted small">{t('peopleFacets.lag')}</p>{/if}

    {#if problems.length > 0}
      <details>
        <summary>{t('peopleFacets.listTitle', { count: n(stats.couldNot) })}</summary>
        {#if stats.on && stats.failedForGood > 0}
          <p><button class="btn btn-sm" type="button" disabled={busy} onclick={() => queue({ which: 'failed' })}>{t('peopleFacets.tryAll', { count: n(stats.failedForGood) })}</button></p>
        {/if}
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>{t('common.photo')}</th><th>{t('peopleFacets.why')}</th><th></th></tr></thead>
            <tbody>
              {#each problems as p (p.id)}
                <tr>
                  <td><a href={`/assets/${p.id}`}>{p.filename}</a></td>
                  <td class="muted">{reason(p)}</td>
                  <td class="end">
                    {#if p.status === 'failed' && stats.on}<button class="btn btn-sm" type="button" disabled={busy} onclick={() => queue({ ids: [p.id] })}>{t('checks.again')}</button>{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>
    {/if}
    <p class="muted small">{t('peopleFacets.privacy')} {t('peopleFacets.byHand')}</p>
  {/if}
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
</section>

<style>
  .people {
    max-width: 760px;
  }
  p {
    margin: 0;
  }
  .small {
    font-size: 0.85rem;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 16px;
  }
  .stats > * {
    display: grid;
    align-content: start;
    color: inherit;
    text-decoration: none;
  }
  .stats a strong {
    color: var(--accent);
  }
  .stats strong {
    font-size: 1.5rem;
  }
  .stats span {
    font-size: 0.8rem;
  }
  .stats .bad strong {
    color: var(--warning);
  }
  .check {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    cursor: pointer;
  }
  .check input {
    margin-top: 4px;
  }
  .switches {
    gap: 10px;
  }
  details summary {
    cursor: pointer;
    color: var(--accent);
    font-size: 0.9rem;
  }
  details p {
    margin: 10px 0;
  }
  .end {
    text-align: right;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
</style>

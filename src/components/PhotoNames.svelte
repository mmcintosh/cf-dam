<script lang="ts">
  /**
   * Who's in this photo by name (catalog/people.ts, plans/PLAN-FN-v2.md FN1): names given by hand or read from the
   * file, each linking to the person, and adding or removing one. Never shown to clients.
   */
  import { t } from '@cf-dam/i18n/client'
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'

  let { assetId, canManage, heading }: { assetId: string; canManage: boolean; heading: boolean } = $props()

  let named = $state<{ id: number; name: string; how: string }[] | null>(null)
  let everyone = $state<{ id: number; name: string }[]>([])
  let name = $state('')
  let busy = $state(false)
  let error = $state('')

  async function load() {
    named = (await api<{ people: { id: number; name: string; how: string }[] }>(`/api/people/photo/${assetId}`)).people
  }
  onMount(() => {
    void load().catch(() => (named = []))
    if (canManage) void api<{ people: { id: number; name: string }[] }>('/api/people').then((r) => (everyone = r.people)).catch(() => {})
  })

  async function change(body: Record<string, unknown>) {
    busy = true
    error = ''
    try {
      await api('/api/assets/bulk', { method: 'POST', body: JSON.stringify({ ids: [assetId], action: 'person', ...body }) })
      name = ''
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }

  function add(event: SubmitEvent) {
    event.preventDefault()
    const typed = name.trim()
    if (!typed) return
    const known = everyone.find((p) => p.name.toLowerCase() === typed.toLowerCase())
    void change(known ? { personId: known.id } : { name: typed })
  }
</script>

{#if heading}<h2>{t('photoPeople.title')}</h2>{:else}<h3>{t('photoNames.named')}</h3>{/if}
{#if named === null}
  <p class="muted small">{t('common.loading')}</p>
{:else}
  {#if named.length === 0}<p class="muted small">{t('photoNames.none')}</p>{/if}
  <ul class="names">
    {#each named as p (p.id)}
      <li class="chip">
        <a href={`/people/${p.id}`}>{p.name}</a>
        {#if p.how === 'file'}<span class="muted small" title={t('photoNames.fromFileTitle')}>{t('photoNames.fromFile')}</span>{/if}
        {#if canManage}<button class="x" type="button" disabled={busy} aria-label={t('photoNames.remove', { name: p.name })} onclick={() => change({ personId: p.id, add: false })}>×</button>{/if}
      </li>
    {/each}
  </ul>
  {#if canManage}
    <form class="row add" onsubmit={add}>
      <input type="text" list={`people-${assetId}`} maxlength="120" placeholder={t('photoNames.addPlaceholder')} aria-label={t('photoNames.add')} bind:value={name} />
      <datalist id={`people-${assetId}`}>{#each everyone as p (p.id)}<option value={p.name}></option>{/each}</datalist>
      <button class="btn btn-sm" type="submit" disabled={busy || !name.trim()}>{t('photoNames.add')}</button>
    </form>
  {/if}
{/if}
{#if error}<p class="alert alert-error small" role="alert">{error}</p>{/if}

<style>
  h3 {
    font-size: 0.95rem;
    margin: 14px 0 6px;
  }
  .names {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    padding: 3px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 99px;
  }
  .x {
    border: 0;
    background: none;
    padding: 0 2px;
    color: var(--text-muted);
    font: inherit;
    cursor: pointer;
  }
  .add {
    gap: 6px;
  }
  .add input {
    flex: 1;
    min-width: 0;
  }
  .small {
    font-size: 0.8rem;
  }
</style>

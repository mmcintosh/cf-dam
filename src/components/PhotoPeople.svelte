<script lang="ts">
  /**
   * People in one photo (catalog/jev-facets.ts, plans/PLAN-F2-v2.md): TypeSafe's Jev's answer or one set by hand,
   * and a way to correct it. A correction is what the Library's People filter uses, and Jev never changes it.
   */
  import { t } from '@cf-dam/i18n/client'
  import type { MessageKey } from '@cf-dam/i18n'
  import { api } from '../lib/auth-client'

  interface People {
    value: string | null
    jev: string | null
    byHand: boolean
    status: string | null
    error: string | null
  }
  let { assetId, initial, canEdit }: { assetId: string; initial: People; canEdit: boolean } = $props()
  // svelte-ignore state_referenced_locally
  let people = $state<People>({ ...initial })
  let busy = $state(false)
  let error = $state('')

  const VALUES: Record<string, MessageKey> = {
    none: 'photoPeople.none',
    one: 'photoPeople.onePerson',
    two_to_five: 'photoPeople.twoToFive',
    six_or_more: 'photoPeople.sixOrMore',
    some: 'photoPeople.some',
  }
  const CHOICES = ['none', 'one', 'two_to_five', 'six_or_more'] as const

  const answer = $derived.by(() => {
    if (people.value && VALUES[people.value]) return t(VALUES[people.value]!)
    if (people.status === 'done') return t('photoPeople.unsure')
    if (people.status === 'queued' || people.status === 'running') return t('photoPeople.waiting')
    if (people.status === 'skipped' || people.status === 'failed') return t('photoPeople.couldNot', { error: people.error ?? '' })
    return t('photoPeople.notLooked')
  })

  async function set(value: (typeof CHOICES)[number] | 'jev') {
    busy = true
    error = ''
    try {
      await api('/api/assets/bulk', { method: 'POST', body: JSON.stringify({ ids: [assetId], action: 'people', people: value }) })
      if (value === 'jev') people = { ...people, value: people.jev, byHand: false, status: people.jev === null && people.status === 'done' ? 'queued' : people.status }
      else people = { ...people, value, byHand: true, status: people.status === 'running' ? 'running' : 'done' }
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }
</script>

<h2>{t('photoPeople.title')}</h2>
<p class="answer">
  <strong>{answer}</strong>
  <span class="muted small">
    · {people.byHand ? t('photoPeople.byHand') : t('photoPeople.byJev')}
    {#if people.byHand && people.jev && people.jev !== people.value && VALUES[people.jev]}· {t('photoPeople.jevSaid', { answer: t(VALUES[people.jev]!) })}{/if}
  </span>
</p>
{#if canEdit}
  <div class="choices" role="group" aria-label={t('photoPeople.correct')}>
    {#each CHOICES as c (c)}
      <button class="btn btn-sm" type="button" class:on={people.byHand && people.value === c} aria-pressed={people.byHand && people.value === c} disabled={busy} onclick={() => set(c)}>{t(VALUES[c]!)}</button>
    {/each}
    {#if people.byHand}<button class="link" type="button" disabled={busy} onclick={() => set('jev')}>{t('photoPeople.backToJev')}</button>{/if}
  </div>
{/if}
{#if error}<p class="alert alert-error small" role="alert">{error}</p>{/if}

<style>
  h2 {
    margin-bottom: 8px;
  }
  .answer {
    margin: 0 0 10px;
  }
  .small {
    font-size: 0.8rem;
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .choices .on {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .link {
    border: 0;
    background: none;
    padding: 0 4px;
    color: var(--accent);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
</style>

<script lang="ts">
  /**
   * The Storage page's connections (plans/PLAN-ST-v2.md): one row each, with what's kept there, what uses it and
   * its last test. A row opens the connection's own page, where everything else is.
   */
  import { format, t } from '@cf-dam/i18n/client'
  import type { MessageKey } from '@cf-dam/i18n'
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'
  import { serviceOf } from '../lib/storage-presets'

  interface Row {
    id: string
    name: string
    provider: 'r2-binding' | 's3'
    endpoint: string | null
    bucket: string | null
    prefix: string
    authMode: string
    isDefault: boolean
    lastTest: { at: string; ok: boolean; message: string | null } | null
    usage: { originals: number; bytes: number }
    uses: { jobArchive: boolean; backupDestination: boolean; agents: string[]; isDefault: boolean }
  }

  let rows = $state<Row[] | null>(null)
  let error = $state('')

  onMount(async () => {
    try {
      rows = (await api<{ connections: Row[] }>('/api/connections/overview')).connections
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotLoad')
    }
  })

  const KIND: Record<string, MessageKey> = { aws: 'connPage.kindAws', r2: 'connPage.kindR2', b2: 'connPage.kindB2', wasabi: 'connPage.kindWasabi', custom: 'connPage.kindOther' }
  const kind = (r: Row) =>
    r.provider === 'r2-binding'
      ? t('connPage.kindBuiltIn')
      : `${t(KIND[serviceOf(r.endpoint)]!)} · ${r.authMode === 'oidc-role' ? t('conn.keyless') : t('connPage.withKeys')}`
</script>

{#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
{#if rows}
  <ul class="rows">
    {#each rows as r (r.id)}
      <li>
        <a class="card row conn" href={`/settings/storage/${r.id}`}>
          <div class="main">
            <h3>{r.name}</h3>
            <p class="muted">{kind(r)}{#if r.bucket}{' · '}<code>{r.bucket}</code>{r.prefix ? ` / ${r.prefix}` : ''}{/if}</p>
            <p class="small">
              {r.usage.originals > 0 ? t('storagePage.kept', { count: format().number(r.usage.originals), size: format().bytes(r.usage.bytes) }) : t('storagePage.nothingYet')}
            </p>
            <div class="chips">
              {#if r.isDefault}<span class="badge badge-accent">{t('storagePage.chipDefault')}</span>{/if}
              {#if r.uses.jobArchive}<span class="badge">{t('storagePage.chipJobArchive')}</span>{/if}
              {#if r.uses.backupDestination}<span class="badge">{t('storagePage.chipBackups')}</span>{/if}
              {#each r.uses.agents as agent (agent)}<span class="badge">{t('storagePage.chipAgent', { name: agent })}</span>{/each}
              {#if r.provider === 's3' && !r.lastTest}<span class="badge badge-warn">{t('storagePage.notTested')}</span>{/if}
              {#if r.lastTest && !r.lastTest.ok}<span class="badge badge-warn" title={r.lastTest.message ?? ''}>{t('storagePage.testFailed')}</span>{/if}
            </div>
          </div>
          <span class="open" aria-hidden="true">{t('storagePage.open')} →</span>
        </a>
      </li>
    {/each}
  </ul>
{:else if !error}
  <p class="muted">{t('common.loading')}</p>
{/if}
<div><a class="btn btn-primary" href="/settings/storage/new">{t('storagePage.add')}</a></div>

<style>
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .conn {
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    color: inherit;
    text-decoration: none;
  }
  .conn:hover {
    border-color: var(--accent);
  }
  .main {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  h3 {
    font-size: 1rem;
    margin: 0;
  }
  p {
    margin: 0;
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
  .small {
    font-size: 0.88rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }
  .open {
    flex: none;
    color: var(--accent);
    font-size: 0.9rem;
    font-weight: 600;
  }
</style>

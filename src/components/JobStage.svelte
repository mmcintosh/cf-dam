<script lang="ts">
  /**
   * A job's stage on its page: every stage in order, the current one marked. Pressing one moves the job there,
   * forward or back; Proofing and Final edits may be skipped. Cancelled sits apart.
   */
  import { t } from '@cf-dam/i18n/client'
  import type { MessageKey } from '@cf-dam/i18n'
  import { api } from '../lib/auth-client'

  const FLOW = ['booked', 'shot', 'editing', 'proofing', 'final_edits', 'delivered', 'completed'] as const
  const OPTIONAL = new Set(['proofing', 'final_edits'])

  let { jobId, stage }: { jobId: string; stage: string } = $props()
  let busy = $state(false)
  let error = $state('')
  const at = $derived(FLOW.indexOf(stage as (typeof FLOW)[number]))

  async function move(to: string) {
    if (to === stage || busy) return
    busy = true
    error = ''
    try {
      await api(`/api/jobs/${jobId}/stage`, { method: 'POST', body: JSON.stringify({ stage: to }) })
      location.reload()
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
      busy = false
    }
  }
</script>

<div class="stack">
  <ol class="flow" aria-label={t('jobs.stage')}>
    {#each FLOW as s, i (s)}
      <li>
        <button
          type="button"
          class="step"
          class:done={stage !== 'cancelled' && i < at}
          class:now={s === stage}
          class:optional={OPTIONAL.has(s)}
          aria-current={s === stage ? 'step' : undefined}
          disabled={busy}
          title={OPTIONAL.has(s) ? t('jobs.optionalStage') : undefined}
          onclick={() => move(s)}
        >
          {t(`job.stage.${s}` as MessageKey)}
        </button>
      </li>
    {/each}
  </ol>
  <div class="row other">
    {#if stage === 'cancelled'}
      <span class="badge">{t('job.stage.cancelled')}</span>
      <span class="muted small">{t('jobs.cancelledLead')}</span>
    {:else}
      <button class="btn btn-sm" type="button" disabled={busy} onclick={() => move('cancelled')}>{t('jobs.cancel')}</button>
    {/if}
  </div>
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
</div>

<style>
  .flow {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .step {
    font: inherit;
    font-size: 0.85rem;
    padding: 6px 12px;
    border-radius: 99px;
    border: 1px solid var(--border-strong);
    background: var(--bg-elevated);
    color: var(--text-muted);
    cursor: pointer;
  }
  .step.optional {
    border-style: dashed;
  }
  .step.done {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .step.now {
    color: var(--text);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    font-weight: 600;
  }
  .step:disabled {
    cursor: progress;
  }
  .other {
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .small {
    font-size: 0.85rem;
  }
</style>

<script lang="ts">
  /**
   * Setup → AI review → Find faces (catalog/faces.ts, plans/PLAN-FN2-v2.md). Turning it on asks for a tick first: what
   * is kept, what isn't, and that the law may ask for consent (the help's Faces and the law). Off pauses and keeps
   * everything; Remove all face boxes, only while paused, deletes what the detector found (names stay on the photos).
   */
  import { t } from '@cf-dam/i18n/client'
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'

  interface Status {
    on: boolean
    removing: boolean
    counts: { boxes: number; named: number; photos: number; toLook: number }
  }

  let { installed, initial, canManage }: { installed: boolean; initial: Status | null; canManage: boolean } = $props()

  let status = $state<Status | null>(initial)
  let understood = $state(false)
  let confirming = $state(false)
  let busy = $state(false)
  let error = $state('')

  const toLook = $derived(status && status.counts.toLook > 10_000 ? t('faces.toLookMany') : t('faces.toLook', { count: status?.counts.toLook ?? 0 }))

  async function refresh() {
    status = await api<Status>('/api/faces/status')
  }

  onMount(() => {
    // While Remove all runs (a slice a minute in the sweep), keep the counts current.
    const timer = setInterval(() => {
      if (status?.removing) void refresh().catch(() => {})
    }, 15_000)
    return () => clearInterval(timer)
  })

  async function act(run: () => Promise<unknown>) {
    busy = true
    error = ''
    try {
      await run()
      await refresh()
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      busy = false
    }
  }

  const turn = (on: boolean) =>
    act(async () => {
      await api('/api/faces/settings', { method: 'PUT', body: JSON.stringify({ on, understood: on ? understood : undefined }) })
      understood = false
    })

  const remove = () =>
    act(async () => {
      await api('/api/faces/remove', { method: 'POST', body: '{}' })
      confirming = false
    })
</script>

<section class="card" aria-labelledby="faces-title">
  <h2 id="faces-title">{t('faces.title')}</h2>
  {#if !installed || !status}
    <p class="muted">{t('faces.notInstalled')}</p>
  {:else}
    <p>{t('faces.lead')}</p>
    <p class="muted small">{t('faces.promise')}</p>
    <p class="state" role="status">
      <strong>{status.on ? t('faces.stateOn') : t('faces.statePaused')}</strong>
      {t('faces.found', { count: status.counts.boxes })}{' · '}{t('faces.named', { count: status.counts.named })}{#if status.on}{' · '}{toLook}{/if}
    </p>

    {#if canManage}
      {#if status.on}
        <button class="btn" type="button" disabled={busy} onclick={() => turn(false)}>{t('faces.pause')}</button>
      {:else}
        <div class="law">
          <p>{t('faces.law')} <a href="/help/faces-and-the-law">{t('faces.lawLink')}</a></p>
          <label class="tick"><input type="checkbox" bind:checked={understood} /> {t('faces.understood')}</label>
        </div>
        <button class="btn btn-primary" type="button" disabled={busy || !understood || status.removing} onclick={() => turn(true)}>{t('faces.turnOn')}</button>
      {/if}

      <div class="remove">
        {#if status.removing}
          <p class="muted" role="status">{t('faces.removing', { count: status.counts.boxes })}</p>
        {:else if status.counts.boxes > 0}
          {#if status.on}
            <p class="muted small">{t('faces.removeNeedsPause')}</p>
          {:else if confirming}
            <p role="alert">{t('faces.removeConfirm', { count: status.counts.boxes, named: status.counts.named })}</p>
            <button class="btn btn-danger" type="button" disabled={busy} onclick={remove}>{t('faces.removeYes')}</button>
            <button class="btn btn-ghost" type="button" disabled={busy} onclick={() => (confirming = false)}>{t('common.cancel')}</button>
          {:else}
            <button class="btn" type="button" onclick={() => (confirming = true)}>{t('faces.remove')}</button>
          {/if}
        {/if}
      </div>
    {/if}
    {#if error}<p class="alert alert-error small" role="alert">{error}</p>{/if}
  {/if}
</section>

<style>
  .state {
    margin: 10px 0;
  }
  .law {
    border-left: 3px solid var(--border-strong);
    padding: 4px 0 4px 12px;
    margin: 10px 0;
  }
  .tick {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .remove {
    margin-top: 14px;
  }
  .small {
    font-size: 0.85rem;
  }
</style>

<script lang="ts">
  /**
   * Find faces in this album, or in a job's albums (plans/PLAN-FN2-v2.md, FN2b): for photos no helper looks at
   * (website uploads, mostly). Runs in this tab: cf-dam hands out a few photos at a time, the face worker (/faces/,
   * src/faces/worker.ts) looks at each unedited preview, and only the boxes go back. Stops when the tab closes and
   * carries on next time from what's left; a pause in Setup stops it at once.
   */
  import { t } from '@cf-dam/i18n/client'
  import { onDestroy } from 'svelte'
  import { api } from '../lib/auth-client'

  interface Counts {
    toLook: number
    done: number
    failed: number
    without: number
  }
  type Answer = { assetId: string; frame: string; faces: unknown[] } | { assetId: string; failed: true }

  let { scope, id, initial }: { scope: 'album' | 'job'; id: string; initial: Counts } = $props()

  let counts = $state<Counts>({ ...initial })
  let running = $state(false)
  let looked = $state(0)
  let found = $state(0)
  let message = $state('')
  let error = $state('')
  let stopping = false
  let workers: Worker[] = []
  let wake: { release: () => Promise<void> } | null = null
  const phone = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)

  const queueUrl = () => `/api/faces/queue?${scope}=${encodeURIComponent(id)}`

  /** One photo through a worker; a worker that dies counts the photo as not readable. */
  function look(worker: Worker, assetId: string): Promise<Answer> {
    return new Promise((resolve) => {
      const done = (answer: Answer) => {
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
        resolve(answer)
      }
      const onMessage = (e: MessageEvent<Answer>) => e.data.assetId === assetId && done(e.data)
      const onError = () => done({ assetId, failed: true })
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)
      worker.postMessage({ assetId })
    })
  }

  async function start() {
    error = ''
    message = ''
    looked = 0
    found = 0
    stopping = false
    running = true
    // Two at once on a machine with room for it; one on a phone or a small laptop.
    const nav = navigator as Navigator & { deviceMemory?: number; wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }
    const many = (navigator.hardwareConcurrency ?? 2) > 4 && (nav.deviceMemory ?? 8) > 4 && !phone
    workers = Array.from({ length: many ? 2 : 1 }, () => new Worker('/faces/worker.js', { type: 'module' }))
    wake = await nav.wakeLock?.request('screen').catch(() => null) ?? null
    try {
      while (!stopping) {
        const batch = await api<{ model: string; epoch: number; photos: { assetId: string }[]; counts: Counts }>(queueUrl())
        counts = batch.counts
        if (batch.photos.length === 0) break
        const answers: Answer[] = []
        let next = 0
        await Promise.all(
          workers.map(async (worker) => {
            while (!stopping && next < batch.photos.length) {
              const answer = await look(worker, batch.photos[next++]!.assetId)
              answers.push(answer)
              looked++
              if ('faces' in answer) found += answer.faces.length
            }
          }),
        )
        if (answers.length === 0) break
        const sent = await fetch('/api/faces/boxes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: batch.model, epoch: batch.epoch, photos: answers }) })
        if (sent.status === 409) {
          error = t('findFaces.paused')
          break
        }
        if (!sent.ok) throw new Error(((await sent.json().catch(() => ({}))) as { message?: string }).message ?? `HTTP ${sent.status}`)
      }
      if (!error) message = stopping ? t('findFaces.stopped', { count: looked }) : t('findFaces.done', { count: found, photos: looked })
      counts = (await api<{ counts: Counts }>(`${queueUrl()}&peek=1`)).counts
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      finish()
    }
  }

  function finish() {
    for (const w of workers) w.terminate()
    workers = []
    void wake?.release().catch(() => {})
    wake = null
    running = false
  }

  onDestroy(() => {
    stopping = true
    finish()
  })
</script>

<section class="card" aria-labelledby={`find-faces-${id}`}>
  <h2 id={`find-faces-${id}`}>{t('findFaces.title')}</h2>
  <p class="muted small">
    {t('findFaces.counts', { toLook: counts.toLook, done: counts.done })}{#if counts.failed > 0}{' · '}{t('findFaces.failed', { count: counts.failed })}{/if}
  </p>
  {#if running}
    <p role="status">{t('findFaces.running', { count: looked, faces: found })}</p>
    <p class="muted small">{phone ? t('findFaces.keepInFront') : t('findFaces.keepOpen')}</p>
    <button class="btn" type="button" onclick={() => (stopping = true)}>{t('findFaces.stop')}</button>
  {:else}
    {#if message}<p role="status">{message}</p>{/if}
    {#if counts.toLook > 0}
      <button class="btn btn-primary" type="button" onclick={start}>{scope === 'album' ? t('findFaces.startAlbum') : t('findFaces.startJob')}</button>
    {/if}
  {/if}
  {#if error}<p class="alert alert-error small" role="alert">{error}</p>{/if}
</section>

<style>
  .small {
    font-size: 0.85rem;
  }
</style>

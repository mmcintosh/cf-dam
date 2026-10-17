<script lang="ts">
  import { api } from '../lib/auth-client'

  interface Settings {
    enabled: boolean
    auto: boolean
    model: string
    context: string
  }
  interface Stats {
    analysed: number
    queued: number
    failed: number
    waiting: number
    averageNeurons: number | null
    usdPerPhoto: number | null
  }
  interface Model {
    id: string
    label: string
    note: string
  }
  interface Props {
    available: boolean
    initialSettings: Settings
    initialStats: Stats
    models: Model[]
    usdPer1000Neurons: number
    canManage: boolean
  }
  let props: Props = $props()

  let settings = $state<Settings>({ ...props.initialSettings })
  let stats = $state<Stats>({ ...props.initialStats })
  let saved = $state('')
  let error = $state('')
  let queueing = $state(false)

  // Before anything has been analysed here, estimate from the measured default (~41 neurons a photo).
  const perPhoto = $derived(stats.usdPerPhoto ?? (41 / 1000) * props.usdPer1000Neurons)
  const backlog = $derived(stats.waiting + stats.failed)
  const money = (usd: number) => (usd < 0.01 ? 'less than $0.01' : `$${usd.toFixed(2)}`)
  const cost = (usd: number) => (usd < 0.01 ? 'less than $0.01' : `about $${usd.toFixed(2)}`)

  async function save(patch: Partial<Settings>) {
    error = ''
    try {
      const result = await api<{ settings: Settings }>('/api/ai/settings', { method: 'PUT', body: JSON.stringify(patch) })
      settings = result.settings
      saved = 'Saved'
      setTimeout(() => (saved = ''), 1500)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save.'
    }
  }

  async function backfill() {
    queueing = true
    error = ''
    try {
      stats = (await api<{ stats: Stats }>('/api/ai/backfill', { method: 'POST' })).stats
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not queue.'
    } finally {
      queueing = false
    }
  }

  async function refresh() {
    stats = (await api<{ stats: Stats }>('/api/ai')).stats
  }
</script>

<div class="stack settings">
  {#if !props.available}
    <div class="alert alert-error">
      This deployment has no Workers AI binding. Add <code>"ai": {'{'} "binding": "AI" {'}'}</code> to <code>wrangler.jsonc</code> and deploy again.
    </div>
  {/if}

  <section class="card stats">
    <div><strong>{stats.analysed.toLocaleString()}</strong><span class="muted">analysed</span></div>
    <div><strong>{stats.queued.toLocaleString()}</strong><span class="muted">in the queue</span></div>
    <div><strong>{stats.waiting.toLocaleString()}</strong><span class="muted">never analysed</span></div>
    <div><strong>{stats.failed.toLocaleString()}</strong><span class="muted">failed</span></div>
    <div>
      <strong>{money(perPhoto * 1000)}</strong>
      <span class="muted">per 1,000 photos{stats.usdPerPhoto === null ? ' (estimate)' : ''}</span>
    </div>
  </section>

  {#if backlog > 0 && props.available}
    <section class="card row backlog">
      <div>
        <h2>Analyse the back catalogue</h2>
        <p class="muted">
          {backlog.toLocaleString()} photos have no suggestions yet. Analysing them all costs {cost(backlog * perPhoto)} in Workers
          AI usage (the first 10,000 neurons each day are free). They are worked through in the background, a few at a time.
        </p>
      </div>
      <button class="btn btn-primary" type="button" onclick={backfill} disabled={queueing}>{queueing ? 'Queueing…' : `Queue ${backlog.toLocaleString()}`}</button>
    </section>
  {:else if stats.queued > 0}
    <p class="muted">Working through the queue. <button class="link" type="button" onclick={refresh}>Refresh</button></p>
  {/if}

  <section class="card stack">
    <h2>Settings</h2>
    <label class="check">
      <input type="checkbox" checked={settings.enabled} disabled={!props.canManage} onchange={(e) => save({ enabled: e.currentTarget.checked })} />
      <span><strong>AI review</strong><br /><span class="muted">Off stops all analysis. Suggestions already made are kept.</span></span>
    </label>
    <label class="check">
      <input type="checkbox" checked={settings.auto} disabled={!props.canManage || !settings.enabled} onchange={(e) => save({ auto: e.currentTarget.checked })} />
      <span><strong>Analyse new uploads</strong><br /><span class="muted">Each new photo is queued once it has a preview.</span></span>
    </label>

    <fieldset class="models">
      <legend class="label">Model</legend>
      {#each props.models as model (model.id)}
        <label class="model" class:on={settings.model === model.id}>
          <input type="radio" name="model" value={model.id} checked={settings.model === model.id} disabled={!props.canManage} onchange={() => save({ model: model.id })} />
          <span><strong>{model.label}</strong><br /><span class="muted">{model.note}</span></span>
        </label>
      {/each}
    </fieldset>

    <div class="field">
      <label for="context">About your work</label>
      <textarea
        id="context"
        rows="2"
        maxlength="500"
        placeholder="e.g. Wedding and landscape photographer in western Norway"
        bind:value={settings.context}
        disabled={!props.canManage}
        onchange={() => save({ context: settings.context })}
      ></textarea>
      <span class="muted small">Given to the model with every photo, so its tags fit your archive.</span>
    </div>
    {#if saved}<span class="muted small">{saved}</span>{/if}
    {#if error}<div class="alert alert-error">{error}</div>{/if}
    {#if !props.canManage}<p class="muted small">Only administrators can change these settings.</p>{/if}
  </section>

  <p class="muted small">
    The model sees a 1024 px copy of the preview, never the original, so archived photos can be analysed too. Suggested alt text and
    captions wait for you to accept them; suggested tags are searchable straight away and marked as AI until you keep or drop them.
  </p>
</div>

<style>
  .settings {
    max-width: 760px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 16px;
  }
  .stats div {
    display: grid;
  }
  .stats strong {
    font-size: 1.5rem;
  }
  .stats span {
    font-size: 0.8rem;
  }
  .backlog {
    justify-content: space-between;
    gap: 20px;
  }
  .backlog p {
    margin: 6px 0 0;
  }
  .check,
  .model {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    cursor: pointer;
  }
  .check input,
  .model input {
    margin-top: 4px;
  }
  .models {
    display: grid;
    gap: 8px;
    border: 0;
    padding: 0;
    margin: 0;
  }
  .model {
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
  }
  .model.on {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }
  textarea {
    width: 100%;
    font: inherit;
    color: var(--text);
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    resize: vertical;
  }
  .small {
    font-size: 0.8rem;
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
  @media (max-width: 640px) {
    .backlog {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>

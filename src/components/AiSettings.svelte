<script lang="ts">
  import { format, t } from '@cf-dam/i18n/client'
  import type { MessageKey } from '@cf-dam/i18n'
  import { LANGUAGES } from '@cf-dam/i18n/languages'
  import { api } from '../lib/auth-client'

  interface Settings {
    enabled: boolean
    auto: boolean
    model: string
    context: string
    language: string
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
    /** settings `site.language`, for the "archive's language" choice. */
    archiveLanguage: string
    canManage: boolean
  }
  let props: Props = $props()

  let settings = $state<Settings>({ ...props.initialSettings })
  let stats = $state<Stats>({ ...props.initialStats })
  let saved = $state('')
  let error = $state('')
  let queueing = $state(false)
  let queueError = $state('')
  // What the server last confirmed. A failed save puts the controls back to it (redrawn, so a checkbox
  // or radio the browser already flipped doesn't keep showing a setting that wasn't saved).
  let confirmed = { ...props.initialSettings }
  let redraw = $state(0)

  // Before anything has been analysed here, estimate from the measured default (~41 neurons a photo).
  const perPhoto = $derived(stats.usdPerPhoto ?? (41 / 1000) * props.usdPer1000Neurons)
  const backlog = $derived(stats.waiting + stats.failed)
  const noBinding = (() => {
    const [a = '', rest = ''] = t('ai.noBinding', { config: '\u0000', file: '\u0001' }).split('\u0000')
    const [b = '', c = ''] = rest.split('\u0001')
    return [a, b, c]
  })()
  const money = (usd: number) => (usd < 0.01 ? t('ai.lessThanCent') : format().number(usd, { style: 'currency', currency: 'USD' }))
  const cost = (usd: number) => (usd < 0.01 ? t('ai.lessThanCent') : t('ai.about', { amount: format().number(usd, { style: 'currency', currency: 'USD' }) }))
  const MODEL_NOTES: Record<string, MessageKey> = {
    '@cf/mistralai/mistral-small-3.1-24b-instruct': 'aiModel.mistral',
    '@cf/meta/llama-4-scout-17b-16e-instruct': 'aiModel.llama',
    '@cf/google/gemma-4-26b-a4b-it': 'aiModel.gemma',
    '@cf/moondream/moondream3.1-9B-A2B': 'aiModel.moondream',
  }

  async function save(patch: Partial<Settings>) {
    error = ''
    try {
      const result = await api<{ settings: Settings }>('/api/ai/settings', { method: 'PUT', body: JSON.stringify(patch) })
      settings = result.settings
      confirmed = { ...result.settings }
      saved = t('common.saved')
      setTimeout(() => (saved = ''), 1500)
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
      settings = { ...confirmed }
      redraw++
    }
  }

  async function backfill() {
    queueing = true
    queueError = ''
    try {
      stats = (await api<{ stats: Stats }>('/api/ai/backfill', { method: 'POST' })).stats
    } catch (e) {
      queueError = e instanceof Error ? e.message : t('ai.couldNotQueue')
    } finally {
      queueing = false
    }
  }

  async function refresh() {
    queueError = ''
    try {
      stats = (await api<{ stats: Stats }>('/api/ai')).stats
    } catch (e) {
      queueError = e instanceof Error ? e.message : t('ai.couldNotRefresh')
    }
  }
</script>

<div class="stack settings">
  {#if !props.available}
    <div class="alert alert-error">
      {noBinding[0]}<code>"ai": {'{'} "binding": "AI" {'}'}</code>{noBinding[1]}<code>wrangler.jsonc</code>{noBinding[2]}
    </div>
  {/if}

  <section class="card stats">
    <div><strong>{format().number(stats.analysed)}</strong><span class="muted">{t('ai.analysed')}</span></div>
    <div><strong>{format().number(stats.queued)}</strong><span class="muted">{t('ai.inQueue')}</span></div>
    <div><strong>{format().number(stats.waiting)}</strong><span class="muted">{t('ai.never')}</span></div>
    <div><strong>{format().number(stats.failed)}</strong><span class="muted">{t('ai.failed')}</span></div>
    <div>
      <strong>{money(perPhoto * 1000)}</strong>
      <span class="muted">{t('ai.per1000')}{stats.usdPerPhoto === null ? ` ${t('ai.estimate')}` : ''}</span>
    </div>
  </section>

  {#if backlog > 0 && props.available}
    <section class="card row backlog">
      <div>
        <h2>{t('ai.backCatalogue')}</h2>
        {#if settings.enabled}
          <p class="muted">
            {t('ai.backlogOn', { count: backlog, cost: cost(backlog * perPhoto) })}
          </p>
        {:else}
          <p class="muted">{t('ai.backlogOff', { count: backlog })}</p>
        {/if}
        {#if queueError}<div class="alert alert-error">{queueError}</div>{/if}
      </div>
      {#if settings.enabled}
        <button class="btn btn-primary" type="button" onclick={backfill} disabled={queueing}>{queueing ? t('ai.queueing') : t('ai.queueCount', { count: backlog })}</button>
      {/if}
    </section>
  {:else if stats.queued > 0}
    <p class="muted">
      {settings.enabled ? t('ai.working') : t('ai.offWaiting')}
      <button class="link" type="button" onclick={refresh}>{t('common.refresh')}</button>
    </p>
    {#if queueError}<div class="alert alert-error">{queueError}</div>{/if}
  {/if}

  <section class="card stack">
    <h2>{t('ai.settings')}</h2>
    {#key redraw}
    <label class="check">
      <input type="checkbox" checked={settings.enabled} disabled={!props.canManage} onchange={(e) => save({ enabled: e.currentTarget.checked })} />
      <span><strong>{t('ai.switch')}</strong><br /><span class="muted">{t('ai.switchNote')}</span></span>
    </label>
    <label class="check">
      <input type="checkbox" checked={settings.auto} disabled={!props.canManage || !settings.enabled} onchange={(e) => save({ auto: e.currentTarget.checked })} />
      <span><strong>{t('ai.auto')}</strong><br /><span class="muted">{t('ai.autoNote')}</span></span>
    </label>

    <fieldset class="models">
      <legend class="label">{t('ai.model')}</legend>
      {#each props.models as model (model.id)}
        <label class="model" class:on={settings.model === model.id}>
          <input type="radio" name="model" value={model.id} checked={settings.model === model.id} disabled={!props.canManage} onchange={() => save({ model: model.id })} />
          <span><strong>{model.label}</strong><br /><span class="muted">{MODEL_NOTES[model.id] ? t(MODEL_NOTES[model.id]!) : model.note}</span></span>
        </label>
      {/each}
    </fieldset>

    <div class="field">
      <label for="ai-language">{t('ai.language')}</label>
      <select id="ai-language" bind:value={settings.language} disabled={!props.canManage} onchange={() => save({ language: settings.language })}>
        <option value="site">{t('ai.languageSite', { name: LANGUAGES.find((l) => l.code === props.archiveLanguage)?.name ?? props.archiveLanguage })}</option>
        {#each LANGUAGES as language (language.code)}<option value={language.code} lang={language.code}>{language.name}</option>{/each}
      </select>
      <span class="muted small">{t('ai.languageNote')}</span>
    </div>

    <div class="field">
      <label for="context">{t('ai.aboutWork')}</label>
      <textarea
        id="context"
        rows="2"
        maxlength="500"
        placeholder={t('ai.aboutPlaceholder')}
        bind:value={settings.context}
        disabled={!props.canManage}
        onchange={() => save({ context: settings.context })}
      ></textarea>
      <span class="muted small">{t('ai.aboutNote')}</span>
    </div>
    {/key}
    {#if saved}<span class="muted small">{saved}</span>{/if}
    {#if error}<div class="alert alert-error">{error}</div>{/if}
    {#if !props.canManage}<p class="muted small">{t('ai.adminsOnly')}</p>{/if}
  </section>

  <p class="muted small">
    {t('ai.footer')}
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

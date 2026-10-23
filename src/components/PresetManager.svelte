<script lang="ts">
  import { t } from '@cf-dam/i18n/client'
  import { iptcGroup, iptcLabel } from '../lib/iptc-labels'
  import { api } from '../lib/auth-client'

  interface Field {
    key: string
    label: string
    group: string
    max: number
    long?: boolean
  }
  interface Preset {
    id: string
    name: string
    fields: Record<string, string | null>
    applyToUploads: boolean
  }
  interface Props {
    initial: Preset[]
    fields: Field[]
    canEdit: boolean
  }
  let props: Props = $props()

  let presets = $state<Preset[]>([...props.initial])
  let editing = $state<string | null>(null) // preset id, or 'new'
  let name = $state('')
  let values = $state<Record<string, string>>({})
  let applyToUploads = $state(false)
  let error = $state('')
  let message = $state('')
  const groups = [...new Set(props.fields.map((f) => f.group))]

  function start(preset: Preset | null) {
    editing = preset?.id ?? 'new'
    name = preset?.name ?? ''
    values = Object.fromEntries(props.fields.map((f) => [f.key, preset?.fields[f.key] ?? '']))
    applyToUploads = preset?.applyToUploads ?? false
    error = ''
    message = ''
  }

  async function save() {
    error = ''
    const fields = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]))
    try {
      const body = JSON.stringify({ name, fields, applyToUploads })
      const { preset } =
        editing === 'new'
          ? await api<{ preset: Preset }>('/api/presets', { method: 'POST', body })
          : await api<{ preset: Preset }>(`/api/presets/${editing}`, { method: 'PUT', body })
      presets = [...presets.filter((p) => p.id !== preset.id), preset].sort((a, b) => a.name.localeCompare(b.name))
      editing = null
      message = t('presets.saved', { name: preset.name })
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
    }
  }

  // Delete asks for a second click, which lapses after a few seconds or when the button loses focus.
  let confirming = $state<string | null>(null)
  let lapse: ReturnType<typeof setTimeout> | undefined
  function arm(id: string | null) {
    clearTimeout(lapse)
    confirming = id
    if (id) lapse = setTimeout(() => (confirming = null), 4000)
  }
  async function remove(preset: Preset) {
    if (confirming !== preset.id) return arm(preset.id)
    arm(null)
    error = ''
    message = ''
    try {
      await api(`/api/presets/${preset.id}`, { method: 'DELETE' })
      presets = presets.filter((p) => p.id !== preset.id)
      if (editing === preset.id) editing = null
    } catch (e) {
      error = t('presets.notDeleted', { name: preset.name, why: e instanceof Error ? e.message : t('common.tryAgain') })
    }
  }

  const summary = (p: Preset) =>
    props.fields
      .filter((f) => p.fields[f.key])
      .map((f) => iptcLabel(f))
      .join(', ')
</script>

<div class="presets stack">
  {#if presets.length === 0 && editing === null}
    <div class="card">
      <p>{t('presets.none')}</p>
    </div>
  {/if}

  {#each presets as preset (preset.id)}
    <div class="card row item">
      <div class="grow">
        <strong>{preset.name}</strong>
        {#if preset.applyToUploads}<span class="pill">{t('presets.newUploads')}</span>{/if}
        <p class="muted small">{summary(preset)}</p>
      </div>
      {#if props.canEdit}
        <button class="btn btn-sm" type="button" onclick={() => start(preset)}>{t('common.edit')}</button>
        <button class="btn btn-sm btn-danger" type="button" onclick={() => remove(preset)} onblur={() => confirming === preset.id && arm(null)}>{confirming === preset.id ? t('common.clickAgainDelete') : t('common.delete')}</button>
      {/if}
    </div>
  {/each}

  {#if props.canEdit && editing === null}
    <div><button class="btn btn-primary" type="button" onclick={() => start(null)}>{t('presets.new')}</button></div>
  {/if}
  {#if message}<p class="alert alert-success">{message}</p>{/if}
  {#if error && editing === null}<div class="alert alert-error">{error}</div>{/if}

  {#if editing !== null}
    <form class="card stack" onsubmit={(e) => (e.preventDefault(), save())}>
      <div class="field">
        <label for="preset-name">{t('presets.name')}</label>
        <input id="preset-name" type="text" maxlength="100" bind:value={name} required placeholder={t('presets.namePlaceholder')} />
      </div>
      {#each groups as group (group)}
        <fieldset>
          <legend class="label">{iptcGroup(group)}</legend>
          <div class="grid">
            {#each props.fields.filter((f) => f.group === group) as field (field.key)}
              <div class="field" class:wide={field.long}>
                <label for={`p-${field.key}`}>{iptcLabel(field)}</label>
                {#if field.long}
                  <textarea id={`p-${field.key}`} rows="2" maxlength={field.max} bind:value={values[field.key]}></textarea>
                {:else}
                  <input id={`p-${field.key}`} type="text" maxlength={field.max} bind:value={values[field.key]} />
                {/if}
              </div>
            {/each}
          </div>
        </fieldset>
      {/each}
      <label class="check">
        <input type="checkbox" bind:checked={applyToUploads} />
        <span><strong>{t('presets.applyUploads')}</strong><br /><span class="muted small">{t('presets.applyUploadsNote')}</span></span>
      </label>
      <p class="muted small">{t('presets.onlyFilled')}</p>
      {#if error}<div class="alert alert-error">{error}</div>{/if}
      <div class="row">
        <button class="btn btn-primary" type="submit">{t('presets.save')}</button>
        <button class="btn" type="button" onclick={() => (editing = null)}>{t('common.cancel')}</button>
      </div>
    </form>
  {/if}
</div>

<style>
  .presets {
    max-width: 820px;
  }
  .item {
    gap: 10px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .grow p {
    margin: 4px 0 0;
  }
  .pill {
    margin-left: 8px;
    font-size: 0.72rem;
    padding: 1px 8px;
    border-radius: 99px;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px 14px;
    margin-top: 6px;
  }
  .field.wide {
    grid-column: 1 / -1;
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
  .check {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .check input {
    margin-top: 4px;
  }
  .small {
    font-size: 0.8rem;
  }
</style>

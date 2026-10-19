<script lang="ts">
  /** IPTC Core fields on the asset page, grouped as photographers know them. Saves each field on change. */
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
  }
  interface Props {
    assetId: string
    fields: Field[]
    values: Record<string, string | null>
    placeFromGps: string[]
    presets: Preset[]
    canEdit: boolean
  }
  let props: Props = $props()

  let values = $state<Record<string, string>>(Object.fromEntries(props.fields.map((f) => [f.key, props.values[f.key] ?? ''])))
  /** What the server has: a field that fails to save goes back to it. */
  let saved = $state<Record<string, string>>({ ...values })
  let fromGps = $state(props.placeFromGps)
  const gpsHint = $derived(`${props.fields.filter((f) => fromGps.includes(f.key)).map((f) => f.label.toLowerCase()).join(', ')} from GPS`)
  let status = $state('')
  let error = $state('')
  const groups = [...new Set(props.fields.map((f) => f.group))]
  const WIDE = new Set(['headline', 'copyright', 'copyrightUrl', 'contactUrl'])
  // Open the groups that have something in them; Rights always, since that's what people come for.
  const initiallyOpen = (group: string) => group === 'Rights' || props.fields.some((f) => f.group === group && props.values[f.key])

  const label = (key: string) => props.fields.find((f) => f.key === key)?.label ?? key

  async function save(key: string) {
    error = ''
    status = 'Saving…'
    const value = values[key]!.trim()
    try {
      await api(`/api/assets/${props.assetId}`, { method: 'PATCH', body: JSON.stringify({ iptc: { [key]: value || null } }) })
      saved[key] = value
      fromGps = fromGps.filter((k) => k !== key)
      status = 'Saved'
      setTimeout(() => status === 'Saved' && (status = ''), 1500)
    } catch (e) {
      status = ''
      error = `${label(key)} wasn't saved (“${value}”): ${e instanceof Error ? e.message : 'try again.'}`
      values[key] = saved[key]!
    }
  }

  async function applyPreset(id: string, overwrite: boolean) {
    if (!id) return
    error = ''
    try {
      await api('/api/assets/bulk', { method: 'POST', body: JSON.stringify({ ids: [props.assetId], action: 'preset', presetId: id, overwrite }) })
      const fresh = await api<{ iptc: Record<string, string | null>; placeFromGps: string[] }>(`/api/assets/${props.assetId}`)
      values = Object.fromEntries(props.fields.map((f) => [f.key, fresh.iptc[f.key] ?? '']))
      saved = { ...values }
      fromGps = fresh.placeFromGps
      status = 'Preset applied'
      setTimeout(() => (status = ''), 1500)
    } catch (e) {
      error = `The preset wasn't applied: ${e instanceof Error ? e.message : 'try again.'}`
    }
  }
</script>

<div class="stack iptc">
  {#if props.canEdit && props.presets.length > 0}
    <div class="row presets">
      <select aria-label="Apply a preset" onchange={(e) => { const v = e.currentTarget.value; e.currentTarget.value = ''; applyPreset(v, false) }}>
        <option value="">Apply preset (fill empty fields)…</option>
        {#each props.presets as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      </select>
      <a class="small" href="/presets">Manage</a>
    </div>
  {/if}
  {#each groups as group (group)}
    <details open={initiallyOpen(group)}>
      <summary>
        {group}
        {#if group === 'Location' && fromGps.length > 0}<span class="hint">{gpsHint}</span>{/if}
      </summary>
      <div class="grid">
        {#each props.fields.filter((f) => f.group === group) as field (field.key)}
          <div class="field" class:wide={field.long || WIDE.has(field.key)}>
            <label for={`iptc-${field.key}`}>{field.label}</label>
            {#if field.long}
              <textarea id={`iptc-${field.key}`} rows="2" maxlength={field.max} bind:value={values[field.key]} disabled={!props.canEdit} onchange={() => save(field.key)}></textarea>
            {:else}
              <input id={`iptc-${field.key}`} type="text" maxlength={field.max} bind:value={values[field.key]} disabled={!props.canEdit} onchange={() => save(field.key)} />
            {/if}
          </div>
        {/each}
      </div>
    </details>
  {/each}
  {#if status}<span class="muted small">{status}</span>{/if}
  {#if error}<div class="alert alert-error">{error}</div>{/if}
</div>

<style>
  .iptc {
    gap: 4px;
  }
  .presets {
    gap: 8px;
    margin-bottom: 6px;
  }
  .presets select {
    flex: 1;
  }
  details {
    border-top: 1px solid var(--border);
    padding: 8px 0;
  }
  summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .hint {
    margin-left: 8px;
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
    color: var(--accent);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 10px;
    margin-top: 8px;
  }
  .field {
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .field.wide {
    grid-column: 1 / -1;
  }
  .field label {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .field input {
    padding: 6px 8px;
    font-size: 0.85rem;
  }
  textarea {
    width: 100%;
    font: inherit;
    font-size: 0.85rem;
    color: var(--text);
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 6px 8px;
    resize: vertical;
  }
  .small {
    font-size: 0.8rem;
  }
</style>

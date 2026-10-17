<script lang="ts">
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'

  interface Connection {
    id: string
    name: string
    provider: 'r2-binding' | 's3'
    endpoint: string | null
    region: string | null
    bucket: string | null
    prefix: string
    storageClasses: string[]
    defaultClass: string
    isDefault: boolean
    accessKeyId: string | null
  }
  interface Props {
    origin: string
  }
  let { origin }: Props = $props()

  const ALL_CLASSES = ['STANDARD', 'INTELLIGENT_TIERING', 'STANDARD_IA', 'ONEZONE_IA', 'GLACIER_IR', 'GLACIER', 'DEEP_ARCHIVE']
  const PRESETS = {
    aws: { label: 'Amazon S3', endpoint: (r: string) => `https://s3.${r}.amazonaws.com`, region: 'us-east-1', pathStyle: false, classes: ALL_CLASSES },
    r2: { label: 'Cloudflare R2 (S3 API)', endpoint: () => 'https://<ACCOUNT_ID>.r2.cloudflarestorage.com', region: 'auto', pathStyle: true, classes: ['STANDARD', 'STANDARD_IA'] },
    b2: { label: 'Backblaze B2', endpoint: (r: string) => `https://s3.${r}.backblazeb2.com`, region: 'us-west-004', pathStyle: true, classes: ['STANDARD'] },
    wasabi: { label: 'Wasabi', endpoint: (r: string) => `https://s3.${r}.wasabisys.com`, region: 'us-east-1', pathStyle: true, classes: ['STANDARD'] },
    custom: { label: 'Other S3-compatible', endpoint: () => 'https://', region: 'us-east-1', pathStyle: true, classes: ['STANDARD'] },
  } as const
  type PresetKey = keyof typeof PRESETS

  let connections = $state<Connection[]>([])
  let adding = $state(false)
  let preset = $state<PresetKey>('aws')
  let form = $state({ name: '', endpoint: PRESETS.aws.endpoint('us-east-1'), region: 'us-east-1', bucket: '', prefix: '', forcePathStyle: false, accessKeyId: '', secretAccessKey: '', storageClasses: [...ALL_CLASSES], defaultClass: 'STANDARD' })
  let testResults = $state<Record<string, { ok: boolean; message?: string } | 'running'>>({})
  let error = $state('')
  let busy = $state(false)

  async function load() {
    connections = (await api<{ connections: Connection[] }>('/api/connections')).connections
  }
  onMount(load)

  function applyPreset(key: PresetKey) {
    preset = key
    const p = PRESETS[key]
    form.region = p.region
    form.endpoint = p.endpoint(p.region)
    form.forcePathStyle = p.pathStyle
    form.storageClasses = [...p.classes]
    form.defaultClass = 'STANDARD'
  }

  function regionChanged() {
    if (preset !== 'custom' && preset !== 'r2') form.endpoint = PRESETS[preset].endpoint(form.region)
  }

  async function create(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    busy = true
    try {
      const { connection } = await api<{ connection: Connection }>('/api/connections', { method: 'POST', body: JSON.stringify(form) })
      adding = false
      form.secretAccessKey = ''
      await load()
      await test(connection.id)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not add the connection.'
    } finally {
      busy = false
    }
  }

  async function test(id: string) {
    testResults[id] = 'running'
    testResults[id] = await api<{ ok: boolean; message?: string }>(`/api/connections/${id}/test`, { method: 'POST' })
  }

  async function makeDefault(id: string) {
    await api(`/api/connections/${id}/default`, { method: 'POST' })
    await load()
  }

  async function remove(c: Connection) {
    if (!confirm(`Remove "${c.name}"? The bucket and its files are not touched.`)) return
    try {
      await api(`/api/connections/${c.id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not remove the connection.'
    }
  }

  const corsRule = $derived(
    JSON.stringify(
      [{ AllowedOrigins: [origin], AllowedMethods: ['PUT', 'GET', 'HEAD'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }],
      null,
      2,
    ),
  )
</script>

<div class="stack">
  {#each connections as c (c.id)}
    {@const result = testResults[c.id]}
    <article class="card conn">
      <div class="row top">
        <div>
          <h3>{c.name} {#if c.isDefault}<span class="badge badge-accent">Default</span>{/if}</h3>
          <p class="muted">
            {#if c.provider === 'r2-binding'}This deployment's own R2 bucket, through the Worker binding. Thumbnails and previews always live here.
            {:else}<code>{c.bucket}</code>{c.prefix ? ` / ${c.prefix}` : ''} · {c.endpoint} · {c.region} · key <code>{c.accessKeyId}</code>{/if}
          </p>
        </div>
        <div class="row actions">
          <button class="btn btn-sm" onclick={() => test(c.id)} disabled={result === 'running'}>{result === 'running' ? 'Testing…' : 'Test'}</button>
          {#if !c.isDefault}<button class="btn btn-sm" onclick={() => makeDefault(c.id)}>Make default</button>{/if}
          {#if c.provider === 's3'}<button class="btn btn-sm btn-danger" onclick={() => remove(c)}>Remove</button>{/if}
        </div>
      </div>
      <div class="row classes">
        {#each c.storageClasses as cls (cls)}<span class="badge" class:badge-accent={cls === c.defaultClass}>{cls}</span>{/each}
      </div>
      {#if result && result !== 'running'}
        <div class="alert" class:alert-success={result.ok} class:alert-error={!result.ok}>
          {result.ok ? 'Connected: wrote, read back and deleted a test object.' : result.message}
        </div>
      {/if}
    </article>
  {/each}

  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}

  {#if !adding}
    <div><button class="btn btn-primary" onclick={() => (adding = true)}>Add an S3 connection</button></div>
  {:else}
    <form class="card stack" onsubmit={create}>
      <h3>New S3 connection</h3>
      <div class="presets" role="radiogroup" aria-label="Provider">
        {#each Object.entries(PRESETS) as [key, p] (key)}
          <button type="button" role="radio" aria-checked={preset === key} class:on={preset === key} onclick={() => applyPreset(key as PresetKey)}>{p.label}</button>
        {/each}
      </div>
      <div class="grid">
        <div class="field"><label for="c-name">Name</label><input id="c-name" type="text" placeholder="Studio archive" required bind:value={form.name} /></div>
        <div class="field"><label for="c-bucket">Bucket</label><input id="c-bucket" type="text" required bind:value={form.bucket} /></div>
        <div class="field"><label for="c-region">Region</label><input id="c-region" type="text" required bind:value={form.region} oninput={regionChanged} /></div>
        <div class="field"><label for="c-prefix">Folder in the bucket (optional)</label><input id="c-prefix" type="text" placeholder="cf-dam" bind:value={form.prefix} /></div>
        <div class="field wide"><label for="c-endpoint">Endpoint</label><input id="c-endpoint" type="text" required bind:value={form.endpoint} /></div>
        <div class="field"><label for="c-key">Access key ID</label><input id="c-key" type="text" autocomplete="off" required bind:value={form.accessKeyId} /></div>
        <div class="field"><label for="c-secret">Secret access key</label><input id="c-secret" type="password" autocomplete="off" required bind:value={form.secretAccessKey} /></div>
      </div>
      <label class="check"><input type="checkbox" bind:checked={form.forcePathStyle} /> Path-style URLs (most non-AWS services)</label>
      <fieldset class="classes-pick">
        <legend class="label">Storage classes this bucket offers</legend>
        {#each ALL_CLASSES as cls (cls)}
          <label class="check"><input type="checkbox" value={cls} bind:group={form.storageClasses} /> <code>{cls}</code></label>
        {/each}
      </fieldset>
      <div class="field narrow">
        <label for="c-default">Default class for uploads</label>
        <select id="c-default" bind:value={form.defaultClass}>
          {#each form.storageClasses as cls (cls)}<option value={cls}>{cls}</option>{/each}
        </select>
      </div>
      <details>
        <summary>Browser uploads go straight to the bucket: add this CORS rule to it</summary>
        <pre class="mono">{corsRule}</pre>
        <p class="muted">Without it, uploads to this connection fail with a network error. The secret is encrypted before it is stored and is never shown again.</p>
      </details>
      <div class="row">
        <button class="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add and test'}</button>
        <button class="btn" type="button" onclick={() => (adding = false)}>Cancel</button>
      </div>
    </form>
  {/if}
</div>

<style>
  .conn h3,
  form h3 {
    font-size: 1rem;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .conn p {
    margin: 6px 0 0;
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
  .top {
    justify-content: space-between;
    align-items: flex-start;
  }
  .actions {
    flex: none;
  }
  .classes {
    margin-top: 12px;
  }
  .conn .alert {
    margin-top: 12px;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .presets button {
    font: inherit;
    font-size: 0.85rem;
    padding: 6px 12px;
    border-radius: 99px;
    border: 1px solid var(--border-strong);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }
  .presets button.on {
    color: var(--text);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .narrow {
    max-width: 280px;
  }
  .check {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .classes-pick {
    border: 0;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
  }
  .classes-pick legend {
    margin-bottom: 8px;
  }
  details summary {
    cursor: pointer;
    color: var(--accent);
    font-size: 0.9rem;
  }
  pre {
    padding: 12px;
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    overflow-x: auto;
  }
</style>

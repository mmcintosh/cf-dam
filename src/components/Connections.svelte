<script lang="ts">
  import { t, tHtml } from '@cf-dam/i18n/client'
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
    authMode: 'binding' | 'access-key' | 'oidc-role' | 'agent'
    roleArn: string | null
  }
  interface AwsSetup {
    identityProvider: { url: string; audience: string; arn: string }
    subject: string
    roleArn: string
    trustPolicy: unknown
    permissionsPolicy: unknown
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
  // Keyless needs an https issuer AWS can reach, so it's the default only when this site is on https.
  const keylessPossible = origin.startsWith('https://')
  let authMode = $state<'access-key' | 'oidc-role'>(keylessPossible ? 'oidc-role' : 'access-key')
  let roleArn = $state('')
  let setups = $state<Record<string, AwsSetup>>({})
  let copied = $state('')

  async function loadSetup(id: string) {
    setups[id] = await api<AwsSetup>(`/api/connections/${id}/aws-setup`)
  }

  async function copy(label: string, value: unknown) {
    await navigator.clipboard.writeText(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
    copied = label
    setTimeout(() => copied === label && (copied = ''), 1500)
  }

  let testResults = $state<Record<string, { ok: boolean; message?: string } | 'running'>>({})
  let error = $state('')
  let busy = $state(false)

  async function load() {
    connections = (await api<{ connections: Connection[] }>('/api/connections')).connections
  }
  onMount(load)

  function applyPreset(key: PresetKey) {
    preset = key
    authMode = key === 'aws' && keylessPossible ? 'oidc-role' : 'access-key'
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
      const payload =
        authMode === 'oidc-role'
          ? { authMode, name: form.name, region: form.region, bucket: form.bucket, prefix: form.prefix, roleArn, storageClasses: form.storageClasses }
          : form
      const { connection } = await api<{ connection: Connection }>('/api/connections', { method: 'POST', body: JSON.stringify(payload) })
      adding = false
      form.secretAccessKey = ''
      await load()
      if (authMode === 'oidc-role') await loadSetup(connection.id)
      else await test(connection.id)
    } catch (e) {
      error = e instanceof Error ? e.message : t('conn.addFailed')
    } finally {
      busy = false
    }
  }

  async function test(id: string) {
    testResults[id] = 'running'
    testResults[id] = await api<{ ok: boolean; message?: string }>(`/api/connections/${id}/test`, { method: 'POST' })
  }

  let importing = $state<Record<string, { prefix: string; running: boolean; imported: number; skipped: number; done: boolean; error: string }>>({})

  function importState(id: string) {
    importing[id] ??= { prefix: '', running: false, imported: 0, skipped: 0, done: false, error: '' }
    return importing[id]
  }

  /** Page through the bucket, one call per 1000 objects, until the cursor runs out. */
  async function runImport(id: string) {
    const state = importState(id)
    Object.assign(state, { running: true, imported: 0, skipped: 0, done: false, error: '' })
    let cursor: string | null = null
    try {
      do {
        const page: { imported: number; skipped: number; cursor: string | null } = await api(`/api/connections/${id}/import`, {
          method: 'POST',
          body: JSON.stringify({ prefix: state.prefix || undefined, cursor: cursor ?? undefined }),
        })
        state.imported += page.imported
        state.skipped += page.skipped
        cursor = page.cursor
      } while (cursor)
      state.done = true
    } catch (e) {
      state.error = e instanceof Error ? e.message : t('conn.importStopped')
    } finally {
      state.running = false
    }
  }

  async function makeDefault(id: string) {
    await api(`/api/connections/${id}/default`, { method: 'POST' })
    await load()
  }

  async function remove(c: Connection) {
    if (!confirm(t('conn.removeConfirm', { name: c.name }))) return
    try {
      await api(`/api/connections/${c.id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : t('conn.removeFailed')
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
          <h3>{c.name} {#if c.isDefault}<span class="badge badge-accent">{t('conn.default')}</span>{/if}</h3>
          <p class="muted">
            {#if c.provider === 'r2-binding'}{t('conn.builtIn')}
            {:else if c.authMode === 'oidc-role'}<code>{c.bucket}</code>{c.prefix ? ` / ${c.prefix}` : ''} · {c.region} · <span class="badge badge-ok">{t('conn.keyless')}</span> {t('conn.role')} <code>{c.roleArn}</code>
            {:else}<code>{c.bucket}</code>{c.prefix ? ` / ${c.prefix}` : ''} · {c.endpoint} · {c.region} · {t('conn.key')} <code>{c.accessKeyId}</code>{/if}
          </p>
        </div>
        <div class="row actions">
          <button class="btn btn-sm" onclick={() => test(c.id)} disabled={result === 'running'}>{result === 'running' ? t('conn.testing') : t('conn.test')}</button>
          {#if !c.isDefault}<button class="btn btn-sm" onclick={() => makeDefault(c.id)}>{t('conn.makeDefault')}</button>{/if}
          {#if c.provider === 's3'}<button class="btn btn-sm btn-danger" onclick={() => remove(c)}>{t('common.remove')}</button>{/if}
        </div>
      </div>
      <div class="row classes">
        {#each c.storageClasses as cls (cls)}<span class="badge" class:badge-accent={cls === c.defaultClass}>{cls}</span>{/each}
      </div>
      {#if result && result !== 'running'}
        <div class="alert" class:alert-success={result.ok} class:alert-error={!result.ok}>
          {result.ok ? t('conn.ok') : result.message}
        </div>
      {/if}
      {#if c.authMode === 'oidc-role'}
        {@const setup = setups[c.id]}
        <details class="import" ontoggle={(e) => e.currentTarget.open && !setup && loadSetup(c.id)}>
          <summary>{t('conn.awsSetup')}</summary>
          {#if setup}
            <ol class="steps">
              <li>
                {@html tHtml('conn.step1', { url: setup.identityProvider.url, audience: setup.identityProvider.audience })}
              </li>
              <li>
                {@html tHtml('conn.step2', { role: setup.roleArn })}
                <button class="btn btn-sm" onclick={() => copy(`trust-${c.id}`, setup.trustPolicy)}>{copied === `trust-${c.id}` ? t('share.copied') : t('common.copy')}</button>
                <pre class="mono">{JSON.stringify(setup.trustPolicy, null, 2)}</pre>
              </li>
              <li>
                {t('conn.step3')}
                <button class="btn btn-sm" onclick={() => copy(`perm-${c.id}`, setup.permissionsPolicy)}>{copied === `perm-${c.id}` ? t('share.copied') : t('common.copy')}</button>
                <pre class="mono">{JSON.stringify(setup.permissionsPolicy, null, 2)}</pre>
              </li>
              <li>{@html tHtml('conn.step4')}</li>
            </ol>
          {:else}
            <p class="muted">{t('common.loading')}</p>
          {/if}
        </details>
      {/if}
      {#if c.provider === 's3'}
        {@const state = importState(c.id)}
        <details class="import">
          <summary>{t('conn.catalogue')}</summary>
          <p class="muted">{t('conn.catalogueLead')}</p>
          <div class="row">
            <input type="text" placeholder={t('conn.importFrom')} bind:value={state.prefix} style="flex: 1" aria-label={t('conn.importFolder')} />
            <button class="btn" onclick={() => runImport(c.id)} disabled={state.running}>{state.running ? t('conn.importing') : t('conn.import')}</button>
          </div>
          {#if state.running || state.done}
            <p class="muted">{t(state.done ? 'conn.progressDone' : 'conn.progress', { files: t('conn.newFiles', { count: state.imported }), skipped: state.skipped })}</p>
          {/if}
          {#if state.error}<div class="alert alert-error">{state.error}</div>{/if}
        </details>
      {/if}
    </article>
  {/each}

  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}

  {#if !adding}
    <div><button class="btn btn-primary" onclick={() => (adding = true)}>{t('conn.add')}</button></div>
  {:else}
    <form class="card stack" onsubmit={create}>
      <h3>{t('conn.new')}</h3>
      <div class="presets" role="radiogroup" aria-label={t('conn.provider')}>
        {#each Object.entries(PRESETS) as [key, p] (key)}
          <button type="button" role="radio" aria-checked={preset === key} class:on={preset === key} onclick={() => applyPreset(key as PresetKey)}>{key === 'custom' ? t('conn.otherS3') : p.label}</button>
        {/each}
      </div>
      {#if preset === 'aws'}
        <div class="presets" role="radiogroup" aria-label={t('conn.howReach')}>
          <button type="button" role="radio" aria-checked={authMode === 'oidc-role'} class:on={authMode === 'oidc-role'} onclick={() => (authMode = 'oidc-role')}>{t('conn.keylessOption')}</button>
          <button type="button" role="radio" aria-checked={authMode === 'access-key'} class:on={authMode === 'access-key'} onclick={() => (authMode = 'access-key')}>{t('conn.keysOption')}</button>
        </div>
        {#if authMode === 'oidc-role'}
          <p class="muted">{t('conn.keylessLead')}</p>
        {/if}
      {/if}
      <div class="grid">
        <div class="field"><label for="c-name">{t('conn.name')}</label><input id="c-name" type="text" placeholder={t('conn.namePlaceholder')} required bind:value={form.name} /></div>
        <div class="field"><label for="c-bucket">{t('conn.bucket')}</label><input id="c-bucket" type="text" required bind:value={form.bucket} /></div>
        <div class="field"><label for="c-region">{t('conn.region')}</label><input id="c-region" type="text" required bind:value={form.region} oninput={regionChanged} /></div>
        <div class="field"><label for="c-prefix">{t('conn.prefix')}</label><input id="c-prefix" type="text" placeholder="cf-dam" bind:value={form.prefix} /></div>
        {#if authMode === 'oidc-role'}
          <div class="field wide"><label for="c-role">{t('conn.roleArn')}</label><input id="c-role" type="text" placeholder="arn:aws:iam::123456789012:role/cf-dam" required bind:value={roleArn} /></div>
        {:else}
          <div class="field wide"><label for="c-endpoint">{t('conn.endpoint')}</label><input id="c-endpoint" type="text" required bind:value={form.endpoint} /></div>
          <div class="field"><label for="c-key">{t('conn.accessKeyId')}</label><input id="c-key" type="text" autocomplete="off" required bind:value={form.accessKeyId} /></div>
          <div class="field"><label for="c-secret">{t('conn.secret')}</label><input id="c-secret" type="password" autocomplete="off" required bind:value={form.secretAccessKey} /></div>
        {/if}
      </div>
      <label class="check"><input type="checkbox" bind:checked={form.forcePathStyle} /> {t('conn.pathStyle')}</label>
      <fieldset class="classes-pick">
        <legend class="label">{t('conn.classes')}</legend>
        {#each ALL_CLASSES as cls (cls)}
          <label class="check"><input type="checkbox" value={cls} bind:group={form.storageClasses} /> <code>{cls}</code></label>
        {/each}
      </fieldset>
      <div class="field narrow">
        <label for="c-default">{t('conn.defaultClass')}</label>
        <select id="c-default" bind:value={form.defaultClass}>
          {#each form.storageClasses as cls (cls)}<option value={cls}>{cls}</option>{/each}
        </select>
      </div>
      <details>
        <summary>{t('conn.cors')}</summary>
        <pre class="mono">{corsRule}</pre>
        <p class="muted">{t('conn.corsLead')}</p>
      </details>
      <div class="row">
        <button class="btn btn-primary" type="submit" disabled={busy}>{busy ? t('conn.adding') : t('conn.addTest')}</button>
        <button class="btn" type="button" onclick={() => (adding = false)}>{t('common.cancel')}</button>
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
  .import {
    margin-top: 14px;
  }
  .steps {
    display: grid;
    gap: 12px;
    padding-left: 20px;
    font-size: 0.88rem;
  }
  .steps pre {
    margin: 8px 0 0;
    font-size: 0.78rem;
  }
  .import p {
    margin: 8px 0;
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

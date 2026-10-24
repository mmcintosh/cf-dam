<script lang="ts">
  /**
   * One storage connection's page (plans/PLAN-ST-v2.md): what cf-dam keeps there, what uses it, uploading from the
   * browser (the CORS rule, and a test), cataloguing what's already in the bucket, the AWS setup, its details to
   * edit, and removing it.
   */
  import { format, t, tHtml } from '@cf-dam/i18n/client'
  import type { MessageKey } from '@cf-dam/i18n'
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'
  import { ALL_CLASSES, PRESETS, serviceOf } from '../lib/storage-presets'

  type Tier = 'nas' | 'hot' | 'warm' | 'cold' | 'deep'
  interface Connection {
    id: string
    name: string
    provider: 'r2-binding' | 's3'
    endpoint: string | null
    region: string | null
    bucket: string | null
    prefix: string
    forcePathStyle: boolean
    storageClasses: string[]
    defaultClass: string
    isDefault: boolean
    accessKeyId: string | null
    authMode: 'binding' | 'access-key' | 'oidc-role' | 'agent'
    roleArn: string | null
    lastTest: { at: string; ok: boolean; message: string | null } | null
  }
  interface Details {
    connection: Connection
    usage: { originals: number; bytes: number; tiers: Partial<Record<Tier, { count: number; bytes: number }>>; restored: number }
    uses: {
      originals: number
      archiveWaiting: number
      archiveFailed: number
      agentUploads: number
      restores: number
      backups: number
      jobArchive: boolean
      backupDestination: boolean
      agents: string[]
      isDefault: boolean
    }
    locked: boolean
    newestBackup: string | null
    jobArchive: { storageClass: string; afterDays: number } | null
    backupHour: number | null
  }
  interface AwsSetup {
    identityProvider: { url: string; audience: string; arn: string }
    roleArn: string
    trustPolicy: unknown
    permissionsPolicy: unknown
  }

  let { id, origin, added = false }: { id: string; origin: string; added?: boolean } = $props()

  let details = $state<Details | null>(null)
  let loadError = $state('')
  const c = $derived(details?.connection)
  const s3 = $derived(c?.provider === 's3')
  const n = (v: number) => format().number(v)
  const bytes = (v: number) => format().bytes(v)
  const when = (iso: string) => format().dateTime(iso)

  async function load() {
    try {
      details = await api<Details>(`/api/connections/${id}/details`)
    } catch (e) {
      loadError = e instanceof Error ? e.message : t('common.couldNotLoad')
    }
  }

  onMount(async () => {
    await load()
    // Just added: show that it works (keys), or open the AWS steps (keyless: nothing works until they're done).
    if (added && details) {
      if (details.connection.authMode === 'oidc-role') void openSetup()
      else void test()
    }
  })

  const KIND: Record<string, MessageKey> = { aws: 'connPage.kindAws', r2: 'connPage.kindR2', b2: 'connPage.kindB2', wasabi: 'connPage.kindWasabi', custom: 'connPage.kindOther' }
  const kind = $derived.by(() => {
    if (!c) return ''
    if (c.provider === 'r2-binding') return t('connPage.kindBuiltIn')
    const service = t(KIND[serviceOf(c.endpoint)]!)
    return c.authMode === 'oidc-role' ? `${service} · ${t('conn.keyless')}` : `${service} · ${t('connPage.withKeys')}`
  })

  const TIERS: Tier[] = ['hot', 'warm', 'cold', 'deep']

  // Test: write, read back and delete a probe.
  let testing = $state(false)
  async function test() {
    testing = true
    try {
      const result = await api<{ ok: boolean; message?: string }>(`/api/connections/${id}/test`, { method: 'POST' })
      if (details) details.connection.lastTest = { at: new Date().toISOString(), ok: result.ok, message: result.message ?? null }
    } catch (e) {
      if (details) details.connection.lastTest = { at: new Date().toISOString(), ok: false, message: e instanceof Error ? e.message : String(e) }
    } finally {
      testing = false
    }
  }

  let actionError = $state('')
  async function makeDefault() {
    actionError = ''
    try {
      await api(`/api/connections/${id}/default`, { method: 'POST' })
      await load()
    } catch (e) {
      actionError = e instanceof Error ? e.message : t('common.couldNotSave')
    }
  }

  // Uploading from the browser: the rule, and a test that sends one byte the way the uploader does.
  const corsRule = $derived(JSON.stringify([{ AllowedOrigins: [origin], AllowedMethods: ['PUT'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }], null, 2))
  let copied = $state('')
  async function copy(label: string, value: unknown) {
    await navigator.clipboard.writeText(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
    copied = label
    setTimeout(() => copied === label && (copied = ''), 1500)
  }
  type BrowserResult = { ok: true } | { ok: false; why: 'cors' | 'csp' | 'etag' | 'http' | 'server'; detail?: string }
  let browser = $state<BrowserResult | 'running' | null>(null)
  async function browserTest() {
    browser = 'running'
    let blocked = false
    const onViolation = () => (blocked = true)
    document.addEventListener('securitypolicyviolation', onViolation)
    let probe: { url: string; headers: Record<string, string>; token: string; uploadId: string } | null = null
    try {
      probe = await api(`/api/connections/${id}/browser-test`, { method: 'POST' })
      let res: Response
      try {
        res = await fetch(probe!.url, { method: 'PUT', headers: probe!.headers, body: new Uint8Array([0]) })
      } catch {
        // A refused CORS request and one the page's own security policy blocked look alike to fetch.
        await new Promise((r) => setTimeout(r, 50))
        browser = { ok: false, why: blocked ? 'csp' : 'cors' }
        return
      }
      if (!res.ok) browser = { ok: false, why: 'http', detail: String(res.status) }
      else if (!res.headers.get('ETag')) browser = { ok: false, why: 'etag' }
      else browser = { ok: true }
    } catch (e) {
      browser = { ok: false, why: 'server', detail: e instanceof Error ? e.message : String(e) }
    } finally {
      document.removeEventListener('securitypolicyviolation', onViolation)
      if (probe) await api(`/api/connections/${id}/browser-test/done`, { method: 'POST', body: JSON.stringify({ token: probe.token, uploadId: probe.uploadId }) }).catch(() => {})
    }
  }
  const BROWSER_FAIL: Record<string, MessageKey> = { cors: 'connPage.browserCors', csp: 'connPage.browserCsp', etag: 'connPage.browserEtag', http: 'connPage.browserHttp', server: 'connPage.browserServer' }

  // AWS setup (keyless).
  let setup = $state<AwsSetup | null>(null)
  let setupOpen = $state(false)
  async function openSetup() {
    setupOpen = true
    setup ??= await api<AwsSetup>(`/api/connections/${id}/aws-setup`)
  }

  // Cataloguing what's already in the bucket, a page of 1,000 at a time.
  let importing = $state({ prefix: '', running: false, imported: 0, skipped: 0, done: false, error: '' })
  async function runImport() {
    Object.assign(importing, { running: true, imported: 0, skipped: 0, done: false, error: '' })
    let cursor: string | null = null
    try {
      do {
        const page: { imported: number; skipped: number; cursor: string | null } = await api(`/api/connections/${id}/import`, {
          method: 'POST',
          body: JSON.stringify({ prefix: importing.prefix || undefined, cursor: cursor ?? undefined }),
        })
        importing.imported += page.imported
        importing.skipped += page.skipped
        cursor = page.cursor
      } while (cursor)
      importing.done = true
    } catch (e) {
      importing.error = e instanceof Error ? e.message : t('conn.importStopped')
    } finally {
      importing.running = false
    }
  }

  // Details to edit. The bucket's own fields only while nothing is kept there or uses it.
  let editing = $state(false)
  let draft = $state({ name: '', region: '', bucket: '', prefix: '', endpoint: '', forcePathStyle: false, roleArn: '', accessKeyId: '', secretAccessKey: '', storageClasses: [] as string[], defaultClass: 'STANDARD' })
  let saving = $state(false)
  let editError = $state('')
  function startEdit() {
    if (!c) return
    draft = {
      name: c.name,
      region: c.region ?? '',
      bucket: c.bucket ?? '',
      prefix: c.prefix,
      endpoint: c.endpoint ?? '',
      forcePathStyle: c.forcePathStyle,
      roleArn: c.roleArn ?? '',
      accessKeyId: c.accessKeyId ?? '',
      secretAccessKey: '',
      storageClasses: [...c.storageClasses],
      defaultClass: c.defaultClass,
    }
    editError = ''
    editing = true
  }
  async function saveEdit(event: SubmitEvent) {
    event.preventDefault()
    if (!c || !details) return
    saving = true
    editError = ''
    const patch: Record<string, unknown> = { name: draft.name, storageClasses: draft.storageClasses, defaultClass: draft.defaultClass }
    if (s3 && !details.locked) Object.assign(patch, { bucket: draft.bucket, region: draft.region, prefix: draft.prefix })
    if (s3 && !details.locked && c.authMode === 'access-key') Object.assign(patch, { endpoint: draft.endpoint, forcePathStyle: draft.forcePathStyle })
    if (c.authMode === 'oidc-role' && draft.roleArn !== c.roleArn) patch.roleArn = draft.roleArn
    if (c.authMode === 'access-key' && draft.accessKeyId !== c.accessKeyId) patch.accessKeyId = draft.accessKeyId
    if (c.authMode === 'access-key' && draft.secretAccessKey) patch.secretAccessKey = draft.secretAccessKey
    try {
      await api(`/api/connections/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      draft.secretAccessKey = ''
      editing = false
      await load()
      // New credentials or a new place: show at once whether they work.
      if (s3 && ['roleArn', 'accessKeyId', 'secretAccessKey', 'bucket', 'region', 'endpoint', 'prefix'].some((k) => k in patch)) void test()
    } catch (e) {
      editError = e instanceof Error ? e.message : t('common.couldNotSave')
    } finally {
      saving = false
    }
  }

  let removeError = $state('')
  async function remove() {
    if (!c || !confirm(t('conn.removeConfirm', { name: c.name }))) return
    removeError = ''
    try {
      await api(`/api/connections/${id}`, { method: 'DELETE' })
      location.href = '/settings/storage'
    } catch (e) {
      removeError = e instanceof Error ? e.message : t('conn.removeFailed')
    }
  }

  /** What stops removal, in words. */
  const blockers = $derived.by(() => {
    if (!details) return []
    const u = details.uses
    const out: string[] = []
    if (u.originals > 0) out.push(t('connPage.blockOriginals', { count: n(u.originals) }))
    if (u.archiveWaiting > 0) out.push(t('connPage.blockArchive', { count: n(u.archiveWaiting) }))
    if (u.agentUploads > 0) out.push(t('connPage.blockAgentUploads', { count: n(u.agentUploads) }))
    if (u.restores > 0) out.push(t('connPage.blockRestores', { count: n(u.restores) }))
    if (u.backups > 0) out.push(t('connPage.blockBackups', { count: n(u.backups) }))
    if (u.jobArchive) out.push(t('connPage.blockJobArchive'))
    if (u.backupDestination) out.push(t('connPage.blockBackupDestination'))
    for (const agent of u.agents) out.push(t('connPage.blockAgent', { name: agent }))
    return out
  })
</script>

{#if loadError}
  <div class="alert alert-error" role="alert">{loadError}</div>
{:else if !details || !c}
  <p class="muted">{t('common.loading')}</p>
{:else}
  <div class="stack page">
    <section class="card stack">
      <div class="row top">
        <div>
          <p class="kind">{kind} {#if c.isDefault}<span class="badge badge-accent">{t('conn.default')}</span>{/if}</p>
          {#if s3}<p class="muted where"><code>{c.bucket}</code>{c.prefix ? ` / ${c.prefix}` : ''} · {c.region}</p>{/if}
        </div>
        <div class="row actions">
          <button class="btn btn-sm" onclick={test} disabled={testing}>{testing ? t('conn.testing') : t('conn.test')}</button>
          {#if !c.isDefault}<button class="btn btn-sm" onclick={makeDefault}>{t('conn.makeDefault')}</button>{/if}
        </div>
      </div>
      {#if c.lastTest}
        <div class="alert" class:alert-success={c.lastTest.ok} class:alert-error={!c.lastTest.ok} role="status">
          {c.lastTest.ok ? t('connPage.testedOk', { date: when(c.lastTest.at) }) : t('connPage.testedBad', { date: when(c.lastTest.at), message: c.lastTest.message ?? '' })}
        </div>
      {:else if s3}
        <p class="muted small">{t('connPage.neverTested')}</p>
      {/if}
      {#if actionError}<div class="alert alert-error" role="alert">{actionError}</div>{/if}
    </section>

    <section class="card stack">
      <h2>{t('connPage.onIt')}</h2>
      {#if details.usage.originals === 0}
        <p class="muted">{t('connPage.empty')}</p>
      {:else}
        <p class="big"><strong>{n(details.usage.originals)}</strong> {t('connPage.originals')} · <strong>{bytes(details.usage.bytes)}</strong></p>
        <ul class="tiers">
          {#each TIERS as tier (tier)}
            {@const row = details.usage.tiers[tier]}
            {#if row}
              <li><a href={`/?on=${c.id}&tier=${tier}`}>{t(`facets.tier.${tier}` as MessageKey)}</a> <span class="muted">{n(row.count)} · {bytes(row.bytes)}</span></li>
            {/if}
          {/each}
        </ul>
        {#if details.usage.restored > 0}<p class="muted small">{t('connPage.restored', { count: n(details.usage.restored) })}</p>{/if}
        <p><a href={`/?on=${c.id}`}>{t('connPage.showInLibrary')}</a></p>
      {/if}
      {#if details.uses.archiveWaiting > 0 || details.uses.archiveFailed > 0}
        <p class="muted small">{t('connPage.archiveItems', { waiting: n(details.uses.archiveWaiting), failed: n(details.uses.archiveFailed) })}</p>
      {/if}
      {#if details.uses.backups > 0}
        <p class="muted small">{t('connPage.backupsKept', { count: n(details.uses.backups), date: details.newestBackup ? when(details.newestBackup) : '—' })}</p>
      {/if}
      {#if s3}<p class="muted small">{t('connPage.fromCatalogue')}</p>{/if}
    </section>

    <section class="card stack">
      <h2>{t('connPage.usedFor')}</h2>
      <ul class="uses">
        {#if c.isDefault}<li>{t('connPage.useDefault')}</li>{:else}<li class="muted">{t('connPage.usePickable')}</li>{/if}
        {#if details.jobArchive}<li>{t('connPage.useJobArchive', { class: t(`storageClass.${details.jobArchive.storageClass}` as MessageKey), days: details.jobArchive.afterDays })} <a href="/settings/storage#archive-jobs">{t('connPage.change')}</a></li>{/if}
        {#if details.backupHour !== null}<li>{t('connPage.useBackups', { hour: `${String(details.backupHour).padStart(2, '0')}:00` })} <a href="/settings/storage#backups">{t('connPage.change')}</a></li>{/if}
        {#each details.uses.agents as agent (agent)}<li>{t('connPage.useAgent', { name: agent })} <a href="/sources">{t('connPage.change')}</a></li>{/each}
      </ul>
      {#if s3 && !details.jobArchive && details.backupHour === null && details.uses.agents.length === 0}
        <p class="muted small">{t('connPage.useHow')}</p>
      {/if}
    </section>

    {#if s3}
      <section class="card stack">
        <h2>{t('connPage.browserTitle')}</h2>
        <p class="muted">{t('connPage.browserLead')}</p>
        <p class="muted">{@html tHtml('connPage.browserWhere')}</p>
        <div class="rule">
          <button class="btn btn-sm" onclick={() => copy('cors', corsRule)}>{copied === 'cors' ? t('share.copied') : t('common.copy')}</button>
          <pre class="mono">{corsRule}</pre>
        </div>
        <div class="row">
          <button class="btn" onclick={browserTest} disabled={browser === 'running'}>{browser === 'running' ? t('conn.testing') : t('connPage.browserTest')}</button>
        </div>
        {#if browser && browser !== 'running'}
          {#if browser.ok}
            <div class="alert alert-success" role="status">{t('connPage.browserOk')}</div>
          {:else}
            <div class="alert alert-error" role="alert">{t(BROWSER_FAIL[browser.why]!, { detail: browser.detail ?? '' })}</div>
          {/if}
        {/if}
      </section>

      <section class="card stack">
        <h2>{t('conn.catalogue')}</h2>
        <p class="muted">{t('conn.catalogueLead')}</p>
        <div class="row">
          <input type="text" placeholder={t('conn.importFrom')} bind:value={importing.prefix} style="flex: 1" aria-label={t('conn.importFolder')} />
          <button class="btn" onclick={runImport} disabled={importing.running}>{importing.running ? t('conn.importing') : t('conn.import')}</button>
        </div>
        {#if importing.running || importing.done}
          <p class="muted">{t(importing.done ? 'conn.progressDone' : 'conn.progress', { files: t('conn.newFiles', { count: importing.imported }), skipped: importing.skipped })}</p>
        {/if}
        {#if importing.error}<div class="alert alert-error">{importing.error}</div>{/if}
      </section>
    {/if}

    {#if c.authMode === 'oidc-role'}
      <section class="card stack">
        <details open={setupOpen} ontoggle={(e) => e.currentTarget.open && openSetup()}>
          <summary>{t('conn.awsSetup')}</summary>
          {#if setup}
            <ol class="steps">
              <li>{@html tHtml('conn.step1', { url: setup.identityProvider.url, audience: setup.identityProvider.audience })}</li>
              <li>
                {@html tHtml('conn.step2', { role: setup.roleArn })}
                <button class="btn btn-sm" onclick={() => copy('trust', setup!.trustPolicy)}>{copied === 'trust' ? t('share.copied') : t('common.copy')}</button>
                <pre class="mono">{JSON.stringify(setup.trustPolicy, null, 2)}</pre>
              </li>
              <li>
                {t('conn.step3')}
                <button class="btn btn-sm" onclick={() => copy('perm', setup!.permissionsPolicy)}>{copied === 'perm' ? t('share.copied') : t('common.copy')}</button>
                <pre class="mono">{JSON.stringify(setup.permissionsPolicy, null, 2)}</pre>
              </li>
              <li>{@html tHtml('conn.step4')}</li>
            </ol>
          {:else}
            <p class="muted">{t('common.loading')}</p>
          {/if}
        </details>
      </section>
    {/if}

    {#if s3}
      <section class="card stack">
        <div class="row top">
          <h2>{t('connPage.details')}</h2>
          {#if !editing}<button class="btn btn-sm" onclick={startEdit}>{t('connPage.edit')}</button>{/if}
        </div>
        {#if !editing}
          <dl class="facts">
            <dt>{t('conn.name')}</dt><dd>{c.name}</dd>
            <dt>{t('conn.bucket')}</dt><dd><code>{c.bucket}</code></dd>
            <dt>{t('conn.prefix')}</dt><dd>{c.prefix ? c.prefix : '—'}</dd>
            <dt>{t('conn.region')}</dt><dd>{c.region}</dd>
            {#if c.authMode === 'oidc-role'}<dt>{t('conn.roleArn')}</dt><dd><code>{c.roleArn}</code></dd>{:else}<dt>{t('conn.endpoint')}</dt><dd>{c.endpoint}</dd><dt>{t('conn.accessKeyId')}</dt><dd><code>{c.accessKeyId}</code></dd>{/if}
            <dt>{t('conn.classes')}</dt><dd class="classes">{#each c.storageClasses as cls (cls)}<span class="badge" class:badge-accent={cls === c.defaultClass}>{cls}</span>{/each}</dd>
          </dl>
        {:else}
          <form class="stack" onsubmit={saveEdit}>
            <div class="grid">
              <div class="field"><label for="e-name">{t('conn.name')}</label><input id="e-name" type="text" required bind:value={draft.name} /></div>
              <div class="field"><label for="e-bucket">{t('conn.bucket')}</label><input id="e-bucket" type="text" required disabled={details.locked} bind:value={draft.bucket} /></div>
              <div class="field"><label for="e-region">{t('conn.region')}</label><input id="e-region" type="text" required disabled={details.locked} bind:value={draft.region} /></div>
              <div class="field"><label for="e-prefix">{t('conn.prefix')}</label><input id="e-prefix" type="text" disabled={details.locked} bind:value={draft.prefix} /></div>
              {#if c.authMode === 'oidc-role'}
                <div class="field wide"><label for="e-role">{t('conn.roleArn')}</label><input id="e-role" type="text" required bind:value={draft.roleArn} /></div>
              {:else}
                <div class="field wide"><label for="e-endpoint">{t('conn.endpoint')}</label><input id="e-endpoint" type="text" required disabled={details.locked} bind:value={draft.endpoint} /></div>
                <div class="field"><label for="e-key">{t('conn.accessKeyId')}</label><input id="e-key" type="text" autocomplete="off" required bind:value={draft.accessKeyId} /></div>
                <div class="field"><label for="e-secret">{t('conn.secret')}</label><input id="e-secret" type="password" autocomplete="off" placeholder={t('connPage.secretUnchanged')} bind:value={draft.secretAccessKey} /></div>
              {/if}
            </div>
            {#if details.locked}<p class="muted small">{t('connPage.locked')}</p>{/if}
            {#if c.authMode === 'access-key'}<label class="check"><input type="checkbox" disabled={details.locked} bind:checked={draft.forcePathStyle} /> {t('conn.pathStyle')}</label>{/if}
            <fieldset class="classes-pick">
              <legend class="label">{t('conn.classes')}</legend>
              {#each serviceOf(c.endpoint) === 'aws' ? ALL_CLASSES : PRESETS[serviceOf(c.endpoint)].classes as cls (cls)}
                <label class="check"><input type="checkbox" value={cls} bind:group={draft.storageClasses} /> <code>{cls}</code></label>
              {/each}
            </fieldset>
            <div class="field narrow">
              <label for="e-default">{t('conn.defaultClass')}</label>
              <select id="e-default" bind:value={draft.defaultClass}>
                {#each draft.storageClasses as cls (cls)}<option value={cls}>{cls}</option>{/each}
              </select>
            </div>
            {#if editError}<div class="alert alert-error" role="alert">{editError}</div>{/if}
            <div class="row">
              <button class="btn btn-primary" type="submit" disabled={saving}>{t('common.save')}</button>
              <button class="btn" type="button" onclick={() => (editing = false)}>{t('common.cancel')}</button>
            </div>
          </form>
        {/if}
      </section>

      <section class="card stack">
        <h2>{t('connPage.removeTitle')}</h2>
        {#if blockers.length > 0}
          <p class="muted">{t('connPage.cantRemove')}</p>
          <ul class="uses">{#each blockers as b (b)}<li>{b}</li>{/each}</ul>
        {:else}
          <p class="muted">{t('connPage.canRemove')}</p>
          <div><button class="btn btn-danger" onclick={remove}>{t('common.remove')}</button></div>
        {/if}
        {#if removeError}<div class="alert alert-error" role="alert">{removeError}</div>{/if}
      </section>
    {/if}
  </div>
{/if}

<style>
  .page {
    max-width: 860px;
  }
  h2 {
    font-size: 1.05rem;
    margin: 0;
  }
  p {
    margin: 0;
  }
  .top {
    justify-content: space-between;
    align-items: flex-start;
  }
  .actions {
    flex: none;
  }
  .kind {
    font-weight: 600;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .where {
    margin-top: 4px;
    font-size: 0.88rem;
    overflow-wrap: anywhere;
  }
  .small {
    font-size: 0.85rem;
  }
  .big {
    font-size: 1.1rem;
  }
  .tiers,
  .uses {
    margin: 0;
    padding-left: 20px;
    display: grid;
    gap: 6px;
  }
  .rule {
    position: relative;
  }
  .rule .btn {
    position: absolute;
    top: 8px;
    right: 8px;
  }
  pre {
    margin: 0;
    padding: 12px;
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    overflow-x: auto;
    font-size: 0.8rem;
  }
  .steps {
    display: grid;
    gap: 12px;
    padding-left: 20px;
    font-size: 0.88rem;
  }
  .steps pre {
    margin-top: 8px;
  }
  details summary {
    cursor: pointer;
    color: var(--accent);
    font-size: 0.95rem;
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 16px;
    margin: 0;
    font-size: 0.9rem;
  }
  .facts dt {
    color: var(--text-muted);
  }
  .facts dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .classes {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
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
  @media (max-width: 640px) {
    .top {
      flex-direction: column;
    }
  }
</style>

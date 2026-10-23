<script lang="ts">
  import { format, t, tHtml } from '@cf-dam/i18n/client'
  /** Computers and NAS: add a helper (compose file or installer, then a pairing code), see what each is doing, choose its folders. */
  import { onMount } from 'svelte'
  import { api } from '../lib/auth-client'
  import ArchivePanel, { type ArchiveProgress, type ArchiveSettings } from './ArchivePanel.svelte'

  interface Root {
    id: string
    path: string
    label: string | null
    exclude: string[]
    enabled: boolean
    firstScanDone: boolean
    lastScanAt: string | null
    volume: { id: string; label: string | null; path: string | null } | null
    offlineSince: string | null
  }
  interface Source {
    id: string
    name: string
    platform: string | null
    version: string | null
    lastSeenAt: string | null
    online: boolean
    paused: boolean
    revoked: boolean
    /** Back from a backup without its key: waiting for its agent to pair again. */
    waiting: boolean
    status: { phase?: string; current?: string | null; found?: number; queued?: number; sent?: number; failed?: number; missing?: number; lastError?: string | null; root?: string | null; archive?: ArchiveProgress; previewsLater?: number }
    archive: ArchiveSettings
    folders: string[]
    volumes: { id: string; label: string | null; path: string; removable: boolean }[]
    roots: Root[]
    photos: { total: number; missing: number; processing: number }
  }

  let { initialCode = null }: { initialCode?: string | null } = $props()

  let sources = $state<Source[]>([])
  let connections = $state<{ id: string; name: string; provider: string; storageClasses: string[]; defaultClass: string }[]>([])
  let loaded = $state(false)
  let adding = $state(false)
  /** Where the new helper runs: the steps differ, the pairing code doesn't. */
  let kind = $state<'nas' | 'mac' | 'windows'>('nas')
  let origin = $state('https://your-cf-dam')
  /** Which NAS: the compose file's example paths and where it's pasted differ. */
  const NAS = [
    ['synology', 'Synology'],
    ['qnap', 'QNAP'],
    ['ugreen', 'UGREEN'],
    ['terramaster', 'TerraMaster'],
    ['asustor', 'Asustor'],
    ['truenas', 'TrueNAS'],
    ['unraid', 'Unraid'],
    ['omv', 'OpenMediaVault'],
    ['linux', 'Another Linux computer with Docker'],
  ] as const
  let nas = $state<(typeof NAS)[number][0]>('synology')
  let composes = $state<Record<string, string>>({})
  const compose = $derived(composes[nas] ?? '')
  const image = $derived(compose.match(/image: (\S+)/)?.[1] ?? 'ghcr.io/mmcintosh/cf-dam-agent')
  let copied = $state(false)
  let code = $state(initialCode ?? '')
  interface Waiting {
    id: string
    name: string
    platform: string | null
  }
  let pending = $state<{ name: string; platform: string | null; previous: Waiting | null; reconnectable: Waiting[] } | null>(null)
  let agentName = $state('')
  /** '' for a new agent, else the entry it gets back. */
  let reconnectTo = $state('')
  let error = $state('')
  let newFolder = $state<Record<string, string>>({})
  // Disconnect and Remove ask for a second click, which lapses after a few seconds or when the button
  // loses focus. Keys: `revoke:<source id>`, `remove:<root id>`.
  let confirming = $state<string | null>(null)
  let lapse: ReturnType<typeof setTimeout> | undefined
  function arm(key: string | null) {
    clearTimeout(lapse)
    confirming = key
    if (key) lapse = setTimeout(() => (confirming = null), 4000)
  }
  const disarm = (key: string) => confirming === key && arm(null)

  const failed = (e: unknown, what: string) => (error = t('sources.failed', { what, why: e instanceof Error ? e.message : t('common.tryAgain') }))

  async function load() {
    sources = (await api<{ sources: Source[] }>('/api/sources')).sources
    loaded = true
  }

  onMount(() => {
    origin = window.location.origin
    kind = /Mac/.test(navigator.platform) ? 'mac' : /Win/.test(navigator.platform) ? 'windows' : 'nas'
    load().catch((e) => failed(e, t('sources.loadFailed')))
    api<{ connections: typeof connections }>('/api/connections').then((r) => (connections = r.connections)).catch(() => {})
    if (initialCode) void startAdding().then(lookUp)
    const timer = setInterval(() => void load().catch(() => {}), 10_000)
    return () => clearInterval(timer)
  })

  async function loadCompose(which: string) {
    if (composes[which]) return
    const res = await fetch(`/api/sources/compose?nas=${which}`)
    if (res.ok) composes[which] = await res.text()
    else error = t('sources.composeFailed', { status: String(res.status) })
  }

  async function startAdding() {
    adding = true
    await loadCompose(nas)
  }

  async function copyCompose() {
    try {
      await navigator.clipboard.writeText(compose)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {
      error = t('sources.copyFailed')
    }
  }

  async function lookUp() {
    error = ''
    pending = null
    const clean = code.trim()
    if (clean.replace(/[^A-Za-z0-9]/g, '').length !== 8) return
    try {
      pending = await api<NonNullable<typeof pending>>(`/api/sources/pair/${encodeURIComponent(clean)}`)
      agentName = pending.name
      reconnectTo = pending.previous?.id ?? ''
    } catch (e) {
      error = e instanceof Error ? e.message : t('sources.codeUnknown')
    }
  }

  async function approve() {
    error = ''
    try {
      await api('/api/sources/pair', { method: 'POST', body: JSON.stringify({ code, name: agentName, sourceId: reconnectTo || undefined }) })
      adding = false
      pending = null
      code = ''
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : t('sources.connectFailed')
    }
  }

  /** A change to an agent. On failure the page shows what the server has, and why. */
  async function update(s: Source, patch: Record<string, unknown>, input?: HTMLInputElement) {
    error = ''
    try {
      await api(`/api/sources/${s.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
    } catch (e) {
      if (input) input.value = s.name
      failed(e, t('sources.notChanged', { name: s.name }))
    }
    await load().catch(() => {})
  }

  async function rescan(s: Source) {
    error = ''
    try {
      await api(`/api/sources/${s.id}/rescan`, { method: 'POST' })
    } catch (e) {
      failed(e, t('sources.scanFailed', { name: s.name }))
    }
  }

  async function revoke(s: Source) {
    if (confirming !== `revoke:${s.id}`) return arm(`revoke:${s.id}`)
    arm(null)
    error = ''
    try {
      await api(`/api/sources/${s.id}`, { method: 'DELETE' })
    } catch (e) {
      failed(e, t('sources.notDisconnected', { name: s.name }))
    }
    await load().catch(() => {})
  }

  async function addFolder(s: Source) {
    const path = newFolder[s.id]
    if (!path) return
    error = ''
    try {
      await api(`/api/sources/${s.id}/roots`, { method: 'POST', body: JSON.stringify({ path }) })
      newFolder[s.id] = ''
    } catch (e) {
      error = e instanceof Error ? e.message : t('sources.addFolderFailed')
      return
    }
    await rescan(s)
    await load().catch(() => {})
  }

  /** A change to a folder. On failure its controls go back to what the server has. */
  async function updateRoot(s: Source, r: Root, patch: Record<string, unknown>, input: HTMLInputElement) {
    error = ''
    try {
      await api(`/api/sources/${s.id}/roots/${r.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
    } catch (e) {
      if (input.type === 'checkbox') input.checked = r.enabled
      else input.value = r.exclude.join(', ')
      failed(e, t('sources.folderNotChanged', { path: r.path }))
    }
    await load().catch(() => {})
  }

  async function removeRoot(s: Source, r: Root) {
    if (confirming !== `remove:${r.id}`) return arm(`remove:${r.id}`)
    arm(null)
    error = ''
    try {
      await api(`/api/sources/${s.id}/roots/${r.id}`, { method: 'DELETE' })
    } catch (e) {
      failed(e, t('sources.stillIndexed', { path: r.path }))
    }
    await load().catch(() => {})
  }

  /** Folders the agent can see that aren't indexed, inside, or around an indexed one. */
  const offered = (s: Source) => s.folders.filter((f) => !s.roots.some((r) => f === r.path || f.startsWith(`${r.path}/`) || r.path.startsWith(`${f}/`)))
  const ago = (iso: string | null) => {
    if (!iso) return t('sources.never')
    const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
    return s < 90 ? t('sources.justNow') : format().relative(iso)
  }
  const n = (v: number | undefined) => format().number(v ?? 0)
</script>

<div class="stack sources">
  {#if !adding}
    <div><button class="btn btn-primary" type="button" onclick={startAdding}>{t('sources.add')}</button></div>
  {:else}
    <section class="card stack add">
      <header class="row"><h2>{t('sources.add')}</h2><span class="spacer"></span><button class="btn btn-sm" type="button" onclick={() => (adding = false)}>{t('common.close')}</button></header>
      <div class="kinds" role="tablist" aria-label={t('sources.whereRuns')}>
        {#each [['nas', t('sources.kind.nas')], ['mac', t('sources.kind.mac')], ['windows', t('sources.kind.windows')]] as [k, label] (k)}
          <button class="btn btn-sm" class:btn-primary={kind === k} type="button" role="tab" aria-selected={kind === k} onclick={() => (kind = k as typeof kind)}>{label}</button>
        {/each}
      </div>
      <ol class="steps">
        {#if kind === 'nas'}
          <li>
            <strong>{t('sources.whichNas')}</strong>
            <select bind:value={nas} onchange={() => loadCompose(nas)} aria-label={t('sources.whichNasLabel')}>
              {#each NAS as [k, label] (k)}<option value={k}>{k === 'linux' ? t('sources.otherLinux') : label}</option>{/each}
            </select>
            <p class="muted small">
              {t('sources.anyNas')}
            </p>
          </li>
          <li>
            {#if nas === 'synology'}
              {@html tHtml('sources.steps.synology')}
            {:else if nas === 'qnap'}
              {@html tHtml('sources.steps.qnap')}
            {:else if nas === 'ugreen'}
              {@html tHtml('sources.steps.ugreen')}
            {:else if nas === 'terramaster'}
              {@html tHtml('sources.steps.terramaster')}
            {:else if nas === 'asustor'}
              {@html tHtml('sources.steps.asustor')}
            {:else if nas === 'truenas'}
              {@html tHtml('sources.steps.truenas')}
            {:else if nas === 'unraid'}
              {@html tHtml('sources.steps.unraid', { image, origin })}
            {:else if nas === 'omv'}
              {@html tHtml('sources.steps.omv')}
            {:else}
              {@html tHtml('sources.steps.linux')}
            {/if}
            <div class="compose">
              <pre>{compose}</pre>
              <button class="btn btn-sm" type="button" onclick={copyCompose}>{copied ? t('share.copied') : t('common.copy')}</button>
            </div>
            <p class="muted small">
              {@html tHtml('sources.pasteAsIs')}
            </p>
          </li>
          <li>
            {@html tHtml('sources.startIt')}
          </li>
        {:else}
          <li>
            {@html tHtml('sources.installNode')}
          </li>
          {#if kind === 'mac'}
            <li>
              {@html tHtml('sources.unzipMac')}
              <div class="compose"><pre>./install-macos.sh {origin}</pre></div>
              <p class="muted small">
                {@html tHtml('sources.macNote')}
              </p>
            </li>
          {:else}
            <li>
              {@html tHtml('sources.unzipWindows')}
              <div class="compose"><pre>powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Url {origin}</pre></div>
              <p class="muted small">{t('sources.windowsNote')}</p>
            </li>
          {/if}
          <li>
            {@html tHtml('sources.openLocal')}
          </li>
        {/if}
        <li>
          <strong>{t('sources.enterCode')}</strong>
          <div class="row code-row">
            <input type="text" bind:value={code} placeholder="ABCD-EFGH" maxlength="9" oninput={lookUp} aria-label={t('sources.pairingCode')} class="code" />
            {#if pending}
              {#if pending.reconnectable.length > 0}
                <select bind:value={reconnectTo} aria-label={t('sources.connectAs')}>
                  <option value="">{t('sources.asNew')}</option>
                  {#each pending.reconnectable as w (w.id)}<option value={w.id}>{t('sources.asAgain', { name: w.name })}{w.platform ? ` (${w.platform})` : ''}</option>{/each}
                </select>
              {/if}
              {#if !reconnectTo}<input type="text" bind:value={agentName} maxlength="80" aria-label={t('sources.agentName')} />{/if}
              <button class="btn btn-primary" type="button" onclick={approve}>{t('sources.connect')}</button>
            {/if}
          </div>
          {#if pending && reconnectTo}
            <p class="muted small">{pending.previous?.id === reconnectTo ? t('sources.getsBackOwn') : t('sources.getsBack')}</p>
          {/if}
          {#if pending}<p class="muted small">{pending.platform ? t('sources.waitingAgentOn', { name: pending.name, platform: pending.platform }) : t('sources.waitingAgent', { name: pending.name })}</p>{/if}
        </li>
      </ol>
      {#if error}<div class="alert alert-error">{error}</div>{/if}
    </section>
  {/if}

  {#if loaded && sources.length === 0 && !adding}
    <section class="card empty">
      <p>{t('sources.none')}</p>
    </section>
  {/if}

  {#each sources as s (s.id)}
    <section class="card stack agent" class:revoked={s.revoked}>
      <header class="row">
        <span class="dot" class:on={s.online && !s.paused} class:paused={s.paused} title={s.online ? t('sources.online') : t('sources.offline')}></span>
        <input class="name" type="text" value={s.name} disabled={s.revoked} onchange={(e) => update(s, { name: e.currentTarget.value }, e.currentTarget)} aria-label={t('sources.agentName')} />
        <span class="muted small">{s.revoked ? t('sources.disconnected') : s.paused ? t('sources.paused') : s.online ? (s.status.phase === 'scanning' ? t('sources.scanning') : t('sources.online')) : t('sources.lastSeen', { when: ago(s.lastSeenAt) })}{s.version ? ` · v${s.version}` : ''}{s.platform ? ` · ${s.platform}` : ''}</span>
        <span class="spacer"></span>
        {#if !s.revoked}
          <button class="btn btn-sm" type="button" onclick={() => rescan(s)} disabled={s.paused}>{t('sources.scanNow')}</button>
          <button class="btn btn-sm" type="button" onclick={() => update(s, { paused: !s.paused })}>{s.paused ? t('sources.resume') : t('sources.pause')}</button>
          <button
            class="btn btn-sm btn-danger"
            type="button"
            onclick={() => revoke(s)}
            onblur={() => disarm(`revoke:${s.id}`)}
            title={t('sources.disconnectTitle')}
          >
            {confirming === `revoke:${s.id}` ? t('people.deleteConfirm') : t('sources.disconnect')}
          </button>
        {/if}
      </header>

      <div class="numbers">
        <a href={`/?on=${encodeURIComponent(`nas-${s.id}`)}`}><strong>{n(s.photos.total)}</strong><span class="muted">{t('sources.photos')}</span></a>
        <a href={`/?on=${encodeURIComponent(`nas-${s.id}`)}&missing=1`}><strong>{n(s.photos.missing)}</strong><span class="muted">{t('sources.missing')}</span></a>
        {#if s.status.phase === 'scanning'}
          <div><strong>{n(s.status.sent)} / {n(s.status.queued)}</strong><span class="muted">{s.status.failed ? t('sources.thisScanFailed', { count: s.status.failed }) : t('sources.thisScan')}</span></div>
        {/if}
        {#if s.status.previewsLater}
          <div title={t('sources.previewsLaterTitle')}>
            <strong>{n(s.status.previewsLater)}</strong><span class="muted">{t('sources.previewsLater')}</span>
          </div>
        {/if}
      </div>
      {#if s.status.phase === 'scanning' && s.status.current}<p class="muted small current">{t('sources.now', { item: s.status.current })}</p>{/if}
      {#if s.waiting}
        <p class="alert">
          {t('sources.restoredWaiting', { name: s.name })}
        </p>
      {/if}
      {#if s.status.lastError}<p class="muted small">{t('sources.lastProblem', { error: s.status.lastError })}</p>{/if}

      {#if !s.revoked}
        <div class="folders">
          <h3>{t('sources.folders')}</h3>
          {#if s.roots.length === 0}<p class="muted small">{t('sources.noFolders')}</p>{/if}
          {#each s.roots as r (r.id)}
            <div class="root row">
              <input type="checkbox" checked={r.enabled} onchange={(e) => updateRoot(s, r, { enabled: e.currentTarget.checked }, e.currentTarget)} aria-label={t('sources.indexPath', { path: r.path })} />
              <code>{r.path}</code>
              {#if r.volume}<span class="pill">Drive: {r.volume.label ?? 'unnamed'}</span>{/if}
              {#if r.offlineSince}<span class="pill offline" title={t('sources.offlineTitle')}>{t('sources.offlineSince', { when: ago(r.offlineSince) })}</span>{/if}
              <span class="muted small">{r.lastScanAt ? t('sources.scanned', { when: ago(r.lastScanAt) }) : t('sources.firstScanPending')}</span>
              <span class="spacer"></span>
              <input
                class="globs"
                type="text"
                value={r.exclude.join(', ')}
                placeholder={t('sources.skipPlaceholder')}
                aria-label={t('sources.skipLabel')}
                onchange={(e) => updateRoot(s, r, { exclude: e.currentTarget.value.split(',').map((g) => g.trim()).filter(Boolean) }, e.currentTarget)}
              />
              <button class="btn btn-sm" type="button" onclick={() => removeRoot(s, r)} onblur={() => disarm(`remove:${r.id}`)}>{confirming === `remove:${r.id}` ? t('sources.clickStop') : t('common.remove')}</button>
            </div>
          {/each}
          <div class="row">
            {#if offered(s).length > 0}
              <select bind:value={newFolder[s.id]} aria-label={t('sources.folderToIndex')}>
                <option value="">{t('sources.chooseFolder')}</option>
                {#each offered(s) as f (f)}
                  {@const drive = s.volumes.find((v) => v.path === f)}
                  <option value={f}>{drive ? `${drive.label ?? t('sources.drive')} (${f})${drive.removable ? ` · ${t('sources.removable')}` : ''}` : f}</option>
                {/each}
              </select>
            {:else}
              <input type="text" bind:value={newFolder[s.id]} placeholder="/photos/photo" aria-label={t('sources.folderToIndex')} />
            {/if}
            <button class="btn btn-sm" type="button" onclick={() => addFolder(s)} disabled={!newFolder[s.id]}>{t('sources.indexThis')}</button>
          </div>
          <p class="muted small">{t('sources.alwaysSkipped')}</p>
        </div>
        <ArchivePanel sourceId={s.id} settings={s.archive ?? {}} progress={s.status.archive} {connections} onchange={() => void load()} />
      {/if}
    </section>
  {/each}
  {#if error && !adding}<div class="alert alert-error">{error}</div>{/if}
</div>

<style>
  .sources {
    max-width: 980px;
  }
  .spacer {
    flex: 1;
  }
  .small {
    font-size: 0.8rem;
  }
  .steps {
    margin: 0;
    padding-left: 20px;
    display: grid;
    gap: 14px;
  }
  .compose {
    position: relative;
    margin: 8px 0;
  }
  .compose pre {
    margin: 0;
    padding: 12px;
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    font-size: 0.78rem;
    overflow-x: auto;
  }
  .compose button {
    position: absolute;
    top: 8px;
    right: 8px;
  }
  .kinds {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .code-row {
    gap: 8px;
    margin-top: 8px;
    flex-wrap: wrap;
  }
  .code {
    width: 140px;
    font-family: var(--mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .agent header {
    gap: 10px;
    flex-wrap: wrap;
  }
  .agent.revoked {
    opacity: 0.6;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-faint);
  }
  .dot.on {
    background: var(--success);
    box-shadow: 0 0 8px var(--success);
  }
  .dot.paused {
    background: var(--warning);
  }
  .name {
    font-weight: 650;
    font-size: 1.05rem;
    width: auto;
    min-width: 0;
    max-width: 260px;
    padding: 4px 8px;
    background: transparent;
    border-color: transparent;
  }
  .name:hover:not(:disabled),
  .name:focus {
    border-color: var(--border-strong);
  }
  .numbers {
    display: flex;
    gap: 28px;
    flex-wrap: wrap;
  }
  .numbers > * {
    display: grid;
    color: var(--text);
  }
  .numbers a:hover {
    text-decoration: none;
  }
  .numbers strong {
    font-size: 1.4rem;
  }
  .numbers span {
    font-size: 0.8rem;
  }
  .current {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .folders h3 {
    margin: 0 0 8px;
    font-size: 0.9rem;
  }
  .root {
    gap: 10px;
    padding: 6px 0;
    border-top: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .root code {
    font-size: 0.85rem;
  }
  .pill {
    font-size: 0.72rem;
    padding: 1px 8px;
    border-radius: 99px;
    background: var(--surface-strong);
    color: var(--text-muted);
  }
  .pill.offline {
    background: color-mix(in srgb, var(--warning) 22%, transparent);
    color: var(--text);
  }
  .globs {
    width: 240px;
    padding: 4px 8px;
    font-size: 0.82rem;
  }
  .folders .row {
    gap: 8px;
    margin-top: 6px;
  }
  .empty p {
    margin: 0;
  }
</style>

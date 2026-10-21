<script lang="ts">
  /** NAS agents: add one (compose file + pairing code), see what each is doing, choose its folders. */
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
    status: { phase?: string; current?: string | null; found?: number; queued?: number; sent?: number; failed?: number; missing?: number; lastError?: string | null; root?: string | null; archive?: ArchiveProgress }
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
  let compose = $state('')
  let copied = $state(false)
  let code = $state(initialCode ?? '')
  let pending = $state<{ name: string; platform: string | null } | null>(null)
  let agentName = $state('')
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

  const failed = (e: unknown, what: string) => (error = `${what}: ${e instanceof Error ? e.message : 'try again.'}`)

  async function load() {
    sources = (await api<{ sources: Source[] }>('/api/sources')).sources
    loaded = true
  }

  onMount(() => {
    load().catch((e) => failed(e, 'Could not load the agents'))
    api<{ connections: typeof connections }>('/api/connections').then((r) => (connections = r.connections)).catch(() => {})
    if (initialCode) void startAdding().then(lookUp)
    const timer = setInterval(() => void load().catch(() => {}), 10_000)
    return () => clearInterval(timer)
  })

  async function startAdding() {
    adding = true
    if (compose) return
    const res = await fetch('/api/sources/compose')
    if (res.ok) compose = await res.text()
    else error = `Could not load the compose file (${res.status}).`
  }

  async function copyCompose() {
    try {
      await navigator.clipboard.writeText(compose)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {
      error = 'Could not copy: select the text and copy it yourself.'
    }
  }

  async function lookUp() {
    error = ''
    pending = null
    const clean = code.trim()
    if (clean.replace(/[^A-Za-z0-9]/g, '').length !== 8) return
    try {
      pending = await api<{ name: string; platform: string | null }>(`/api/sources/pair/${encodeURIComponent(clean)}`)
      agentName = pending.name
    } catch (e) {
      error = e instanceof Error ? e.message : 'That code is unknown or has expired.'
    }
  }

  async function approve() {
    error = ''
    try {
      await api('/api/sources/pair', { method: 'POST', body: JSON.stringify({ code, name: agentName }) })
      adding = false
      pending = null
      code = ''
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not connect the agent.'
    }
  }

  /** A change to an agent. On failure the page shows what the server has, and why. */
  async function update(s: Source, patch: Record<string, unknown>, input?: HTMLInputElement) {
    error = ''
    try {
      await api(`/api/sources/${s.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
    } catch (e) {
      if (input) input.value = s.name
      failed(e, `“${s.name}” wasn't changed`)
    }
    await load().catch(() => {})
  }

  async function rescan(s: Source) {
    error = ''
    try {
      await api(`/api/sources/${s.id}/rescan`, { method: 'POST' })
    } catch (e) {
      failed(e, `Could not start a scan on “${s.name}”`)
    }
  }

  async function revoke(s: Source) {
    if (confirming !== `revoke:${s.id}`) return arm(`revoke:${s.id}`)
    arm(null)
    error = ''
    try {
      await api(`/api/sources/${s.id}`, { method: 'DELETE' })
    } catch (e) {
      failed(e, `“${s.name}” wasn't disconnected`)
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
      error = e instanceof Error ? e.message : 'Could not add that folder.'
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
      failed(e, `${r.path} wasn't changed`)
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
      failed(e, `${r.path} is still indexed`)
    }
    await load().catch(() => {})
  }

  /** Folders the agent can see that aren't indexed, inside, or around an indexed one. */
  const offered = (s: Source) => s.folders.filter((f) => !s.roots.some((r) => f === r.path || f.startsWith(`${r.path}/`) || r.path.startsWith(`${f}/`)))
  const ago = (iso: string | null) => {
    if (!iso) return 'never'
    const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
    return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`
  }
  const n = (v: number | undefined) => (v ?? 0).toLocaleString()
</script>

<div class="stack sources">
  {#if !adding}
    <div><button class="btn btn-primary" type="button" onclick={startAdding}>Add a NAS agent</button></div>
  {:else}
    <section class="card stack add">
      <header class="row"><h2>Add a NAS agent</h2><span class="spacer"></span><button class="btn btn-sm" type="button" onclick={() => (adding = false)}>Close</button></header>
      <ol class="steps">
        <li>
          <strong>On your Synology</strong>, open <em>Container Manager</em> → <em>Project</em> → <em>Create</em>. Name it <code>cf-dam-agent</code>,
          choose a folder for it (for example <code>/docker/cf-dam-agent</code>), pick <em>Create docker-compose.yml</em> and paste this:
          <div class="compose">
            <pre>{compose}</pre>
            <button class="btn btn-sm" type="button" onclick={copyCompose}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <p class="muted small">
            Change <code>/volume1/photo</code> to your photo shared folder; add a line for each other folder. Keep <code>:ro</code>: the agent can then only read
            your photos. It needs about 1 GB of memory. Other NAS models and computers with Docker work the same way.
          </p>
        </li>
        <li>
          <strong>Start the project.</strong> The agent's log (and its page at <code>http://your-nas:8790</code>) shows an eight-letter code.
        </li>
        <li>
          <strong>Enter the code:</strong>
          <div class="row code-row">
            <input type="text" bind:value={code} placeholder="ABCD-EFGH" maxlength="9" oninput={lookUp} aria-label="Pairing code" class="code" />
            {#if pending}
              <input type="text" bind:value={agentName} maxlength="80" aria-label="Agent name" />
              <button class="btn btn-primary" type="button" onclick={approve}>Connect</button>
            {/if}
          </div>
          {#if pending}<p class="muted small">Agent “{pending.name}”{pending.platform ? ` on ${pending.platform}` : ''} is waiting. Connecting gives it a key that can only send photos to this archive.</p>{/if}
        </li>
      </ol>
      {#if error}<div class="alert alert-error">{error}</div>{/if}
    </section>
  {/if}

  {#if loaded && sources.length === 0 && !adding}
    <section class="card empty">
      <p>No agents yet. An agent runs on your NAS (or any computer with Docker), reads your photos where they are, and sends their metadata and previews here. Originals never leave the NAS until you decide to move them.</p>
    </section>
  {/if}

  {#each sources as s (s.id)}
    <section class="card stack agent" class:revoked={s.revoked}>
      <header class="row">
        <span class="dot" class:on={s.online && !s.paused} class:paused={s.paused} title={s.online ? 'Online' : 'Offline'}></span>
        <input class="name" type="text" value={s.name} disabled={s.revoked} onchange={(e) => update(s, { name: e.currentTarget.value }, e.currentTarget)} aria-label="Agent name" />
        <span class="muted small">{s.revoked ? 'Disconnected' : s.paused ? 'Paused' : s.online ? (s.status.phase === 'scanning' ? 'Scanning' : 'Online') : `Last seen ${ago(s.lastSeenAt)}`}{s.version ? ` · v${s.version}` : ''}{s.platform ? ` · ${s.platform}` : ''}</span>
        <span class="spacer"></span>
        {#if !s.revoked}
          <button class="btn btn-sm" type="button" onclick={() => rescan(s)} disabled={s.paused}>Scan now</button>
          <button class="btn btn-sm" type="button" onclick={() => update(s, { paused: !s.paused })}>{s.paused ? 'Resume' : 'Pause'}</button>
          <button
            class="btn btn-sm btn-danger"
            type="button"
            onclick={() => revoke(s)}
            onblur={() => disarm(`revoke:${s.id}`)}
            title="Its key stops working at once. Connecting it again means pairing again, as a new agent."
          >
            {confirming === `revoke:${s.id}` ? "Click again: can't be undone" : 'Disconnect'}
          </button>
        {/if}
      </header>

      <div class="numbers">
        <a href={`/?on=${encodeURIComponent(`nas-${s.id}`)}`}><strong>{n(s.photos.total)}</strong><span class="muted">photos</span></a>
        <a href={`/?on=${encodeURIComponent(`nas-${s.id}`)}&missing=1`}><strong>{n(s.photos.missing)}</strong><span class="muted">missing from the NAS</span></a>
        {#if s.status.phase === 'scanning'}
          <div><strong>{n(s.status.sent)} / {n(s.status.queued)}</strong><span class="muted">this scan{s.status.failed ? `, ${n(s.status.failed)} failed` : ''}</span></div>
        {/if}
      </div>
      {#if s.status.phase === 'scanning' && s.status.current}<p class="muted small current">Now: {s.status.current}</p>{/if}
      {#if s.status.lastError}<p class="muted small">Last problem: {s.status.lastError}</p>{/if}

      {#if !s.revoked}
        <div class="folders">
          <h3>Folders</h3>
          {#if s.roots.length === 0}<p class="muted small">Nothing indexed yet. Choose a folder the agent can see.</p>{/if}
          {#each s.roots as r (r.id)}
            <div class="root row">
              <input type="checkbox" checked={r.enabled} onchange={(e) => updateRoot(s, r, { enabled: e.currentTarget.checked }, e.currentTarget)} aria-label={`Index ${r.path}`} />
              <code>{r.path}</code>
              {#if r.volume}<span class="pill">Drive: {r.volume.label ?? 'unnamed'}</span>{/if}
              {#if r.offlineSince}<span class="pill offline" title="Unplugged or unmounted. Its photos stay here; connect it to update them.">Offline since {ago(r.offlineSince)}</span>{/if}
              <span class="muted small">{r.lastScanAt ? `scanned ${ago(r.lastScanAt)}` : 'first scan pending'}</span>
              <span class="spacer"></span>
              <input
                class="globs"
                type="text"
                value={r.exclude.join(', ')}
                placeholder="Also skip, e.g. Exports/**, *.tmp"
                aria-label="Folders and files to skip"
                onchange={(e) => updateRoot(s, r, { exclude: e.currentTarget.value.split(',').map((g) => g.trim()).filter(Boolean) }, e.currentTarget)}
              />
              <button class="btn btn-sm" type="button" onclick={() => removeRoot(s, r)} onblur={() => disarm(`remove:${r.id}`)}>{confirming === `remove:${r.id}` ? 'Click again to stop indexing' : 'Remove'}</button>
            </div>
          {/each}
          <div class="row">
            {#if offered(s).length > 0}
              <select bind:value={newFolder[s.id]} aria-label="Folder to index">
                <option value="">Choose a folder…</option>
                {#each offered(s) as f (f)}
                  {@const drive = s.volumes.find((v) => v.path === f)}
                  <option value={f}>{drive ? `${drive.label ?? 'Drive'} (${f})${drive.removable ? ' · removable' : ''}` : f}</option>
                {/each}
              </select>
            {:else}
              <input type="text" bind:value={newFolder[s.id]} placeholder="/photos/photo" aria-label="Folder to index" />
            {/if}
            <button class="btn btn-sm" type="button" onclick={() => addFolder(s)} disabled={!newFolder[s.id]}>Index this folder</button>
          </div>
          <p class="muted small">Synology's own folders (@eaDir, #recycle), Mac and Windows clutter and Lightroom caches are always skipped. Removing a folder keeps its photos here, marked missing.</p>
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

<script lang="ts">
  /**
   * The keyword manager: browse the tree, add, rename, move, merge, delete, set export options and
   * synonyms. Also where colour labels get their names.
   */
  import { api } from '../lib/auth-client'

  interface Keyword {
    id: string
    name: string
    parentId: string | null
    path: string
    includeOnExport: boolean
    exportParents: boolean
    exportSynonyms: boolean
    synonyms: string[]
    count: number
    total: number
  }
  type Label = 'red' | 'yellow' | 'green' | 'blue' | 'purple'
  interface Props {
    initial: Keyword[]
    labelNames: Record<Label, string>
    canEdit: boolean
    canManageLabels: boolean
  }
  let props: Props = $props()

  let keywords = $state<Keyword[]>([...props.initial])
  let selectedId = $state<string | null>(null)
  let filter = $state('')
  let open = $state(new Set<string>())
  let newPath = $state('')
  let message = $state('')
  let error = $state('')
  let busy = $state(false)
  let confirmDelete = $state(false)

  // Edit form for the selected keyword.
  let editName = $state('')
  let editParent = $state('')
  let editSynonyms = $state('')
  let mergeInto = $state('')

  const selected = $derived(keywords.find((k) => k.id === selectedId) ?? null)
  const childrenOf = (id: string | null) => keywords.filter((k) => k.parentId === id)
  const matches = $derived(
    filter.trim()
      ? keywords.filter((k) => k.path.toLowerCase().includes(filter.trim().toLowerCase()) || k.synonyms.some((s) => s.toLowerCase().includes(filter.trim().toLowerCase())))
      : [],
  )
  // Keywords a selection may move under: not itself or anything below it.
  const moveTargets = $derived(selected ? keywords.filter((k) => k.id !== selected.id && !k.path.startsWith(`${selected.path} › `)) : [])

  function select(k: Keyword) {
    selectedId = k.id
    editName = k.name
    editParent = k.parentId ?? ''
    editSynonyms = k.synonyms.join(', ')
    mergeInto = ''
    confirmDelete = false
    error = ''
    message = ''
    // Reveal it in the tree.
    let parent = k.parentId
    const next = new Set(open)
    while (parent) {
      next.add(parent)
      parent = keywords.find((p) => p.id === parent)?.parentId ?? null
    }
    open = next
  }

  function toggle(id: string) {
    const next = new Set(open)
    next.has(id) ? next.delete(id) : next.add(id)
    open = next
  }

  async function reload(selectId: string | null = selectedId) {
    keywords = (await api<{ keywords: Keyword[] }>('/api/tags')).keywords
    const k = keywords.find((x) => x.id === selectId)
    if (k) select(k)
    else selectedId = null
  }

  async function run(action: () => Promise<string>, selectId?: string | null) {
    busy = true
    error = ''
    message = ''
    try {
      const done = await action()
      await reload(selectId === undefined ? selectedId : selectId)
      message = done
    } catch (e) {
      error = e instanceof Error ? e.message : 'That did not work.'
    } finally {
      busy = false
    }
  }

  const plural = (n: number) => `${n.toLocaleString()} photo${n === 1 ? '' : 's'}`

  function add() {
    const path = newPath.trim()
    if (!path) return
    void run(async () => {
      const { keyword } = await api<{ keyword: Keyword }>('/api/tags', { method: 'POST', body: JSON.stringify({ path }) })
      newPath = ''
      selectedId = keyword.id
      return `Added ${keyword.path}.`
    })
  }

  function saveEdits() {
    const k = selected
    if (!k) return
    const body: Record<string, unknown> = {}
    if (editName.trim() !== k.name) body.name = editName.trim()
    if ((editParent || null) !== k.parentId) body.parentId = editParent || null
    const synonyms = editSynonyms.split(',').map((s) => s.trim()).filter(Boolean)
    if (synonyms.join('\n') !== k.synonyms.join('\n')) body.synonyms = synonyms
    if (Object.keys(body).length === 0) return
    void run(async () => {
      const result = await api<{ photos: number }>(`/api/tags/${k.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      return result.photos ? `Saved. ${plural(result.photos)} updated.` : 'Saved.'
    })
  }

  function setOption(key: 'includeOnExport' | 'exportParents' | 'exportSynonyms', value: boolean) {
    const k = selected
    if (!k) return
    void run(async () => {
      await api(`/api/tags/${k.id}`, { method: 'PATCH', body: JSON.stringify({ [key]: value }) })
      return 'Saved.'
    })
  }

  function merge() {
    const k = selected
    if (!k || !mergeInto) return
    const target = keywords.find((x) => x.id === mergeInto)
    void run(async () => {
      const result = await api<{ photos: number }>(`/api/tags/${k.id}/merge`, { method: 'POST', body: JSON.stringify({ into: mergeInto }) })
      return `Merged into ${target?.path}. ${plural(result.photos)} updated.`
    }, mergeInto)
  }

  function remove() {
    const k = selected
    if (!k) return
    if (!confirmDelete) {
      confirmDelete = true
      return
    }
    void run(async () => {
      const result = await api<{ photos: number }>(`/api/tags/${k.id}`, { method: 'DELETE' })
      return `Deleted ${k.path}. Removed from ${plural(result.photos)}.`
    }, null)
  }

  let labelNames = $state<Record<Label, string>>({ ...props.labelNames })
  let labelsSaved = $state('')
  async function saveLabels() {
    labelNames = (await api<{ names: Record<Label, string> }>('/api/labels', { method: 'PUT', body: JSON.stringify(labelNames) })).names
    labelsSaved = 'Saved'
    setTimeout(() => (labelsSaved = ''), 1500)
  }
</script>

{#snippet branch(parentId: string | null)}
  <ul class="tree">
    {#each childrenOf(parentId) as k (k.id)}
      {@const kids = childrenOf(k.id).length > 0}
      <li>
        <div class="node" class:on={k.id === selectedId}>
          {#if kids}
            <button class="twisty" class:open={open.has(k.id)} type="button" aria-label={open.has(k.id) ? 'Collapse' : 'Expand'} onclick={() => toggle(k.id)}>▸</button>
          {:else}
            <span class="twisty"></span>
          {/if}
          <button class="name" type="button" onclick={() => select(k)}>
            <span class:muted={!k.includeOnExport}>{k.name}</span>
            <span class="count" title={`${k.count} tagged directly, ${k.total} including below`}>{k.total || ''}</span>
          </button>
        </div>
        {#if kids && open.has(k.id)}{@render branch(k.id)}{/if}
      </li>
    {/each}
  </ul>
{/snippet}

<div class="manager">
  <section class="card list">
    <input type="text" placeholder="Find a keyword or synonym…" bind:value={filter} aria-label="Find a keyword" />
    {#if filter.trim()}
      <ul class="tree flat">
        {#each matches as k (k.id)}
          <li><div class="node" class:on={k.id === selectedId}><button class="name" type="button" onclick={() => select(k)}><span>{k.path}</span><span class="count">{k.total || ''}</span></button></div></li>
        {:else}
          <li class="muted empty">No keyword matches.</li>
        {/each}
      </ul>
    {:else if keywords.length === 0}
      <p class="muted empty">No keywords yet. Add one below, tag photos, or import a Lightroom catalog.</p>
    {:else}
      {@render branch(null)}
    {/if}
    {#if props.canEdit}
      <form class="row add" onsubmit={(e) => (e.preventDefault(), add())}>
        <input type="text" placeholder="New keyword, e.g. Places > Norway > Bergen" bind:value={newPath} aria-label="New keyword path" />
        <button class="btn btn-sm" type="submit" disabled={busy || !newPath.trim()}>Add</button>
      </form>
    {/if}
  </section>

  <section class="card detail">
    {#if selected}
      <header>
        {#if selected.parentId}<p class="crumbs muted">{selected.path.split(' › ').slice(0, -1).join(' › ')}</p>{/if}
        <h2>{selected.name}</h2>
        <p class="muted">
          {plural(selected.count)} tagged with it{selected.total > selected.count ? `, ${plural(selected.total)} including keywords below` : ''}.
          <a href={`/?tag=${encodeURIComponent(selected.path)}`}>Show photos</a>
        </p>
      </header>

      {#if props.canEdit}
        <form class="stack" onsubmit={(e) => (e.preventDefault(), saveEdits())}>
          <div class="field">
            <label for="kw-name">Name</label>
            <input id="kw-name" type="text" bind:value={editName} maxlength="80" />
          </div>
          <div class="field">
            <label for="kw-parent">Inside</label>
            <select id="kw-parent" bind:value={editParent}>
              <option value="">(top level)</option>
              {#each moveTargets as k (k.id)}<option value={k.id}>{k.path}</option>{/each}
            </select>
          </div>
          <div class="field">
            <label for="kw-syn">Synonyms</label>
            <input id="kw-syn" type="text" bind:value={editSynonyms} placeholder="Comma separated: other words that should find these photos" />
          </div>
          <div><button class="btn btn-primary btn-sm" type="submit" disabled={busy}>Save</button></div>
        </form>

        <fieldset class="options">
          <legend class="label">When exporting (XMP, downloads)</legend>
          <label><input type="checkbox" checked={selected.includeOnExport} onchange={(e) => setOption('includeOnExport', e.currentTarget.checked)} /> Include this keyword</label>
          <label><input type="checkbox" checked={selected.exportParents} onchange={(e) => setOption('exportParents', e.currentTarget.checked)} /> Include the keywords above it</label>
          <label><input type="checkbox" checked={selected.exportSynonyms} onchange={(e) => setOption('exportSynonyms', e.currentTarget.checked)} /> Include its synonyms</label>
          <p class="muted small">Untick "Include this keyword" for organising keywords such as "Places" or "People". Search always sees every level.</p>
        </fieldset>

        <div class="row danger-zone">
          <select bind:value={mergeInto} aria-label="Merge into">
            <option value="">Merge into…</option>
            {#each moveTargets as k (k.id)}<option value={k.id}>{k.path}</option>{/each}
          </select>
          <button class="btn btn-sm" type="button" onclick={merge} disabled={busy || !mergeInto}>Merge</button>
          <span class="spacer"></span>
          <button class="btn btn-sm btn-danger" type="button" onclick={remove} disabled={busy}>
            {confirmDelete ? `Delete from ${plural(selected.total)}? Click again` : 'Delete'}
          </button>
        </div>
      {/if}
    {:else}
      <p class="muted">Choose a keyword to see and change it.</p>
      <p class="muted small">
        Type paths with <kbd>&gt;</kbd> anywhere you add keywords: <code>Places &gt; Norway &gt; Bergen</code>. Filtering on a keyword includes
        everything below it, so "Norway" finds photos tagged Bergen.
      </p>
    {/if}
    {#if message}<p class="alert alert-success">{message}</p>{/if}
    {#if error}<p class="alert alert-error">{error}</p>{/if}
  </section>

  <section class="card labels">
    <h2>Colour labels</h2>
    <p class="muted small">Keys 6–9 set red, yellow, green and blue in the library. Name them for how you work; the names are written to XMP, as Lightroom does.</p>
    <div class="label-grid">
      {#each Object.keys(labelNames) as value (value)}
        <label class="label-row">
          <span class={`swatch label-${value}`}></span>
          <input type="text" bind:value={labelNames[value as Label]} maxlength="40" disabled={!props.canManageLabels} aria-label={`Name for ${value}`} />
        </label>
      {/each}
    </div>
    {#if props.canManageLabels}
      <div class="row"><button class="btn btn-sm" type="button" onclick={saveLabels}>Save names</button><span class="muted small">{labelsSaved}</span></div>
    {/if}
  </section>
</div>

<style>
  .manager {
    display: grid;
    grid-template-columns: minmax(260px, 380px) minmax(0, 1fr);
    gap: 20px;
    align-items: start;
  }
  .list {
    display: grid;
    gap: 10px;
    max-height: calc(100vh - 160px);
    overflow: auto;
    grid-row: span 2;
  }
  .tree {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .tree .tree {
    margin-left: 14px;
    border-left: 1px solid var(--border);
  }
  .node {
    display: flex;
    align-items: center;
    border-radius: 6px;
  }
  .node.on {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .twisty {
    width: 20px;
    flex: none;
    border: 0;
    background: none;
    color: var(--text-faint);
    cursor: pointer;
    font-size: 0.7rem;
    transition: transform 120ms var(--ease);
  }
  .twisty.open {
    transform: rotate(90deg);
  }
  .name {
    flex: 1;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 8px 5px 2px;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.88rem;
    text-align: left;
    cursor: pointer;
  }
  .flat .name {
    padding-left: 8px;
  }
  .count {
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    font-size: 0.8rem;
  }
  .empty {
    padding: 8px;
    font-size: 0.88rem;
  }
  .add input {
    flex: 1;
  }
  .detail {
    display: grid;
    gap: 16px;
  }
  .detail header h2 {
    margin: 2px 0 4px;
  }
  .crumbs {
    margin: 0;
    font-size: 0.8rem;
  }
  .detail header p {
    margin: 0;
  }
  .options {
    display: grid;
    gap: 6px;
    border: 0;
    padding: 0;
    margin: 0;
  }
  .options label {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 0.9rem;
  }
  .danger-zone {
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .spacer {
    flex: 1;
  }
  .small {
    font-size: 0.8rem;
  }
  .labels {
    display: grid;
    gap: 10px;
  }
  .labels p {
    margin: 0;
  }
  .label-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 8px;
  }
  .label-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    flex: none;
  }
  .label-red {
    background: var(--label-red);
  }
  .label-yellow {
    background: var(--label-yellow);
  }
  .label-green {
    background: var(--label-green);
  }
  .label-blue {
    background: var(--label-blue);
  }
  .label-purple {
    background: var(--label-purple);
  }
  @media (max-width: 860px) {
    .manager {
      grid-template-columns: 1fr;
    }
    .list {
      max-height: none;
    }
  }
</style>

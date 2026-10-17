<script lang="ts">
  /** "Save this search": names the current filters and keeps them in the sidebar. */
  import { api } from '../lib/auth-client'

  let { query }: { query: string } = $props()
  let naming = $state(false)
  let name = $state('')
  let error = $state('')

  async function save() {
    if (!name.trim()) return
    try {
      await api('/api/saved-searches', { method: 'POST', body: JSON.stringify({ name: name.trim(), query }) })
      location.reload()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save.'
    }
  }
</script>

{#if naming}
  <form class="save" onsubmit={(e) => (e.preventDefault(), save())}>
    <!-- svelte-ignore a11y_autofocus -->
    <input type="text" bind:value={name} placeholder="Name this search" maxlength="100" autofocus aria-label="Saved search name" />
    <button class="btn btn-sm" type="submit">Save</button>
    {#if error}<span class="err">{error}</span>{/if}
  </form>
{:else}
  <button class="link" type="button" onclick={() => (naming = true)}>Save this search</button>
{/if}

<style>
  .save {
    display: flex;
    gap: 6px;
    width: 100%;
    flex-wrap: wrap;
  }
  .save input {
    flex: 1;
    min-width: 0;
    padding: 4px 8px;
    font-size: 0.82rem;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }
  .err {
    color: var(--danger);
    font-size: 0.8rem;
  }
</style>

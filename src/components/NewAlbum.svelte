<script lang="ts">
  import { api } from '../lib/auth-client'

  let name = $state('')
  let busy = $state(false)

  async function create(event: SubmitEvent) {
    event.preventDefault()
    busy = true
    const { album } = await api<{ album: { id: string } }>('/api/albums', { method: 'POST', body: JSON.stringify({ name }) })
    window.location.href = `/albums/${album.id}`
  }
</script>

<form class="row" onsubmit={create}>
  <input type="text" placeholder="New album name" required maxlength="200" bind:value={name} style="max-width: 320px" aria-label="New album name" />
  <button class="btn btn-primary" type="submit" disabled={busy}>Create album</button>
</form>

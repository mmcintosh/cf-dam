<script lang="ts">
  import { t } from '@cf-dam/i18n/client'
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
  <input type="text" placeholder={t('albums.newName')} required maxlength="200" bind:value={name} style="max-width: 320px" aria-label={t('albums.newName')} />
  <button class="btn btn-primary" type="submit" disabled={busy}>{t('albums.create')}</button>
</form>

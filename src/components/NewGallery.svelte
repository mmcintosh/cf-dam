<script lang="ts">
  /**
   * "New client gallery" on the Client galleries page: choose the album to share, then the album's page opens
   * with the new-gallery form ready. Photos not yet in an album go through the Library's "Share with a client".
   */
  import { t, tHtml } from '@cf-dam/i18n/client'

  let { albums }: { albums: { id: string; name: string }[] } = $props()
  let open = $state(false)
  let albumId = $state('')

  function go(event: SubmitEvent) {
    event.preventDefault()
    if (albumId) location.href = `/albums/${encodeURIComponent(albumId)}?share=new#share`
  }
</script>

<div class="stack new">
  <div><button class="btn btn-primary" type="button" aria-expanded={open} onclick={() => (open = !open)}>{open ? t('common.cancel') : t('galleries.new')}</button></div>
  {#if open}
    <form class="card stack" onsubmit={go}>
      {#if albums.length > 0}
        <div class="row">
          <div class="field grow">
            <label for="gallery-album">{t('galleries.chooseAlbum')}</label>
            <select id="gallery-album" required bind:value={albumId}>
              <option value="" disabled>{t('galleries.chooseAlbumMenu')}</option>
              {#each albums as album (album.id)}<option value={album.id}>{album.name}</option>{/each}
            </select>
          </div>
          <button class="btn btn-primary" type="submit" disabled={!albumId}>{t('galleries.continue')}</button>
        </div>
        <p class="muted small">{@html tHtml('galleries.fromLibrary')}</p>
      {:else}
        <p class="muted">{@html tHtml('galleries.noAlbums')}</p>
      {/if}
    </form>
  {/if}
</div>

<style>
  .new {
    margin-bottom: 20px;
  }
  .row {
    align-items: flex-end;
    gap: 12px;
    flex-wrap: wrap;
  }
  .grow {
    flex: 1 1 260px;
  }
  select {
    width: 100%;
  }
</style>

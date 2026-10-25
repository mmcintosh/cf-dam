<script lang="ts">
  /** Add a person by name (plans/PLAN-FN-v2.md FN1); the same name twice is the same person. */
  import { t } from '@cf-dam/i18n/client'
  import { api } from '../lib/auth-client'

  let name = $state('')
  let busy = $state(false)
  let error = $state('')

  async function create(event: SubmitEvent) {
    event.preventDefault()
    busy = true
    error = ''
    try {
      const { person } = await api<{ person: { id: number } }>('/api/people', { method: 'POST', body: JSON.stringify({ name }) })
      window.location.href = `/people/${person.id}`
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.couldNotSave')
      busy = false
    }
  }
</script>

<form class="row" onsubmit={create}>
  <input type="text" placeholder={t('peoplePage.newName')} aria-label={t('peoplePage.newName')} required maxlength="120" bind:value={name} />
  <button class="btn btn-primary" type="submit" disabled={busy}>{t('peoplePage.add')}</button>
  {#if error}<span class="alert alert-error" role="alert">{error}</span>{/if}
</form>

<script lang="ts">
  /**
   * Adding a storage connection (plans/PLAN-ST-v2.md), on its own page. After "Add and test" it opens the new
   * connection's page, where the test result (or, for keyless, the AWS setup) is.
   */
  import { t } from '@cf-dam/i18n/client'
  import { api } from '../lib/auth-client'
  import { ALL_CLASSES, PRESETS, type PresetKey } from '../lib/storage-presets'

  let { origin }: { origin: string } = $props()

  let preset = $state<PresetKey>('aws')
  let form = $state({ name: '', endpoint: PRESETS.aws.endpoint('us-east-1'), region: 'us-east-1', bucket: '', prefix: '', forcePathStyle: false, accessKeyId: '', secretAccessKey: '', storageClasses: [...ALL_CLASSES], defaultClass: 'STANDARD' })
  // Keyless needs an https issuer AWS can reach, so it's the default only when this site is on https.
  // svelte-ignore state_referenced_locally
  const keylessPossible = origin.startsWith('https://')
  let authMode = $state<'access-key' | 'oidc-role'>(keylessPossible ? 'oidc-role' : 'access-key')
  let roleArn = $state('')
  let error = $state('')
  let busy = $state(false)

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
          ? { authMode, name: form.name, region: form.region, bucket: form.bucket, prefix: form.prefix, roleArn, storageClasses: form.storageClasses, defaultClass: form.defaultClass }
          : form
      const { connection } = await api<{ connection: { id: string } }>('/api/connections', { method: 'POST', body: JSON.stringify(payload) })
      form.secretAccessKey = ''
      location.href = `/settings/storage/${connection.id}?added=1`
    } catch (e) {
      error = e instanceof Error ? e.message : t('conn.addFailed')
      busy = false
    }
  }
</script>

<form class="card stack" onsubmit={create}>
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
  {#if authMode === 'access-key'}<label class="check"><input type="checkbox" bind:checked={form.forcePathStyle} /> {t('conn.pathStyle')}</label>{/if}
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
  {#if error}<div class="alert alert-error" role="alert">{error}</div>{/if}
  <div class="row">
    <button class="btn btn-primary" type="submit" disabled={busy}>{busy ? t('conn.adding') : t('conn.addTest')}</button>
    <a class="btn" href="/settings/storage">{t('common.cancel')}</a>
  </div>
</form>

<style>
  form {
    max-width: 860px;
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
</style>

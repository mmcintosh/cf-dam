<script lang="ts">
  /**
   * Appearance and accessibility (catalog/preferences.ts). Each change shows at once and is kept with
   * the person, so it follows them to any computer.
   */
  import { api } from '../lib/auth-client'
  import { t } from '@cf-dam/i18n/client'
  import type { MessageKey } from '@cf-dam/i18n'

  interface Preferences {
    theme: 'system' | 'light' | 'dark'
    textSize: 100 | 112 | 125 | 150
    highContrast: boolean
    reduceMotion: boolean
    readableFont: boolean
    underlineLinks: boolean
    thumbnails: 'small' | 'medium' | 'large'
    /** 'auto' follows the browser. */
    language?: string
  }

  let { initial }: { initial: Preferences } = $props()
  let prefs = $state<Preferences>({ ...initial })
  let saved = $state('')
  let error = $state('')

  /** The same attributes the page is built with (preferenceAttributes), set here for an instant preview. */
  function show(p: Preferences) {
    const root = document.documentElement
    const set = (name: string, value: string | undefined) => (value === undefined ? root.removeAttribute(name) : root.setAttribute(name, value))
    set('data-theme', p.theme === 'system' ? undefined : p.theme)
    set('data-contrast', p.highContrast ? 'high' : undefined)
    set('data-motion', p.reduceMotion ? 'reduce' : undefined)
    set('data-font', p.readableFont ? 'readable' : undefined)
    set('data-links', p.underlineLinks ? 'underline' : undefined)
    set('data-thumbs', p.thumbnails === 'medium' ? undefined : p.thumbnails)
    if (p.textSize === 100) root.style.removeProperty('--text-scale')
    else root.style.setProperty('--text-scale', String(p.textSize / 100))
  }

  const USUAL: Preferences = { theme: 'system', textSize: 100, highContrast: false, reduceMotion: false, readableFont: false, underlineLinks: false, thumbnails: 'medium' }

  let timer: ReturnType<typeof setTimeout> | undefined
  /** Show the choices now, keep them a moment later (several quick changes are one save). */
  function apply(next: Preferences) {
    prefs = next
    show(prefs)
    saved = ''
    clearTimeout(timer)
    timer = setTimeout(async () => {
      try {
        prefs = await api<Preferences>('/api/me/preferences', { method: 'PUT', body: JSON.stringify(prefs) })
        saved = t('common.saved')
        error = ''
      } catch (e) {
        error = e instanceof Error ? e.message : t('common.couldNotSave')
      }
    }, 300)
  }
  const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => apply({ ...prefs, [key]: value })
  // Appearance only: the language stays as chosen.
  const reset = () => apply({ ...USUAL, language: prefs.language })

  const SIZES: [Preferences['textSize'], MessageKey][] = [
    [100, 'appearance.size.normal'],
    [112, 'appearance.size.larger'],
    [125, 'appearance.size.large'],
    [150, 'appearance.size.largest'],
  ]
  const THEMES: [Preferences['theme'], MessageKey][] = [
    ['system', 'appearance.theme.system'],
    ['light', 'appearance.theme.light'],
    ['dark', 'appearance.theme.dark'],
  ]
  const THUMBS: [Preferences['thumbnails'], MessageKey][] = [
    ['small', 'appearance.thumbs.small'],
    ['medium', 'appearance.thumbs.medium'],
    ['large', 'appearance.thumbs.large'],
  ]
</script>

<div class="appearance">
  <div class="stack">
  <fieldset>
    <legend>{t('appearance.theme')}</legend>
    <div class="choices" role="radiogroup">
      {#each THEMES as [value, label] (value)}
        <label class="choice"><input type="radio" name="theme" {value} checked={prefs.theme === value} onchange={() => change('theme', value)} /> {t(label)}</label>
      {/each}
    </div>
  </fieldset>

  <fieldset>
    <legend>{t('appearance.textSize')}</legend>
    <div class="choices" role="radiogroup">
      {#each SIZES as [value, label] (value)}
        <label class="choice"><input type="radio" name="text-size" {value} checked={prefs.textSize === value} onchange={() => change('textSize', value)} /> <span style={`font-size:${value / 100}em`}>{t(label)}</span></label>
      {/each}
    </div>
    <p class="muted small">{t('appearance.textSizeNote')}</p>
  </fieldset>

  <fieldset>
    <legend>{t('appearance.thumbnails')}</legend>
    <div class="choices" role="radiogroup">
      {#each THUMBS as [value, label] (value)}
        <label class="choice"><input type="radio" name="thumbnails" {value} checked={prefs.thumbnails === value} onchange={() => change('thumbnails', value)} /> {t(label)}</label>
      {/each}
    </div>
  </fieldset>

  </div>

  <fieldset>
    <legend>{t('appearance.easier')}</legend>
    <label class="check"><input type="checkbox" checked={prefs.highContrast} onchange={(e) => change('highContrast', e.currentTarget.checked)} /> <span><strong>{t('appearance.contrast')}</strong> {t('appearance.contrastNote')}</span></label>
    <label class="check"><input type="checkbox" checked={prefs.readableFont} onchange={(e) => change('readableFont', e.currentTarget.checked)} /> <span><strong>{t('appearance.font')}</strong> {t('appearance.fontNote')}</span></label>
    <label class="check"><input type="checkbox" checked={prefs.underlineLinks} onchange={(e) => change('underlineLinks', e.currentTarget.checked)} /> <span><strong>{t('appearance.links')}</strong> {t('appearance.linksNote')}</span></label>
    <label class="check"><input type="checkbox" checked={prefs.reduceMotion} onchange={(e) => change('reduceMotion', e.currentTarget.checked)} /> <span><strong>{t('appearance.motion')}</strong> {t('appearance.motionNote')}</span></label>
  </fieldset>

  <div class="row foot">
    <button class="btn btn-sm" type="button" onclick={reset}>{t('appearance.reset')}</button>
    <span class="muted small" role="status">{saved}</span>
  </div>
  {#if error}<div class="alert alert-error">{error}</div>{/if}
</div>

<style>
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
  }
  legend {
    font-weight: 600;
    margin-bottom: 8px;
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .choice {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .choice:has(input:checked) {
    border-color: var(--accent);
    background: var(--surface-hover);
  }
  .check {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin: 8px 0;
    cursor: pointer;
  }
  .check input {
    margin-top: 4px;
  }
  /* Look (theme, size, thumbnails) beside "easier to see and use"; one column when narrow. */
  .appearance {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 24px 40px;
    align-items: start;
  }
  .foot,
  .appearance > .alert {
    grid-column: 1 / -1;
  }
  .foot {
    gap: 12px;
    align-items: center;
  }
  .check:first-of-type {
    margin-top: 0;
  }
</style>

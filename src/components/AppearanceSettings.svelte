<script lang="ts">
  /**
   * Appearance and accessibility (catalog/preferences.ts). Each change shows at once and is kept with
   * the person, so it follows them to any computer.
   */
  import { api } from '../lib/auth-client'
  import { t } from '@cf-dam/i18n/client'
  import { LANGUAGES } from '@cf-dam/i18n/languages'

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
        saved = 'Saved'
        error = ''
      } catch (e) {
        error = e instanceof Error ? e.message : 'Could not save.'
      }
    }, 300)
  }
  /** A new language needs the page rebuilt in it, so save at once and reload. */
  async function chooseLanguage(language: string) {
    try {
      await api('/api/me/preferences', { method: 'PUT', body: JSON.stringify({ language }) })
      location.reload()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save.'
    }
  }
  const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => apply({ ...prefs, [key]: value })
  // Appearance only: the language stays as chosen.
  const reset = () => apply({ ...USUAL, language: prefs.language })

  const SIZES: [Preferences['textSize'], string][] = [
    [100, 'Normal'],
    [112, 'Larger'],
    [125, 'Large'],
    [150, 'Largest'],
  ]
</script>

<div class="stack appearance">
  <div class="field language">
    <label for="appearance-language">{t('language.label')}</label>
    <select id="appearance-language" value={prefs.language ?? 'auto'} onchange={(e) => chooseLanguage(e.currentTarget.value)}>
      <option value="auto">{t('language.browser')}</option>
      {#each LANGUAGES as language (language.code)}<option value={language.code} lang={language.code}>{language.name}</option>{/each}
    </select>
  </div>

  <fieldset>
    <legend>Theme</legend>
    <div class="choices" role="radiogroup">
      {#each [['system', 'Same as this computer'], ['light', 'Light'], ['dark', 'Dark']] as [value, label] (value)}
        <label class="choice"><input type="radio" name="theme" {value} checked={prefs.theme === value} onchange={() => change('theme', value as Preferences['theme'])} /> {label}</label>
      {/each}
    </div>
  </fieldset>

  <fieldset>
    <legend>Text size</legend>
    <div class="choices" role="radiogroup">
      {#each SIZES as [value, label] (value)}
        <label class="choice"><input type="radio" name="text-size" {value} checked={prefs.textSize === value} onchange={() => change('textSize', value)} /> <span style={`font-size:${value / 100}em`}>{label}</span></label>
      {/each}
    </div>
    <p class="muted small">Everything grows with it, and the page reflows: nothing is cut off. Your browser's own zoom (Ctrl or ⌘ and +) works too.</p>
  </fieldset>

  <fieldset>
    <legend>Library thumbnails</legend>
    <div class="choices" role="radiogroup">
      {#each [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] as [value, label] (value)}
        <label class="choice"><input type="radio" name="thumbnails" {value} checked={prefs.thumbnails === value} onchange={() => change('thumbnails', value as Preferences['thumbnails'])} /> {label}</label>
      {/each}
    </div>
  </fieldset>

  <fieldset>
    <legend>Easier to see and use</legend>
    <label class="check"><input type="checkbox" checked={prefs.highContrast} onchange={(e) => change('highContrast', e.currentTarget.checked)} /> <span><strong>Stronger contrast.</strong> Black or white text, firmer edges and thicker focus outlines.</span></label>
    <label class="check"><input type="checkbox" checked={prefs.readableFont} onchange={(e) => change('readableFont', e.currentTarget.checked)} /> <span><strong>Easier-to-read font.</strong> Atkinson Hyperlegible, designed by the Braille Institute for low vision.</span></label>
    <label class="check"><input type="checkbox" checked={prefs.underlineLinks} onchange={(e) => change('underlineLinks', e.currentTarget.checked)} /> <span><strong>Underline links,</strong> so they don't depend on colour.</span></label>
    <label class="check"><input type="checkbox" checked={prefs.reduceMotion} onchange={(e) => change('reduceMotion', e.currentTarget.checked)} /> <span><strong>No animations.</strong> (They're already kept to a minimum when your computer asks for less motion.)</span></label>
  </fieldset>

  <div class="row foot">
    <button class="btn btn-sm" type="button" onclick={reset}>Back to the usual</button>
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
  .foot {
    gap: 12px;
    align-items: center;
  }
</style>

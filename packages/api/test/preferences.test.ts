/** Appearance and accessibility choices (catalog/preferences.ts). */
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, parsePreferences, preferenceAttributes } from '../src/catalog/preferences'
import { createHarness, setUpAdmin, type Harness } from './harness'

let h: Harness
afterEach(async () => h?.dispose())

describe('appearance choices', () => {
  it('starts from the usual, keeps changes, ignores nonsense, and only touches what was sent', async () => {
    h = await createHarness()
    const admin = await setUpAdmin(h)
    const get = async () => (await h.fetch('/api/me/preferences', { cookie: admin })).json()
    expect(await get()).toEqual(DEFAULT_PREFERENCES)
    const put = (body: unknown) => h.fetch('/api/me/preferences', { method: 'PUT', body: JSON.stringify(body), cookie: admin })
    expect((await put({ theme: 'light', textSize: 125 })).status).toBe(200)
    await put({ highContrast: true, textSize: 999, theme: 'purple' })
    expect(await get()).toEqual({ ...DEFAULT_PREFERENCES, theme: 'light', textSize: 125, highContrast: true })
    expect((await h.fetch('/api/me/preferences', { method: 'PUT', body: JSON.stringify({ theme: 'dark' }) })).status).toBe(401)
  })

  it('becomes the page’s attributes, leaving the usual ones out', () => {
    expect(preferenceAttributes(DEFAULT_PREFERENCES)).toEqual({
      'data-theme': undefined,
      'data-contrast': undefined,
      'data-motion': undefined,
      'data-font': undefined,
      'data-links': undefined,
      'data-thumbs': undefined,
      style: undefined,
    })
    expect(preferenceAttributes(parsePreferences({ theme: 'dark', textSize: 150, readableFont: true, thumbnails: 'large' }))).toMatchObject({
      'data-theme': 'dark',
      'data-font': 'readable',
      'data-thumbs': 'large',
      style: '--text-scale: 1.5',
    })
  })
})

/**
 * Small helpers the pages use in the browser: where to go after signing in (src/lib/safe-next.ts), and a gallery's
 * last day (src/lib/gallery-days.ts), which must survive being edited and saved again in any time zone.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { closesAt, lastDay } from '../../../src/lib/gallery-days'
import { safeNext } from '../../../src/lib/safe-next'

describe('after signing in', () => {
  it('goes only to a path on this site', () => {
    expect(safeNext('/s/abc?x=1#top')).toBe('/s/abc?x=1#top')
    expect(safeNext('/')).toBe('/')
    for (const bad of [null, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', '/%09/evil.example'.replace('%09', '\t'), 'javascript:alert(1)', ' /x']) {
      expect(safeNext(bad), String(bad)).toBe('/')
    }
    // Encoded characters stay encoded: the browser doesn't turn %2F%2F into a host.
    expect(safeNext('/%2F%2Fevil.example')).toBe('/%2F%2Fevil.example')
  })
})

describe('a gallery’s last day', () => {
  const zone = process.env.TZ
  afterEach(() => {
    process.env.TZ = zone
  })

  for (const tz of ['America/New_York', 'UTC', 'Pacific/Auckland', 'America/Los_Angeles']) {
    it(`stays the same day when edited and saved again (${tz})`, () => {
      process.env.TZ = tz
      for (const day of ['2026-11-20', '2026-03-08', '2026-11-01', '2026-12-31', '2026-02-28']) {
        let stored = closesAt(day)
        for (let save = 0; save < 3; save++) stored = closesAt(lastDay(stored))
        expect(lastDay(stored), `${tz} ${day}`).toBe(day)
        // It closes at the start of the next day there.
        const close = new Date(stored)
        expect([close.getHours(), close.getMinutes()]).toEqual([0, 0])
      }
    })
  }
})

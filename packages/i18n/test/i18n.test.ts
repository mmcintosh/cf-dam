import { describe, expect, it } from 'vitest'
import { createFormat, createTranslate, getT, pageI18n, parseAcceptLanguage, pseudoize, resolveLanguage, runInLanguage } from '../src/index'
import { t as clientT, tHtml } from '../src/client'

describe('resolveLanguage', () => {
  it('takes the first source that names a language we have', () => {
    expect(resolveLanguage({ preference: 'de', cookie: 'fr', acceptLanguage: 'es', site: 'it' })).toBe('de')
    expect(resolveLanguage({ preference: 'klingon', cookie: 'fr-CA', acceptLanguage: 'es' })).toBe('fr')
    expect(resolveLanguage({ gallery: 'it', acceptLanguage: 'es' })).toBe('it')
    expect(resolveLanguage({ acceptLanguage: 'pt-BR, de;q=0.8, es;q=0.9', site: 'fr' })).toBe('es')
    expect(resolveLanguage({ acceptLanguage: 'pt-BR', site: 'it' })).toBe('it')
    expect(resolveLanguage({})).toBe('en')
  })

  it('never lets an odd value through, and only allows the pseudo-language when asked', () => {
    expect(resolveLanguage({ cookie: '"><script>', site: { not: 'a string' } })).toBe('en')
    expect(resolveLanguage({ cookie: 'en-XA' })).toBe('en')
    expect(resolveLanguage({ cookie: 'en-XA', pseudo: true })).toBe('en-XA')
  })

  it('reads Accept-Language by weight, ignoring zero weights and *', () => {
    expect(parseAcceptLanguage('fr-CH, fr;q=0.9, en;q=0.8, *;q=0.5, de;q=0')).toEqual(['fr-CH', 'fr', 'en'])
    expect(parseAcceptLanguage(null)).toEqual([])
  })
})

describe('t', () => {
  it('translates, and falls back to English key by key', () => {
    expect(getT('de')('common.save')).toBe('Speichern')
    const partial = createTranslate('de', { 'common.save': 'Speichern' }, { 'common.save': 'Save', 'common.close': 'Close' })
    expect(partial('common.close')).toBe('Close')
  })

  it("picks each language's plural form and formats the number", () => {
    expect(getT('en')('common.photos', { count: 1 })).toBe('1 photo')
    expect(getT('en')('common.photos', { count: 1200 })).toBe('1,200 photos')
    expect(getT('de')('common.photos', { count: 1200 })).toBe('1.200 Fotos')
    expect(getT('fr')('common.photos', { count: 0 })).toBe('0 photo')
    expect(getT('fr')('common.photos', { count: 1_000_000 })).toBe('1\u202f000\u202f000 de photos')
    expect(getT('es')('common.photos', { count: 2 })).toBe('2 fotos')
  })

  it('leaves values as text for the page to escape, and unknown placeholders visible', () => {
    const t = createTranslate('en', {}, { 'x.hello': 'Hello {name}, {missing}' })
    expect(t('x.hello' as never, { name: '<b>Ann</b>' })).toBe('Hello <b>Ann</b>, {missing}')
  })
})

describe('pseudo-language', () => {
  it('marks text, keeps placeholders and tags, and makes it longer', () => {
    const out = pseudoize('Save {count} photos to <strong>Album</strong>')
    expect(out).toContain('{count}')
    expect(out).toContain('<strong>')
    expect(out.startsWith('⟦') && out.endsWith('⟧')).toBe(true)
    expect(out.length).toBeGreaterThan('Save {count} photos to <strong>Album</strong>'.length * 1.2)
    expect(getT('en-XA')('common.save')).not.toBe('Save')
  })
})

describe('format', () => {
  it('formats sizes in the language’s units, dates in the zone, and sorts by the language', () => {
    expect(createFormat('fr').bytes(5 * 1024 * 1024)).toBe('5\u202fMo')
    expect(createFormat('en').bytes(1536)).toBe('1.5 kB')
    expect(createFormat('de', 'Europe/Berlin').dateTime('2026-10-23T22:30:00Z')).toContain('00:30')
    expect(createFormat('en').dateTime('2026-10-23T22:30:00Z')).toContain('UTC')
    expect(createFormat('en', 'Not/AZone').date('2026-10-23T12:00:00Z')).toBe('Oct 23, 2026')
    expect(['Zoë', 'émile', 'Anna', 'eva'].sort(createFormat('fr').compare)).toEqual(['Anna', 'émile', 'eva', 'Zoë'])
    expect(createFormat('es').list(['a', 'b', 'c'])).toBe('a, b y c')
    expect(createFormat('en').relative(Date.now() - 3 * 86_400_000)).toBe('3 days ago')
  })
})

describe('client t on the server', () => {
  it('uses the language of the request it runs in', async () => {
    expect(clientT('common.save')).toBe('Save')
    const inside = await runInLanguage({ lang: 'it' }, async () => {
      await new Promise((r) => setTimeout(r, 1))
      return clientT('common.save')
    })
    expect(inside).toBe('Salva')
    expect(clientT('common.save')).toBe('Save')
  })

  it('sends the browser one merged catalog', () => {
    const page = pageI18n('es', 'Europe/Madrid')
    expect(page.catalog['common.save']).toBe('Guardar')
    expect(page).toMatchObject({ lang: 'es', timeZone: 'Europe/Madrid' })
  })
})

describe('tHtml', () => {
  it("keeps the catalog's own markup and escapes what goes into it", async () => {
    const html = await runInLanguage({ lang: 'en' }, async () => tHtml('sources.steps.unraid', { image: '<img src=x onerror=alert(1)>', origin: '"https://dam.example"' }))
    expect(html).toContain('<strong>On Unraid</strong>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img')
    expect(html).toContain('&quot;https://dam.example&quot;')
  })
})


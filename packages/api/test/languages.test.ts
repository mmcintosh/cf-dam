import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN, cookiesFrom, createHarness, json, setUpAdmin, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))

let h: Harness
let admin: string
let albumId: string

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
  const created = (await (await h.fetch('/api/uploads', { ...json({ filename: 'a.jpg', size: camera.byteLength }), cookie: admin })).json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  albumId = ((await (await h.fetch('/api/albums', { ...json({ name: 'Boda' }), cookie: admin })).json()) as { album: { id: string } }).album.id
})
afterEach(async () => h.dispose())

async function share(body: Record<string, unknown> = {}) {
  const response = await h.fetch('/api/shares', { ...json({ albumId, name: 'For Ana', ...body }), cookie: admin })
  expect(response.status).toBe(201)
  return ((await response.json()) as { share: { id: string; token: string; language: string | null } }).share
}

const message = async (response: Response) => ((await response.json()) as { message: string }).message

describe('languages in the API', () => {
  it("answers in the browser's language, and in English when it has no better", async () => {
    const link = await share({ password: 'para ana' })
    const locked = (headers: Record<string, string>) => h.fetch(`/api/public/galleries/${link.token}`, { headers })
    expect(await message(await locked({ 'Accept-Language': 'es-ES,es;q=0.9' }))).toBe('Esta galería necesita una contraseña.')
    expect(await message(await locked({ 'Accept-Language': 'de' }))).toBe('Diese Galerie braucht ein Passwort.')
    expect(await message(await locked({ 'Accept-Language': 'pt-BR' }))).toBe('This gallery needs a password.')
    // The cookie (a choice) beats the browser.
    expect(await message(await locked({ 'Accept-Language': 'de', Cookie: 'cfdam_lang=it' }))).toBe('Questa galleria richiede una password.')
  })

  it("keeps a link's fixed language for visitors who haven't chosen, previews any, and checks the value", async () => {
    const link = await share({ password: 'para ana', language: 'fr' })
    expect(link.language).toBe('fr')
    const locked = (path = '', headers: Record<string, string> = {}) => h.fetch(`/api/public/galleries/${link.token}${path}`, { headers })
    expect(await message(await locked('', { 'Accept-Language': 'de' }))).toBe('Cette galerie nécessite un mot de passe.')
    expect(await message(await locked('', { Cookie: 'cfdam_lang=es' }))).toBe('Esta galería necesita una contraseña.')
    expect(await message(await locked('?lang=it'))).toBe('Questa galleria richiede una password.')
    expect((await h.fetch(`/api/shares/${link.id}`, { ...json({ language: 'klingon' }), method: 'PATCH', cookie: admin })).status).toBe(400)
    expect((await h.fetch(`/api/shares/${link.id}`, { ...json({ language: null }), method: 'PATCH', cookie: admin })).status).toBe(200)
    expect(await message(await locked('', { 'Accept-Language': 'de' }))).toBe('Diese Galerie braucht ein Passwort.')
  })

  it('remembers a person’s language in a cookie when they choose it, and forgets it for "auto"', async () => {
    const saved = await h.fetch('/api/me/preferences', { ...json({ language: 'de' }), method: 'PUT', cookie: admin })
    expect(((await saved.json()) as { language: string }).language).toBe('de')
    expect(saved.headers.get('Set-Cookie')).toMatch(/^cfdam_lang=de; Path=\/; Max-Age=31536000/)
    const cleared = await h.fetch('/api/me/preferences', { ...json({ language: 'auto' }), method: 'PUT', cookie: admin })
    expect(cleared.headers.get('Set-Cookie')).toMatch(/^cfdam_lang=; Path=\/; Max-Age=0/)
    // Other preference changes leave the cookie alone.
    expect((await h.fetch('/api/me/preferences', { ...json({ theme: 'dark' }), method: 'PUT', cookie: admin })).headers.get('Set-Cookie')).toBeNull()
    expect(((await (await h.fetch('/api/me/preferences', { ...json({ language: 'xx' }), method: 'PUT', cookie: admin })).json()) as { language: string }).language).toBe('auto')
  })
})

describe('the language chosen at setup', () => {
  it("becomes the archive's language and the first administrator's own", async () => {
    const fresh = await createHarness()
    try {
      const response = await fresh.fetch('/api/setup', json({ ...ADMIN, language: 'it' }))
      expect(response.ok).toBe(true)
      const cookie = cookiesFrom(response)
      expect(((await (await fresh.fetch('/api/me/preferences', { cookie })).json()) as { language: string }).language).toBe('it')
      // Someone whose browser says nothing we speak gets the archive's language.
      const gone = await fresh.fetch('/api/public/galleries/abcdefghijklmnopqrstuv', { headers: { 'Accept-Language': 'pt' } })
      expect(((await gone.json()) as { message: string }).message).toBe('Questa galleria non è più disponibile.')
    } finally {
      await fresh.dispose()
    }
  })
})


describe('the server’s own messages', () => {
  it('come back in the reader’s language', async () => {
    const rename = (cookie: string) => h.fetch(`/api/albums/${albumId}`, { ...json({ name: '  ' }), method: 'PATCH', cookie })
    expect(((await (await rename(admin)).json()) as { message: string }).message).toBe('An album needs a name.')
    expect(((await (await rename(`${admin}; cfdam_lang=de`)).json()) as { message: string }).message).toBe('Ein Album braucht einen Namen.')
  })
})

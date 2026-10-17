import { describe, expect, it } from 'vitest'
import { deriveKey, open, seal } from '../src/storage/secret-box'

describe('secret box', () => {
  it('round-trips and never reuses an IV', async () => {
    const key = await deriveKey('a secret long enough to be a key')
    const a = await seal(key, 'wJalrXUtnFEMI/K7MDENG')
    const b = await seal(key, 'wJalrXUtnFEMI/K7MDENG')
    expect(a).not.toBe(b)
    expect(await open(key, a)).toBe('wJalrXUtnFEMI/K7MDENG')
  })

  it('fails with a different key or a tampered value', async () => {
    const sealed = await seal(await deriveKey('one secret'), 'value')
    await expect(open(await deriveKey('another secret'), sealed)).rejects.toThrow()
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'B' : 'A') + sealed.slice(-1)
    await expect(open(await deriveKey('one secret'), tampered)).rejects.toThrow()
  })
})

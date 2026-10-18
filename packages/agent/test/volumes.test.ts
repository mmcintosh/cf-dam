import { describe, expect, it } from 'vitest'
import { locate, toAgentPath } from '../src/volumes.ts'

describe('drives', () => {
  it('writes Windows paths the way cf-dam stores them', () => {
    expect(toAgentPath('e:\\Photos\\2014')).toBe('E:/Photos/2014')
    expect(toAgentPath('\\\\nas\\photo\\2019')).toBe('//nas/photo/2019')
  })

  it('finds a folder on a drive that came back somewhere else', () => {
    const root = { path: 'E:/Archive/2014', volume: { id: 'volume:X', path: 'E:/' } }
    expect(locate(root, [{ id: 'volume:X', label: 'Archive 2014-B', path: 'F:/', removable: true }])).toBe('F:/Archive/2014')
    // Not connected: not the folder, whatever is at E: now.
    expect(locate(root, [])).toBeNull()
    expect(locate(root, [{ id: 'volume:Y', label: 'Another', path: 'E:/', removable: true }])).toBeNull()
    const mac = { path: '/Volumes/Archive', volume: { id: 'uuid:1', path: '/Volumes/Archive' } }
    expect(locate(mac, [{ id: 'uuid:1', label: 'Archive', path: '/Volumes/Archive 1', removable: true }])).toBe('/Volumes/Archive 1')
    expect(locate({ path: '/photos/photo', volume: null }, [])).toBe('/photos/photo')
  })
})

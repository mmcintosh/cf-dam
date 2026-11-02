/**
 * Face chips (src/lib/face-chip.ts): the margin round a found face, kept inside the photo without squashing the face.
 */
import { describe, expect, it } from 'vitest'
import { chipStyle, withMargin } from '../../../src/lib/face-chip'

describe('face chips', () => {
  it('shows a margin round the box on each side', () => {
    expect(withMargin({ x: 400, y: 300, w: 100, h: 150 })).toEqual({ x: 370, y: 255, w: 160, h: 240 })
  })

  it('moves the box back inside at an edge rather than shrinking it', () => {
    expect(withMargin({ x: 0, y: 900, w: 100, h: 100 })).toEqual({ x: 0, y: 840, w: 160, h: 160 })
    expect(withMargin({ x: 950, y: 10, w: 50, h: 50 })).toEqual({ x: 920, y: 0, w: 80, h: 80 })
  })

  it('a face filling the photo shows the whole photo', () => {
    expect(withMargin({ x: 100, y: 0, w: 800, h: 1000 })).toEqual({ x: 0, y: 0, w: 1000, h: 1000 })
    expect(chipStyle('/p', { x: 100, y: 0, w: 800, h: 1000 })).toBe('background-image:url(/p);background-size:100% 100%;background-position:0% 0%')
  })

  it('scales and places the picture so the box with its margin fills the chip', () => {
    // 160 per-mille wide with the margin: the picture is 625% of the chip; x 370 of the 840 it can move is 44.05%.
    const style = chipStyle('/p', { x: 400, y: 300, w: 100, h: 150 })
    expect(style).toContain('background-size:625% 416.6666666666667%')
    expect(style).toMatch(/background-position:44\.04\d*% 33\.55\d*%/)
  })
})

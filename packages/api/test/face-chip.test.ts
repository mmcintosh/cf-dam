/**
 * Face chips (src/lib/face-chip.ts): the margin round a found face, kept inside the photo without squashing the face.
 */
import { describe, expect, it } from 'vitest'
import { chipStyle, outlineStyle, WIDE, withMargin } from '../../../src/lib/face-chip'

describe('face chips', () => {
  it('shows a margin round the box on each side', () => {
    expect(withMargin({ x: 400, y: 300, w: 100, h: 150 })).toEqual({ x: 370, y: 255, w: 160, h: 240 })
  })

  it('moves the box back inside at an edge rather than shrinking it', () => {
    expect(withMargin({ x: 0, y: 900, w: 100, h: 100 })).toEqual({ x: 0, y: 840, w: 160, h: 160 })
    expect(withMargin({ x: 950, y: 10, w: 50, h: 50 })).toEqual({ x: 920, y: 0, w: 80, h: 80 })
  })

  it("near the photo's size the margin shrinks on both sides alike, so the face keeps its shape", () => {
    // 700 tall can only grow to 1000 (×1.43): the width grows as much, not by the full 60%.
    const b = withMargin({ x: 300, y: 150, w: 300, h: 700 })
    expect(b.w / b.h).toBeCloseTo(300 / 700)
    expect(b).toMatchObject({ y: 0, h: 1000 })
    expect(withMargin({ x: 0, y: 0, w: 1000, h: 1000 })).toEqual({ x: 0, y: 0, w: 1000, h: 1000 })
    expect(chipStyle('/p', { x: 0, y: 0, w: 1000, h: 1000 })).toBe('background-image:url(/p);background-size:100% 100%;background-position:0% 0%')
  })

  it('the larger view is head and shoulders, with the face outlined where it is', () => {
    expect(withMargin({ x: 400, y: 400, w: 100, h: 100 }, WIDE)).toEqual({ x: 300, y: 300, w: 300, h: 300 })
    expect(outlineStyle({ x: 400, y: 400, w: 100, h: 100 }, WIDE)).toMatch(/^left:33\.3\d*%;top:33\.3\d*%;width:33\.3\d*%;height:33\.3\d*%$/)
    // At the left edge the view is moved in, so the face sits to the left of its middle.
    expect(outlineStyle({ x: 0, y: 400, w: 100, h: 100 }, WIDE)).toMatch(/^left:0%;top:33\.3\d*%/)
  })

  it('scales and places the picture so the box with its margin fills the chip', () => {
    // 160 per-mille wide with the margin: the picture is 625% of the chip; x 370 of the 840 it can move is 44.05%.
    const style = chipStyle('/p', { x: 400, y: 300, w: 100, h: 150 })
    expect(style).toContain('background-size:625% 416.6666666666667%')
    expect(style).toMatch(/background-position:44\.04\d*% 33\.55\d*%/)
  })
})

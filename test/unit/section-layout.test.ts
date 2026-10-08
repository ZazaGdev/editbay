import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SECTION_LAYOUT,
  DOCK_MAX,
  DOCK_MIN,
  DOCK_WIDTH,
  SECTION_NAMES,
  cleanSectionLayout,
  placeSection,
  showAll,
  showOnly,
  showSection,
  sideOf,
  stepSection
} from '../../src/shared/section-layout'

const empty = DEFAULT_SECTION_LAYOUT

describe('putting an Inspector section beside the timeline (plan 92)', () => {
  it('starts with every section in the Inspector and none hidden', () => {
    expect(empty).toEqual({ left: [], right: [], hidden: [], leftWidth: DOCK_WIDTH, rightWidth: DOCK_WIDTH, shares: {} })
  })

  it('ticks a section off in the Inspector as it goes beside the timeline, and back on as it comes away', () => {
    const out = placeSection(empty, 'Picture in picture', 'right')
    expect(out.right).toEqual(['Picture in picture'])
    expect(out.hidden).toEqual(['Picture in picture'])
    const back = placeSection(out, 'Picture in picture', 'inspector')
    expect(back.right).toEqual([])
    expect(back.hidden).toEqual([])
  })

  it('leaves the tick alone when a section only changes sides, so one ticked back on stays on', () => {
    const shownToo = showSection(placeSection(empty, 'Sound', 'left'), 'Sound', true)
    const moved = placeSection(shownToo, 'Sound', 'right')
    expect(moved).toMatchObject({ left: [], right: ['Sound'], hidden: [] })
  })

  it('lands a section where it is dropped among the others on a side', () => {
    let l = placeSection(empty, 'Look', 'right')
    l = placeSection(l, 'Crop', 'right')
    l = placeSection(l, 'Sound', 'right', 0)
    expect(l.right).toEqual(['Sound', 'Look', 'Crop'])
    // Dropped further down its own side: the place it left does not count.
    expect(placeSection(l, 'Sound', 'right', 2).right).toEqual(['Look', 'Sound', 'Crop'])
    expect(placeSection(l, 'Crop', 'right', 0).right).toEqual(['Crop', 'Sound', 'Look'])
  })

  it('moves a section up and down its side, and no further than its ends', () => {
    let l = placeSection(placeSection(empty, 'Look', 'left'), 'Blur', 'left')
    l = stepSection(l, 'Blur', -1)
    expect(l.left).toEqual(['Blur', 'Look'])
    expect(stepSection(l, 'Blur', -1)).toBe(l)
    expect(stepSection(l, 'Frame', 1)).toBe(l)
  })

  it('forgets a section’s share of the height when it leaves its side', () => {
    const l = { ...placeSection(placeSection(empty, 'Look', 'left'), 'Blur', 'left'), shares: { Look: 1.4, Blur: 0.6 } }
    expect(placeSection(l, 'Look', 'right').shares).toEqual({ Blur: 0.6 })
    expect(placeSection(l, 'Look', 'left', 2).shares).toEqual({ Look: 1.4, Blur: 0.6 })
  })

  it('knows which side a section is on', () => {
    const l = placeSection(empty, 'Zoom', 'left')
    expect(sideOf(l, 'Zoom')).toBe('left')
    expect(sideOf(l, 'Crop')).toBeNull()
  })
})

describe("the Inspector's picker", () => {
  it('ticks sections off and on', () => {
    const off = showSection(empty, 'Look', false)
    expect(off.hidden).toEqual(['Look'])
    expect(showSection(off, 'Look', true).hidden).toEqual([])
  })

  it('shows only one section, then all of them again', () => {
    const one = showOnly(empty, 'Crop')
    expect(one.hidden).toHaveLength(SECTION_NAMES.length - 1)
    expect(one.hidden).not.toContain('Crop')
    expect(showAll(one).hidden).toEqual([])
  })
})

describe('the layout as stored', () => {
  it('keeps only names the Inspector knows, each on one side at most', () => {
    expect(cleanSectionLayout({ left: ['Sound', 'Nope', 'Sound', 3], right: ['Sound', 'Look'], hidden: ['Look', 'Look', 'Gone'] })).toMatchObject({
      left: ['Sound'],
      right: ['Look'],
      hidden: ['Look']
    })
  })

  it('holds each side’s width to what fits, and keeps shares only for sections beside the timeline', () => {
    const l = cleanSectionLayout({ left: ['Look'], leftWidth: 20, rightWidth: 9000, shares: { Look: 2, Crop: 1, Blur: -1 } })
    expect(l).toMatchObject({ leftWidth: DOCK_MIN, rightWidth: DOCK_MAX, shares: { Look: 2 } })
  })

  it('falls back to nothing moved for anything else', () => {
    expect(cleanSectionLayout('left')).toEqual(empty)
    expect(cleanSectionLayout(null)).toEqual(empty)
  })
})

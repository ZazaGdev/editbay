import { describe, it, expect } from 'vitest'
import { COLUMN_MAX, COLUMN_MIN, DEFAULT_WINDOW_SETTINGS, TIMELINE_MIN, cleanWindowSettings } from '../../../src/renderer/state/useSettings'

describe("the window's own settings as stored", () => {
  it('keeps column widths inside what fits', () => {
    expect(cleanWindowSettings({ binWidth: 50, inspectorWidth: 5000 })).toMatchObject({
      binWidth: COLUMN_MIN,
      inspectorWidth: COLUMN_MAX
    })
  })

  it('leaves the timeline as tall as its tracks until its divider is dragged, and never shorter than one track', () => {
    expect(DEFAULT_WINDOW_SETTINGS.timelineHeight).toBeNull()
    expect(cleanWindowSettings({ timelineHeight: 412.4 }).timelineHeight).toBe(412)
    expect(cleanWindowSettings({ timelineHeight: 10 }).timelineHeight).toBe(TIMELINE_MIN)
    expect(cleanWindowSettings({ timelineHeight: 'tall' }).timelineHeight).toBeNull()
  })

  it('keeps the Inspector sections folded or opened by hand, and nothing else', () => {
    expect(DEFAULT_WINDOW_SETTINGS.inspectorFolds).toEqual({})
    expect(cleanWindowSettings({ inspectorFolds: { Crop: true, Look: false, Sound: 'yes' } }).inspectorFolds).toEqual({ Crop: true, Look: false })
    expect(cleanWindowSettings({ inspectorFolds: ['Crop'] }).inspectorFolds).toEqual({})
  })

  it('rounds a width dragged to part of a pixel', () => {
    expect(cleanWindowSettings({ binWidth: 300.6, inspectorWidth: 280 }).binWidth).toBe(301)
  })

  it('falls back to the default for anything missing or wrong, field by field', () => {
    expect(cleanWindowSettings({ binWidth: 'wide', inspectorWidth: 300 })).toEqual({
      ...DEFAULT_WINDOW_SETTINGS,
      inspectorWidth: 300
    })
    expect(cleanWindowSettings(null)).toEqual(DEFAULT_WINDOW_SETTINGS)
    expect(cleanWindowSettings({ binWidth: Number.NaN })).toEqual(DEFAULT_WINDOW_SETTINGS)
  })

  it('starts with the guides off, ready to show thirds and every app’s safe zone', () => {
    expect(DEFAULT_WINDOW_SETTINGS).toMatchObject({ guides: false, thirds: true, safeZone: 'all' })
  })

  it('keeps the guides as chosen, and a safe zone it does not know becomes none', () => {
    expect(cleanWindowSettings({ guides: true, thirds: false, safeZone: 'tiktok' })).toMatchObject({
      guides: true,
      thirds: false,
      safeZone: 'tiktok'
    })
    expect(cleanWindowSettings({ safeZone: 'myspace' }).safeZone).toBe('none')
    expect(cleanWindowSettings({ guides: 'yes' }).guides).toBe(false)
  })

  it('plays at 1x until another of the speeds offered is chosen, and forgets any other', () => {
    expect(DEFAULT_WINDOW_SETTINGS.speed).toBe(1)
    expect(cleanWindowSettings({ speed: 1.5 }).speed).toBe(1.5)
    expect(cleanWindowSettings({ speed: 3 }).speed).toBe(1)
    expect(cleanWindowSettings({ speed: 'fast' }).speed).toBe(1)
  })

  it('skims the timeline until it is turned off, and keeps it off once it is', () => {
    expect(DEFAULT_WINDOW_SETTINGS.skim).toBe(true)
    expect(cleanWindowSettings({ skim: false }).skim).toBe(false)
    expect(cleanWindowSettings({ skim: 'no' }).skim).toBe(true)
    // Stored before the setting existed.
    expect(cleanWindowSettings({ speed: 1 }).skim).toBe(true)
  })

  it('snaps on the timeline until it is turned off, and keeps it off once it is', () => {
    expect(DEFAULT_WINDOW_SETTINGS.snapping).toBe(true)
    expect(cleanWindowSettings({ snapping: false }).snapping).toBe(false)
    expect(cleanWindowSettings({ snapping: 'no' }).snapping).toBe(true)
    expect(cleanWindowSettings({ speed: 1 }).snapping).toBe(true)
  })

  it('starts with the Source and Output side by side, and keeps it turned off once turned off', () => {
    expect(DEFAULT_WINDOW_SETTINGS.sideBySide).toBe(true)
    expect(cleanWindowSettings({ sideBySide: false }).sideBySide).toBe(false)
    expect(cleanWindowSettings({ sideBySide: 'no' }).sideBySide).toBe(true)
  })

  it('keeps what Remove silences was last set to, within range, and the defaults for anything else', () => {
    expect(DEFAULT_WINDOW_SETTINGS.silence).toEqual({ levelDb: -40, shortestSec: 0.5, leaveSec: 0.2 })
    expect(cleanWindowSettings({ silence: { levelDb: -35, shortestSec: 0.8, leaveSec: 0 } }).silence).toEqual({
      levelDb: -35,
      shortestSec: 0.8,
      leaveSec: 0
    })
    expect(cleanWindowSettings({ silence: { levelDb: 5, shortestSec: 0, leaveSec: 9 } }).silence).toEqual({
      levelDb: -10,
      shortestSec: 0.1,
      leaveSec: 2
    })
    expect(cleanWindowSettings({ silence: { levelDb: 'quiet' } }).silence).toEqual(DEFAULT_WINDOW_SETTINGS.silence)
  })

  it('keeps where the Inspector sections sit beside the timeline, starting with none moved (plan 92)', () => {
    expect(DEFAULT_WINDOW_SETTINGS.sections).toMatchObject({ left: [], right: [], hidden: [] })
    expect(cleanWindowSettings({ sections: null }).sections).toEqual(DEFAULT_WINDOW_SETTINGS.sections)
    expect(cleanWindowSettings({ sections: { right: ['Crop'], hidden: ['Crop'] } }).sections).toMatchObject({ right: ['Crop'], hidden: ['Crop'] })
  })
})

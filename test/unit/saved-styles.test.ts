import { describe, it, expect } from 'vitest'
import {
  MAX_SAVED_STYLES,
  captionStyleToSave,
  cleanSavedCaptionStyles,
  cleanSavedTextStyles,
  nextStyleName,
  removeStyle,
  saveStyle,
  textStyleToSave
} from '../../src/shared/saved-styles'
import { DEFAULT_CAPTION_STYLE, cleanCaptionStyle } from '../../src/shared/captions'
import { DEFAULT_TEXT } from '../../src/shared/text'
import { sanitiseSettings } from '../../src/main/settings/app-settings'
import { setCaptionStyle } from '../../src/shared/timeline-captions'
import { createTimeline } from '../../src/shared/project'
import { textStyledAs } from '../../src/shared/apply-to-all'

/** Plan 99: caption and text styles saved under a name, kept with the app's settings. */

describe('a saved caption style', () => {
  const look = { ...DEFAULT_CAPTION_STYLE, font: 'anton', box: true, glow: 0.12, popGrow: true, height: 0.3, across: 0.2 }

  it('keeps how captions look, never where they sit', () => {
    const kept = captionStyleToSave(look)
    expect(kept).toMatchObject({ font: 'anton', box: true, glow: 0.12, popGrow: true, pcFont: null })
    expect(kept).not.toHaveProperty('height')
    expect(kept).not.toHaveProperty('across')
  })

  it('put on a sequence, gives its captions that look and leaves where they sit', () => {
    const t = setCaptionStyle(createTimeline(30, { width: 1080, height: 1920 }), { height: 0.8 })
    const after = setCaptionStyle(t, captionStyleToSave(look)).captions.style
    expect(after).toMatchObject({ font: 'anton', box: true, glow: 0.12, popGrow: true, height: 0.8, across: DEFAULT_CAPTION_STYLE.across })
  })

  it('comes back from the settings file as saved, and a damaged one goes', () => {
    const list = saveStyle([], 'Bold yellow', captionStyleToSave(look), 'a')
    const back = cleanSavedCaptionStyles(JSON.parse(JSON.stringify([...list, { id: 'b', name: '' }, 'x'])))
    expect(back).toEqual(list)
    expect(cleanCaptionStyle({ ...DEFAULT_CAPTION_STYLE, ...back[0]!.style }).box).toBe(true)
  })
})

describe('a saved text style', () => {
  const look = { ...DEFAULT_TEXT, text: 'Hello', font: 'Arial', glow: true, glowColour: '#00ff00', align: 'left' as const }

  it('keeps everything but the words', () => {
    const kept = textStyleToSave(look)
    expect(kept).toMatchObject({ font: 'Arial', glow: true, glowColour: '#00ff00' })
    expect(kept.text).toBe(DEFAULT_TEXT.text)
  })

  it('put on a text, keeps that text its own words and alignment', () => {
    const other = { ...DEFAULT_TEXT, text: 'Bye', align: 'right' as const }
    expect(textStyledAs(textStyleToSave(look), other)).toMatchObject({ text: 'Bye', align: 'right', font: 'Arial', glow: true })
  })

  it('comes back from the settings file as saved', () => {
    const list = saveStyle([], 'Neon', textStyleToSave(look), 't')
    expect(cleanSavedTextStyles(JSON.parse(JSON.stringify(list)))).toEqual(list)
  })
})

describe('the lists of saved styles', () => {
  it('replace one saved again under the same name where it is, and add a new name last', () => {
    let list = saveStyle([], 'One', 1, 'a')
    list = saveStyle(list, 'Two', 2, 'b')
    list = saveStyle(list, 'one', 3, 'c')
    expect(list).toEqual([
      { id: 'a', name: 'One', style: 3 },
      { id: 'b', name: 'Two', style: 2 }
    ])
    expect(saveStyle(list, '   ', 4)).toEqual(list)
    expect(removeStyle(list, 'a').map((s) => s.name)).toEqual(['Two'])
  })

  it('keep at most forty, forgetting the oldest', () => {
    let list = saveStyle<number>([], 'S0', 0, 'id0')
    for (let i = 1; i <= MAX_SAVED_STYLES; i++) list = saveStyle(list, `S${i}`, i, `id${i}`)
    expect(list).toHaveLength(MAX_SAVED_STYLES)
    expect(list[0]!.name).toBe('S1')
  })

  it('offer a name not taken yet', () => {
    expect(nextStyleName([], 'My caption style')).toBe('My caption style')
    expect(nextStyleName(saveStyle([], 'My caption style', 0), 'My caption style')).toBe('My caption style 2')
  })

  it('are kept apart in the settings: captions in one, texts in the other', () => {
    const s = sanitiseSettings({ savedCaptionStyles: saveStyle([], 'C', captionStyleToSave(DEFAULT_CAPTION_STYLE), 'c'), savedTextStyles: 'nonsense' })
    expect(s.savedCaptionStyles.map((x) => x.name)).toEqual(['C'])
    expect(s.savedTextStyles).toEqual([])
  })
})

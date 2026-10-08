import { describe, it, expect } from 'vitest'
import { defaultSettings, sanitiseSettings } from '../../src/main/settings/app-settings'

/** What a transition defaults to before one has ever been added. */
const TRANSITION = {
  transitionSeconds: 1,
  transitionPictureKind: 'dissolve',
  transitionSoundKind: 'even',
  transitionOnEveryCut: false,
  // And how exports go before anything is chosen: as they always went.
  exportFolder: null,
  exportMode: 'join',
  exportPattern: '{project}_{index}_{clip}',
  exportExisting: 'ask',
  showAfterExport: false,
  // No layouts saved yet.
  savedLayouts: [],
  savedShapes: [],
  savedCaptionStyles: [],
  savedTextStyles: [],
  lastShape: 'vertical',
  textStyle: null,
  lastFraming: null,
  // Sources' folders before any are made: Recordings alone, following OBS's own folder.
  sourceFolders: [{ id: 'recordings', name: 'Recordings', kind: 'recordings', folder: null, newestFirst: true }],
  // No file marked by hand as needing a credit (task 47).
  credits: {}
}

describe("the app's settings as read from disk", () => {
  it('starts with saving automatically on and Recordings following OBS', () => {
    expect(defaultSettings()).toEqual({
      saveAutomatically: true,
      microphoneId: null,
      muteWhileRecording: false,
      ...TRANSITION
    })
  })

  it('keeps what is right', () => {
    expect(sanitiseSettings({ saveAutomatically: true, microphoneId: 'usb-mic', muteWhileRecording: true })).toEqual({
      saveAutomatically: true,
      microphoneId: 'usb-mic',
      muteWhileRecording: true,
      ...TRANSITION
    })
  })

  it('takes the default for each field that is wrong, and keeps the rest', () => {
    expect(sanitiseSettings({ saveAutomatically: 'yes', microphoneId: 3, muteWhileRecording: 'no' })).toEqual({
      saveAutomatically: true,
      microphoneId: null,
      muteWhileRecording: false,
      ...TRANSITION
    })
    expect(sanitiseSettings({ saveAutomatically: false, microphoneId: '' })).toEqual({
      saveAutomatically: false,
      microphoneId: null,
      muteWhileRecording: false,
      ...TRANSITION
    })
  })

  it("makes Sources' folders the first time from the recordings and library folders there were, and keeps them after", () => {
    expect(sanitiseSettings({ recordingsFolder: 'D:\\OBS', libraryVideoFolder: 'D:\\fx', librarySoundFolder: '  ' }).sourceFolders).toEqual([
      { id: 'recordings', name: 'Recordings', kind: 'recordings', folder: 'D:\\OBS', newestFirst: true },
      { id: 'library-video', name: 'Video library', kind: 'folder', folder: 'D:\\fx', newestFirst: false }
    ])
    const mine = [{ id: 'a', name: 'Music', kind: 'folder', folder: 'E:\\music', newestFirst: false }]
    expect(sanitiseSettings({ sourceFolders: mine, libraryVideoFolder: 'D:\\fx' }).sourceFolders).toEqual(mine)
    // Every one taken out stays that way.
    expect(sanitiseSettings({ sourceFolders: [] }).sourceFolders).toEqual([])
  })

  it('leaves a transition on every cut off until it is turned on', () => {
    expect(defaultSettings().transitionOnEveryCut).toBe(false)
    expect(sanitiseSettings({ transitionOnEveryCut: true }).transitionOnEveryCut).toBe(true)
    expect(sanitiseSettings({ transitionOnEveryCut: 'yes' }).transitionOnEveryCut).toBe(false)
  })

  it('remembers the transition last used, and refuses a length or a kind it could not use', () => {
    expect(sanitiseSettings({ transitionSeconds: 0.5, transitionPictureKind: 'wipeLeft', transitionSoundKind: 'smooth' })).toMatchObject({
      transitionSeconds: 0.5,
      transitionPictureKind: 'wipeLeft',
      transitionSoundKind: 'smooth'
    })
    expect(sanitiseSettings({ transitionSeconds: 0, transitionPictureKind: 'kaleidoscope', transitionSoundKind: 'wipeLeft' })).toMatchObject(
      TRANSITION
    )
    expect(sanitiseSettings({ transitionSeconds: 9000 })).toMatchObject({ transitionSeconds: 1 })
  })

  it('keeps how exports should go, and refuses what an export could not use', () => {
    expect(
      sanitiseSettings({ exportFolder: 'D:\out', exportMode: 'batch', exportPattern: '{clip}', exportExisting: 'keepBoth', showAfterExport: true })
    ).toMatchObject({ exportFolder: 'D:\out', exportMode: 'batch', exportPattern: '{clip}', exportExisting: 'keepBoth', showAfterExport: true })
    expect(
      sanitiseSettings({ exportFolder: ' ', exportMode: 'zip', exportPattern: '', exportExisting: 'never', showAfterExport: 'yes' })
    ).toMatchObject({ exportFolder: null, exportMode: 'join', exportPattern: '{project}_{index}_{clip}', exportExisting: 'ask', showAfterExport: false })
  })

  it('gives the defaults for anything that is not settings at all', () => {
    for (const raw of [null, undefined, 3, 'x', [], [true]]) expect(sanitiseSettings(raw)).toEqual(defaultSettings())
  })
})

describe('saved layouts in the settings', () => {
  const framing = {
    crop: { x: 0, y: 0, w: 1920, h: 1080 },
    place: { x: 0, y: 0, w: 1, h: 1 },
    layers: [],
    layout: 'single',
    width: 1920,
    height: 1080,
    frameW: 1080,
    frameH: 1920
  }

  it('keeps the good ones and drops a damaged one, rather than losing them all', () => {
    const read = sanitiseSettings({
      savedLayouts: [
        { id: 'a', name: '  Game  +  facecam ', framing },
        { id: 'b', name: 'Broken', framing: { ...framing, crop: 'wide' } },
        { id: 'c', name: 'Talking head', framing: { ...framing, layout: 'split' } }
      ]
    })
    expect(read.savedLayouts.map((l) => l.name)).toEqual(['Game + facecam', 'Talking head'])
  })

  it('reads anything that is not a list as none', () => {
    expect(sanitiseSettings({ savedLayouts: 'many' }).savedLayouts).toEqual([])
  })
})

describe('the shape last chosen', () => {
  it('starts on Vertical, keeps a shape it knows, and forgets one it does not', () => {
    expect(defaultSettings().lastShape).toBe('vertical')
    expect(sanitiseSettings({ lastShape: 'landscape' }).lastShape).toBe('landscape')
    expect(sanitiseSettings({ lastShape: 'cinema' }).lastShape).toBe('vertical')
    expect(sanitiseSettings({ lastShape: 3 }).lastShape).toBe('vertical')
  })
})

describe('the framing last used (plan 93)', () => {
  it('is none at first, keeps a whole framing, and forgets a damaged one', () => {
    expect(defaultSettings().lastFraming).toBeNull()
    const framing = {
      crop: { x: 0, y: 0, w: 1920, h: 1080 },
      place: { x: 0.05, y: 0.05, w: 0.5, h: 0.5 },
      layers: [],
      layout: 'custom',
      width: 1920,
      height: 1080,
      frameW: 1920,
      frameH: 1080
    }
    expect(sanitiseSettings({ lastFraming: framing }).lastFraming).toEqual(framing)
    expect(sanitiseSettings({ lastFraming: { ...framing, width: 0 } }).lastFraming).toBeNull()
    expect(sanitiseSettings({ lastFraming: 'pip' }).lastFraming).toBeNull()
  })
})

describe('the style a new text starts as (bugs and notes 2, note 26)', () => {
  it('is none at first, keeps how a text looks without its words, and cleans what it keeps', () => {
    expect(defaultSettings().textStyle).toBeNull()
    const kept = sanitiseSettings({ textStyle: { text: 'Hello', size: 48, colour: '#FF0000' } }).textStyle
    expect(kept).toMatchObject({ size: 48, colour: '#ff0000', text: 'Your text' })
    expect(sanitiseSettings({ textStyle: 'big' }).textStyle).toBeNull()
  })
})

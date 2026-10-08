/**
 * Keyboard shortcuts: what every action is, what key it starts on, and how the
 * keys you choose are merged with those defaults.
 *
 * A binding is a normalised string: modifiers in a fixed order, then the
 * physical key's `KeyboardEvent.code`, for example `Ctrl+Shift+KeyZ`. Physical
 * rather than the character typed, because the character changes with the
 * keyboard layout: with a Georgian layout active, the S key types a Georgian
 * letter, and a shortcut matched on the character stops working silently.
 *
 * Only the actions you change are stored. Defaults fill in the rest at load, so
 * an action added later arrives with its default key rather than none.
 */

export type ActionId =
  | 'playPause'
  | 'stepBack'
  | 'stepForward'
  | 'jumpBack'
  | 'jumpForward'
  | 'goToStart'
  | 'goToEnd'
  | 'previousCut'
  | 'nextCut'
  | 'previousMarker'
  | 'nextMarker'
  | 'shuttleBack'
  | 'shuttleStop'
  | 'shuttleForward'
  | 'toggleLoop'
  | 'recordVoice'
  | 'addMarker'
  | 'addPictureTransition'
  | 'addSoundTransition'
  | 'split'
  | 'splitAll'
  | 'markIn'
  | 'markOut'
  | 'clearMarks'
  | 'trimStartToPlayhead'
  | 'trimEndToPlayhead'
  | 'deleteClip'
  | 'closeUp'
  | 'removeSilences'
  | 'deselect'
  | 'selectNextClip'
  | 'selectPreviousClip'
  | 'undo'
  | 'redo'
  | 'zoomIn'
  | 'fitTimeline'
  | 'zoomOut'
  | 'toggleView'
  | 'toggleGuides'
  | 'toggleSnapping'
  | 'fullscreen'
  | 'nudgeLeft'
  | 'nudgeRight'
  | 'nudgeUp'
  | 'nudgeDown'
  | 'copyFraming'
  | 'addText'
  | 'addBlackScreen'
  | 'saveFrame'
  | 'earlierVersions'
  | 'saveTranscript'
  | 'pasteFraming'
  | 'copyCrop'
  | 'joinClips'
  | 'groupClips'
  | 'ungroupClips'
  | 'copyClips'
  | 'cutClips'
  | 'pasteClips'
  | 'pasteCrop'
  | 'toggleZoomKey'
  | 'previousZoomKey'
  | 'nextZoomKey'
  | 'moveOutOfTheWay'
  | 'fadeOutOfTheWay'
  | 'showShortcuts'
  | 'showTutorials'
  | 'showSettings'
  | 'commandPalette'
  | 'searchSources'
  | 'newProject'
  | 'openProject'
  | 'save'
  | 'saveAs'
  | 'export'
  | 'makeCaptions'
  | 'addVideoTrack'
  | 'addAudioTrack'

export type ActionGroup = 'Playback' | 'Editing' | 'View' | 'Project'

export interface ActionDef {
  id: ActionId
  label: string
  group: ActionGroup
  defaults: string[]
}

export const ACTIONS: ActionDef[] = [
  { id: 'playPause', label: 'Play or pause', group: 'Playback', defaults: ['Space'] },
  { id: 'stepBack', label: 'Back one frame', group: 'Playback', defaults: ['ArrowLeft'] },
  { id: 'stepForward', label: 'Forward one frame', group: 'Playback', defaults: ['ArrowRight'] },
  { id: 'jumpBack', label: 'Back one second', group: 'Playback', defaults: ['Shift+ArrowLeft'] },
  { id: 'jumpForward', label: 'Forward one second', group: 'Playback', defaults: ['Shift+ArrowRight'] },
  { id: 'goToStart', label: 'Go to start', group: 'Playback', defaults: ['Home'] },
  { id: 'goToEnd', label: 'Go to end', group: 'Playback', defaults: ['End'] },
  // Up and Down, as in Premiere: every clip's start and end, on any track.
  { id: 'previousCut', label: 'Go to the previous cut', group: 'Playback', defaults: ['ArrowUp'] },
  { id: 'nextCut', label: 'Go to the next cut', group: 'Playback', defaults: ['ArrowDown'] },
  // Shift on the same two: Up and Down are the cuts, so Shift+Up and Shift+Down
  // are the markers. Shift+Left and Shift+Right are already a bigger step than
  // their plain selves, so this reads the same way round.
  { id: 'previousMarker', label: 'Go to the previous marker', group: 'Playback', defaults: ['Shift+ArrowUp'] },
  { id: 'nextMarker', label: 'Go to the next marker', group: 'Playback', defaults: ['Shift+ArrowDown'] },
  // J, K and L, as in Premiere: again for faster, K held with J or L for one frame.
  { id: 'shuttleBack', label: 'Play backwards, faster each time (a frame back with K held)', group: 'Playback', defaults: ['KeyJ'] },
  { id: 'shuttleStop', label: 'Stop (hold it and press J or L for one frame)', group: 'Playback', defaults: ['KeyK'] },
  { id: 'shuttleForward', label: 'Play, faster each time (a frame on with K held)', group: 'Playback', defaults: ['KeyL'] },
  { id: 'toggleLoop', label: 'Loop the selected clip, or the whole sequence', group: 'Playback', defaults: ['Ctrl+KeyL'] },
  { id: 'recordVoice', label: 'Record a voice over, or stop', group: 'Playback', defaults: ['KeyR'] },

  // M is free, and it is the key every other editor drops a marker with.
  { id: 'addMarker', label: 'Drop a marker at the playhead', group: 'Editing', defaults: ['KeyM'] },
  // Premiere's own two, and both were free here.
  { id: 'addPictureTransition', label: 'Add a transition at the nearest cut', group: 'Editing', defaults: ['Ctrl+KeyD'] },
  { id: 'addSoundTransition', label: 'Add a sound transition at the nearest cut', group: 'Editing', defaults: ['Ctrl+Shift+KeyD'] },
  { id: 'split', label: 'Split at playhead', group: 'Editing', defaults: ['KeyS'] },
  { id: 'splitAll', label: 'Split every track at playhead', group: 'Editing', defaults: ['Shift+KeyS'] },
  // I and O are this app's trims, from plan 7, so the marks take Shift with them.
  { id: 'markIn', label: 'Mark In at the playhead', group: 'Editing', defaults: ['Shift+KeyI'] },
  { id: 'markOut', label: 'Mark Out at the playhead', group: 'Editing', defaults: ['Shift+KeyO'] },
  { id: 'clearMarks', label: 'Clear In and Out', group: 'Editing', defaults: ['Ctrl+Shift+KeyX'] },
  { id: 'trimStartToPlayhead', label: 'Trim clip start to playhead', group: 'Editing', defaults: ['KeyI'] },
  { id: 'trimEndToPlayhead', label: 'Trim clip end to playhead', group: 'Editing', defaults: ['KeyO'] },
  { id: 'deleteClip', label: 'Delete the selection, or the marked range, leaving a gap', group: 'Editing', defaults: ['Delete', 'Backspace'] },
  { id: 'closeUp', label: 'Remove and close up', group: 'Editing', defaults: ['Shift+Delete', 'Shift+Backspace'] },
  // Used once a video, so it has no key unless one is given.
  { id: 'removeSilences', label: 'Remove silences', group: 'Editing', defaults: [] },
  { id: 'deselect', label: 'Clear the selection', group: 'Editing', defaults: ['Escape'] },
  // Clips chosen from the keyboard, for anyone not using a mouse (audit 2026-10-01).
  { id: 'selectNextClip', label: 'Select the next clip on the track', group: 'Editing', defaults: ['BracketRight'] },
  { id: 'selectPreviousClip', label: 'Select the previous clip on the track', group: 'Editing', defaults: ['BracketLeft'] },
  { id: 'undo', label: 'Undo', group: 'Editing', defaults: ['Ctrl+KeyZ'] },
  { id: 'redo', label: 'Redo', group: 'Editing', defaults: ['Ctrl+KeyY', 'Ctrl+Shift+KeyZ'] },
  // By 2 pixels, or 20 with Shift: the crop in the Source view, the place in the Output view.
  { id: 'nudgeLeft', label: 'Nudge the picture left (2 pixels, 20 with Shift)', group: 'Editing', defaults: ['Alt+ArrowLeft', 'Alt+Shift+ArrowLeft'] },
  { id: 'nudgeRight', label: 'Nudge the picture right (2 pixels, 20 with Shift)', group: 'Editing', defaults: ['Alt+ArrowRight', 'Alt+Shift+ArrowRight'] },
  { id: 'nudgeUp', label: 'Nudge the picture up (2 pixels, 20 with Shift)', group: 'Editing', defaults: ['Alt+ArrowUp', 'Alt+Shift+ArrowUp'] },
  { id: 'nudgeDown', label: 'Nudge the picture down (2 pixels, 20 with Shift)', group: 'Editing', defaults: ['Alt+ArrowDown', 'Alt+Shift+ArrowDown'] },
  { id: 'copyFraming', label: "Copy the clip's framing", group: 'Editing', defaults: ['Ctrl+Alt+KeyC'] },
  { id: 'addText', label: 'Add text over the video, at the playhead', group: 'Editing', defaults: ['KeyT'] },
  { id: 'addBlackScreen', label: 'Add a black screen, for an end card, at the playhead', group: 'Editing', defaults: ['Shift+KeyB'] },
  { id: 'pasteFraming', label: 'Paste the framing onto the clip', group: 'Editing', defaults: ['Ctrl+Alt+KeyV'] },
  // The framing keys with Shift: the crop alone, without the place, layers and layout.
  { id: 'copyCrop', label: "Copy the clip's crop", group: 'Editing', defaults: ['Ctrl+Alt+Shift+KeyC'] },
  // Beside J's place on the keyboard, and J is shuttle, so held with Ctrl.
  { id: 'joinClips', label: 'Join clips into one, bringing back anything cut between them', group: 'Editing', defaults: ['Ctrl+KeyJ'] },
  { id: 'groupClips', label: 'Group the selected clips into one clip, keeping the cuts', group: 'Editing', defaults: ['Ctrl+KeyG'] },
  { id: 'ungroupClips', label: 'Ungroup the selected clip back into its pieces', group: 'Editing', defaults: ['Ctrl+Shift+KeyG'] },
  { id: 'copyClips', label: 'Copy the selected clips', group: 'Editing', defaults: ['Ctrl+KeyC'] },
  { id: 'cutClips', label: 'Cut the selected clips, leaving a gap', group: 'Editing', defaults: ['Ctrl+KeyX'] },
  { id: 'pasteClips', label: 'Paste the copied clips at the playhead', group: 'Editing', defaults: ['Ctrl+KeyV'] },
  { id: 'pasteCrop', label: 'Paste the crop onto the selected clips', group: 'Editing', defaults: ['Ctrl+Alt+Shift+KeyV'] },
  // Final Cut Pro adds a keyframe with Option-K and Resolve steps between them
  // with the brackets. K alone is stop and Ctrl+K the search, so Alt it is.
  { id: 'toggleZoomKey', label: 'Add or remove a zoom keyframe at the playhead', group: 'Editing', defaults: ['Alt+KeyK'] },
  { id: 'previousZoomKey', label: 'Go to the previous zoom keyframe', group: 'Playback', defaults: ['Alt+BracketLeft'] },
  { id: 'nextZoomKey', label: 'Go to the next zoom keyframe', group: 'Playback', defaults: ['Alt+BracketRight'] },
  // Plan 97: the face cam out of the way over In to Out, or a second and a half from the playhead.
  { id: 'moveOutOfTheWay', label: 'Move the picture in picture out of the way, to a free corner and back', group: 'Editing', defaults: [] },
  { id: 'fadeOutOfTheWay', label: 'Fade the picture in picture out of the way and back', group: 'Editing', defaults: [] },
  // Task 62: V and A for the kind of track, with Ctrl+Shift, which nothing else uses.
  { id: 'addVideoTrack', label: 'Add a video track, above the others', group: 'Editing', defaults: ['Ctrl+Shift+KeyV'] },
  { id: 'addAudioTrack', label: 'Add an audio track, below the others', group: 'Editing', defaults: ['Ctrl+Shift+KeyA'] },

  { id: 'zoomIn', label: 'Zoom timeline in', group: 'View', defaults: ['Equal'] },
  { id: 'zoomOut', label: 'Zoom timeline out', group: 'View', defaults: ['Minus'] },
  // Shift+F, beside F for full screen: both are "show me the whole of it".
  { id: 'fitTimeline', label: 'Fit the whole edit on screen', group: 'View', defaults: ['Shift+KeyF'] },
  { id: 'toggleView', label: 'Switch between the Source and Output views', group: 'View', defaults: ['KeyV'] },
  { id: 'toggleGuides', label: 'Show or hide the guides', group: 'View', defaults: ['KeyG'] },
  { id: 'toggleSnapping', label: 'Turn snapping on the timeline on or off', group: 'Editing', defaults: ['KeyN'] },
  { id: 'fullscreen', label: 'Monitor full screen', group: 'View', defaults: ['KeyF'] },
  { id: 'showShortcuts', label: 'Keyboard shortcuts', group: 'View', defaults: ['Ctrl+Slash'] },
  { id: 'showTutorials', label: 'Tutorials', group: 'View', defaults: ['F1'] },
  { id: 'showSettings', label: 'Settings', group: 'View', defaults: ['Ctrl+Comma'] },
  { id: 'commandPalette', label: 'Search every action', group: 'View', defaults: ['Ctrl+KeyK'] },
  { id: 'searchSources', label: 'Search the sources, recordings and library', group: 'View', defaults: ['Ctrl+KeyF'] },

  { id: 'newProject', label: 'New project', group: 'Project', defaults: ['Ctrl+KeyN'] },
  { id: 'openProject', label: 'Open project', group: 'Project', defaults: ['Ctrl+KeyO'] },
  { id: 'save', label: 'Save', group: 'Project', defaults: ['Ctrl+KeyS'] },
  { id: 'saveAs', label: 'Save as', group: 'Project', defaults: ['Ctrl+Shift+KeyS'] },
  { id: 'export', label: 'Export', group: 'Project', defaults: ['Ctrl+KeyE'] },
  // Used once a video, so it has no key unless you give it one.
  { id: 'makeCaptions', label: 'Make captions from the speech', group: 'Editing', defaults: [] },
  // A still of the frame at the playhead, from anywhere. S for snapshot:
  // Ctrl+Shift+S is Save as, and Windows keeps Print Screen for itself.
  { id: 'saveFrame', label: 'Save the frame at the playhead as an image', group: 'Project', defaults: ['Ctrl+Alt+KeyS'] },
  // Now and then, like a cover: no key unless you give it one.
  { id: 'saveTranscript', label: 'Save only the transcript, as a text file', group: 'Project', defaults: [] },
  // Rarely, and in the Recent menu too: no key unless you give it one (plan 84).
  { id: 'earlierVersions', label: 'Earlier versions of this project', group: 'Project', defaults: [] }
]

export const GROUPS: ActionGroup[] = ['Playback', 'Editing', 'View', 'Project']

/** Every action's current keys. */
export type Keymap = Record<ActionId, string[]>

/** Only the actions that differ from their defaults, as their full key lists. */
export type Overrides = Partial<Record<ActionId, string[]>>

/** The parts of a KeyboardEvent a binding is made from. */
export interface KeyLike {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const

const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight'
])

const CODE_TOKEN = /^[A-Za-z0-9]+$/

const DEFAULTS = new Map<ActionId, string[]>(ACTIONS.map((a) => [a.id, a.defaults]))

/**
 * The binding a keypress makes, or null for one that cannot be a shortcut: a
 * modifier pressed on its own, or a key the browser could not identify.
 */
export function comboFromEvent(e: KeyLike): string | null {
  if (!e.code || e.code === 'Unidentified' || MODIFIER_CODES.has(e.code)) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  parts.push(e.code)
  return parts.join('+')
}

/** The mouse buttons a shortcut can be put on, by the number a pointer event gives each. */
const MOUSE_CODES: Record<number, string> = {
  1: 'MouseMiddle',
  3: 'MouseBack',
  4: 'MouseForward'
}

/**
 * The binding a mouse button makes: the middle button and the two on the
 * side, held with any modifiers, as a key is. Null for the left and right
 * buttons, which click and open menus and are never shortcuts.
 */
export function comboFromMouse(e: { button: number; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string | null {
  const code = MOUSE_CODES[e.button]
  return code ? comboFromEvent({ ...e, code }) : null
}

/** Whether a string is a binding comboFromEvent could have produced. */
export function isValidCombo(combo: string): boolean {
  if (typeof combo !== 'string' || combo === '') return false
  const parts = combo.split('+')
  const code = parts[parts.length - 1] ?? ''
  if (!CODE_TOKEN.test(code) || MODIFIER_CODES.has(code)) return false
  if ((MODIFIER_ORDER as readonly string[]).includes(code)) return false

  let last = -1
  for (const mod of parts.slice(0, -1)) {
    const at = (MODIFIER_ORDER as readonly string[]).indexOf(mod)
    // Unknown, repeated or out of order.
    if (at <= last) return false
    last = at
  }
  return true
}

const NAMED: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Equal: '=',
  Minus: '-',
  Slash: '/',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  NumpadEnter: 'Num Enter',
  MouseMiddle: 'Middle mouse button',
  MouseBack: 'Mouse back button',
  MouseForward: 'Mouse forward button'
}

function codeLabel(code: string): string {
  const named = NAMED[code]
  if (named) return named
  const letter = code.match(/^Key([A-Z])$/)
  if (letter?.[1]) return letter[1]
  const digit = code.match(/^Digit(\d)$/)
  if (digit?.[1]) return digit[1]
  const pad = code.match(/^Numpad(\d)$/)
  if (pad?.[1]) return `Num ${pad[1]}`
  return code
}

/** A binding as a person reads it: `Ctrl+Shift+KeyZ` becomes `Ctrl+Shift+Z`. */
export function formatCombo(combo: string): string {
  const parts = combo.split('+')
  const code = parts.pop() ?? ''
  return [...parts, codeLabel(code)].join('+')
}

/**
 * Every action's keys: yours where you changed them, the defaults elsewhere.
 *
 * Guarantees no key means two things, whatever the saved file says. A key you
 * chose beats a default that used it, and between two actions you both gave the
 * same key, the one listed first keeps it.
 */
export function resolveKeymap(overrides: Overrides): Keymap {
  const map = {} as Keymap
  const claimed = new Set<string>()

  for (const a of ACTIONS) {
    const chosen = overrides[a.id]
    if (!chosen) continue
    map[a.id] = chosen.filter((c) => {
      if (claimed.has(c)) return false
      claimed.add(c)
      return true
    })
  }

  for (const a of ACTIONS) {
    if (overrides[a.id]) continue
    map[a.id] = a.defaults.filter((c) => {
      if (claimed.has(c)) return false
      claimed.add(c)
      return true
    })
  }

  return map
}

/** From a key to the action it runs. */
export function buildLookup(keymap: Keymap): Map<string, ActionId> {
  const lookup = new Map<string, ActionId>()
  for (const a of ACTIONS) for (const combo of keymap[a.id]) lookup.set(combo, a.id)
  return lookup
}

/** The other action that already uses this key, if there is one. */
export function findConflict(keymap: Keymap, combo: string, exceptAction?: ActionId): ActionId | null {
  for (const a of ACTIONS) {
    if (a.id !== exceptAction && keymap[a.id].includes(combo)) return a.id
  }
  return null
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x))
}

/** Drop any override that has come back round to the default, so only real changes are stored. */
function normalise(overrides: Overrides): Overrides {
  const out: Overrides = {}
  for (const a of ACTIONS) {
    const list = overrides[a.id]
    if (list && !sameSet(list, DEFAULTS.get(a.id) ?? [])) out[a.id] = list
  }
  return out
}

/**
 * Give an action another key. If something else already had it, it moves, so a
 * key never means two things.
 */
export function assignCombo(overrides: Overrides, actionId: ActionId, combo: string): Overrides {
  if (!isValidCombo(combo)) throw new Error(`${combo} is not a valid shortcut`)
  const map = resolveKeymap(overrides)
  const next: Overrides = { ...overrides }

  for (const a of ACTIONS) {
    if (a.id !== actionId && map[a.id].includes(combo)) {
      next[a.id] = map[a.id].filter((c) => c !== combo)
    }
  }

  const mine = map[actionId]
  next[actionId] = mine.includes(combo) ? mine : [...mine, combo]
  return normalise(next)
}

/** Take one key off an action. The action may be left with none. */
export function removeCombo(overrides: Overrides, actionId: ActionId, combo: string): Overrides {
  const map = resolveKeymap(overrides)
  return normalise({ ...overrides, [actionId]: map[actionId].filter((c) => c !== combo) })
}

/**
 * Put an action back on its default keys, taking them back from wherever they
 * went, so resetting never leaves one key claimed twice.
 */
export function resetAction(overrides: Overrides, actionId: ActionId): Overrides {
  const map = resolveKeymap(overrides)
  const defaults = DEFAULTS.get(actionId) ?? []
  const next: Overrides = { ...overrides }
  delete next[actionId]

  for (const a of ACTIONS) {
    if (a.id === actionId) continue
    if (map[a.id].some((c) => defaults.includes(c))) {
      next[a.id] = map[a.id].filter((c) => !defaults.includes(c))
    }
  }
  return normalise(next)
}

export function isCustomised(overrides: Overrides, actionId: ActionId): boolean {
  return overrides[actionId] !== undefined
}

/**
 * Clean up a saved keymap before trusting it. The file may have been edited by
 * hand, or written by a version with actions this one does not have.
 */
export function sanitiseOverrides(raw: unknown): Overrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const source = raw as Record<string, unknown>
  const out: Overrides = {}
  for (const a of ACTIONS) {
    const value = source[a.id]
    if (!Array.isArray(value)) continue
    out[a.id] = [...new Set(value.filter((c): c is string => typeof c === 'string' && isValidCombo(c)))]
  }
  return out
}

/** The first key an action is on, as a person reads it, or '' when it has none. */
export function keyLabel(keymap: Keymap, id: ActionId): string {
  const first = keymap[id]?.[0]
  return first ? formatCombo(first) : ''
}

/** A button's tooltip: what it does, and its key when it has one. */
export function withKey(text: string, keymap: Keymap, id: ActionId): string {
  const key = keyLabel(keymap, id)
  return key ? `${text} (${key})` : text
}

export function actionLabel(id: ActionId): string {
  return ACTIONS.find((a) => a.id === id)?.label ?? id
}

/**
 * The one place in the renderer where a colour, a size, a weight, a radius, a
 * shadow or a duration is written.
 *
 * Every value here is also written onto the document as a custom property by
 * `applyTheme`, so `ui.css` can reach it with `var(--...)`. That is the only
 * reason both forms exist: a stylesheet can express a hover, a press and a
 * keyboard focus, which an inline style cannot, and it needs the same values.
 * There is no second copy to keep in step, because the properties are written
 * from this object at startup.
 *
 * The values here are today's look; another theme from `themes.ts` replaces
 * some of them as the window loads.
 *
 * `src/renderer/preview/` is exempt from all of this: it draws video pixels
 * rather than the window, and the caption colours there are your data.
 */

import { THEME_CHANGES, chosenTheme } from './themes'

/** Surfaces, darkest to lightest. A panel sits on the canvas, a row on a panel. */
export const surface = {
  /** The window itself. */
  canvas: '#0B0D10',
  /**
   * The well the video is drawn into, and anything drawn over it edge to edge.
   * True black, not the canvas: the bars beside a picture that does not fill
   * the frame have to be the same black the picture's own letterbox is, or the
   * frame looks like it has a border.
   */
  well: '#000000',
  /** Panels and bars. */
  panel: '#12151A',
  /** A row or a card on a panel. */
  raised: '#171B21',
  /** A control at rest. */
  control: '#1E232B',
  /** Below the panel: the track a segmented switch runs in, a control that is off. */
  sunken: '#15191F',
  /** A control under the pointer. */
  controlHover: '#262C36',
  /** A divider inside a panel. */
  line: '#22272F',
  /** The border of a control or a panel. */
  lineStrong: '#2E353F',
  /** A handle, or the border of a control under the pointer. */
  edge: '#3F4856',
  /**
   * The border of a box you type or choose in, which is all that shows where
   * it is: 3:1 against the panel and a row, as WCAG asks of a control's edge
   * (audit 2026-10-01; the line it had was 1.48:1).
   */
  controlLine: '#646E7C',
  /** The same under the pointer. */
  controlLineHover: '#808A99',
  /** The window dimmed behind a dialog. */
  scrim: 'rgba(0, 0, 0, 0.55)',
  /** A chip over the picture, dark enough to read on any shot. */
  overlay: 'rgba(0, 0, 0, 0.55)',
  /** A hairline over the picture, faint enough never to read as part of the shot. */
  overlayLine: 'rgba(255, 255, 255, 0.22)',
  /** The same where it has to be followed by eye: a crop's thirds, the ruler's hover. */
  overlayLineStrong: 'rgba(255, 255, 255, 0.4)',
  /** Behind words typed over the picture: dark enough to hide what was drawn there before. */
  overlayDense: 'rgba(0, 0, 0, 0.85)'
} as const

/**
 * Text. The first three clear 4.5:1 on every surface above, a control under
 * the pointer included, which the greys written through the components before
 * this file did not. Disabled clears 3:1 on a panel: plainly off, and still
 * readable, since what is off says why when you point at it.
 */
export const ink = {
  primary: '#E8EBF0',
  secondary: '#A6AFBD',
  muted: '#8F99A9',
  disabled: '#646D7C',
  /** On the accent, which is light enough to need dark text. */
  onAccent: '#071018'
} as const

/**
 * One accent, for the primary action, the selection and the focus ring, and
 * nothing else. A second accent is the fastest way to lose the meaning of the
 * first.
 */
export const accent = {
  base: '#4C8DF5',
  bright: '#6FA3FF',
  /** The fill of a control that is on. */
  wash: '#24303F',
  /** Its border. */
  washLine: '#38546F',
  /**
   * The fill of a toggle or a choice that is on: a blue plainly brighter than
   * a control at rest, so it reads as on without putting two side by side,
   * and plainly darker than a primary button, so it never reads as one.
   */
  pressed: '#2C4C80',
  /** The same under the pointer. */
  pressedHover: '#35599A',
  /** Over the tracks: a stretch picked out, or a landing a drag would take. */
  tint: 'rgba(76, 141, 245, 0.12)',
  tintLine: 'rgba(76, 141, 245, 0.45)',
  /** The same, stronger, for the band on the ruler and the box drawn over the tracks. */
  band: 'rgba(76, 141, 245, 0.22)'
} as const

/** One colour each, and each used for one thing. */
export const meaning = {
  /** Where you are, and nothing else. */
  playhead: '#FF3B30',
  /** Record, and a refusal. */
  stop: '#E5484D',
  /** A pause, work not saved. */
  attention: '#F5B23D',
  /** Ready, exported. */
  done: '#4FBF87'
} as const

/**
 * Bugs and notes 2, note 25: one colour for each picture of a clip, wherever
 * it appears (its button, its box on either view, the Zoom and Crop headings),
 * so orange anywhere means Picture 2. The main picture's is the accent. A clip
 * with more pictures than colours starts them again. Dark ink reads on each.
 */
export const pictureColours = ['#4C8DF5', '#F5B23D', '#4FBF87', '#B07CF0', '#F06FA8', '#3FC7C7'] as const

/** A picture's colour by its place in the clip: 0 for the main picture, 1 for Picture 2, and so on. */
export function pictureColour(index: number): string {
  return pictureColours[Math.max(0, index) % pictureColours.length]!
}

/**
 * The quiet fill behind a coloured notice, and its border. A meaning colour on
 * its own is a mark: it is far too bright to sit a paragraph on, so anything
 * the size of a bar takes the wash and keeps the meaning colour for its words.
 */
export const wash = {
  attention: '#2B2616',
  attentionLine: '#4A4021',
  done: '#152A20',
  doneLine: '#24503B',
  /** Over the picture: the part of a vertical frame an app covers with its own buttons. */
  keepClear: 'rgba(229, 72, 77, 0.28)'
} as const

/** The one destructive look: delete, and a refusal that has already happened. */
export const danger = {
  ink: '#F3B6B8',
  fill: '#2A1A1D',
  line: '#5A2B31',
  fillHover: '#352024',
  lineHover: '#6E353C'
} as const

/** What a track is for, carried by its header, its clips and its waveform. */
export const track = {
  picture: '#4C8DF5',
  sound: '#4FBF87',
  voice: '#B98CE0',
  camera: '#F5B23D'
} as const

/**
 * A clip on a track: its fill, its border and the words on it. Darker than a
 * panel, because a track is a well the clips sit in, and a clip that reads as
 * a card floats off the timeline.
 */
export const clip = {
  picture: '#161C26',
  pictureLine: '#2B3543',
  sound: '#13201A',
  soundLine: '#2C3A33',
  /** The file has gone: the destructive fill, since nothing can be done with it. */
  offline: '#2A1A1D',
  /** The name on a clip, and what its waveform is drawn in. */
  ink: '#CFE8DA',
  wave: '#4D7360',
  waveSelected: '#8FD6B0'
} as const

/** A caption on its own track, in the colour captions are drawn in. */
export const caption = {
  fill: '#2D2A1D',
  fillSelected: '#4A4222',
  line: '#4D4630',
  header: '#5A5236',
  ink: '#F4ECC8'
} as const

/**
 * A pause found by Remove silences, shaded across the tracks. Three states,
 * and they have to be told apart at a glance across a whole timeline, so each
 * is a fill and a border of its own rather than one colour at three strengths.
 */
export const pause = {
  /** To be taken out. */
  cut: 'rgba(255, 59, 48, 0.26)',
  cutLine: 'rgba(255, 59, 48, 0.6)',
  /** Clicked to keep. */
  kept: 'rgba(166, 175, 189, 0.10)',
  keptLine: 'rgba(166, 175, 189, 0.55)',
  /** Cannot come out without pushing something out of step. */
  blocked: 'rgba(245, 178, 61, 0.14)',
  blockedLine: 'rgba(245, 178, 61, 0.7)'
} as const

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const

/** Four, where the components before this file had nine. */
export const radius = {
  /** A handle or a hairline box, too small for the chip radius to read. */
  handle: 2,
  chip: 4,
  control: 6,
  panel: 8,
  dialog: 12,
  /** A dot, a pill, a meter: fully round whatever its size. */
  round: 999
} as const

/**
 * Five roles, where the components before this file had eighteen font
 * declarations. Anything counted, timed or measured takes `mono`, which is
 * tabular, so digits stop jittering as they count.
 */
export const type = {
  /** The one heading big enough to be read across the room: the empty window. */
  display: '650 18px system-ui',
  title: '650 15px system-ui',
  body: '13px system-ui',
  meta: '12px system-ui',
  label: '650 12px system-ui',
  /** Goes with `label`, which is set in capitals. */
  labelTracking: '0.9px',
  mono: '13px ui-monospace, monospace',
  // The smallest the window sets anything: a timecode on the ruler, a figure on a meter.
  monoSmall: '12px ui-monospace, monospace'
} as const

/**
 * Short enough that it is only noticed when it is missing.
 *
 * The playhead and the timeline's zoom are deliberately absent: one is the
 * clock and the other follows the pointer, and easing either makes the app
 * feel late rather than smooth.
 */
export const motion = {
  /** Hover, press, and a clip being selected. */
  quick: '90ms',
  dialog: '140ms',
  toast: '160ms',
  /** A panel folding away. */
  panel: '180ms',
  easeOut: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)'
} as const

export const elevation = {
  panel: 'none',
  raised: '0 1px 2px rgba(0, 0, 0, 0.35)',
  /** A dialog or a menu, over everything. */
  over: '0 16px 44px rgba(0, 0, 0, 0.62)'
} as const

/**
 * The theme chosen in Settings (task 66), put over the tokens above as this
 * file loads, before anything reads them: every value read afterwards is the
 * theme's, inline styles and the style sheet alike.
 */
const changes = THEME_CHANGES[chosenTheme()]
const groups: Record<string, Record<string, string | number>> = { surface, ink, accent, meaning, wash, danger, track, clip, caption, pause, radius, type, elevation }
for (const [group, values] of Object.entries(changes)) {
  const target = groups[group]
  if (target) Object.assign(target, values)
}

/** Every token, flattened to the custom property name `ui.css` uses. */
export function themeProperties(): Record<string, string> {
  const props: Record<string, string> = {}
  const put = (group: string, values: Record<string, string | number>): void => {
    for (const [name, value] of Object.entries(values)) {
      props[`--${group}-${kebab(name)}`] = typeof value === 'number' ? `${value}px` : value
    }
  }
  put('surface', surface)
  put('ink', ink)
  put('accent', accent)
  put('meaning', meaning)
  put('wash', wash)
  put('danger', danger)
  put('track', track)
  put('clip', clip)
  put('caption', caption)
  put('pause', pause)
  put('space', space)
  put('radius', radius)
  put('type', type)
  put('motion', motion)
  put('elevation', elevation)
  return props
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

/**
 * Write the tokens onto the document, before the first render, so no frame is
 * ever painted with a property missing.
 */
export function applyTheme(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(themeProperties())) root.style.setProperty(name, value)
}

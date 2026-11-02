import { useCallback, useState } from 'react'
import { cleanTheme, type ThemeId } from '../themes'
import { cleanSafeZoneChoice, type SafeZoneChoice } from '../../shared/safe-zones'
import { DEFAULT_SILENCE_SETTINGS, type SilenceSettings } from '../../shared/silences'
import { DEFAULT_SECTION_LAYOUT, cleanSectionLayout, type SectionLayout } from '../../shared/section-layout'

/**
 * Settings the window keeps for itself: how wide its columns are and which
 * guides it draws. Nothing else needs them, so they stay in the window's own
 * storage rather than going to main. Anything wrong in what was stored falls
 * back to the default, and storage that cannot be written is simply not used.
 */

export interface WindowSettings {
  binWidth: number
  inspectorWidth: number
  /**
   * The most room the tracks are given, in pixels, once the divider above
   * the timeline has been dragged: fewer tracks than fill it take less, and
   * give the rest to the monitor. Null until then: as tall as the tracks
   * need, up to 40% of the window. How much room the timeline gets, where Small,
   * Medium and Large are how tall each track is inside that room.
   */
  timelineHeight: number | null
  /**
   * The side panels folded away to a rail, so the picture takes the room.
   * Kept here beside their widths rather than with the project: this is how
   * you like the window, not part of any edit.
   */
  binFolded: boolean
  inspectorFolded: boolean
  /**
   * The Inspector's sections folded (true) or opened (false) by hand, by
   * name. One never touched is not here and is open. See `InspectorFolds`.
   */
  inspectorFolds: Record<string, boolean>
  /**
   * The sections beside the timeline folded or opened by hand, by name: kept
   * apart from the Inspector's own, so folding one place leaves the other as
   * it was (task 61).
   */
  dockFolds: Record<string, boolean>
  /**
   * The sections right of the timeline folded down to a bar under the
   * Inspector, which takes their height (task 1137).
   */
  rightTucked: boolean
  /** The window's theme (task 66), applied as it loads. */
  theme: ThemeId
  /**
   * Whether the strip showing the whole edit is drawn above the ruler. Here
   * beside the folded panels rather than with the project: it is how you like
   * the window, not part of any edit, so it never goes through undo.
   */
  overview: boolean
  /** Whether the guides are drawn over the Output view at all. G turns them on and off. */
  guides: boolean
  /** Centre and thirds lines, among the guides. */
  thirds: boolean
  /** Which app's buttons to shade, on a vertical frame. */
  safeZone: SafeZoneChoice
  /** The 3:4 box Instagram's profile grid crops a cover to. */
  coverGuide: boolean
  /** What Remove silences counts as a pause, and how much of each it leaves. */
  silence: SilenceSettings
  /** The Source and Output views side by side in the monitor, for a frame taller than wide. */
  sideBySide: boolean
  /** How fast Space and the play button play: one of `PLAYBACK_SPEEDS`. */
  speed: number
  /**
   * Whether a timeline clip under a still pointer shows its frame in the
   * monitor while paused. Some people want the picture to follow the pointer
   * and some want it to stay on the playhead, so it is theirs to choose.
   */
  skim: boolean
  /**
   * Whether the preview plays lighter copies of the recordings, made in the
   * background, for smoother playback. The export always uses the recordings.
   */
  lighterCopies: boolean
  /**
   * Whether what is dragged on the timeline snaps to clips' edges and the
   * playhead. N turns it off and on; Alt still frees one drag while it is on.
   */
  snapping: boolean
  /**
   * How the Source bin draws its sources: as cards with everything on them,
   * as a compact list, or as a grid of pictures.
   */
  binView: BinView
  /** How far in Punch in, Zoom in and Zoom in and out go, in per cent, and Simple's zoom buttons too. */
  zoomAmount: ZoomAmount
  /** How quickly Zoom in and Zoom in and out get there. */
  zoomSpeed: ZoomSpeed
  /** Whether zoom keyframes are marked on the clips on the timeline, for a timeline with a great many. */
  clipKeys: boolean
  /**
   * Whether a picture moved on the Output view snaps to the frame's edges and
   * middles, the other pictures and the corners. Apart from the timeline's
   * Snap: the two are wanted at different times. Alt does the opposite.
   */
  placeSnap: boolean
  /** Which Inspector sections sit beside the timeline, and which the Inspector's picker hides (plan 92). */
  sections: SectionLayout
}

export type ZoomAmount = 125 | 150 | 200
export const ZOOM_AMOUNTS: readonly ZoomAmount[] = [125, 150, 200]
export type ZoomSpeed = 'quick' | 'normal' | 'slow'
/** Each speed's time to get there, in seconds. */
export const ZOOM_SPEEDS: Record<ZoomSpeed, number> = { quick: 0.5, normal: 1, slow: 2 }

export type BinView = 'cards' | 'list' | 'grid'
export const BIN_VIEWS: readonly BinView[] = ['cards', 'list', 'grid']

/** The speeds the transport bar offers for Space and the play button. */
export const PLAYBACK_SPEEDS = [1, 1.25, 1.5, 2]

const KEY = 'editbay.window'

export const COLUMN_MIN = 220
export const COLUMN_MAX = 480
/** A folded panel: room for its open control and its name down the edge. */
export const RAIL_WIDTH = 44
/**
 * The monitor never goes below this, which is above what a side panel needs.
 * That is the whole point: at every window size the picture is the thing that
 * takes the space back, and the panels are what give it up.
 */
export const MONITOR_MIN = 520

/**
 * The least of the picture the monitor keeps when the timeline is dragged
 * taller: enough to still see what is playing. Its controls are always shown.
 */
export const PICTURE_MIN = 150

/** The tracks never go shorter than the ruler and one small track. */
export const TIMELINE_MIN = 90
/**
 * How much of the window's height the tracks leave to everything else before
 * the window has been measured: about 320 for the top bar, the timeline's own
 * header and strip and the gaps between, and 200 for the monitor. Once it has
 * been, the monitor's own size decides, down to `PICTURE_MIN`.
 */
export const TIMELINE_LEAVES = 520

export const DEFAULT_WINDOW_SETTINGS: WindowSettings = {
  binWidth: 290,
  inspectorWidth: 280,
  timelineHeight: null,
  binFolded: false,
  inspectorFolded: false,
  inspectorFolds: {},
  dockFolds: {},
  rightTucked: false,
  theme: 'current',
  overview: true,
  guides: false,
  thirds: true,
  safeZone: 'all',
  coverGuide: false,
  silence: DEFAULT_SILENCE_SETTINGS,
  sideBySide: true,
  speed: 1,
  skim: true,
  lighterCopies: false,
  snapping: true,
  binView: 'cards',
  zoomAmount: 150,
  zoomSpeed: 'normal',
  clipKeys: true,
  placeSnap: true,
  sections: DEFAULT_SECTION_LAYOUT
}

function column(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, value)))
    : fallback
}

function within(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

/** Silence settings in range: a level from -80 to -10 dB, a pause from 0.1 to 5 s, and up to 2 s of it left. */
export function cleanSilenceSettings(raw: unknown): SilenceSettings {
  const d = DEFAULT_SILENCE_SETTINGS
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    levelDb: within(r.levelDb, -80, -10, d.levelDb),
    shortestSec: within(r.shortestSec, 0.1, 5, d.shortestSec),
    leaveSec: within(r.leaveSec, 0, 2, d.leaveSec)
  }
}

/** Folds as stored: a name to a yes or no, anything else left out. */
function cleanFolds(raw: unknown): Record<string, boolean> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'))
}

/**
 * The guides turned on or off, by Show guides or G. Turned on with no line
 * and no safe zone ticked they would draw nothing, which reads as broken
 * (task 58): Centre and thirds come on with them then.
 */
export function guidesTurned(now: Pick<WindowSettings, 'thirds' | 'coverGuide' | 'safeZone'>, on: boolean): { guides: boolean; thirds?: true } {
  const nothing = !now.thirds && !now.coverGuide && now.safeZone === 'none'
  return on && nothing ? { guides: true, thirds: true } : { guides: on }
}

export function cleanWindowSettings(raw: unknown): WindowSettings {
  const d = DEFAULT_WINDOW_SETTINGS
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    binWidth: column(r.binWidth, d.binWidth),
    inspectorWidth: column(r.inspectorWidth, d.inspectorWidth),
    timelineHeight:
      typeof r.timelineHeight === 'number' && Number.isFinite(r.timelineHeight)
        ? Math.round(Math.max(TIMELINE_MIN, r.timelineHeight))
        : d.timelineHeight,
    binFolded: typeof r.binFolded === 'boolean' ? r.binFolded : d.binFolded,
    inspectorFolded: typeof r.inspectorFolded === 'boolean' ? r.inspectorFolded : d.inspectorFolded,
    inspectorFolds: cleanFolds(r.inspectorFolds),
    dockFolds: cleanFolds(r.dockFolds),
    rightTucked: typeof r.rightTucked === 'boolean' ? r.rightTucked : d.rightTucked,
    theme: cleanTheme(r.theme),
    overview: typeof r.overview === 'boolean' ? r.overview : d.overview,
    guides: typeof r.guides === 'boolean' ? r.guides : d.guides,
    thirds: typeof r.thirds === 'boolean' ? r.thirds : d.thirds,
    safeZone: r.safeZone === undefined ? d.safeZone : cleanSafeZoneChoice(r.safeZone),
    coverGuide: typeof r.coverGuide === 'boolean' ? r.coverGuide : d.coverGuide,
    silence: cleanSilenceSettings(r.silence),
    sideBySide: typeof r.sideBySide === 'boolean' ? r.sideBySide : d.sideBySide,
    speed: typeof r.speed === 'number' && PLAYBACK_SPEEDS.includes(r.speed) ? r.speed : d.speed,
    skim: typeof r.skim === 'boolean' ? r.skim : d.skim,
    lighterCopies: typeof r.lighterCopies === 'boolean' ? r.lighterCopies : d.lighterCopies,
    snapping: typeof r.snapping === 'boolean' ? r.snapping : d.snapping,
    binView: BIN_VIEWS.includes(r.binView as BinView) ? (r.binView as BinView) : d.binView,
    zoomAmount: ZOOM_AMOUNTS.includes(r.zoomAmount as ZoomAmount) ? (r.zoomAmount as ZoomAmount) : d.zoomAmount,
    zoomSpeed: typeof r.zoomSpeed === 'string' && r.zoomSpeed in ZOOM_SPEEDS ? (r.zoomSpeed as ZoomSpeed) : d.zoomSpeed,
    clipKeys: typeof r.clipKeys === 'boolean' ? r.clipKeys : d.clipKeys,
    placeSnap: typeof r.placeSnap === 'boolean' ? r.placeSnap : d.placeSnap,
    sections: cleanSectionLayout(r.sections)
  }


}

function load(): WindowSettings {
  try {
    const text = window.localStorage.getItem(KEY)
    return cleanWindowSettings(text ? JSON.parse(text) : null)
  } catch {
    return DEFAULT_WINDOW_SETTINGS
  }
}

export function useWindowSettings(): [WindowSettings, (change: Partial<WindowSettings>) => void] {
  const [settings, setSettings] = useState<WindowSettings>(load)
  const update = useCallback((change: Partial<WindowSettings>) => {
    setSettings((prev) => {
      const next = cleanWindowSettings({ ...prev, ...change })
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // Kept for this session only.
      }
      return next
    })
  }, [])
  return [settings, update]
}

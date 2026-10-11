/**
 * What the App holds, as its parts read it: the values and handlers that live
 * in the App itself, and what each of its hooks gives back. The command
 * handling, the menus and the panels moved out of App.tsx take this as one
 * object, so each reads what it used to read from the App's scope.
 */

import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { CopiedCrop, Framing, Gap, Project, Timeline as TimelineData, clipsUsing } from '../../shared/project'
import type { PeaksData } from '../../shared/types'
import type { TransitionSide } from '../../shared/transitions'
import type { TrackSize } from '../../shared/timeline-layout'
import type { TimelineWorkspace } from '../../shared/workspace'
import type { TextStyle } from '../../shared/text'
import type { CopiedClips } from '../../shared/clipboard'
import type { ActionId } from '../../shared/keymap'
import type { levelAt } from '../../shared/sound'
import type { voiceStretches } from '../../shared/ducking'
import type { MenuAt } from '../components/ContextMenu'
import type { MonitorView } from '../components/Monitor'
import type { VoiceOverState } from '../components/Transport'
import type { CaptionScope } from '../components/CaptionsDialog'
import type { Take } from '../voiceover/recorder'
import type { WindowSettings } from '../state/useSettings'
import type { AssetsState } from '../state/useAssets'
import type { ExportRun } from '../state/useExportRun'
import type { KeymapState } from '../state/useKeymap'
import type { ProjectState } from '../state/useProject'
import type { SpeechRun } from '../state/useSpeech'
import type { PlayheadStore } from '../state/playheadStore'
import type { useLighterCopies } from '../state/useLighterCopies'
import type { useTimelineRoom } from './useTimelineRoom'
import type { useExportSettings } from './useExportSettings'
import type { useAppSettings } from './useAppSettings'
import type { useSelecting } from './useSelecting'
import type { useSequences } from './useSequences'
import type { useEditClip } from './useEditClip'
import type { usePeaks } from './usePeaks'
import type { useVoiceOver } from './useVoiceOver'
import type { useMarks } from './useMarks'
import type { useTimelineZoom } from './useTimelineZoom'
import type { usePlaceSource } from './usePlaceSource'
import type { useSilences } from './useSilences'
import type { useNudge } from './useNudge'
import type { usePainter } from './usePainter'
import type { useTexts } from './useTexts'
import type { useShapes } from './useShapes'
import type { useFrameAndTranscript } from './useFrameAndTranscript'
import type { useCaptionMaking } from './useCaptionMaking'
import type { useLayouts } from './useLayouts'
import type { useZoomAim } from './useZoomAim'

type Set<T> = Dispatch<SetStateAction<T>>

/** Where you are now, for the handlers and continuations that run between renders. */
export interface Here {
  playhead: number
  playing: boolean
  timeline: TimelineData | null
  sequenceId: string
}

/** What every action does, run by a key, a mouse button, a menu or the command search. */
export type RunAction = (action: ActionId, shift?: boolean, key?: { code: string; repeat: boolean }) => void

export type PickedTransition = { clipId: string; side: TransitionSide; alone?: boolean }
export type JoinAsk = { clipIds: string[]; frames: number; alone: boolean; select: string | null }

/** What lives in the App itself. */
export interface AppLocals {
  assets: AssetsState['assets']
  progress: AssetsState['progress']
  convertingSince: AssetsState['convertingSince']
  importPaths: AssetsState['importPaths']
  cancel: AssetsState['cancel']
  retry: AssetsState['retry']
  show: AssetsState['show']
  usage: Map<string, ReturnType<typeof clipsUsing>>
  removeSource: (id: string) => void
  addedAt: Map<string, number>
  playhead: number
  setPlayhead: Set<number>
  playheadSent: RefObject<number>
  playheadStore: PlayheadStore
  solo: ReadonlySet<string>
  setSolo: Set<ReadonlySet<string>>
  clipMenu: { clipId: string; at: MenuAt } | null
  setClipMenu: Set<{ clipId: string; at: MenuAt } | null>
  gapMenu: { gap: Gap; at: MenuAt } | null
  setGapMenu: Set<{ gap: Gap; at: MenuAt } | null>
  markerMenu: { markerId: string; at: MenuAt } | null
  setMarkerMenu: Set<{ markerId: string; at: MenuAt } | null>
  selectedTransition: PickedTransition | null
  setSelectedTransition: Set<PickedTransition | null>
  transitionMenu: { clipId: string; side: TransitionSide; at: MenuAt } | null
  setTransitionMenu: Set<{ clipId: string; side: TransitionSide; at: MenuAt } | null>
  joinAsk: JoinAsk | null
  setJoinAsk: Set<JoinAsk | null>
  renamingMarker: string | null
  setRenamingMarker: Set<string | null>
  skimming: string | null
  setSkimming: Set<string | null>
  lookingAt: number | null
  setLookingAt: Set<number | null>
  soloList: string[]
  playing: boolean
  setPlaying: Set<boolean>
  rate: number
  setRate: Set<number>
  loopOn: boolean
  setLoopOn: Set<boolean>
  kHeld: RefObject<string | null>
  selected: string | null
  setSelected: Set<string | null>
  alsoSelected: string[]
  setAlsoSelected: Set<string[]>
  selectedAlone: boolean
  setSelectedAlone: Set<boolean>
  gap: Gap | null
  setGap: Set<Gap | null>
  selectedCaption: string | null
  setSelectedCaption: Set<string | null>
  captionMove: 'one' | 'all' | null
  setCaptionMove: Set<'one' | 'all' | null>
  relocateHandPlaced: boolean
  setRelocateHandPlaced: Set<boolean>
  peaks: Map<string, PeaksData>
  setPeaks: Set<Map<string, PeaksData>>
  view: MonitorView
  setView: Set<MonitorView>
  aspectLocked: boolean
  setAspectLocked: Set<boolean>
  trackSize: TrackSize
  setTrackSize: Set<TrackSize>
  monitorVolume: number
  setMonitorVolume: Set<number>
  scrubbing: boolean
  setScrubbing: Set<boolean>
  ffmpeg: { ok: boolean; message: string }
  exportOpen: boolean
  setExportOpen: Set<boolean>
  fullscreen: boolean
  setFullscreen: Set<boolean>
  recording: VoiceOverState | null
  setRecording: Set<VoiceOverState | null>
  phase: RefObject<VoiceOverState['phase'] | null>
  takeRef: RefObject<{ take: Take; startFrame: number; sequenceId: string; docId: number } | null>
  cancelStart: RefObject<boolean>
  windowSettings: WindowSettings
  setWindowSettings: (change: Partial<WindowSettings>) => void
  binFolded: boolean
  inspectorFolded: boolean
  fold: (which: 'binFolded' | 'inspectorFolded') => (folded: boolean) => void
  exportRun: ExportRun
  binColumn: RefObject<HTMLDivElement | null>
  inspectorColumn: RefObject<HTMLDivElement | null>
  timelineTracks: RefObject<HTMLDivElement | null>
  zoom: number
  setZoom: Set<number>
  trackHeights: Record<string, number>
  setTrackHeights: Set<Record<string, number>>
  sequenceId: string
  setSequenceId: Set<string>
  places: Record<string, TimelineWorkspace>
  setPlaces: Set<Record<string, TimelineWorkspace>>
  lastTextStyle: RefObject<TextStyle | null>
  /** Plan 93: the framing of the recording last framed, while it waits to be written to the settings. */
  lastFraming: RefObject<Framing | null>
  picture: string
  zoomEnd: boolean
  setZoomEnd: Set<boolean>
  /** Task 122: Start, End or a keyframe picked in the Zoom panel, so a crop changes the zoom and not only the crop. */
  zoomPicked: boolean
  setZoomPicked: Set<boolean>
  choosePicture: (id: string) => void
  shortcutsOpen: boolean
  setShortcutsOpen: Set<boolean>
  blurBox: number | null
  setBlurBox: Set<number | null>
  setVersionsAsked: Set<number>
  settingsOpen: boolean
  setSettingsOpen: Set<boolean>
  tutorialsOpen: boolean | string
  setTutorialsOpen: Set<boolean | string>
  setPaletteOpen: Set<boolean>
  captionsOpen: boolean
  setCaptionsOpen: Set<boolean>
  captionsScope: CaptionScope | undefined
  setCaptionsScope: Set<CaptionScope | undefined>
  captionsError: { text: string; details?: string } | null
  setCaptionsError: Set<{ text: string; details?: string } | null>
  speech: SpeechRun
  exportAll: boolean
  setExportAll: Set<boolean>
  silenceOpen: boolean
  setSilenceOpen: Set<boolean>
  keys: KeymapState
  enterPlace: (place: TimelineWorkspace) => void
  showStepped: RefObject<(changed: string[]) => void>
  proj: ProjectState
  here: TimelineWorkspace
  save: (saveAs: boolean) => void
  undo: ProjectState['undo']
  status: ProjectState['status']
  project: Project | null
  timeline: TimelineData | null
  lighterCopies: ReturnType<typeof useLighterCopies>
  total: number
  stateNow: RefObject<Here>
  missingMedia: ProjectState['missingMedia']
  rebuildingMedia: ProjectState['rebuildingMedia']
  seek: (f: number) => void
  followEngine: (f: number) => void
  onEnded: () => void
  level: ReturnType<typeof levelAt> | null
  voice: ReturnType<typeof voiceStretches>
  silenceSettings: WindowSettings['silence']
  copiedFraming: RefObject<Framing | null>
  copiedCrop: CopiedCrop | null
  setCopiedCrop: Set<CopiedCrop | null>
  clipboard: CopiedClips | null
  setClipboard: Set<CopiedClips | null>
  pasteAt: (at: number) => Promise<void>
  loopRange: { from: number; to: number } | null
  canPlay: boolean
  togglePlay: () => void
  closeGap: (g: Gap) => void
  run: RunAction
}

export type TimelineRoom = ReturnType<typeof useTimelineRoom>
export type ExportSettings = ReturnType<typeof useExportSettings>
export type AppSettings = ReturnType<typeof useAppSettings>
export type Selecting = ReturnType<typeof useSelecting>
export type Sequences = ReturnType<typeof useSequences>
export type EditClip = ReturnType<typeof useEditClip>
export type Texts = ReturnType<typeof useTexts>

/** Everything the App's parts read from it. */
export type AppState = AppLocals &
  TimelineRoom &
  ExportSettings &
  AppSettings &
  Selecting &
  Sequences &
  EditClip &
  ReturnType<typeof usePeaks> &
  ReturnType<typeof useVoiceOver> &
  ReturnType<typeof useMarks> &
  ReturnType<typeof useTimelineZoom> &
  ReturnType<typeof usePlaceSource> &
  ReturnType<typeof useSilences> &
  ReturnType<typeof useNudge> &
  ReturnType<typeof usePainter> &
  Texts &
  ReturnType<typeof useShapes> &
  ReturnType<typeof useFrameAndTranscript> &
  ReturnType<typeof useCaptionMaking> &
  ReturnType<typeof useLayouts> &
  ReturnType<typeof useZoomAim>

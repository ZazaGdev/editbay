import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type JSX } from 'react'
import { useAssets } from './state/useAssets'
import { useLighterCopies } from './state/useLighterCopies'
import { makePlayheadStore } from './state/playheadStore'
import { dropHandled } from './state/drops'
import { useProject } from './state/useProject'
import type { TextStyle } from '../shared/text'
import type { MonitorView } from './components/Monitor'
import { Notices } from './components/Notices'
import { Toasts } from './components/Toasts'
import { CommandPalette } from './components/CommandPalette'
import type { CaptionScope } from './components/CaptionsDialog'
import { EFFECT_TYPE, SOURCE_TYPE } from './components/Timeline'
import type { MenuAt } from './components/ContextMenu'
import { useKeymap } from './state/useKeymap'
import { useWorkspaceSync } from './state/useWorkspaceSync'
import { useExportRun } from './state/useExportRun'
import { useSpeech } from './state/useSpeech'
import { useWindowSettings } from './state/useSettings'
import { showToast } from './state/toasts'
import type { CopiedClips } from '../shared/clipboard'
import { DEFAULT_ZOOM, DEFAULT_TRACK_SIZE, type TrackSize } from '../shared/timeline-layout'
import { timelineWorkspaceOf, type TimelineWorkspace, type Workspace } from '../shared/workspace'
import type { TransitionSide } from '../shared/transitions'
import {
  FIRST_SEQUENCE_ID,
  MAIN_PICTURE,
  allClips,
  clipsUsing,
  closeUpBlockers,
  findClip,
  findVideoClip,
  gapCanClose,
  gapPartsGroup,
  newId,
  sequenceOf,
  targetAspect,
  timelineDuration,
  timelineOf,
  trackOf,
  type CopiedCrop,
  type Framing,
  type Gap
} from '../shared/project'
import { MAX_VIDEO_TRACKS, spanEnd } from '../shared/tracks'
import type { Take } from './voiceover/recorder'
import type { VoiceOverState } from './components/Transport'
import { levelAt } from '../shared/sound'
import { voiceStretches } from '../shared/ducking'
import type { OpenedDocument, PeaksData } from '../shared/types'
import { surface, ink, accent, motion } from './theme'
import type { AppState, RunAction } from './app/app-state'
import { blurFieldOnPress } from './app/fields'
import { inTheWay } from './app/edit-words'
import { runAction } from './app/commands'
import { paletteCommands } from './app/palette'
import { useTimelineRoom } from './app/useTimelineRoom'
import { useExportSettings } from './app/useExportSettings'
import { useAppSettings } from './app/useAppSettings'
import { useSelecting } from './app/useSelecting'
import { useSequences } from './app/useSequences'
import { useEditClip } from './app/useEditClip'
import { usePeaks } from './app/usePeaks'
import { useVoiceOver } from './app/useVoiceOver'
import { useMarks } from './app/useMarks'
import { useTimelineZoom } from './app/useTimelineZoom'
import { usePlaceSource } from './app/usePlaceSource'
import { useSilences } from './app/useSilences'
import { useNudge } from './app/useNudge'
import { usePainter } from './app/usePainter'
import { useTexts } from './app/useTexts'
import { useShapes } from './app/useShapes'
import { useFrameAndTranscript } from './app/useFrameAndTranscript'
import { useShortcutKeys } from './app/useShortcutKeys'
import { useExportFinished } from './app/useExportFinished'
import { useCaptionMaking } from './app/useCaptionMaking'
import { useLayouts } from './app/useLayouts'
import { useZoomAim } from './app/useZoomAim'
import { ProblemBanners } from './app/ProblemBanners'
import { AppTopBar } from './app/AppTopBar'
import { PanelGrid } from './app/PanelGrid'
import { SECTION_TYPE } from './components/section-host'
import { ExportWindow } from './app/ExportWindow'
import { ClipMenu } from './app/ClipMenu'
import { GapMenu } from './app/GapMenu'
import { MarkerMenu } from './app/MarkerMenu'
import { TransitionMenu } from './app/TransitionMenu'
import { JoinAsk } from './app/JoinAsk'
import { Dialogs } from './app/Dialogs'
import { OPEN_TUTORIAL } from './ui/HelpTip'

export function App(): JSX.Element {
  const { assets, progress, convertingSince, importPaths, cancel, retry, remove, show } = useAssets()
  const [dragging, setDragging] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  /**
   * Where the playhead was last sent, before the window has drawn it: a key
   * pressed again before then steps on from there, not from where the last
   * drawing had it (audit 2026-10-01: Home then a quick Shift+Right went on
   * from before Home).
   */
  const playheadSent = useRef(0)
  playheadSent.current = playhead
  /**
   * The playhead again, for the memoised Inspector: its Zoom group follows
   * the playhead through this without the whole panel being drawn again on
   * every frame of playback.
   */
  const playheadStore = useMemo(() => makePlayheadStore(), [])
  useLayoutEffect(() => playheadStore.set(playhead), [playheadStore, playhead])
  /**
   * The audio tracks being listened to alone. Renderer state on purpose: solo
   * is a way of listening, never saved with the project and never honoured by
   * the export, so one left on by accident cannot change what comes out.
   */
  const [solo, setSolo] = useState<ReadonlySet<string>>(() => new Set())
  /** A clip right clicked, and where its menu opens. */
  const [clipMenu, setClipMenu] = useState<{ clipId: string; at: MenuAt } | null>(null)
  /** The menu of an empty stretch of a track, right clicked. */
  const [gapMenu, setGapMenu] = useState<{ gap: Gap; at: MenuAt } | null>(null)
  const [markerMenu, setMarkerMenu] = useState<{ markerId: string; at: MenuAt } | null>(null)
  /** The transition picked out on the timeline, and the one right clicked. */
  const [selectedTransition, setSelectedTransition] = useState<{ clipId: string; side: TransitionSide; alone?: boolean } | null>(null)
  const [transitionMenu, setTransitionMenu] = useState<{ clipId: string; side: TransitionSide; at: MenuAt } | null>(null)
  /**
   * A join that would bring back what was cut between the pieces, asked about
   * before it is done: the clips, how many frames come back, and the clip to
   * select once it is done.
   */
  const [joinAsk, setJoinAsk] = useState<{ clipIds: string[]; frames: number; alone: boolean; select: string | null } | null>(null)
  /** The marker whose name is being typed on the ruler, or null. */
  const [renamingMarker, setRenamingMarker] = useState<string | null>(null)
  /** The recording being looked through before it lands, by its id. */
  const [skimming, setSkimming] = useState<string | null>(null)
  /**
   * The frame of the sequence under the pointer on the timeline, or null.
   * The monitor shows it and the playhead stays where it is, so a clip can be
   * looked through without losing your place.
   */
  const [lookingAt, setLookingAt] = useState<number | null>(null)
  // A stable list, so the preview is not handed a new array on every render.
  const soloList = useMemo(() => [...solo].sort(), [solo])
  const [playing, setPlaying] = useState(false)
  /** How fast playing goes, and which way: the speed chosen for Space, or J's and L's; below 0 backwards. */
  const [rate, setRate] = useState(1)
  // Playing takes the picture back. Forgotten rather than held, so stopping
  // leaves it where playback ended rather than jumping to a pointer that has
  // been still since before it started.
  useEffect(() => {
    if (playing) setLookingAt(null)
  }, [playing])
  /** Playing repeats the selected clip, or the whole sequence. */
  const [loopOn, setLoopOn] = useState(false)
  /** The key K was pressed on, while it is held: J and L then step a frame. */
  const kHeld = useRef<string | null>(null)
  /**
   * The leading clip of the selection: the one pressed last, and the one
   * everything that acts on a single clip uses, from the Inspector and the
   * crop box to Split, I and O.
   */
  const [selected, setSelected] = useState<string | null>(null)
  /** The rest of the selection, when several clips are selected at once. */
  const [alsoSelected, setAlsoSelected] = useState<string[]>([])
  /** Whether the selected clips were taken on their own, with Alt, rather than with the clips linked to them. */
  const [selectedAlone, setSelectedAlone] = useState(false)
  /** A gap selected by clicking it, which Delete closes. */
  const [gap, setGap] = useState<Gap | null>(null)
  /** A caption selected on the caption track. Selecting one clears the clip selected, and the other way round. */
  const [selectedCaption, setSelectedCaption] = useState<string | null>(null)
  /**
   * The caption on the Output view being moved: the selected one on its own,
   * after a double click, or every caption that follows the style, while
   * Relocate is on. Escape ends either.
   */
  const [captionMove, setCaptionMove] = useState<'one' | 'all' | null>(null)
  /** Relocate moves the captions placed by hand too. Off unless ticked. */
  const [relocateHandPlaced, setRelocateHandPlaced] = useState(false)
  // Either ends when no caption is selected: Relocate is pressed in a
  // caption's own panel, and a mode nothing on screen says is on is a trap.
  useEffect(() => {
    if (captionMove !== null && selectedCaption === null) setCaptionMove(null)
  }, [captionMove, selectedCaption])
  const [peaks, setPeaks] = useState<Map<string, PeaksData>>(new Map())
  const [view, setView] = useState<MonitorView>('source')
  const [aspectLocked, setAspectLocked] = useState(true)
  /** How tall the timeline's tracks are drawn. Saved with the workspace, never through undo. */
  const [trackSize, setTrackSize] = useState<TrackSize>(DEFAULT_TRACK_SIZE)
  /** How loud the preview is played, 0 to 1. What comes out of the speakers, never what is exported. */
  const [monitorVolume, setMonitorVolume] = useState(1)
  /** The playhead is being dragged along the ruler, so every move of it is heard. */
  const [scrubbing, setScrubbing] = useState(false)
  const [ffmpeg, setFfmpeg] = useState({ ok: true, message: 'checking ffmpeg' })
  const [exportOpen, setExportOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  /**
   * A voice over under way, from R until it is on the timeline: the
   * microphone opening, recording, then being saved and put in place.
   * Everything that could change the sequence under it is held throughout.
   */
  const [recording, setRecording] = useState<VoiceOverState | null>(null)
  /** The same, for the handlers that run between renders. */
  const phase = useRef<VoiceOverState['phase'] | null>(null)
  /** The take recording now, with where it goes: the frame, the sequence and the document it was begun on. */
  const takeRef = useRef<{ take: Take; startFrame: number; sequenceId: string; docId: number } | null>(null)
  /** R, Space or Esc while the microphone was opening: never mind. */
  const cancelStart = useRef(false)
  const [windowSettings, setWindowSettings] = useWindowSettings()
  // Skimming turned off lets go of a frame it was showing, so the monitor
  // goes back to the playhead there and then rather than at the next move.
  const skimOn = windowSettings.skim
  useEffect(() => {
    if (!skimOn) setLookingAt(null)
  }, [skimOn])
  const binFolded = windowSettings.binFolded
  const inspectorFolded = windowSettings.inspectorFolded
  /** Fold a panel away, or bring it back. */
  const fold =
    (which: 'binFolded' | 'inspectorFolded') =>
    (folded: boolean): void =>
      setWindowSettings({ [which]: folded })
  const exportRun = useExportRun()
  const binColumn = useRef<HTMLDivElement>(null)
  const inspectorColumn = useRef<HTMLDivElement>(null)
  const timelineTracks = useRef<HTMLDivElement>(null)
  const { timelineRoom, measureTimelineRoom, clampTracks } = useTimelineRoom({ timelineTracks })
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  /** How tall each track has been dragged to in this sequence, by its id. */
  const [trackHeights, setTrackHeights] = useState<Record<string, number>>({})
  const exportSettings = useExportSettings({ exportOpen })
  const { exportFolder, setExportFolder, exportMode, setExportMode, exportPattern, setExportPattern, exportSubtitles, setExportSubtitles } = exportSettings
  const { exportTranscript, setExportTranscript, exportSharpen, setExportSharpen, exportFast, setExportFast, exportFileNames, setExportFileNames } = exportSettings
  const { exportPrefs, setExportPrefs } = exportSettings
  const [workspaceReady, setWorkspaceReady] = useState(false)
  /** The sequence on screen. */
  const [sequenceId, setSequenceId] = useState(FIRST_SEQUENCE_ID)
  /**
   * Where you were in each sequence, by id. The one on screen lives in the
   * playhead, selection, zoom and view state instead, and its entry here is
   * only brought up to date when you switch away from it.
   */
  const [places, setPlaces] = useState<Record<string, TimelineWorkspace>>({})
  /** The picture being edited in the selected clip: its main one, or a layer's id. */
  /** How the text last changed looks, which a new text starts as: from the app's settings. */
  const lastTextStyle = useRef<TextStyle | null>(null)
  const lastFraming = useRef<Framing | null>(null)
  const [picture, setPicture] = useState(MAIN_PICTURE)

  /**
   * Whether the chosen picture's End is chosen, for a Simple zoom: a choice
   * beside the picture, so choosing End never changes which picture it is.
   * Any other picture chosen, or another clip, starts on Start again.
   */
  const [zoomEnd, setZoomEnd] = useState(false)
  const choosePicture = useCallback((id: string): void => {
    setPicture(id)
    setZoomEnd(false)
  }, [])
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  /** The selected clip's blurred box being moved on the Source view, if any (plan 85). */
  const [blurBox, setBlurBox] = useState<number | null>(null)
  // Another clip selected, or none: no box of it is being moved.
  useEffect(() => setBlurBox(null), [selected])
  /** Counts each ask for the earlier versions from Search every action, which opens the Recent menu at them. */
  const [versionsAsked, setVersionsAsked] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** Open, or open at one entry by its id, as a "?" beside a control asks (task 60). */
  const [tutorialsOpen, setTutorialsOpen] = useState<boolean | string>(false)
  useEffect(() => {
    const open = (e: Event): void => setTutorialsOpen(String((e as CustomEvent).detail))
    window.addEventListener(OPEN_TUTORIAL, open)
    return () => window.removeEventListener(OPEN_TUTORIAL, open)
  }, [])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [captionsOpen, setCaptionsOpen] = useState(false)
  /** Plan 78: what the Make captions window chooses to begin with, when opened for something in particular. */
  const [captionsScope, setCaptionsScope] = useState<CaptionScope | undefined>(undefined)
  /** Why the last Make captions failed, shown in its window until it is tried again. */
  const [captionsError, setCaptionsError] = useState<{ text: string; details?: string } | null>(null)
  const speech = useSpeech()
  /** The Export dialog was opened to export every sequence. */
  const [exportAll, setExportAll] = useState(false)
  /** Remove silences is open, its pauses shaded on the timeline. */
  const [silenceOpen, setSilenceOpen] = useState(false)
  const keys = useKeymap()
  // A dialog opens over the window, not over the monitor on the whole screen,
  // so full screen gives way to it rather than hiding it.
  useEffect(() => {
    if (shortcutsOpen || tutorialsOpen || exportOpen || paletteOpen || captionsOpen || settingsOpen) setFullscreen(false)
  }, [shortcutsOpen, tutorialsOpen, exportOpen, paletteOpen, captionsOpen, settingsOpen])

  /** Take up the place stored for a sequence. */
  const enterPlace = useCallback((place: TimelineWorkspace) => {
    setPlaying(false)
    setPlayhead(place.playhead)
    setSelected(place.selectedClipId)
    setAlsoSelected([])
    setSelectedAlone(false)
    setGap(null)
    setSelectedCaption(null)
    setZoom(place.zoom)
    setView(place.view)
    setTrackHeights(place.trackHeights)
  }, [])

  /** Put you back where you were in a document that has just arrived. */
  const restoreWorkspace = useCallback((d: OpenedDocument) => {
    const w = d.workspace
    setSequenceId(w.activeSequenceId)
    setPlaces(w.timelines)
    enterPlace(timelineWorkspaceOf(w, w.activeSequenceId))
    setAspectLocked(w.aspectLocked)
    setTrackSize(w.trackSize)
    setMonitorVolume(w.monitorVolume)
    setExportFolder(w.export.folder)
    setExportMode(w.export.mode)
    setExportPattern(w.export.filenamePattern)
    setExportSubtitles(w.export.subtitleFile)
    setExportTranscript(w.export.transcriptFile)
    setExportSharpen(w.export.sharpen)
    setExportFast(w.export.fast)
    setExportFileNames(w.export.fileNames)
    setWorkspaceReady(true)
  }, [enterPlace])

  // An undo or redo that changed another sequence shows it, rather than changing it out of sight.
  const showStepped = useRef<(changed: string[]) => void>(() => undefined)
  const proj = useProject(restoreWorkspace, (changed) => showStepped.current(changed))

  const here = useMemo<TimelineWorkspace>(
    () => ({ playhead, selectedClipId: selected, zoom, view, trackHeights }),
    [playhead, selected, zoom, view, trackHeights]
  )
  const workspace = useMemo<Workspace>(
    () => ({
      activeSequenceId: sequenceId,
      timelines: { ...places, [sequenceId]: here },
      aspectLocked,
      trackSize,
      monitorVolume,
      export: { folder: exportFolder, mode: exportMode, filenamePattern: exportPattern, subtitleFile: exportSubtitles, transcriptFile: exportTranscript, sharpen: exportSharpen, fast: exportFast, fileNames: exportFileNames }
    }),
    [sequenceId, places, here, aspectLocked, trackSize, monitorVolume, exportFolder, exportMode, exportPattern, exportSubtitles, exportTranscript, exportSharpen, exportFast, exportFileNames]
  )
  const flushWorkspace = useWorkspaceSync(workspace, proj.docId, workspaceReady)

  const save = useCallback(
    (saveAs: boolean) => {
      // Send where you are first, so the file holds it rather than where you
      // were half a second ago.
      void flushWorkspace()
        .then(() => proj.save(saveAs))
        .then((path) => {
          if (path) showToast({ kind: 'saved', text: `Saved ${path.split(/[\\/]/).pop() ?? path}` })
        })
    },
    [flushWorkspace, proj]
  )

  const appSettings = useAppSettings({ setExportPrefs, lastTextStyle })
  const { transitionDefaults, transitionOnEveryCut, recordSettings, savedLayouts, savedLayoutsNow, storeLayouts, savedShapes, savedShapesNow, storeShapes } = appSettings

  const { undo } = proj

  const status = proj.status
  useEffect(() => {
    document.title = status ? `${status.name} ${status.changed ? '\u2022' : '-'} Editbay` : 'Editbay'
  }, [status])

  useEffect(() => {
    void window.api.ffmpegStatus().then((s) => setFfmpeg({ ok: s.ok, message: s.message }))
  }, [])

  const project = proj.project
  /** How many times each source is on the timeline, in every sequence. */
  const usage = useMemo(
    () => new Map(project ? assets.map((a) => [a.id, clipsUsing(project, a.id)] as const) : []),
    [project, assets]
  )
  const removeSource = useCallback(
    (id: string) => {
      const name = assets.find((a) => a.id === id)?.originalPath.split(/[\\/]/).pop() ?? 'The source'
      void remove(id).then((gone) => {
        if (gone) showToast({ kind: 'removed', text: `Took ${name} out of the bin. The file is still where it was.` })
      })
    },
    [assets, remove]
  )
  // A recording OBS has just finished, offered for import wherever you are in the window.
  useEffect(
    () =>
      window.api.onRecordingFinished((r) =>
        showToast({
          kind: 'recording',
          text: `New recording: ${r.name}`,
          action: { label: 'Import', run: () => importPaths([r.path]) },
          sticky: true,
          lasting: true,
          dismissLabel: 'Dismiss'
        })
      ),
    [importPaths]
  )
  // The sequence on screen, seen as one timeline. Everything that edits,
  // plays or exports works on this.
  const timeline = useMemo(() => (project ? timelineOf(project, sequenceId) : null), [project, sequenceId])
  // The room for the tracks, measured once there is a timeline to measure and
  // again when the strip above the tracks comes or goes.
  const hasTimeline = timeline !== null
  useEffect(() => {
    if (!hasTimeline) return
    const frame = requestAnimationFrame(measureTimelineRoom)
    return () => cancelAnimationFrame(frame)
  }, [hasTimeline, windowSettings.overview, measureTimelineRoom])
  const lighterCopies = useLighterCopies(windowSettings.lighterCopies, timeline)
  // Once per timeline, not on every tick of the playhead: it walks every clip.
  const total = useMemo(() => (timeline ? timelineDuration(timeline) : 0), [timeline])

  /** Where you are now, for the handlers and continuations that run between renders. */
  const stateNow = useRef({ playhead, playing, timeline, sequenceId })
  stateNow.current = { playhead, playing, timeline, sequenceId }

  const selecting = useSelecting({
    stateNow, setPlayhead, playheadStore, timeline, selected, setSelected, alsoSelected, setAlsoSelected, selectedAlone, setSelectedAlone, gap, setGap,
    selectedCaption, setSelectedCaption, setSelectedTransition
  })
  const { select, showClip, frameSelected, selectedIds, selectedClips, framing, onSelection } = selecting

  const sequences = useSequences({ project, proj, sequenceId, setSequenceId, here, places, setPlaces, enterPlace, timeline, undo, showStepped })

  const editing = useEditClip({
    project, proj, sequenceId, undo, phase, stateNow, selected, setSelectedTransition, setPlayhead, transitionOnEveryCut, transitionDefaults, onSelection,
    select, lastFraming
  })
  const { editClip } = editing

  /**
   * Which of its clip's pictures is chosen, by position: 0 for the main one,
   * 2 for Picture 2 and so on. Taken when the choice is made, so it is the
   * clip being left that it describes when another is selected.
   */
  const pictureSlot = useRef(0)
  useEffect(() => {
    const c = timeline && selected ? findVideoClip(timeline, selected)?.clip : undefined
    pictureSlot.current = c ? c.layers.findIndex((l) => l.id === picture) + 1 : 0
  }, [picture])
  // A picture belongs to one clip, but working down a row of picture in
  // picture clips means the same picture on each: selecting another clip
  // keeps the picture in the same position when it has one, Picture 2 on
  // Picture 2, and starts on its main picture otherwise. A shape with no
  // frame, which leaves the layers out, always starts on the main picture.
  const framedShape = timeline ? targetAspect(timeline) !== null : true
  useEffect(() => {
    const c = timeline && selected ? findVideoClip(timeline, selected)?.clip : undefined
    const slot = pictureSlot.current
    const same = framedShape && c && slot > 0 ? c.layers[slot - 1]?.id : undefined
    setPicture(same ?? MAIN_PICTURE)
    setZoomEnd(false)
  }, [selected, framedShape])

  const missingMedia = proj.missingMedia
  const rebuildingMedia = proj.rebuildingMedia
  /** When each source came into the project, for the Source bin's days. */
  const addedAt = useMemo(
    () => new Map((project?.media ?? []).flatMap((m) => (m.addedAt === undefined ? [] : [[m.id, m.addedAt] as const]))),
    [project]
  )
  const { revisions } = usePeaks({ project, peaks, setPeaks, missingMedia, rebuildingMedia })

  const seek = useCallback(
    (f: number) => {
      setPlaying(false)
      const to = Math.max(0, Math.min(total, f))
      playheadSent.current = to
      setPlayhead(to)
    },
    [total]
  )

  // Playback reports its own position; do not stop it by seeking back.
  const followEngine = useCallback((f: number) => setPlayhead(f), [])
  const onEnded = useCallback(() => setPlaying(false), [])

  // Captions are made for the document they were asked for. Another one
  // opened meanwhile, as from Explorer, stops the listening and closes the
  // window for it, rather than putting one project's words on another.
  const { cancelTranscribe } = speech
  useEffect(() => {
    cancelTranscribe()
    setCaptionsOpen(false)
  }, [proj.docId, cancelTranscribe])

  const voiceOver = useVoiceOver({
    phase, takeRef, cancelStart, recording, setRecording, timeline, project, playhead, sequenceId, total, proj, setPlaying, recordSettings, select
  })

  useEffect(() => {
    // Against the latest value, so it never undoes a place just taken up.
    if (playhead > total) setPlayhead((p) => (p > total ? total : p))
  }, [playhead, total])

  /**
   * The marked range, as frames of the sequence: In to the end, the start to
   * Out, or nothing marked.
   *
   * A mark past the end of the sequence is held back to the end here rather
   * than changed where it is kept. A trim dragged in and out again shortens
   * the sequence and lengthens it back, and pulling the marks in as it went
   * would leave the range short with nothing to undo.
   */
  /**
   * How loud the sequence is where the playhead is, for the meter under the
   * monitor. Worked out here rather than in the transport, which has neither
   * the timeline nor the waveforms, and worked out afresh on every frame the
   * playhead moves, which is what makes it a meter rather than a reading.
   */
  const level = useMemo(
    () => (timeline ? levelAt(timeline, peaks, playhead) : null),
    [timeline, peaks, playhead]
  )

  const marking = useMarks({ timeline, total, editClip, selectedClips })

  useEffect(() => {
    if (total === 0 && playing) setPlaying(false)
  }, [total, playing])

  const zooming = useTimelineZoom({ timeline, setZoom })

  const placing = usePlaceSource({ project, timeline, proj, sequenceId, peaks, assets, select, showClip, undo, lastFraming })

  /** Take a gap's time out of the sequence, or say what is in the way. */
  const closeGap = useCallback(
    (g: Gap) => {
      if (!timeline) return
      if (!gapCanClose(timeline, g)) {
        const blockers = closeUpBlockers(timeline, g.from, g.to - g.from)
        showToast({
          kind: 'refused',
          text: gapPartsGroup(timeline, g)
            ? 'A clip after this gap is linked to one that begins before the gap ends, so closing it would put them out of step.'
            : blockers.length > 0 && trackOf(timeline, g.trackId)
              ? `This gap cannot close up: ${inTheWay(timeline, blockers)}.`
              : 'Something on another track starts, ends or lies inside this gap, so it cannot close up.'
        })
        return
      }
      editClip({ kind: 'closeUpGap', gap: g })
      setGap(null)
      // Onto the join it leaves, rather than onto whatever has slid up under the old time.
      seek(g.from)
    },
    [timeline, editClip, seek]
  )

  // Where the voice is, which a track that ducks comes down under in the
  // preview, from the same waveforms and the same function the export uses.
  const voice = useMemo(() => (timeline ? voiceStretches(timeline, peaks) : []), [timeline, peaks])
  const silenceSettings = windowSettings.silence
  const silences = useSilences({
    project, sequenceId, timeline, peaks, silenceOpen, setSilenceOpen, silenceSettings, setPlaying, setPlayhead, seek, editClip
  })

  const nudging = useNudge({ timeline, framing, playhead, selected, picture, zoomEnd, view, proj, editClip, frameSelected })

  /** The framing copied with Ctrl+Alt+C, ready to paste onto the clips selected. */
  const copiedFraming = useRef<Framing | null>(null)
  /** A crop copied on its own, ready to paste onto the clips selected. State, so Paste crop lights up when there is one. */
  const [copiedCrop, setCopiedCrop] = useState<CopiedCrop | null>(null)

  /**
   * Clips copied or cut, whole, ready to paste at the playhead in this or
   * another sequence of the project. The window's, not the project's.
   */
  const [clipboard, setClipboard] = useState<CopiedClips | null>(null)
  const pasteAt = useCallback(
    async (at: number): Promise<void> => {
      if (!project) return
      if (!clipboard) {
        showToast({ kind: 'paste', text: 'Nothing to paste yet: copy or cut a clip first.' })
        return
      }
      const sequence = sequenceOf(project, sequenceId)
      // Enough new ids for every clip, its group's link and a track it may need, and each text.
      const ids = Array.from({ length: clipboard.clips.length * 3 + clipboard.texts.length }, () => newId())
      const after = await proj.edit({ kind: 'pasteClips', sequenceId: sequence.id, copied: clipboard, at, ids })
      const t = timelineOf(after, sequence.id)
      const pasted = ids.filter((id) => findClip(t, id) !== null)
      const left = clipboard.clips.length - pasted.length
      if (left > 0) {
        showToast({
          kind: 'refused',
          text: `${left === 1 ? 'One clip' : `${left} clips`} had no track free to go on and ${left === 1 ? 'was' : 'were'} left out: a sequence has at most ${MAX_VIDEO_TRACKS} video tracks.`
        })
      }
      if (pasted[0]) select(pasted[0])
    },
    [project, clipboard, sequenceId, proj, select]
  )

  useEffect(() => {
    window.addEventListener('pointerdown', blurFieldOnPress, true)
    return () => window.removeEventListener('pointerdown', blurFieldOnPress, true)
  }, [])

  const painting = usePainter({ timeline, selected, editClip })

  /** What Loop repeats: every selected clip with the clips linked to them, from the first start to the last end, or the whole sequence when nothing is selected. */
  const loopRange = useMemo(() => {
    if (!loopOn || !timeline || total === 0) return null
    const chosen = allClips(timeline).filter((c) => selectedIds.has(c.id))
    if (chosen.length === 0) return { from: 0, to: total }
    return { from: Math.min(...chosen.map((c) => c.timelineStart)), to: Math.max(...chosen.map(spanEnd)) }
  }, [loopOn, timeline, total, selectedIds])
  /** Whether playing forward has anywhere to go: before the end, or round a loop, which starts at its start. */
  const canPlay = playhead < total || loopRange !== null

  /** Space and the play button: stop, or play forward at the speed chosen in the transport bar. */
  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false)
      return
    }
    setRate(windowSettings.speed)
    setPlaying(canPlay)
  }, [playing, windowSettings.speed, canPlay])

  // K is held until it is let go, or the window loses the keyboard.
  useEffect(() => {
    const up = (e: KeyboardEvent): void => {
      if (e.code === kHeld.current) kHeld.current = null
    }
    const away = (): void => {
      kHeld.current = null
    }
    window.addEventListener('keyup', up)
    window.addEventListener('blur', away)
    return () => {
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', away)
    }
  }, [])

  const texts = useTexts({ project, proj, sequenceId, playhead, timeline, selected, lastTextStyle, select })
  const { pressed, resized } = texts

  const shapes = useShapes({
    project, proj, sequenceId, playhead, timeline, selected, view, setView, windowSettings, select, pressed, resized, savedShapes, savedShapesNow,
    storeShapes
  })

  const saving = useFrameAndTranscript({ project, sequenceId, playhead, speech, exportFolder, exportSharpen, exportFileNames })

  // Made afresh every render, so it always acts on what is current: everything
  // that calls it reads the latest one, and with a list of what it reads, one
  // left off the list went stale (audit 2026-10-01: Escape stopped ending a
  // shape being drawn once the rest of the window stopped changing every frame).
  const run: RunAction = (action, shift, key) => runAction(app, action, shift, key)

  // The key listener reads what is current as of the last render, not as of
  // the last effect. Effects run after the window has painted, so a listener
  // swapped in by an effect leaves a moment in which a key already sees the new
  // screen but acts on the old state: Shift+Right just after clips were added
  // moved the playhead against a timeline that was still empty.
  const blocked = shortcutsOpen || tutorialsOpen !== false || exportOpen || paletteOpen || captionsOpen || settingsOpen
  const latest = useRef({ run, blocked, lookup: keys.lookup })
  latest.current = { run, blocked, lookup: keys.lookup }

  useShortcutKeys(latest)

  useExportFinished({ project, sequenceId, exportRun, exportOpen, setExportOpen, exportPrefs })

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    // Files let go on a folder in Sources are copied there, not imported.
    if (dropHandled(e)) return
    // A source from the bin, an effect or an Inspector section, let go somewhere other than where it goes: not a file to import.
    if ([SOURCE_TYPE, EFFECT_TYPE, SECTION_TYPE].some((k) => e.dataTransfer.types.includes(k))) return
    const paths = Array.from(e.dataTransfer.files).map((f) => window.api.pathForFile(f))
    importPaths(paths.filter((p) => p !== ''))
  }

  const exportLabel = exportRun.running
    ? `Exporting ${Math.round((exportRun.progress?.fraction ?? 0) * 100)}%`
    : null

  const captionMaking = useCaptionMaking({ project, proj, phase, undo, captionsOpen, setCaptionsOpen, setCaptionsError, speech })

  const layouts = useLayouts({
    project, proj, timeline, selected, playhead, sequenceId, phase, undo, selectedClips, editClip, savedLayouts, savedLayoutsNow, storeLayouts
  })

  const zoomAim = useZoomAim({ proj, selected, timeline, windowSettings, setWindowSettings, editClip })

  /** Everything the menus, the panels and the command handling read, as one object. */
  const app: AppState = {
    ...exportSettings, ...appSettings, ...selecting, ...sequences, ...editing, ...voiceOver, ...marking, ...zooming,
    ...placing, ...silences, ...nudging, ...painting, ...texts, ...shapes, ...saving, ...captionMaking, ...layouts, ...zoomAim, timelineRoom,
    measureTimelineRoom, clampTracks, revisions, assets, progress, convertingSince, importPaths, cancel, retry, show, usage, removeSource, addedAt,
    playhead, setPlayhead, playheadSent, playheadStore, solo, setSolo, clipMenu, setClipMenu, gapMenu, setGapMenu, markerMenu, setMarkerMenu,
    selectedTransition, setSelectedTransition, transitionMenu, setTransitionMenu, joinAsk, setJoinAsk, renamingMarker, setRenamingMarker, skimming,
    setSkimming, lookingAt, setLookingAt, soloList, playing, setPlaying, rate, setRate, loopOn, setLoopOn, kHeld, selected, setSelected,
    alsoSelected, setAlsoSelected, selectedAlone, setSelectedAlone, gap, setGap, selectedCaption, setSelectedCaption, captionMove, setCaptionMove,
    relocateHandPlaced, setRelocateHandPlaced, peaks, setPeaks, view, setView, aspectLocked, setAspectLocked, trackSize, setTrackSize, monitorVolume,
    setMonitorVolume, scrubbing, setScrubbing, ffmpeg, exportOpen, setExportOpen, fullscreen, setFullscreen, recording, setRecording, phase, takeRef,
    cancelStart, windowSettings, setWindowSettings, binFolded, inspectorFolded, fold, exportRun, binColumn, inspectorColumn, timelineTracks, zoom,
    setZoom, trackHeights, setTrackHeights, sequenceId, setSequenceId, places, setPlaces, lastTextStyle, lastFraming, picture, zoomEnd, setZoomEnd, choosePicture,
    shortcutsOpen, setShortcutsOpen, blurBox, setBlurBox, setVersionsAsked, settingsOpen, setSettingsOpen, tutorialsOpen, setTutorialsOpen,
    setPaletteOpen, captionsOpen, setCaptionsOpen, captionsScope, setCaptionsScope, captionsError, setCaptionsError, speech, exportAll, setExportAll,
    silenceOpen, setSilenceOpen, keys, enterPlace, showStepped, proj, here, save, undo, status, project, timeline, lighterCopies, total, stateNow,
    missingMedia, rebuildingMedia, seek, followEngine, onEnded, level, voice, silenceSettings, copiedFraming, copiedCrop, setCopiedCrop, clipboard,
    setClipboard, pasteAt, loopRange, canPlay, togglePlay, closeGap, run
  }

  return (
    <main
      onDragOver={(e) => {
        // A section's heading is moved within the window, not dropped on it.
        if (e.dataTransfer.types.includes(SECTION_TYPE)) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      style={{
        height: '100%',
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        // Lit while files are held over the window, so it is clear they can be dropped.
        background: dragging ? accent.wash : surface.canvas,
        color: ink.primary,
        transition: `background ${motion.quick} ${motion.easeOut}`
      }}
    >
      {/* Nothing in it is used while a take records: undo, opening and exporting would all pull the ground from under it. */}
      <div style={{ display: 'contents', pointerEvents: recording ? 'none' : undefined }}>
        <AppTopBar app={app} versionsAsked={versionsAsked} exportLabel={exportLabel} />
      </div>

      <ProblemBanners app={app} />

      <PanelGrid app={app} />

      <Notices />
      <Toasts />

      {exportOpen && timeline && project && <ExportWindow app={app} timeline={timeline} project={project} />}

      {clipMenu && timeline && findClip(timeline, clipMenu.clipId) && <ClipMenu app={app} clipMenu={clipMenu} timeline={timeline} />}

      {/* An empty stretch of a track: taken out of the sequence, as Shift+Delete takes a selected one. */}
      {gapMenu && timeline && <GapMenu app={app} gapMenu={gapMenu} timeline={timeline} />}

      {markerMenu && timeline && timeline.markers.some((m) => m.id === markerMenu.markerId) && (
        <MarkerMenu app={app} markerMenu={markerMenu} timeline={timeline} />
      )}

      {transitionMenu && timeline && findClip(timeline, transitionMenu.clipId) && (
        <TransitionMenu app={app} transitionMenu={transitionMenu} timeline={timeline} />
      )}

      {paletteOpen && <CommandPalette commands={paletteCommands(app)} onClose={() => setPaletteOpen(false)} />}

      {joinAsk && timeline && <JoinAsk app={app} joinAsk={joinAsk} timeline={timeline} />}
      <Dialogs app={app} />
    </main>
  )
}

import {
  animationAt,
  cleanOverlay,
  framesPattern,
  hasLayout,
  isAnimated,
  isStill,
  sequenceOf,
  timelineDuration,
  v1Clips,
  type Clip,
  type Project,
  type Timeline
} from './project'
import { spanEnd } from './tracks'
import { type Place } from './layout'
import type { BoxKey, PictureStyle, Rect } from './project'
import { moves } from './crop-geometry'
import { boxMoves } from './box-keys'
import { colourKey } from './looks'
import { framesToSeconds } from './time'
import { outputSizeFor, type Preset } from './presets'
import { formatFilename, clipNameFromPath } from './filename'
import { captionsAss, captionsSrt, captionsTranscript, transcriptOf, type TimedWord } from './captions'
import type { PeaksData } from './types'
import type { Clock, Move } from './render-moves'
import {
  AS_BT709,
  LABELLED_BT709,
  TO_RGB,
  TO_VIDEO,
  blurField,
  colourField,
  editListArgs,
  inputArgs,
  mediaOf,
  pictureGraph,
  videoFilter
} from './render-pictures'
import { AUDIO_RATE, heardInputs, round6, soundGraph, type Heard, type SoundShape, soundShape, heardOver } from './render-sound'
import { blendFilters, fadePartway, overlayGraph, partway, xfadePartway, type Animation, type Overlay } from './render-overlays'
import { linkedSound, spansOf, washesOfClip, type Blend, type Piece } from './render-pieces'
import { LOUDNESS_TARGET, SHARPEN, TAGGED, concatListLine, encodeArgs, graphToFile, joinArgs, loudnessJob, type LoudnessJob } from './render-encode'

// Split out of this file by what each part does (plan 91), and re-exported
// from it, so everything that imports from here still does.
export { recordingFrame, keyedExpression, balancedSum, keysForPiece } from './render-moves'
export { spansOf, trackCopiesRead } from './render-pieces'
export type { Wash, Blend, Piece } from './render-pieces'
export {
  MAX_INLINE_GRAPH,
  graphToFile,
  LOUDNESS_TARGET,
  parseLoudnorm,
  loudnormFilter,
  withAudioFilter,
  concatListLine
} from './render-encode'
export type { LoudnessTarget, LoudnessMeasurement, LoudnessJob } from './render-encode'

/**
 * Turn one sequence into the exact ffmpeg command lines that produce the output.
 *
 * Pure: it touches no disk and runs no process, so the part of the app most
 * likely to produce a wrong video is the part that is fully testable, and a
 * change to what gets encoded shows up in a diff.
 */

export type ExportMode = 'join' | 'batch'

/** What an export is called after. */
export interface ExportNames {
  project: string
  sequence: string
  /** A joined export's file name, without its extension. */
  joined: string
}

/**
 * A joined export is named after the project, as it always was, while the
 * project has one sequence. With more, it is named after the sequence too,
 * so a vertical and a landscape cut of one project never overwrite each other.
 */
export function exportNames(project: Project, sequenceId: string): ExportNames {
  const sequence = sequenceOf(project, sequenceId).name
  return {
    project: project.name,
    sequence,
    joined: project.sequences.length > 1 ? `${project.name} ${sequence}` : project.name
  }
}

export interface RenderRequest {
  timeline: Timeline
  names: ExportNames
  preset: Preset
  mode: ExportMode
  /** Where the finished files go. */
  outputDir: string
  /** Where segments are written on the way to a join. Removed afterwards. */
  scratchDir: string
  filenamePattern: string
  /**
   * Only this part of the sequence, in frames, `to` not included: a marked
   * range, or the stretch some clips cover. The whole sequence when absent.
   */
  range?: { from: number; to: number }
  /**
   * Files that must not be written over. An output that would land on one
   * takes the first free name of "name (2).mp4", "name (3).mp4" and so on.
   * The outputs of one plan never land on each other either.
   */
  keep?: string[]
  /**
   * Also write the captions beside a joined video, as an SRT file with its
   * name. Nothing is written without captions, or for one file per clip.
   */
  subtitleFile?: boolean
  /**
   * Also write every word of the captions beside a joined video, as a text
   * file with its name to read. Nothing is written without captions, or for
   * one file per clip.
   */
  transcriptFile?: boolean
  /**
   * The words heard by listening to the sequence, at its own frames, for the
   * transcript of a sequence with no captions. Captions come first when there
   * are some: they hold the words as fixed by hand.
   */
  heard?: TimedWord[]
  /** No sound at all: a picture made from the sequence, as Save frame makes, reads none of its sound files. */
  silent?: boolean
  /**
   * Sharpen every picture a little: a light grain cleanup, then a light sharpen
   * of the brightness only, so colour noise is not sharpened. Before the
   * captions, which are drawn crisp already.
   */
  sharpen?: boolean
  /**
   * Encode on an NVIDIA graphics card rather than the processor: several
   * times faster, for a slightly larger file at the same quality. Only asked
   * for once the card has been found to work.
   */
  fast?: boolean
  /**
   * The waveforms of the sounds heard, by `peaksKey`, which say where the
   * voice is for a track that ducks under it. Only read when one does.
   */
  peaks?: ReadonlyMap<string, PeaksData>
}

/**
 * A path as Windows compares it: case ignored, and either slash, one or
 * several, the same. Paths reach here built both by Node and by hand.
 */
export function samePathKey(path: string): string {
  return path.replace(/[\\/]+/g, '\\').toLowerCase()
}

/**
 * `path`, or the first of "name (2).ext", "name (3).ext" and so on that
 * nothing in `taken` already has. `taken` holds paths as `samePathKey` gives them.
 */
export function freeName(path: string, taken: Set<string>): string {
  if (!taken.has(samePathKey(path))) return path
  const slash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  const dot = path.lastIndexOf('.')
  const cut = dot > slash ? dot : path.length
  const stem = path.slice(0, cut)
  const ext = path.slice(cut)
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!taken.has(samePathKey(candidate))) return candidate
  }
}

/** The subtitle file beside a video: its name, with `.srt` for its extension. */
export function subtitlePathOf(video: string): string {
  return video.replace(/\.[^.\\/]*$/, '') + '.srt'
}

/** The transcript file beside a video: its name, with `.txt` for its extension. */
export function transcriptPathOf(video: string): string {
  return video.replace(/\.[^.\\/]*$/, '') + '.txt'
}

/** The folder, in a segment's scratch folder, that the captions' font is put in for libass to find. */
export const CAPTION_FONTS_DIR = 'fonts'

export interface SegmentJob {
  /** The clip whose picture is underneath, or the first picture over black, or '' for black alone. */
  clipId: string
  /**
   * The captions over this stretch, as an ASS file to write in the scratch
   * folder under `name` before it runs, which is where it runs: the filter
   * names the file and the font's folder by relative paths, so no path of
   * a real one, with its drive letter and spaces, ever goes in a filter graph.
   */
  subtitles?: { name: string; content: string }
  /**
   * The filter graph, when it is too long for a command line, as a file to
   * write in the scratch folder under `name` before it runs, which the command
   * reads with `-/filter_complex`, the `-/` asking for the option's value
   * from a file (`-filter_complex_script` is gone from ffmpeg 8). A clip with
   * many zoom keyframes writes a long expression for each, and Windows cuts a
   * command off at 32767 characters.
   */
  graph?: { name: string; content: string }
  /** One based, for the filename and for progress reporting. */
  index: number
  args: string[]
  output: string
  frames: number
  /** What to call this stretch if it fails. */
  label: string
}

export interface JoinJob {
  listPath: string
  listContent: string
  args: string[]
  output: string
}

export interface RenderPlan {
  segments: SegmentJob[]
  /** Null in batch mode, where each segment is already a deliverable. */
  join: JoinJob | null
  /** Every file the export will produce. */
  outputs: string[]
  totalFrames: number
  /**
   * Levelling the finished sound, or null to leave it as it was recorded.
   *
   * Joined exports only. Handoff writes fragments for another editor to
   * assemble, and levelling each fragment to its own target would flatten the
   * differences between them, which is the opposite of what a handoff wants.
   */
  loudness: LoudnessJob | null
  /**
   * Files written beside the video once it is finished, as the subtitle file
   * is: not videos themselves, so not among `outputs`, which are what can be
   * played afterwards.
   */
  beside: { path: string; content: string }[]
}


function joinPath(dir: string, name: string): string {
  const sep = dir.endsWith('/') || dir.endsWith('\\') ? '' : '\\'
  return `${dir}${sep}${name}`
}

function segmentArgs(opts: {
  timeline: Timeline
  piece: Piece
  /** Every sound transition of the sequence, worked out once for the whole plan. */
  sound: SoundShape
  width: number
  height: number
  /** Whether the shape has a fixed frame, which places need. Handoff has none. */
  framed: boolean
  crf: number
  output: string
  /** Batch writes a finished MP4; a segment on the way to a join writes Matroska. */
  final: boolean
  /** The ASS file of the captions over it, by its name in the folder it runs in, or null for none. */
  subtitles: string | null
  /** Sharpen the finished picture a little, before the captions. */
  sharpen?: boolean
  /** Encode on the graphics card. */
  fast?: boolean
}): string[] {
  const { timeline, piece, width, height, framed, crf, output, final, subtitles, sharpen, fast } = opts
  const fps = timeline.fps
  const frames = piece.to - piece.from
  // A segment may hold its last frame to make up its length, and a time bound
  // written a microsecond short of that length drops the held frame. So it is
  // rounded up; the frame count still bounds the picture exactly.
  const durationSec = (Math.ceil(framesToSeconds(frames, fps) * 1e6) / 1e6).toFixed(6)
  const base = piece.base
  const heard = heardInputs(timeline, base, piece.from, piece.to, piece.sounds, opts.sound)

  const args: string[] = []
  if (base) {
    const into = piece.from - base.timelineStart
    // Input seek before -i is frame accurate when re-encoding, and fast.
    args.push(...inputArgs(mediaOf(timeline, base), framesToSeconds(Math.max(0, base.sourceIn + into), fps).toFixed(6), fps))
  } else {
    args.push('-f', 'lavfi', '-t', durationSec, '-i', `color=c=black:s=${width}x${height}:r=${fps}`)
  }

  // The order of the inputs is fixed, because the generated silence is mapped
  // as input 1 and anything put in before it would be played in its place:
  // the picture underneath, then the silence when nothing is heard, then the
  // sounds, then the pictures laid over.
  //
  // Every segment carries an audio track without exception: a segment
  // missing the track the others have is the likeliest way to break the join.
  const silent = heard.length === 0
  if (silent) {
    args.push('-f', 'lavfi', '-t', durationSec, '-i', `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_RATE}`)
  }
  const soundInput = new Map<Heard, number>()
  let next = silent ? 2 : 1
  for (const h of heard) {
    if (h.path === null) continue
    soundInput.set(h, next++)
    args.push('-ss', h.fromSec.toFixed(6), '-t', h.readSec.toFixed(6), ...editListArgs(h.path), '-i', h.path)
  }
  const still = (c: Clip): boolean => isStill(mediaOf(timeline, c))
  const animStartOf = (c: Clip): { animStart?: { start: number; into: number; once?: boolean } } => {
    const a = animationOf(c).anim
    return a ? { animStart: { start: a.start, into: a.into, ...(a.once ? { once: true } : {}) } } : {}
  }
  /** A clip of an animation, read from the frame this piece starts on. */
  const animationOf = (c: Clip): { anim: Animation } | Record<string, never> => {
    const m = mediaOf(timeline, c)
    if (!isAnimated(m)) return {}
    const at = animationAt(m, c.sourceIn + (piece.from - c.timelineStart), fps)
    return { anim: { pattern: framesPattern(m), rate: m.frameRate!, start: at.frame, into: at.into, ...(m.once === true ? { once: true } : {}) } }
  }
  /** Where a clip's own source is at the start of this piece, and how many frames it is short of it. */
  const reach = (c: Clip): { fromSec: string; hold: number } => {
    const at = c.sourceIn + (piece.from - c.timelineStart)
    // A picture is the same frame wherever it is read, so nothing is held.
    const hold = still(c) ? 0 : Math.max(0, -at)
    return { fromSec: framesToSeconds(Math.max(0, at), fps).toFixed(6), hold }
  }
  /** A clip's move, on the clock of this piece. */
  const moveOf = (c: Clip): { move?: Move; clock?: Clock } => {
    const clock = { first: c.sourceIn + (piece.from - c.timelineStart), frames: piece.to - piece.from }
    return {
      ...(c.transform.keys && moves(c.transform.keys) ? { move: { keys: c.transform.keys, ...clock } } : {}),
      // Only when a further picture moves of its own, or a box moves (plan 97), which is all the clock is for.
      ...(c.layers.some((l) => (l.keys && moves(l.keys)) || boxMoves(l.boxKeys)) || boxMoves(c.transform.boxKeys) ? { clock } : {})
    }
  }

  const asPictures = (c: Clip): { crop: Rect; place: Place; style?: PictureStyle; boxKeys?: BoxKey[] }[] => [
    {
      crop: c.transform.crop,
      place: c.transform.place,
      ...(c.transform.style ? { style: c.transform.style } : {}),
      ...(c.transform.boxKeys ? { boxKeys: c.transform.boxKeys } : {})
    },
    ...c.layers
  ]
  const blendOn = (c: Clip | null): Blend | undefined => (c ? piece.blends.find((b) => b.clipId === c.id) : undefined)

  const overlays: Overlay[] = framed
    ? piece.overlays.map((c) => {
        const blend = blendOn(c)
        return {
          path: mediaOf(timeline, c).playablePath,
          ...reach(c),
          ...(still(c) ? { still: true, ...cleanOverlay(c.transform), ...animationOf(c) } : {}),
          pictures: asPictures(c),
          ...moveOf(c),
          ...(c.blurFill === true ? { blurFill: true } : {}),
          ...colourField(c),
          ...blurField(timeline, c),
          ...(still(c) && !blend && (c.enter || c.exit)
            ? {
                appear: {
                  lead: piece.from - c.timelineStart,
                  length: c.sourceOut - c.sourceIn,
                  ...(c.enter ? { enter: c.enter } : {}),
                  ...(c.exit ? { exit: c.exit } : {})
                }
              }
            : {}),
          ...(piece.washes.find((x) => x.clipId === c.id) ? { wash: piece.washes.find((x) => x.clipId === c.id)! } : {}),
          ...(blend
            ? {
                into: {
                  path: mediaOf(timeline, blend.into).playablePath,
                  ...reach(blend.into),
                  ...(still(blend.into) ? { still: true, ...cleanOverlay(blend.into.transform), ...animationOf(blend.into) } : {}),
                  pictures: asPictures(blend.into),
                  ...moveOf(blend.into),
                  ...(blend.into.blurFill === true ? { blurFill: true } : {}),
                  ...colourField(blend.into),
                  ...blurField(timeline, blend.into),
                  xfade: blend.xfade,
                  kind: blend.kind,
                  partway: partway(piece.from, blend, fps)
                }
              }
            : {})
        }
      })
    : []
  const firstOverlay = next
  const read = (o: { path: string; fromSec: string; still?: boolean; anim?: Animation }): string[] =>
    o.anim
      ? [...(o.anim.once ? [] : ['-stream_loop', '-1']), '-framerate', String(o.anim.rate), '-i', o.anim.pattern]
      : o.still
        ? ['-loop', '1', '-framerate', String(fps), '-i', o.path]
        : // Read as V1 reads it: untagged on V2 was read as BT.601, a different red (audit 2026-10-08).
          ['-ss', o.fromSec, ...AS_BT709, '-i', o.path]
  for (const o of overlays) {
    args.push(...read(o))
    next += 1
    if (o.into) {
      o.into.input = next
      args.push(...read(o.into))
      next += 1
    }
  }

  // The clip the picture underneath turns into over this whole piece, read as
  // its own input. Last of all, so nothing already numbered moves.
  const baseBlend = framed ? blendOn(base) : undefined
  const baseInto = baseBlend ? { clip: baseBlend.into, ...reach(baseBlend.into), input: next } : null
  if (baseInto) {
    args.push(...inputArgs(mediaOf(timeline, baseInto.clip), baseInto.fromSec, fps))
    next += 1
  }

  // The finished picture comes out as [vt], to be tagged on its way to [v],
  // or as [c] to have the captions drawn over it last.
  const finished = subtitles ? 'c' : 'vt'
  // Or as [p] first, to be sharpened on its way there.
  const pictured = sharpen ? 'p' : finished
  // The picture underneath comes out as that, or as [b] to have more laid over it.
  const under = overlays.length > 0 ? 'b' : pictured
  const baseWash = base ? piece.washes.find((x) => x.clipId === base.id) : undefined
  // A dip to a colour is drawn over the finished picture; a blend is two
  // pictures of the same track mixed. Neither ever happens to the same clip in
  // the same piece: a window is one or the other.
  const washed = baseWash ? 'w' : under
  const onePicture = (c: Clip, out: string, at: { input: number; hold: number }, tag: string): string =>
    // A blurred background fills round the picture, which the single chain's black bars cannot.
    framed && (hasLayout(c) || c.blurFill === true)
      ? pictureGraph(fps, c, width, height, out, { input: at.input, startHold: at.hold, tag, still: still(c), ...animStartOf(c), ...moveOf(c), ...blurField(timeline, c) })
      : // A plain clip keeps its single chain. Under Handoff, which has no
        // frame to place anything in, a clip exports its main picture only.
        `[${at.input}:v]${videoFilter(fps, c.transform.crop, width, height, at.hold, moveOf(c).move, colourKey(c), still(c), animationOf(c).anim, blurField(timeline, c).headBlur, out)}[${out}]`

  const filters: string[] = []
  if (!base) filters.push(`[0:v]setsar=1,${LABELLED_BT709}[${washed}]`)
  else if (baseInto) {
    // Both sides through the same chain first, so they are the same size, rate
    // and pixel format, which `xfade` will not work without.
    filters.push(onePicture(base, 'xa', { input: 0, hold: reach(base).hold }, 'a'))
    filters.push(onePicture(baseInto.clip, 'xb', { input: baseInto.input, hold: baseInto.hold }, 'b'))
    filters.push(
      `[xa]format=yuv420p[xa1];[xb]format=yuv420p[xb1];` +
        xfadePartway('xa1', 'xb1', washed, baseBlend!.xfade, partway(piece.from, baseBlend!, fps), 'xab', blendFilters(baseBlend!.kind, partway(piece.from, baseBlend!, fps), fps, width, false))
    )
  } else filters.push(onePicture(base, washed, { input: 0, hold: reach(base).hold }, ''))
  if (baseWash) filters.push(`[w]${fadePartway(baseWash.dir, baseWash.colour, partway(piece.from, baseWash, fps), baseWash.late)}[${under}]`)
  if (overlays.length > 0) filters.push(overlayGraph(fps, under, overlays, firstOverlay, width, height, pictured, piece.from))
  if (sharpen) filters.push(`[p]${SHARPEN}[${finished}]`)
  // Burned in on RGB and turned back into video by BT.709: drawn straight onto
  // video, libass converts its colours by BT.601, and the yellow came out 10
  // levels off the preview's.
  if (subtitles) filters.push(`[c]${TO_RGB},format=rgb24,ass=filename=${subtitles}:fontsdir=${CAPTION_FONTS_DIR},${TO_VIDEO},format=yuv420p[vt]`)
  // The colours said on every frame, which ffmpeg 9 writes into the file over
  // what the encoder is told: a picture's frames said "unknown" and the file
  // went out with no primaries or transfer (plan 89).
  filters.push(`[vt]${TAGGED}[v]`)
  if (!silent) filters.push(soundGraph(heard, (h) => (h.path === null ? 0 : soundInput.get(h)!)))

  args.push('-filter_complex', filters.join(';'))
  args.push('-map', '[v]')
  args.push('-map', silent ? '1:a' : '[a]')
  args.push(...encodeArgs(durationSec, frames, crf, final, output, fast === true))
  return args
}

export function planRender(request: RenderRequest): RenderPlan {
  const { timeline, names, preset, outputDir, scratchDir, filenamePattern } = request

  const mode: ExportMode = preset.joinable ? request.mode : 'batch'
  const joining = mode === 'join'
  const framed = preset.width !== null && preset.height !== null

  // Every finished file takes a name nothing kept has, and no other file of this plan.
  const taken = new Set((request.keep ?? []).map(samePathKey))
  const claim = (path: string): string => {
    const free = freeName(path, taken)
    taken.add(samePathKey(free))
    return free
  }
  // A video with files beside it takes the first name free for all of them.
  const claimWithBeside = (path: string, besideOf: ((video: string) => string)[]): string => {
    let free = freeName(path, taken)
    while (besideOf.some((of) => taken.has(samePathKey(of(free))))) {
      taken.add(samePathKey(free))
      free = freeName(path, taken)
    }
    taken.add(samePathKey(free))
    for (const of of besideOf) taken.add(samePathKey(of(free)))
    return free
  }

  // A joined export is the whole sequence, cut into pieces at every edge of a
  // picture. A file of its own is one V1 clip with its own pictures and its
  // linked sound, the other tracks left out.
  const range = request.range ? { from: Math.max(0, Math.round(request.range.from)), to: Math.round(request.range.to) } : undefined
  const whole: Piece[] = joining
    ? spansOf(timeline, framed, range)
    : v1Clips(timeline).map((c) => ({
        from: c.timelineStart,
        to: spanEnd(c),
        base: c,
        overlays: [],
        sounds: linkedSound(timeline, c),
        // A blend needs both clips, and here they are two separate files, so a
        // file of its own carries only the fades that belong to this clip alone.
        blends: [],
        washes: washesOfClip(timeline, c)
      }))
  // Only what falls inside the part asked for. A joined export is already cut
  // at its edges; a file of its own is its clip's frames inside it, with the
  // sound over those frames.
  const cut: Piece[] = !range
    ? whole
    : whole
        .filter((p) => p.from < range.to && p.to > range.from)
        .map((p) => {
          if (p.from >= range.from && p.to <= range.to) return p
          const from = Math.max(p.from, range.from)
          const to = Math.min(p.to, range.to)
          const only = p.base ? new Set(p.sounds.map((c) => c.id)) : undefined
          return { ...p, from, to, sounds: heardOver(timeline, from, to, only) }
        })
  if (cut.length === 0) throw new Error(range ? 'there is nothing in that part of the timeline to export' : 'there is nothing on the timeline to export')
  // Save frame wants the picture only: no sound file is read for it.
  const pieces: Piece[] = request.silent ? cut.map((p) => ({ ...p, sounds: [] })) : cut

  // Worked out once: every segment asks the same questions of the same sounds.
  const sound = soundShape(timeline, request.peaks ?? new Map())

  const segments: SegmentJob[] = pieces.map((piece, i) => {
    const index = i + 1
    const shown = piece.base ?? piece.overlays[0] ?? null
    const media = shown ? mediaOf(timeline, shown) : null
    const { width, height } = piece.base
      ? outputSizeFor(preset, piece.base.transform.crop)
      : { width: preset.width ?? timeline.output.width, height: preset.height ?? timeline.output.height }
    const name = joining
      ? `segment-${String(index).padStart(3, '0')}.mkv`
      : formatFilename(
          filenamePattern,
          {
            // A pattern without {sequence} still has to tell two sequences'
            // files apart, or exporting both into one folder overwrites the first.
            project: filenamePattern.includes('{sequence}') ? names.project : names.joined,
            sequence: names.sequence,
            index,
            clip: media ? clipNameFromPath(media.originalPath) : ''
          },
          'mp4'
        )
    const output = joining ? joinPath(scratchDir, name) : claim(joinPath(outputDir, name))
    // Captions over the finished picture, for a shape with a frame to place them in; Handoff has none.
    const ass = framed
      ? captionsAss({ clips: timeline.captions.clips, style: timeline.captions.style, from: piece.from, to: piece.to, fps: timeline.fps, width, height })
      : null
    const subtitles = ass ? { name: `captions-${String(index).padStart(3, '0')}.ass`, content: ass } : null
    const args = segmentArgs({ timeline, piece, sound, width, height, framed, crf: preset.crf, output, final: !joining, subtitles: subtitles?.name ?? null, sharpen: request.sharpen === true, fast: request.fast === true })
    const graph = graphToFile(args, `graph-${String(index).padStart(3, '0')}.txt`)
    return {
      clipId: shown?.id ?? '',
      ...(subtitles ? { subtitles } : {}),
      ...(graph ? { graph: graph.file } : {}),
      index,
      frames: piece.to - piece.from,
      label: media ? clipNameFromPath(media.originalPath) : 'black',
      output,
      args: graph ? graph.args : args
    }
  })

  const totalFrames = segments.reduce((sum, s) => sum + s.frames, 0)

  if (!joining) {
    return { segments, join: null, outputs: segments.map((s) => s.output), totalFrames, loudness: null, beside: [] }
  }

  const listPath = joinPath(scratchDir, 'segments.txt')
  // One file means one name, the project's, and the sequence's when there are
  // several. Running the per-clip pattern over a single joined video produces
  // things like "holiday_01_holiday.mp4".
  const wanted = joinPath(outputDir, formatFilename('{project}', { project: names.joined, sequence: names.sequence, index: 1, clip: '' }, 'mp4'))
  const said = { clips: timeline.captions.clips, from: range?.from ?? 0, to: range?.to ?? timelineDuration(timeline), fps: timeline.fps }
  const srt = request.subtitleFile === true ? captionsSrt(said) : null
  const transcript =
    request.transcriptFile !== true
      ? null
      : timeline.captions.clips.length > 0
        ? captionsTranscript(said)
        : request.heard
          ? transcriptOf(request.heard, said.from, said.to, said.fps)
          : null
  const besideFiles = [
    ...(srt === null ? [] : [{ of: subtitlePathOf, content: srt }]),
    ...(transcript === null ? [] : [{ of: transcriptPathOf, content: transcript }])
  ]
  const output = claimWithBeside(wanted, besideFiles.map((b) => b.of))
  const beside = besideFiles.map((b) => ({ path: b.of(output), content: b.content }))

  return {
    segments,
    join: {
      listPath,
      // Each piece with its length in frames, so the next starts exactly where
      // it ends. Left to the demuxer, a piece's length is read back from its
      // file, rounded to the millisecond, and forty cuts put the picture 13 ms
      // behind the sound.
      listContent: `${segments.map((s) => `${concatListLine(s.output)}\nduration ${round6(s.frames / timeline.fps)}`).join('\n')}\n`,
      args: joinArgs(listPath, output, timeline.fps),
      output
    },
    outputs: [output],
    totalFrames,
    loudness: loudnessJob(listPath, LOUDNESS_TARGET),
    beside
  }
}

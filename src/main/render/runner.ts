import { randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  CAPTION_FONTS_DIR,
  loudnormFilter,
  parseLoudnorm,
  withAudioFilter,
  type JoinJob,
  type LoudnessJob,
  type RenderPlan
} from '../../shared/render-plan'
import { CAPTION_FONTS } from '../../shared/caption-fonts'
import type { ExportProgress } from '../../shared/types'
import { measureFfmpeg, runFfmpeg } from '../ffmpeg/run'
import { ProcessError } from '../ffmpeg/spawn'

/** Segments are the bulk of the work; the join only copies the picture. */
const SEGMENT_SHARE = 0.92
/**
 * Of what is left after the segments, how much the loudness measuring pass
 * takes. It decodes all of the sound and none of the picture, so it is quick
 * next to the join, but it is not instant on a long sequence and a bar that
 * sits still is worse than one that moves slowly. Both are reported as the
 * join, so nothing in the window has to know this pass exists.
 */
const MEASURE_SHARE = 0.25
/** How many of ffmpeg's last lines are kept to show when asked. */
const DETAIL_LINES = 25

/**
 * An export that failed: a plain account for the window, and ffmpeg's own
 * last lines for whoever wants to know more.
 */
export class ExportFailure extends Error {
  constructor(
    message: string,
    readonly details: string
  ) {
    super(message)
  }
}

function detailsOf(err: unknown): string {
  return err instanceof ProcessError ? err.stderr.trim().split('\n').slice(-DETAIL_LINES).join('\n') : String(err)
}

function parentDir(path: string): string {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return cut > 0 ? path.slice(0, cut) : ''
}

/**
 * Where each finished file is written while it is being made: a hidden name
 * beside the one asked for, taken over by the real name only once everything
 * has succeeded. Written straight to its name, a cancelled or failed export
 * left a broken video there, and "Replace" had already emptied the good one.
 */
function standIns(outputs: string[]): Map<string, string> {
  return new Map(outputs.map((o) => [o, join(parentDir(o), `.${basename(o)}.${randomUUID().slice(0, 8)}.part.mp4`)]))
}

/**
 * A segment's arguments with its inputs decoded on the graphics card, on
 * Windows. Decoding a recording is a sixth or so of the processor time of a
 * segment, which the encoder then has to itself, and the card's H.264, HEVC,
 * VP9 and AV1 decoders give back exactly the pixels the processor's would:
 * the same frames go to the same encoder, and the file comes out the same.
 * An input the card cannot decode, a picture or a generated colour, is
 * decoded on the processor as before, by ffmpeg itself.
 */
export function withCardDecoding(args: string[], platform: NodeJS.Platform = process.platform): string[] {
  if (platform !== 'win32') return args
  return args.flatMap((a, i) => (a === '-i' && args[i - 1] !== '-hwaccel' ? ['-hwaccel', 'd3d11va', a] : [a]))
}

/** A command's arguments with each finished file's name swapped for its stand-in. */
function writingTo(args: string[], stand: Map<string, string>): string[] {
  return args.map((a) => stand.get(a) ?? a)
}

/**
 * Stand-ins an export that never finished left beside these outputs: the app
 * closed by force, or the power went, part way through. Theirs, by their
 * names, and nobody else's.
 */
async function clearOldStandIns(outputs: string[]): Promise<void> {
  for (const output of outputs) {
    const dir = parentDir(output)
    const head = `.${basename(output)}.`.toLowerCase()
    const own = (n: string): boolean => {
      const name = n.toLowerCase()
      return name.startsWith(head) && name.endsWith('.part.mp4') && /^[0-9a-f]{8}$/.test(name.slice(head.length, -'.part.mp4'.length))
    }
    const names = await readdir(dir).catch(() => [] as string[])
    for (const n of names) {
      if (own(n)) {
        await rm(join(dir, n), { force: true }).catch(() => undefined)
        continue
      }
      // Another export's, under another name, left a day or more ago: no export runs that long (audit 2026-10-01).
      if (!ANY_STAND_IN.test(n)) continue
      const old = await lstat(join(dir, n)).then((st) => Date.now() - st.mtimeMs > STAND_IN_AGE_MS).catch(() => false)
      if (old) await rm(join(dir, n), { force: true }).catch(() => undefined)
    }
  }
}

/** How old another export's stand-in must be before it is taken to be abandoned: a day. */
const STAND_IN_AGE_MS = 24 * 60 * 60 * 1000

/** The name any export's stand-in has, for a video or a file written beside it. */
const ANY_STAND_IN = /^\..+\.[0-9a-f]{8}\.part(\.mp4)?$|^.+\.[0-9a-f]{8}\.part$/i

/**
 * A finished file taking its name. A player showing the last export holds it
 * so that it cannot be replaced, and a virus scanner or a sync client may
 * hold the new one for a moment, so it is tried again for a few seconds. Then
 * the new video is left where it is, under its stand-in name, and the person
 * told why: an export of many minutes is not thrown away over a locked file.
 */
async function takeName(part: string, output: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(part, output)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      const held = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
      if (!held || attempt >= 9) {
        throw new ExportFailure(
          held
            ? `${basename(output)} is open in another program, so it could not be replaced. Close it, then export again. The new video is kept beside it as ${basename(part)}.`
            : `The finished video could not be named ${basename(output)}. It is kept beside it as ${basename(part)}.`,
          String(err)
        )
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 100 * 2 ** attempt)))
    }
  }
}

interface LevelledJoinOptions {
  join: JoinJob
  loudness: LoudnessJob | null
  /** The sequence's length, which the measuring pass moves along in step with. */
  totalMs: number
  signal?: AbortSignal | undefined
  onFraction: (within: number) => void
}

/**
 * The join's arguments, with the sound levelled to the target when a measuring
 * pass gives figures to level it by, and exactly as planned when it does not.
 *
 * Everything that can go wrong in here costs the levelling and not the export.
 * A video at the recording's own loudness is a great deal better than no video,
 * and this is the one pass in an export that produces nothing, so failing it
 * loses nothing that was going to be delivered. Being cancelled is the single
 * thing passed on, because that is not a fault.
 */
async function levelledJoin(opts: LevelledJoinOptions): Promise<string[]> {
  const { join, loudness, totalMs, signal, onFraction } = opts
  if (!loudness) return join.args

  let stderr: string
  try {
    stderr = await measureFfmpeg(loudness.measureArgs, {
      onProgress: (u) => {
        if (u.timeMs === undefined || totalMs <= 0) return
        onFraction(Math.min(1, u.timeMs / totalMs))
      },
      ...(signal ? { signal } : {})
    })
  } catch (err) {
    if (signal?.aborted) throw err
    return join.args
  }

  const measured = parseLoudnorm(stderr)
  if (measured === null) return join.args
  const filter = loudnormFilter(loudness.target, measured)
  return filter === null ? join.args : withAudioFilter(join.args, filter)
}

export interface RunExportOptions {
  plan: RenderPlan
  fps: number
  scratchDir: string
  onProgress: (p: ExportProgress) => void
  signal?: AbortSignal
  /** Where the captions' font is: needed only when a segment has captions. */
  fontsDir?: string
  /** Font files from this PC the captions are written in (plan 87), put beside the bundled ones. */
  pcFonts?: string[]
}

/**
 * Execute a render plan.
 *
 * Segments run one at a time: two simultaneous x264 encodes saturate the CPU and
 * neither finishes sooner. The scratch directory is removed whether the export
 * succeeds, fails or is cancelled, and so is every finished file still under
 * its stand-in name, so a broken run leaves nothing behind and replaces nothing.
 */
export async function runExport(opts: RunExportOptions): Promise<string[]> {
  const { plan, fps, scratchDir, onProgress, signal, fontsDir, pcFonts = [] } = opts
  const total = Math.max(1, plan.totalFrames)
  let doneFrames = 0

  // Never backwards while it works: ffmpeg's own count can dip a frame or two
  // between reports, which a slow machine shows as the bar jumping back (plan 104).
  let furthest = 0
  const report = (p: ExportProgress): void => {
    if (p.stage === 'segment' || p.stage === 'join') {
      furthest = Math.max(furthest, p.fraction)
      onProgress({ ...p, fraction: furthest })
    } else {
      onProgress(p)
    }
  }

  await mkdir(scratchDir, { recursive: true })
  // ffmpeg will not create a directory for its output, it just fails. Make every
  // folder the plan writes into, so choosing somewhere that does not exist yet
  // works rather than failing at the very end of a long encode.
  for (const dir of new Set(plan.outputs.map(parentDir))) {
    if (dir !== '') await mkdir(dir, { recursive: true })
  }

  await clearOldStandIns(plan.outputs)
  const stand = standIns(plan.outputs)
  /** Stand-ins still waiting for their names: what a failure removes. */
  const pending = new Map(stand)
  const settle = async (output: string): Promise<void> => {
    const part = pending.get(output)
    if (part === undefined) return
    // Whether or not it takes its name, it is no longer to be removed.
    pending.delete(output)
    await takeName(part, output)
  }
  try {
    // The captions' font beside their files, in a folder of its own: libass
    // reads every file in the folder it is given as a font. Without it, libass
    // would quietly burn them in another font, bigger and cut off, so an export
    // that cannot have it is refused.
    if (plan.segments.some((s) => s.subtitles)) {
      const fonts = join(scratchDir, CAPTION_FONTS_DIR)
      await mkdir(fonts, { recursive: true })
      try {
        if (!fontsDir) throw new Error('no fonts folder was given')
        // Every caption font: whichever a sequence's captions use is among them.
        for (const font of CAPTION_FONTS) await copyFile(join(fontsDir, font.file), join(fonts, font.file))
      } catch (err) {
        throw new ExportFailure('The captions could not be burned in: their font is missing from the app. Reinstall Editbay, then export again.', String(err))
      }
      // A font from this PC, by a name of its own so it never stands over a bundled one.
      for (const [i, path] of pcFonts.entries()) {
        await copyFile(path, join(fonts, `pc-${i}${extname(path)}`)).catch(() => undefined)
      }
    }

    for (const segment of plan.segments) {
      if (signal?.aborted) throw new ProcessError('cancelled', null, '')
      if (segment.subtitles) await writeFile(join(scratchDir, segment.subtitles.name), segment.subtitles.content)
      if (segment.graph) await writeFile(join(scratchDir, segment.graph.name), segment.graph.content)

      const segmentMs = (segment.frames / fps) * 1000
      report({
        stage: 'segment',
        clipIndex: segment.index,
        clipLabel: segment.label,
        clipCount: plan.segments.length,
        fraction: (doneFrames / total) * SEGMENT_SHARE
      })

      const encode = (args: string[]): Promise<void> =>
        runFfmpeg(writingTo(args, stand), {
          onProgress: (u) => {
            if (u.timeMs === undefined || segmentMs <= 0) return
            const within = Math.min(1, u.timeMs / segmentMs)
            report({
              stage: 'segment',
              clipIndex: segment.index,
              clipLabel: segment.label,
              clipCount: plan.segments.length,
              fraction: ((doneFrames + within * segment.frames) / total) * SEGMENT_SHARE
            })
          },
          ...(signal ? { signal } : {}),
          // Where its captions' file and font are, which its filter names by
          // relative paths, and its filter graph when that is in a file.
          cwd: scratchDir
        }).then(() => undefined)
      try {
        const card = withCardDecoding(segment.args)
        try {
          await encode(card)
        } catch (err) {
          // A card or driver that fails part way: the processor decodes it instead.
          if (signal?.aborted || card === segment.args) throw err
          await encode(segment.args)
        }
      } catch (err) {
        if (signal?.aborted) throw err
        // Name the clip. "ffmpeg exited with code 1" on its own is useless when
        // there are twenty segments.
        throw new ExportFailure(`Clip ${segment.index} (${segment.label}) could not be exported.`, detailsOf(err))
      }

      doneFrames += segment.frames
      // A file of its own is finished now, and kept whatever happens to the
      // next one: a batch stopped at clip 39 keeps the 38 before it.
      if (!plan.join) await settle(segment.output)
    }

    if (plan.join) {
      if (signal?.aborted) throw new ProcessError('cancelled', null, '')
      report({ stage: 'join', fraction: SEGMENT_SHARE, clipCount: plan.segments.length })
      await writeFile(plan.join.listPath, plan.join.listContent)

      // The join copies the picture and encodes the sound once, so it moves
      // along with the sequence's time like any other ffmpeg run.
      const totalMs = (plan.totalFrames / fps) * 1000
      const tail = 1 - SEGMENT_SHARE
      const measured = SEGMENT_SHARE + tail * MEASURE_SHARE

      const args = await levelledJoin({
        join: plan.join,
        loudness: plan.loudness,
        totalMs,
        ...(signal ? { signal } : {}),
        onFraction: (within) => report({ stage: 'join', fraction: SEGMENT_SHARE + tail * MEASURE_SHARE * within, clipCount: plan.segments.length })
      })

      try {
        await runFfmpeg(writingTo(args, stand), {
          onProgress: (u) => {
            const within = u.timeMs !== undefined && totalMs > 0 ? Math.min(1, u.timeMs / totalMs) : 0
            report({ stage: 'join', fraction: measured + (1 - measured) * within, clipCount: plan.segments.length })
          },
          ...(signal ? { signal } : {})
        })
      } catch (err) {
        if (signal?.aborted) throw err
        throw new ExportFailure('The clips could not be joined into one video.', detailsOf(err))
      }
    }

    // Every file is whole: each takes its name now, over any file it replaces.
    for (const output of plan.outputs) await settle(output)

    // Beside the finished video, once there is one: a subtitle or transcript
    // file for a video that failed would only be left lying there. Written
    // aside first too, so one that fails part way never cuts short the one it
    // replaces.
    try {
      for (const file of plan.beside) {
        const part = `${file.path}.${randomUUID().slice(0, 8)}.part`
        try {
          await writeFile(part, file.content)
          await rename(part, file.path)
        } finally {
          await rm(part, { force: true }).catch(() => undefined)
        }
      }
    } catch (err) {
      throw new ExportFailure(
        'The video was exported, but a file beside it (the subtitles or the transcript) could not be written. Close anything that has it open, then export again.',
        String(err)
      )
    }

    report({ stage: 'done', fraction: 1, clipCount: plan.segments.length })
    return plan.outputs
  } finally {
    await rm(scratchDir, { recursive: true, force: true })
    for (const part of pending.values()) await rm(part, { force: true }).catch(() => undefined)
  }
}

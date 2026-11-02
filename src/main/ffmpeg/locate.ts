import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { captureText } from './spawn'

// A Mac program has no extension (plan 104).
const EXE = process.platform === 'win32' ? '.exe' : ''
const FFMPEG = `ffmpeg${EXE}`

/**
 * Where ffmpeg and ffprobe are (plan 89): one gyan.dev build, in the installed
 * app's resources/ffmpeg, or else in the vendor/ffmpeg that `npm install`
 * fetched, found by walking up from this code. That covers the dev app, the
 * tests and the command line, which each run from a different depth.
 */
export function binariesFolder(): string {
  const resources = (process as { resourcesPath?: string }).resourcesPath
  if (resources && existsSync(join(resources, 'ffmpeg', FFMPEG))) return join(resources, 'ffmpeg')
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const here = join(dir, 'vendor', 'ffmpeg')
    if (existsSync(join(here, FFMPEG))) return here
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error('ffmpeg is not installed. Run `npm install`, which fetches it into vendor/ffmpeg.')
}

const ENCODER_LINE = /^\s[VAS][.A-Z]{5}\s+(\S+)/

/** Parse the name column out of `ffmpeg -encoders` output. */
export function parseEncoderList(stdout: string): Set<string> {
  const names = new Set<string>()
  for (const line of stdout.split('\n')) {
    const m = line.match(ENCODER_LINE)
    if (m?.[1]) names.add(m[1])
  }
  return names
}

const folder = binariesFolder()
export const ffmpegPath = join(folder, FFMPEG)
export const ffprobePath = join(folder, `ffprobe${EXE}`)

export interface FfmpegCapabilities {
  version: string
  encoders: Set<string>
  hasZscale: boolean
}

let cached: FfmpegCapabilities | null = null
let gpu: Promise<boolean> | null = null

/**
 * Whether an export can be encoded on an NVIDIA graphics card. The encoder is
 * listed whatever card is fitted, so it is tried: one small frame, encoded to
 * nowhere. Asked once and remembered for the life of the app.
 */
export function canEncodeOnGpu(): Promise<boolean> {
  gpu ??= captureText(
    ffmpegPath,
    ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:r=30', '-frames:v', '1', '-c:v', 'h264_nvenc', '-f', 'null', '-'],
    // A driver that hangs is a card that cannot be used: given up on after a while (audit 2026-10-01).
    { signal: AbortSignal.timeout(GPU_CHECK_MS) }
  ).then(
    () => true,
    () => false
  )
  return gpu
}

/** How long the graphics card is given to encode its one test frame. */
const GPU_CHECK_MS = 15_000

/**
 * Check the bundled binaries and report what they can do.
 * Throws when libx264, aac or pcm_s16le is missing, because nothing in the app
 * works without them.
 */
export async function verifyFfmpeg(): Promise<FfmpegCapabilities> {
  if (cached) return cached

  // All four at once: in turn, they held the window back four times over (audit 2026-10-01).
  const [versionOut, encoderOut, filterOut] = await Promise.all([
    captureText(ffmpegPath, ['-hide_banner', '-version']),
    captureText(ffmpegPath, ['-hide_banner', '-encoders']),
    captureText(ffmpegPath, ['-hide_banner', '-filters']),
    captureText(ffprobePath, ['-hide_banner', '-version'])
  ])
  const version = versionOut.split('\n')[0] ?? 'unknown'
  const encoders = parseEncoderList(encoderOut)

  const missing = ['libx264', 'aac', 'pcm_s16le'].filter((e) => !encoders.has(e))
  if (missing.length > 0) {
    throw new Error(
      `The bundled ffmpeg is missing required encoders: ${missing.join(', ')}. ` +
        `Run \`npm install\` again to fetch the pinned GPL build.`
    )
  }

  const hasZscale = /\bzscale\b/.test(filterOut)

  cached = { version, encoders, hasZscale }
  return cached
}

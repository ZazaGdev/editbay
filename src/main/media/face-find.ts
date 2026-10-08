import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type * as Ort from 'onnxruntime-node'
import { captureFfmpeg } from '../ffmpeg/run'
import type { Rect } from '../../shared/project'
import type { FaceSample } from '../../shared/face-follow'

/**
 * Follow face (plan 100): the faces on a stretch of a recording, found on this
 * PC by YuNet (OpenCV Zoo, MIT) run through ONNX Runtime (MIT) on the CPU.
 *
 * ONNX Runtime is a native module, so it cannot be bundled with the rest of
 * main: the installed app carries it in resources/onnxruntime, the dev app and
 * the tests load it from node_modules. It is loaded on first use, so a PC it
 * cannot run on still runs everything else.
 */

const MODEL = 'face_detection_yunet_2023mar.onnx'
/** The model takes a 640 square; a frame is shrunk to fit it and the rest left black. */
const SIDE = 640
const STRIDES = [8, 16, 32] as const
const MIN_SCORE = 0.6
/** A box that overlaps a better one by more than this is the same face. */
const SAME_FACE = 0.3
const MAX_FACES = 8
/** Samples a second, and at most this many in all, so a long clip takes no longer than a minute or so. */
const RATE = 5
const MAX_SAMPLES = 3000
/** Frames read in one go: about 50 MB of pixels. */
const CHUNK_SEC = 8

/** The folder `name` is in: the installed app's resources, or else found by walking up from this code. */
function located(resourcesSub: string, devSub: string): string {
  const resources = (process as { resourcesPath?: string }).resourcesPath
  if (resources && existsSync(join(resources, resourcesSub))) return join(resources, resourcesSub)
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const here = join(dir, devSub)
    if (existsSync(here)) return here
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`${devSub} is missing. Run \`npm install\`.`)
}

let session: Promise<{ ort: typeof Ort; session: Ort.InferenceSession }> | null = null

function detector(): Promise<{ ort: typeof Ort; session: Ort.InferenceSession }> {
  session ??= (async () => {
    const pkg = located(join('onnxruntime', 'node_modules', 'onnxruntime-node'), join('node_modules', 'onnxruntime-node'))
    const ort = createRequire(import.meta.url)(pkg) as typeof Ort
    const model = join(located('models', join('resources', 'models')), MODEL)
    return { ort, session: await ort.InferenceSession.create(model, { executionProviders: ['cpu'] }) }
  })()
  // A failure is not kept, so the next try loads it again.
  session.catch(() => (session = null))
  return session
}

/** The size a `width` x `height` frame is shrunk to inside the 640 square, in even numbers as ffmpeg wants. */
export function fitted(width: number, height: number): { w: number; h: number; scale: number } {
  const scale = SIDE / Math.max(width, height, 1)
  const even = (n: number): number => Math.max(2, Math.min(SIDE, 2 * Math.round((n * scale) / 2)))
  return { w: even(width), h: even(height), scale }
}

/**
 * The faces found on frames of `path` from `fromSec` to `toSec`, five times a
 * second, each sample on a frame of the recording at `fps` and each face in
 * the recording's own `width` x `height` pixels.
 */
export async function findFaces(
  path: string,
  span: { fromSec: number; toSec: number },
  size: { width: number; height: number; fps: number }
): Promise<{ samples: FaceSample[]; rate: number }> {
  const { ort, session: s } = await detector()
  const length = Math.max(0, span.toSec - span.fromSec)
  const rate = Math.min(RATE, MAX_SAMPLES / Math.max(length, 1))
  const fit = fitted(size.width, size.height)
  const frameBytes = fit.w * fit.h * 3
  const input = new Float32Array(3 * SIDE * SIDE)
  const samples: FaceSample[] = []

  for (let start = span.fromSec; start < span.toSec; start += CHUNK_SEC) {
    const dur = Math.min(CHUNK_SEC, span.toSec - start)
    const { stdout } = await captureFfmpeg([
      '-v', 'error', '-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', path, '-an',
      '-vf', `fps=${rate.toFixed(4)},scale=${fit.w}:${fit.h}:flags=area,format=bgr24`, '-f', 'rawvideo', 'pipe:1'
    ], { maxStdout: 256 * 1024 * 1024, timeoutMs: 120_000 })
    const count = Math.floor(stdout.length / frameBytes)
    for (let f = 0; f < count; f++) {
      const sec = start + f / rate
      if (sec >= span.toSec) break
      toPlanes(stdout, f * frameBytes, fit.w, fit.h, input)
      const out = await s.run({ [s.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, SIDE, SIDE]) })
      const faces = decode(out).map((r) => ({ x: r.x / fit.scale, y: r.y / fit.scale, w: r.w / fit.scale, h: r.h / fit.scale }))
      samples.push({ at: Math.round(sec * size.fps), faces })
    }
  }
  return { samples, rate }
}

/** A `w` x `h` BGR frame into the model's three 640 square planes, black beyond the frame. */
function toPlanes(buf: Uint8Array, offset: number, w: number, h: number, out: Float32Array): void {
  out.fill(0)
  const plane = SIDE * SIDE
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = offset + (y * w + x) * 3
      const dst = y * SIDE + x
      out[dst] = buf[src]!
      out[plane + dst] = buf[src + 1]!
      out[2 * plane + dst] = buf[src + 2]!
    }
  }
}

/** YuNet's outputs as face boxes in the 640 square, the best first, overlapping repeats dropped. */
function decode(out: Record<string, Ort.Tensor>): Rect[] {
  const found: { r: Rect; score: number }[] = []
  for (const stride of STRIDES) {
    const cls = out[`cls_${stride}`]!.data as Float32Array
    const obj = out[`obj_${stride}`]!.data as Float32Array
    const box = out[`bbox_${stride}`]!.data as Float32Array
    const cols = SIDE / stride
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(clamp01(cls[i]!) * clamp01(obj[i]!))
      if (score < MIN_SCORE) continue
      const cx = ((i % cols) + box[i * 4]!) * stride
      const cy = (Math.floor(i / cols) + box[i * 4 + 1]!) * stride
      const w = Math.exp(box[i * 4 + 2]!) * stride
      const h = Math.exp(box[i * 4 + 3]!) * stride
      found.push({ r: { x: cx - w / 2, y: cy - h / 2, w, h }, score })
    }
  }
  found.sort((a, b) => b.score - a.score)
  const kept: Rect[] = []
  for (const f of found) {
    if (kept.length >= MAX_FACES) break
    if (kept.every((k) => overlap(k, f.r) <= SAME_FACE)) kept.push(f.r)
  }
  return kept
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

/** How much two boxes overlap: the shared area over the area of both. */
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  const shared = w * h
  return shared / (a.w * a.h + b.w * b.h - shared)
}

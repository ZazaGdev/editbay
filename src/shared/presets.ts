/** The 4K ceiling the handoff preset scales down to, matching the import conform cap. */
export const HANDOFF_CAP = 3840

export interface Preset {
  id: string
  /** What a sequence in this shape is called until you rename it. */
  name: string
  label: string
  hint: string
  /** Fixed output size, or null to keep the cropped region at source scale. */
  width: number | null
  height: number | null
  crf: number
  /** A preset whose output size varies per clip cannot be copy-joined. */
  joinable: boolean
}

export const PRESETS: Preset[] = [
  {
    id: 'vertical',
    name: 'Vertical',
    label: 'Vertical 1080x1920',
    hint: 'TikTok, Reels, Shorts',
    width: 1080,
    height: 1920,
    crf: 20,
    joinable: true
  },
  {
    id: 'landscape',
    name: 'Landscape',
    label: 'Landscape 1920x1080',
    hint: 'YouTube',
    width: 1920,
    height: 1080,
    crf: 18,
    joinable: true
  },
  {
    id: 'square',
    name: 'Square',
    label: 'Square 1080x1080',
    hint: 'Feed posts',
    width: 1080,
    height: 1080,
    crf: 20,
    joinable: true
  },
  {
    id: 'handoff',
    name: 'Handoff',
    label: 'Handoff master',
    hint: 'Source scale, for feeding into another tool. One file per clip.',
    width: null,
    height: null,
    crf: 16,
    joinable: false
  }
]

export function presetById(id: string): Preset {
  const found = PRESETS.find((p) => p.id === id)
  if (!found) throw new Error(`unknown preset: ${id}`)
  return found
}

/**
 * The size a clip is written at under this preset.
 *
 * A fixed preset always wins. The handoff preset keeps the cropped region as it
 * is, scaled down only if it exceeds the 4K ceiling, and always even because
 * H.264 requires it.
 */
export function outputSizeFor(preset: Preset, crop: { w: number; h: number }): { width: number; height: number } {
  if (preset.width !== null && preset.height !== null) {
    return { width: preset.width, height: preset.height }
  }
  const longest = Math.max(crop.w, crop.h)
  const scale = longest > HANDOFF_CAP ? HANDOFF_CAP / longest : 1
  const even = (n: number): number => Math.max(2, Math.round((n * scale) / 2) * 2)
  return { width: even(crop.w), height: even(crop.h) }
}

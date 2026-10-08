/**
 * Where the apps put their buttons, captions and names over a vertical video,
 * so a face or a title can be kept clear of them.
 *
 * In pixels of a 1080x1920 frame. Only Meta publishes its numbers, for Reels,
 * and those are written for ads; TikTok's and Shorts' come from third-party
 * guides and move whenever the apps change their layouts. They are a starting
 * point, kept here in one place so they are easy to correct.
 */

export type SafeZoneApp = 'tiktok' | 'reels' | 'shorts'
export type SafeZoneChoice = 'none' | SafeZoneApp | 'all'

export interface Margins {
  top: number
  bottom: number
  left: number
  right: number
}

/** The frame the margins are measured in. */
export const SAFE_FRAME = { width: 1080, height: 1920 }

export const SAFE_ZONES: Record<SafeZoneApp, { name: string; margins: Margins }> = {
  // Meta's ads guide: 14% at the top, 35% at the bottom, 6% at each side.
  reels: { name: 'Reels', margins: { top: 269, bottom: 672, left: 65, right: 65 } },
  tiktok: { name: 'TikTok', margins: { top: 130, bottom: 484, left: 60, right: 140 } },
  shorts: { name: 'Shorts', margins: { top: 288, bottom: 672, left: 48, right: 192 } }
}

export const SAFE_ZONE_CHOICES: { id: SafeZoneChoice; name: string }[] = [
  { id: 'none', name: 'None' },
  { id: 'tiktok', name: 'TikTok' },
  { id: 'reels', name: 'Reels' },
  { id: 'shorts', name: 'Shorts' },
  { id: 'all', name: 'All three' }
]

/** The margins to keep clear for a choice: every app's widest, for all three. Null for none. */
export function safeMargins(choice: SafeZoneChoice): Margins | null {
  if (choice === 'none') return null
  if (choice !== 'all') return SAFE_ZONES[choice].margins
  const all = Object.values(SAFE_ZONES).map((z) => z.margins)
  return {
    top: Math.max(...all.map((m) => m.top)),
    bottom: Math.max(...all.map((m) => m.bottom)),
    left: Math.max(...all.map((m) => m.left)),
    right: Math.max(...all.map((m) => m.right))
  }
}

/**
 * The margins as fractions of a frame's width and height, for a tall frame.
 * Null for a frame that is not taller than it is wide: the apps lay a
 * landscape or square video out differently, and these numbers do not apply.
 */
export function safeFractions(choice: SafeZoneChoice, frameW: number, frameH: number): Margins | null {
  const m = safeMargins(choice)
  if (!m || !(frameH > frameW)) return null
  return {
    top: m.top / SAFE_FRAME.height,
    bottom: m.bottom / SAFE_FRAME.height,
    left: m.left / SAFE_FRAME.width,
    right: m.right / SAFE_FRAME.width
  }
}

/** How far in from each side a title is kept when no app's safe zone applies, as Premiere's title safe does. */
export const TITLE_SAFE = 0.1

/**
 * The area a title is kept inside, in output pixels: the chosen app's safe
 * zone on a tall frame, and the usual title safe margin otherwise.
 */
export function titleSafeRect(choice: SafeZoneChoice, frameW: number, frameH: number): { x: number; y: number; w: number; h: number } {
  const m = safeFractions(choice, frameW, frameH) ?? { top: TITLE_SAFE, bottom: TITLE_SAFE, left: TITLE_SAFE, right: TITLE_SAFE }
  return {
    x: m.left * frameW,
    y: m.top * frameH,
    w: (1 - m.left - m.right) * frameW,
    h: (1 - m.top - m.bottom) * frameH
  }
}

/** Reads a stored choice, falling back to none for anything it does not know. */
export function cleanSafeZoneChoice(raw: unknown): SafeZoneChoice {
  return SAFE_ZONE_CHOICES.some((c) => c.id === raw) ? (raw as SafeZoneChoice) : 'none'
}

/**
 * The window's themes (task 66): today's look, and two from the Arctic
 * Contrast family the owner chose, near-black blue panels with strong borders
 * and tight corners, one with a teal accent and one with electric blue on a
 * darker ground. Each is a set of changes to the tokens in `theme.ts`, which
 * applies the chosen one as it loads, so every value read afterwards is the
 * theme's. A change of theme loads the window again.
 */

export type ThemeId = 'current' | 'teal' | 'electric'

export const THEMES: readonly { id: ThemeId; name: string }[] = [
  { id: 'current', name: 'Classic blue' },
  { id: 'teal', name: 'Arctic teal' },
  { id: 'electric', name: 'Electric deep' }
]

export function cleanTheme(raw: unknown): ThemeId {
  return THEMES.some((t) => t.id === raw) ? (raw as ThemeId) : 'current'
}

/** Where the window keeps its settings, the theme among them. */
const KEY = 'editbay.window'

/** The theme chosen last, read as the window loads; today's look when none was. */
export function chosenTheme(): ThemeId {
  try {
    const kept = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as { theme?: unknown }
    return cleanTheme(kept.theme)
  } catch {
    return 'current'
  }
}

/**
 * Choose a theme: kept with the window's settings at once, then the window
 * loads again in it. The project is held by the app, not the window, so
 * nothing open is lost.
 */
export function switchTheme(id: ThemeId): void {
  try {
    const kept = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>
    window.localStorage.setItem(KEY, JSON.stringify({ ...kept, theme: id }))
  } catch {
    return
  }
  window.location.reload()
}

type Changes = Record<string, Record<string, string | number>>

const SANS = 'Inter, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'
const MONO = '"JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace'

/** What both Arctic themes share: the surfaces, the borders, the type and the corners. */
const ARCTIC: Changes = {
  surface: {
    canvas: '#04060A',
    panel: '#0B1018',
    raised: '#111823',
    control: '#18212E',
    sunken: '#070B11',
    controlHover: '#1F2A3A',
    line: '#233041',
    lineStrong: '#34465C',
    edge: '#4C6380',
    controlLine: '#647C99',
    controlLineHover: '#8299B5'
  },
  ink: { primary: '#F4F8FC', secondary: '#C3CEDB', muted: '#9AAABD', disabled: '#66778C' },
  meaning: { playhead: '#FF3348' },
  track: { picture: '#5AA9FF', sound: '#3FE0A0', voice: '#C7A2FF' },
  clip: {
    picture: '#0E1A2A',
    pictureLine: '#2D4866',
    sound: '#0B1F19',
    soundLine: '#24584A',
    ink: '#E2F4FF',
    wave: '#3B8F72',
    waveSelected: '#7DF2C4'
  },
  caption: { fill: '#2A2612', line: '#6B5D24', ink: '#FFF2BF' },
  radius: { chip: 3, control: 3, panel: 4, dialog: 6 },
  type: {
    display: `650 18px ${SANS}`,
    title: `650 15px ${SANS}`,
    body: `13px ${SANS}`,
    meta: `12px ${SANS}`,
    label: `650 12px ${SANS}`,
    mono: `13px ${MONO}`,
    monoSmall: `12px ${MONO}`
  },
  elevation: { panel: 'none', raised: 'none', over: '0 0 0 1px #4C6380, 0 12px 28px rgba(0, 0, 0, 0.8)' }
}

const merged = (base: Changes, more: Changes): Changes => {
  const out: Changes = { ...base }
  for (const [group, values] of Object.entries(more)) out[group] = { ...(base[group] ?? {}), ...values }
  return out
}

export const THEME_CHANGES: Record<ThemeId, Changes> = {
  current: {},
  teal: merged(ARCTIC, {
    ink: { onAccent: '#00170F' },
    accent: {
      base: '#14BFA6',
      bright: '#5EE6D0',
      wash: '#0E2E2C',
      washLine: '#1F5E55',
      pressed: '#0B4E45',
      pressedHover: '#0F6257',
      tint: 'rgba(20, 191, 166, 0.12)',
      tintLine: 'rgba(94, 230, 208, 0.5)',
      band: 'rgba(20, 191, 166, 0.24)'
    }
  }),
  electric: merged(ARCTIC, {
    surface: { canvas: '#010205', panel: '#060A11', raised: '#0B1019', control: '#121A26', sunken: '#030509', controlHover: '#1A2433' },
    ink: { onAccent: '#FFFFFF' },
    accent: {
      base: '#3370FF',
      bright: '#7EA2FF',
      wash: '#0F1E44',
      washLine: '#2A4590',
      pressed: '#1A3A8F',
      pressedHover: '#2246A8',
      tint: 'rgba(51, 112, 255, 0.14)',
      tintLine: 'rgba(126, 162, 255, 0.55)',
      band: 'rgba(51, 112, 255, 0.26)'
    }
  })
}

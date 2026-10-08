/**
 * The command search: everything the editor can do, found by typing a few
 * letters of it. Pure, so what matches and in what order is tested.
 */

export interface Command {
  id: string
  /** What it does, as the list shows it. */
  label: string
  /** The key that does the same, if it has one. */
  key?: string
  /** Other words it should be found by, such as "vertical" for a shape. */
  keywords?: string[]
  /**
   * The heading it is listed under when nothing is typed, the same four the
   * Shortcuts window uses. Left off, it goes under the last of them.
   */
  group?: string
  /** False when it cannot be done just now, as undoing with nothing to undo. Shown, but not run. */
  enabled?: boolean
  /**
   * Set for a switch: a preference that is on or off, shown with its state
   * where an action shows its key. Running one flips it and leaves the list
   * open, so a run of them does not mean opening it each time.
   */
  on?: boolean
  run: () => void
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== '')
}

/**
 * The commands that match what was typed, best first. Every word typed must
 * begin a word of the command's label or keywords, so "sh tik" finds "Show
 * safe zones for TikTok". Those whose label starts with the first word come
 * first; of the rest, the shorter labels; otherwise they keep their order. Nothing typed matches everything.
 */
export function findCommands<T extends Pick<Command, 'label' | 'keywords'>>(commands: T[], typed: string): T[] {
  const wanted = words(typed)
  // Typed in another alphabet, as with a Georgian layout on: nothing matches it.
  if (wanted.length === 0) return typed.trim() === '' ? commands : []
  const scored: { c: T; score: number; i: number; rest: number }[] = []
  commands.forEach((c, i) => {
    const own = words([c.label, ...(c.keywords ?? [])].join(' '))
    if (!wanted.every((w) => own.some((o) => o.startsWith(w)))) return
    const label = words(c.label)
    const score = label[0]?.startsWith(wanted[0]!) ? 0 : label.some((o) => o.startsWith(wanted[0]!)) ? 1 : 2
    // Among those found further in, one whose label ends with what was typed,
    // naming it, then the shorter: "picture in picture" is the layout of that
    // name before a command that only mentions one (task 54).
    const ends = wanted.length <= label.length && wanted.every((w, k) => label[label.length - wanted.length + k]!.startsWith(w))
    scored.push({ c, score, i, rest: score === 0 || ends ? 0 : label.length })
  })
  return scored.sort((a, b) => a.score - b.score || a.rest - b.rest || a.i - b.i).map((s) => s.c)
}

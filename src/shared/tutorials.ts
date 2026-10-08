/**
 * The tutorials: what an entry is, how one is read off disk, and how they are
 * found by typing.
 *
 * Pure, so what matches and in what order is tested without a window. The
 * files themselves live in `docs/tutorials` and are bundled at build time; see
 * that folder's README for how to write one.
 */

/**
 * The tabs, in the order they are drawn.
 *
 * Eight, because twelve is a wall and eight is a row. A file naming anything
 * else fails the test that reads them all, which is the point: a typo in a
 * category would otherwise show up as an entry nobody can find.
 */
export const CATEGORIES = [
  'Getting started',
  'Cutting',
  'Framing',
  'Layers',
  'Sound',
  'Captions',
  'Timeline',
  'Export'
] as const

export type Category = (typeof CATEGORIES)[number]

export function isCategory(s: string): s is Category {
  return (CATEGORIES as readonly string[]).includes(s)
}

export interface Tutorial {
  /** The file name without its number or extension, which is also its id in the list. */
  id: string
  title: string
  category: Category
  /** Words it should be found by that the title does not already contain. */
  keywords: string[]
  /** A capture in `docs/tutorials/media`, shown under the first paragraph. */
  media?: string
  /** The markdown below the frontmatter. */
  body: string
}

/** Where a search matched, so the list can show the line with the term marked. */
export interface Snippet {
  line: string
  from: number
  to: number
}

export interface Hit {
  tutorial: Tutorial
  /** 0 is best. See `findTutorials`. */
  rank: number
  /** Absent when the match was in the title, where the list already shows it. */
  snippet?: Snippet
}

/**
 * One entry, read from a file.
 *
 * Throws rather than returning something half-built, because a broken entry
 * must fail the test that sweeps the folder rather than appear in the window
 * as an empty panel.
 */
export function parseTutorial(id: string, text: string): Tutorial {
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) throw new Error(`${id}: no frontmatter block`)

  const fields = new Map<string, string>()
  for (const line of m[1]!.split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }

  const title = fields.get('title') ?? ''
  const category = fields.get('category') ?? ''
  if (title === '') throw new Error(`${id}: no title`)
  if (!isCategory(category)) throw new Error(`${id}: unknown category "${category}"`)

  const keywords = (fields.get('keywords') ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k !== '')
  const media = fields.get('media')

  return {
    id,
    title,
    category,
    keywords,
    ...(media !== undefined && media !== '' ? { media } : {}),
    body: (m[2] ?? '').trim()
  }
}

/**
 * What a step's control needs on the timeline or in Sources before it can be
 * shown (task 84), with what the callout says when there is none: what to
 * drop or make first. A kind that can be selected is selected by Show me,
 * the one nearest the playhead, before the control is looked for.
 */
export const NEEDS = {
  picture: 'Drop a video or an image on the timeline first, then press Show me again.',
  video: 'Drop a video on the timeline first, then press Show me again.',
  above: 'Put a recording on a track above V1 first, then press Show me again.',
  overlay: 'Put an image, a text or a shape above V1 first, then press Show me again.',
  text: 'Add a text first: press T, then press Show me again.',
  shape: 'Draw a shape first, with the shapes button left of the timeline, then press Show me again.',
  sound: 'Drop a sound or a video with sound on the timeline first, then press Show me again.',
  linked: 'Drop a video with sound on the timeline first, then press Show me again.',
  group: 'Group two clips first: select them and press Ctrl+G, then press Show me again.',
  cut: 'Put two clips side by side on a track first, then press Show me again.',
  caption: 'Make captions first, with Captions in the top bar, then press Show me again.',
  transition: 'Add a transition at a cut first, then press Show me again.',
  marker: 'Drop a marker first: press M, then press Show me again.',
  keyframes: 'Give a clip zoom keyframes first, in Zoom in the inspector, then press Show me again.',
  marked: 'Change something on a clip first, such as its look or its zoom, then press Show me again.',
  many: 'These show once Sources holds more than five files: drop some more in first, then press Show me again.',
  days: 'These headings show once Sources holds files brought in on different days.',
  asset: 'Drop a video, sound or image file in the window first, then press Show me again.',
  effect: 'Put a file in your assets folder first, then press Show me again.',
  missing: 'Nothing is missing right now. This bar only shows when a source file cannot be found.'
} as const

export type Need = keyof typeof NEEDS

export function isNeed(s: string): s is Need {
  return Object.prototype.hasOwnProperty.call(NEEDS, s)
}

/** Where a step's Show me points, and what its callout says. */
export interface ShowMe {
  /** The `data-testid` of the control to highlight. */
  target: string
  /** For a control that only appears once you act: what to do with the one highlighted. */
  say?: string
  /** What has to exist, and be selected where it can be, for the control to be there. */
  on?: Need
  /**
   * The control to ring when `target` is not there, as one that only shows in
   * a mode: the switch to that mode. `say` is then what the callout says, and
   * the target itself, when found, is ringed with "Here".
   */
  or?: string
}

export interface Step {
  /** The step's markdown, without its `{show: ...}`. */
  text: string
  show?: ShowMe
  /** An `on:` kind that is not one of `NEEDS`, kept so the test that reads every file can name it. */
  unknownNeed?: string
}

/** An entry's body in the three parts the window draws. */
export interface Sections {
  /** Everything before `## Steps`: one sentence, above the tabs. */
  lede: string
  steps: Step[]
  /** Everything under `## Details`. Empty when there is none. */
  details: string
}

const SHOW = /\s*\{show:\s*([\w-]+)(?:\s+or:([\w-]+))?(?:\s+on:([\w-]+))?(?:\s+"([^"]*)")?\s*\}\s*$/

/** A body with its Show me markers taken out, for search and snippets. */
function withoutShow(body: string): string {
  return body.replace(/\s*\{show:[^}]*\}/g, '')
}

/**
 * The lede, the numbered steps and the details of an entry (plan 101).
 *
 * An entry with no `## Steps` heading is all lede, so a file written the old
 * way still reads, and the sweep in the tests is what insists on the new one.
 */
export function sections(body: string): Sections {
  const lines = body.split(/\r?\n/)
  const at = (name: string): number => lines.findIndex((l) => l.trim().toLowerCase() === `## ${name}`)
  const s = at('steps')
  const d = at('details')
  if (s < 0) return { lede: body.trim(), steps: [], details: d < 0 ? '' : lines.slice(d + 1).join('\n').trim() }

  const end = d > s ? d : lines.length
  const steps: Step[] = []
  for (const line of lines.slice(s + 1, end)) {
    const item = line.match(/^\s*\d+\.\s+(.*)$/)
    if (item) {
      steps.push({ text: item[1]! })
    } else if (line.trim() !== '' && steps.length > 0) {
      // A step may wrap onto the lines below it.
      steps[steps.length - 1]!.text += ' ' + line.trim()
    }
  }
  for (const step of steps) {
    const m = step.text.match(SHOW)
    if (!m) continue
    step.text = step.text.slice(0, m.index).trim()
    // An unknown kind is kept off rather than thrown on: the sweep in the tests is what refuses it.
    const on = m[3]
    step.show = {
      target: m[1]!,
      ...(m[2] ? { or: m[2] } : {}),
      ...(m[4] ? { say: m[4] } : {}),
      ...(on !== undefined && isNeed(on) ? { on } : {})
    }
    if (on !== undefined && !isNeed(on)) step.unknownNeed = on
  }

  return {
    lede: lines.slice(0, s).join('\n').trim(),
    steps,
    details: d > s ? lines.slice(d + 1).join('\n').trim() : ''
  }
}

/** Entries in the order they are drawn: by category, then by file name. */
export function inOrder(tutorials: Tutorial[]): Tutorial[] {
  return [...tutorials].sort(
    (a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.id.localeCompare(b.id)
  )
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== '')
}

/** The headings inside an entry, which are more telling than its body text. */
function headings(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((l) => l.startsWith('#'))
    .join(' ')
}

/**
 * The first line of `body` where `wanted` begins a word, with where it sits,
 * so the list can draw the line and mark the term inside it. Null when the
 * match was not in the body at all.
 */
function snippetFor(body: string, wanted: string): Snippet | null {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line.startsWith('|')) continue
    const at = line.toLowerCase().search(new RegExp(`\\b${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    if (at >= 0) return { line, from: at, to: at + wanted.length }
  }
  return null
}

/**
 * The entries that match what was typed, best first.
 *
 * Built on the same idea as `findCommands` in `commands.ts`, so the two search
 * boxes in the app behave the same way: **every** word typed must begin a word
 * of the entry, so "rem sil" finds "Remove silences", and something typed in
 * another alphabet matches nothing rather than everything.
 *
 * What it adds, because an entry has a body and a command does not, is the
 * rank and the snippet:
 *
 * - **0** the title's first word starts with the first word typed
 * - **1** some other word of the title does
 * - **2** a keyword or a heading inside the entry does
 * - **3** only the body does
 *
 * Forty entries scanned per keystroke is nothing, so there is no index and no
 * debounce. Nothing typed returns everything, in reading order.
 */
export function findTutorials(tutorials: Tutorial[], typed: string): Hit[] {
  const wanted = words(typed)
  if (wanted.length === 0) {
    return typed.trim() === '' ? inOrder(tutorials).map((t) => ({ tutorial: t, rank: 0 })) : []
  }
  const first = wanted[0]!

  const scored: { hit: Hit; i: number }[] = []
  inOrder(tutorials).forEach((t, i) => {
    const title = words(t.title)
    const keys = words([...t.keywords, headings(t.body)].join(' '))
    const body = words(withoutShow(t.body))
    const everywhere = [...title, ...keys, ...body]

    // Every word typed has to begin a word somewhere in the entry, or it is
    // not a match at all. This is what makes a second word narrow rather than
    // widen, which is how anyone expects a search box to behave.
    if (!wanted.every((w) => everywhere.some((o) => o.startsWith(w)))) return

    const rank = title[0]?.startsWith(first)
      ? 0
      : title.some((o) => o.startsWith(first))
        ? 1
        : keys.some((o) => o.startsWith(first))
          ? 2
          : 3

    const snippet = rank >= 2 ? snippetFor(withoutShow(t.body), first) : null
    scored.push({ hit: { tutorial: t, rank, ...(snippet ? { snippet } : {}) }, i })
  })

  return scored.sort((a, b) => a.hit.rank - b.hit.rank || a.i - b.i).map((s) => s.hit)
}

/** How many hits fall in each category, for the counts on the tabs. */
export function countByCategory(hits: Hit[]): Map<Category, number> {
  const counts = new Map<Category, number>()
  for (const h of hits) counts.set(h.tutorial.category, (counts.get(h.tutorial.category) ?? 0) + 1)
  return counts
}

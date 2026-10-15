import { describe, it, expect, vi } from 'vitest'

// The files name Windows' keys: pinned so the Mac runner reads them the same.
vi.mock('../../src/shared/system', async (original) => ({ ...(await original<typeof import('../../src/shared/system')>()), RUNNING_SYSTEM: 'windows', COMMAND_KEY_NAME: 'Ctrl' }))
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  CATEGORIES,
  NEEDS,
  countByCategory,
  findTutorials,
  inOrder,
  isCategory,
  parseTutorial,
  sections,
  type Tutorial
} from '../../src/shared/tutorials'

const FOLDER = join(process.cwd(), 'docs', 'tutorials')

/** Every file of the window's code, as one string, to find test ids and links in. */
function readAll(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .map((d) => (d.isDirectory() ? readAll(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? readFileSync(join(dir, d.name), 'utf8') : ''))
    .join('\n')
}
const SOURCE = readAll(join(process.cwd(), 'src', 'renderer'))

/** The id as a quoted literal, which is how every test id in the code is written. Ids are letters, digits and hyphens. */
function quoted(id: string): RegExp {
  return new RegExp(`["'\`]${id}["'\`]`)
}

/**
 * Whether a control with this test id is drawn somewhere: written out whole,
 * or built from a part, as `appear-${side}` and `${testid}-typed` build theirs.
 */
function drawn(id: string): boolean {
  if (quoted(id).test(SOURCE)) return true
  const cut = id.lastIndexOf('-')
  if (cut < 0) return false
  const [head, tail] = [id.slice(0, cut), id.slice(cut + 1)]
  return SOURCE.includes(`\`${head}-\${`) || (SOURCE.includes(`}-${tail}\``) && drawn(head))
}

function entry(over: Partial<Tutorial> = {}): Tutorial {
  return {
    id: '100-x',
    title: 'Split a clip',
    category: 'Cutting',
    keywords: ['razor'],
    body: 'Press S to split the selected clip.',
    ...over
  }
}

describe('reading an entry', () => {
  const text = ['---', 'title: Remove silences', 'category: Cutting', 'keywords: pauses, dead air', '---', '', 'Body here.'].join('\n')

  it('takes the fields and the body apart', () => {
    const t = parseTutorial('150-remove-silences', text)
    expect(t.title).toBe('Remove silences')
    expect(t.category).toBe('Cutting')
    expect(t.keywords).toEqual(['pauses', 'dead air'])
    expect(t.body).toBe('Body here.')
    expect(t.id).toBe('150-remove-silences')
  })

  it('reads a file written with Windows line endings', () => {
    const t = parseTutorial('x', text.replace(/\n/g, '\r\n'))
    expect(t.title).toBe('Remove silences')
    expect(t.body).toBe('Body here.')
  })

  it('leaves keywords empty rather than holding a blank one', () => {
    expect(parseTutorial('x', '---\ntitle: T\ncategory: Export\nkeywords:\n---\nb').keywords).toEqual([])
  })

  it('refuses a file with no frontmatter, rather than showing an empty panel', () => {
    expect(() => parseTutorial('x', 'Just a body.')).toThrow(/frontmatter/)
  })

  it('refuses a file with no title', () => {
    expect(() => parseTutorial('x', '---\ncategory: Export\n---\nb')).toThrow(/title/)
  })

  it('refuses an unknown category, which is how a typo is caught', () => {
    expect(() => parseTutorial('x', '---\ntitle: T\ncategory: Cuting\n---\nb')).toThrow(/Cuting/)
  })

  it('knows which categories exist', () => {
    expect(isCategory('Cutting')).toBe(true)
    expect(isCategory('Cuting')).toBe(false)
  })
})

describe('the order entries are drawn in', () => {
  it('is by category first, in tab order, then by file name', () => {
    const list = [
      entry({ id: '710-a', category: 'Export', title: 'Export' }),
      entry({ id: '120-b', category: 'Cutting', title: 'Trim' }),
      entry({ id: '110-a', category: 'Cutting', title: 'Split' }),
      entry({ id: '010-a', category: 'Getting started', title: 'What' })
    ]
    expect(inOrder(list).map((t) => t.id)).toEqual(['010-a', '110-a', '120-b', '710-a'])
  })

  it('leaves the list it was given alone', () => {
    const list = [entry({ id: 'b' }), entry({ id: 'a' })]
    inOrder(list)
    expect(list.map((t) => t.id)).toEqual(['b', 'a'])
  })
})

describe('finding an entry by typing', () => {
  const list = [
    entry({ id: '110-split', title: 'Split a clip', category: 'Cutting', keywords: ['razor'], body: 'Press S.' }),
    entry({
      id: '150-silences',
      title: 'Remove silences',
      category: 'Cutting',
      keywords: ['pauses'],
      body: 'It finds every pause and shows the time saved.'
    }),
    entry({
      id: '210-crop',
      title: 'Choose what fills the frame',
      category: 'Framing',
      keywords: ['crop'],
      body: 'Drag the box. A silence is not mentioned here, except this once.'
    })
  ]

  it('returns everything, in order, when nothing is typed', () => {
    expect(findTutorials(list, '').map((h) => h.tutorial.id)).toEqual(['110-split', '150-silences', '210-crop'])
  })

  it('matches a word of the title', () => {
    expect(findTutorials(list, 'silences').map((h) => h.tutorial.id)).toEqual(['150-silences'])
  })

  it('matches a prefix, but only forwards: "silences" does not find "silence"', () => {
    // The crop entry's body says "silence". Typing the longer word must not
    // reach it, or every search would widen as you typed instead of narrowing.
    expect(findTutorials(list, 'silen').map((h) => h.tutorial.id)).toEqual(['150-silences', '210-crop'])
    expect(findTutorials(list, 'silences').map((h) => h.tutorial.id)).toEqual(['150-silences'])
  })

  it('puts a title match above a body match', () => {
    const hits = findTutorials(list, 'silence')
    expect(hits[0]!.tutorial.id).toBe('150-silences')
    expect(hits[0]!.rank).toBeLessThan(hits[1]!.rank)
  })

  it('takes the first letters of several words, so "rem sil" finds "Remove silences"', () => {
    expect(findTutorials(list, 'rem sil').map((h) => h.tutorial.id)).toEqual(['150-silences'])
  })

  it('narrows rather than widens as you type another word', () => {
    // "the" reaches both entries; "pause" is in only one of them. Asserted as
    // a shrinking set rather than a fixed order, because the order is the
    // ranking's business and is tested on its own above.
    const one = findTutorials(list, 'the').map((h) => h.tutorial.id)
    const two = findTutorials(list, 'the pause').map((h) => h.tutorial.id)
    expect(one).toHaveLength(2)
    expect(two).toEqual(['150-silences'])
    expect(one).toEqual(expect.arrayContaining(two))
  })

  it('finds an entry by a keyword the title does not contain', () => {
    expect(findTutorials(list, 'razor').map((h) => h.tutorial.id)).toEqual(['110-split'])
  })

  it('matches nothing when typed in another alphabet, rather than everything', () => {
    expect(findTutorials(list, 'გამარჯობა')).toEqual([])
  })

  it('carries the line that matched, so the list can show it', () => {
    const hit = findTutorials(list, 'silence').find((h) => h.tutorial.id === '210-crop')
    expect(hit?.snippet?.line).toContain('silence')
    expect(hit!.snippet!.line.slice(hit!.snippet!.from, hit!.snippet!.to)).toBe('silence')
  })

  it('does not carry a snippet for a title match, which the list already shows', () => {
    expect(findTutorials(list, 'remove')[0]!.snippet).toBeUndefined()
  })

  it('counts hits per category, for the numbers on the tabs', () => {
    const counts = countByCategory(findTutorials(list, 'silence'))
    expect(counts.get('Cutting')).toBe(1)
    expect(counts.get('Framing')).toBe(1)
    expect(counts.get('Export')).toBeUndefined()
  })
})

describe('an entry in steps and details (plan 101)', () => {
  const body = [
    'Keep a clip to use again.',
    '',
    '## Steps',
    '',
    '1. Right click a clip. {show: clip}',
    '2. Choose [Save as asset]. {show: clip "Right click this clip, then choose Save as asset"}',
    '3. A step that wraps',
    '   onto the next line.',
    '',
    '## Details',
    '',
    'The prose.'
  ].join('\n')

  it('takes the lede, the steps and the details apart', () => {
    const s = sections(body)
    expect(s.lede).toBe('Keep a clip to use again.')
    expect(s.steps.map((x) => x.text)).toEqual([
      'Right click a clip.',
      'Choose [Save as asset].',
      'A step that wraps onto the next line.'
    ])
    expect(s.details).toBe('The prose.')
  })

  it('reads where Show me points, and what it says for a control that is not on screen yet', () => {
    const [one, two, three] = sections(body).steps
    expect(one!.show).toEqual({ target: 'clip' })
    expect(two!.show).toEqual({ target: 'clip', say: 'Right click this clip, then choose Save as asset' })
    expect(three!.show).toBeUndefined()
  })

  it('reads what a step needs first, and the control to ring when its own is not there (task 84)', () => {
    const [one, two, three] = sections(
      [
        '## Steps',
        '1. Type the figure. {show: linked-sound-level-typed on:sound}',
        '2. Press Add keyframe. {show: zoom-key or:zoom-mode on:video "Choose Keyframes here, then press Add keyframe"}',
        '3. Something odd. {show: clip on:spaceship}'
      ].join('\n')
    ).steps
    expect(one!.show).toEqual({ target: 'linked-sound-level-typed', on: 'sound' })
    expect(two!.show).toEqual({ target: 'zoom-key', or: 'zoom-mode', on: 'video', say: 'Choose Keyframes here, then press Add keyframe' })
    expect(three!.show).toEqual({ target: 'clip' })
    expect(three!.unknownNeed).toBe('spaceship')
  })

  it('says, for every kind a step can need, what to drop or make first, or when it shows', () => {
    for (const words of Object.values(NEEDS)) expect(words).toMatch(/first|once|Nothing is missing/)
  })

  it('reads an entry with no steps as all lede', () => {
    expect(sections('Just prose.')).toEqual({ lede: 'Just prose.', steps: [], details: '' })
  })

  it('does not let a Show me marker be searched for or shown in a snippet', () => {
    const t = entry({ title: 'Assets', keywords: [], body })
    expect(findTutorials([t], 'show')).toEqual([])
    expect(findTutorials([t], 'prose')[0]!.snippet!.line).toBe('The prose.')
  })
})

describe('every tutorial actually in docs/tutorials', () => {
  const files = readdirSync(FOLDER).filter((f) => /^\d{3}-.+\.md$/.test(f))

  it('has some, so a broken glob does not pass silently', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it.each(files)('%s parses, and names a category that exists', (file) => {
    const t = parseTutorial(file.replace(/\.md$/, ''), readFileSync(join(FOLDER, file), 'utf8'))
    expect(t.title.length).toBeGreaterThan(0)
    expect(CATEGORIES).toContain(t.category)
    expect(t.body.length).toBeGreaterThan(0)
  })

  it.each(files)('%s names a capture that exists, if it names one', (file) => {
    const t = parseTutorial(file.replace(/\.md$/, ''), readFileSync(join(FOLDER, file), 'utf8'))
    if (t.media !== undefined) expect(existsSync(join(FOLDER, 'media', t.media))).toBe(true)
  })

  it('fills every tab, so none of them opens empty', () => {
    const all = files.map((f) => parseTutorial(f.replace(/\.md$/, ''), readFileSync(join(FOLDER, f), 'utf8')))
    for (const c of CATEGORIES) expect(all.filter((t) => t.category === c).length).toBeGreaterThan(0)
  })

  it.each(files)('%s opens on 2 to 6 steps, with details under them', (file) => {
    const t = parseTutorial(file.replace(/\.md$/, ''), readFileSync(join(FOLDER, file), 'utf8'))
    const s = sections(t.body)
    expect(s.steps.length).toBeGreaterThanOrEqual(2)
    expect(s.steps.length).toBeLessThanOrEqual(6)
    expect(s.lede).not.toBe('')
    expect(s.details).not.toBe('')
  })

  it.each(files)('%s points Show me only at controls that exist', (file) => {
    const t = parseTutorial(file.replace(/\.md$/, ''), readFileSync(join(FOLDER, file), 'utf8'))
    for (const step of sections(t.body).steps) {
      if (!step.show) continue
      expect(drawn(step.show.target), `${file}: no control has the test id "${step.show.target}"`).toBe(true)
      if (step.show.or) expect(drawn(step.show.or), `${file}: no control has the test id "${step.show.or}"`).toBe(true)
      expect(step.unknownNeed, `${file}: "on:${step.unknownNeed}" is not a kind Show me knows`).toBeUndefined()
    }
  })

  it('has an entry for every tutorial the app links to, so no "?" opens on nothing', () => {
    const linked = [...SOURCE.matchAll(/["'`](\d{3}-[a-z0-9-]+)["'`]/g)].map((m) => m[1]!)
    expect(linked.length).toBeGreaterThan(5)
    for (const id of new Set(linked)) expect(files, `the app links to ${id}`).toContain(`${id}.md`)
  })

  it('offers the three starting points the window falls back to', () => {
    // TutorialsDialog shows these when a search finds nothing. If one is
    // renamed, the fallback would quietly show nothing at all.
    for (const id of ['040-your-first-edit', '150-remove-silences', '050-the-keys-worth-learning']) {
      expect(files).toContain(`${id}.md`)
    }
  })
})

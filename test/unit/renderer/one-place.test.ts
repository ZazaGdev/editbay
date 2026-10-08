import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { radius, space, themeProperties, type } from '../../../src/renderer/theme'

/**
 * Plan 19, step 2. Every colour, size, weight, radius and duration in the
 * window comes from `theme.ts`, so the whole window can be changed in one
 * file. This fails when one is written anywhere else.
 *
 * `theme.ts` itself is where they are written, with `themes.ts` beside it
 * holding the other themes' values (task 66), and `preview/` is exempt: it
 * draws video pixels rather than the window, and the caption colours there are
 * the owner's data rather than the app's.
 */

const ROOT = join(process.cwd(), 'src', 'renderer')
const EXEMPT = ['theme.ts', 'themes.ts', join('preview', '')]

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return filesUnder(full)
    return /\.(tsx?|css)$/.test(name) ? [full] : []
  })
}

/** Every file the rule covers, with its comments taken out. */
function covered(): { path: string; code: string }[] {
  return filesUnder(ROOT)
    .map((full) => ({ path: relative(ROOT, full), full }))
    .filter((f) => !EXEMPT.some((e) => f.path === e || f.path.startsWith(e)))
    .map((f) => ({
      path: f.path,
      // A comment naming a colour is documentation, not a value the window uses.
      code: readFileSync(f.full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
    }))
}

/** `file: the line that broke the rule`, so a failure says where to go. */
function offenders(pattern: RegExp): string[] {
  const found: string[] = []
  for (const file of covered()) {
    for (const line of file.code.split('\n')) {
      if (pattern.test(line)) found.push(`${file.path}: ${line.trim()}`)
    }
  }
  return found
}

describe('every value in the window comes from theme.ts', () => {
  it('holds no colour of its own', () => {
    expect(offenders(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/)).toEqual([])
  })

  it('holds no font with a size of its own', () => {
    // `font: type.body` is the way; `font: '13px system-ui'` is not.
    expect(offenders(/\bfont(?:Family|Size|Weight)?\s*:\s*['"`]/)).toEqual([])
  })

  it('holds no corner radius of its own', () => {
    // A number or a string, either way: `borderRadius: radius.control` is the way.
    expect(offenders(/border(?:Top|Bottom)?(?:Left|Right)?Radius\s*:\s*(?:[0-9]|['"`])/)).toEqual([])
  })

  it('holds no duration of its own', () => {
    // Every transition and animation takes its time from `motion`.
    expect(offenders(/transition(?:Duration)?\s*:\s*['"`][^'"`]*[0-9]+m?s/)).toEqual([])
  })

  it('checks a real set of files, so an empty list is not a pass by accident', () => {
    const paths = covered().map((f) => f.path)
    expect(paths.length).toBeGreaterThan(25)
    expect(paths).toContain('App.tsx')
    expect(paths).toContain('ui.css')
    expect(paths).toContain(join('components', 'Timeline.tsx'))
    expect(paths).not.toContain('theme.ts')
  })
})

describe('the scales the window is built from', () => {
  it('has one step for each thing a radius is for', () => {
    expect(Object.keys(radius)).toEqual(['handle', 'chip', 'control', 'panel', 'dialog', 'round'])
  })

  it('names every space and every type role as a custom property too', () => {
    const props = themeProperties()
    for (const name of Object.keys(space)) expect(props).toHaveProperty(`--space-${name}`)
    for (const name of Object.keys(type)) expect(props).toHaveProperty(`--type-${kebab(name)}`)
  })
})

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

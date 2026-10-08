import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyTheme, themeProperties, ink, radius, surface, type } from '../../../src/renderer/theme'

/**
 * Plan 19, step 1. The tokens are the one place a colour, a size or a duration
 * is written, and `ui.css` reaches them by name. A name that does not match is
 * silent in CSS: the property is simply missing and the rule falls back to
 * nothing, so it is checked here instead.
 */

const css = readFileSync(join(process.cwd(), 'src', 'renderer', 'ui.css'), 'utf8')

describe('the tokens as custom properties', () => {
  it('writes a number as pixels and a string as it is', () => {
    const props = themeProperties()
    expect(props['--radius-panel']).toBe(`${radius.panel}px`)
    expect(props['--surface-panel']).toBe(surface.panel)
  })

  it('gives a camel case token a kebab case property', () => {
    const props = themeProperties()
    expect(props['--surface-line-strong']).toBe(surface.lineStrong)
    expect(props['--ink-on-accent']).toBe(ink.onAccent)
    expect(props).not.toHaveProperty('--surface-lineStrong')
  })

  it('puts every one of them on the element it is given', () => {
    const written = new Map<string, string>()
    const root = { style: { setProperty: (name: string, value: string) => written.set(name, value) } }

    applyTheme(root as unknown as HTMLElement)

    const props = themeProperties()
    expect(written.size).toBe(Object.keys(props).length)
    for (const [name, value] of Object.entries(props)) expect(written.get(name)).toBe(value)
  })
})

describe('ui.css', () => {
  it('names only properties the theme defines', () => {
    const defined = new Set(Object.keys(themeProperties()))
    // Case matters: a camel case name is a real property that simply never
    // resolves, so it has to be matched here rather than skipped.
    const used = [...css.matchAll(/var\((--[A-Za-z0-9-]+)\)/g)].map((m) => m[1] as string)

    expect(used.length).toBeGreaterThan(20)
    const unknown = [...new Set(used)].filter((name) => !defined.has(name))
    expect(unknown).toEqual([])
  })

  it('holds no colour of its own', () => {
    // Sizes and durations are the stylesheet's business. Colour is not: every
    // one of them belongs to theme.ts, so the window can be changed in one file.
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const colours = withoutComments.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? []
    expect(colours).toEqual([])
  })
})

/** WCAG's contrast ratio between two opaque colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    const f = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(bl!)
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe('readability', () => {
  const surfaces = [surface.canvas, surface.panel, surface.raised, surface.control, surface.controlHover]

  it('sets text that reads at 4.5:1 on every surface, a control under the pointer included', () => {
    for (const text of [ink.primary, ink.secondary, ink.muted]) {
      for (const on of surfaces) expect(contrast(text, on)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps what is off readable, at 3:1 on a panel, and plainly fainter than muted', () => {
    expect(contrast(ink.disabled, surface.panel)).toBeGreaterThanOrEqual(3)
    expect(contrast(ink.muted, surface.panel) - contrast(ink.disabled, surface.panel)).toBeGreaterThan(2)
  })

  it('draws the edge of a box you type or choose in at 3:1 against what it sits on (audit 2026-10-01)', () => {
    for (const on of [surface.panel, surface.raised, surface.control]) expect(contrast(surface.controlLine, on)).toBeGreaterThanOrEqual(3)
  })

  it('sets nothing smaller than 12 pixels', () => {
    for (const font of Object.values(type).filter((v) => /px/.test(v))) {
      const px = Number(font.match(/(\d+(?:\.\d+)?)px/)?.[1])
      if (font.includes('system-ui') || font.includes('monospace')) expect(px).toBeGreaterThanOrEqual(12)
    }
  })
})

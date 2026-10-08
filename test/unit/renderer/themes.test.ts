import { describe, it, expect } from 'vitest'
import { THEMES, THEME_CHANGES, cleanTheme } from '../../../src/renderer/themes'
import * as theme from '../../../src/renderer/theme'

/** Task 66: each theme only changes tokens that exist, so none of its values is quietly ignored. */
describe('the themes', () => {
  it('keeps the classic look for anything it does not know', () => {
    expect(cleanTheme('teal')).toBe('teal')
    expect(cleanTheme('neon')).toBe('current')
    expect(cleanTheme(undefined)).toBe('current')
    expect(THEMES.map((t) => t.id)).toEqual(['current', 'teal', 'electric'])
  })

  it('changes only tokens there are', () => {
    const groups = theme as unknown as Record<string, Record<string, unknown>>
    for (const t of THEMES) {
      for (const [group, values] of Object.entries(THEME_CHANGES[t.id])) {
        expect(groups[group], `${t.id}: ${group}`).toBeTypeOf('object')
        for (const name of Object.keys(values)) expect(Object.keys(groups[group]!), `${t.id}: ${group}.${name}`).toContain(name)
      }
    }
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The Electron the app is built on, and so ships with. The Chromium inside it
 * decodes every recording the window plays, so a release on an Electron that is
 * missing security fixes ships those holes too: 2.0 went out on 44.4.3, six
 * releases behind (audit 2026-11-07). The lowest allowed is raised with each
 * update, and the notices file in the installer names the version it holds.
 */

const LOWEST = '44.10.2'

const root = process.cwd()
const json = (path: string): Record<string, unknown> => JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>
const locked = (): string => (json('package-lock.json').packages as Record<string, { version: string }>)['node_modules/electron']!.version

/** Whether version `v` is `lowest` or later, part by part. */
function atLeast(v: string, lowest: string): boolean {
  const a = v.split('.').map(Number)
  const b = lowest.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return true
}

describe('the Electron the app ships with', () => {
  it(`is ${LOWEST} or later, as the lock file pins it and as it is installed`, () => {
    expect(atLeast(locked(), LOWEST), locked()).toBe(true)
    expect(json('node_modules/electron/package.json').version).toBe(locked())
  })

  it('is the version the notices file names', () => {
    expect(readFileSync(join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8')).toContain(`| Electron | ${locked()} | MIT |`)
  })
})

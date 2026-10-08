import { describe, expect, it } from 'vitest'
import { HISTORY_TOP, byFolder, namedAfter, pickTests, type PickInput } from '../../scripts/test-pick.mjs'

/**
 * Task 28: which tests a change runs. A small made-up project: two app tests,
 * one media test, and the files they belong to.
 */
const tests = ['test/ui/looks.test.ts', 'test/ui/export-dialog.test.ts', 'test/e2e/export.test.ts']

function input(changed: string[], over: Partial<PickInput> = {}): PickInput {
  return {
    changed,
    tests,
    importsOf: () => [],
    coChanged: () => new Map(),
    commitsOf: () => 10,
    sources: [],
    ...over
  }
}
const picked = (r: ReturnType<typeof pickTests>) => [...r.picked.keys()].sort()

describe('picking the tests for a change', () => {
  it('runs nothing but the unit tests for a source file no slow test belongs to', () => {
    const r = pickTests(input(['src/shared/time.ts']))
    expect(r.full).toEqual([])
    expect(r.unit).toBe(true)
    expect(picked(r)).toEqual([])
  })

  it('runs nothing at all for notes and plans', () => {
    const r = pickTests(input(['docs/plans/2026-10-03-x.md', 'bugfixes-2.md', 'README.md']))
    expect(r.unit).toBe(false)
    expect(picked(r)).toEqual([])
  })

  it('asks for a full run when a file every test leans on changes, and says why', () => {
    for (const file of ['package.json', 'vitest.config.ts', 'src/preload/index.ts', 'test/ui/dialogs.ts', 'src/main/index.ts']) {
      const r = pickTests(input(['src/shared/time.ts', file]))
      expect(r.full, file).toHaveLength(1)
      expect(r.full[0]).toContain(file)
    }
  })

  it('runs a changed slow test itself', () => {
    expect(picked(pickTests(input(['test/e2e/export.test.ts'])))).toEqual(['test/e2e/export.test.ts'])
  })

  it('runs the tests named after a changed file, whatever its casing or plural', () => {
    for (const file of ['src/shared/looks.ts', 'src/renderer/app/useLooks.ts', 'src/renderer/components/Look.tsx']) {
      expect(picked(pickTests(input([file]))), file).toEqual(['test/ui/looks.test.ts'])
    }
    expect(namedAfter('test/ui/export-dialog.test.ts', 'src/renderer/components/ExportDialog.tsx')).toBe(true)
    expect(namedAfter('test/ui/export-dialog.test.ts', 'src/renderer/components/Export.tsx')).toBe(false)
  })

  it('runs the tests that import a changed file', () => {
    const r = pickTests(input(['src/main/render/runner.ts'], {
      importsOf: (f) => (f === 'test/e2e/export.test.ts' ? ['src/main/render/runner.ts'] : [])
    }))
    expect(picked(r)).toEqual(['test/e2e/export.test.ts'])
  })

  it('runs the app tests most often committed with a changed file, and only the top few', () => {
    const many = Array.from({ length: HISTORY_TOP + 3 }, (_, i) => `test/ui/t${i}.test.ts`)
    const r = pickTests(input(['src/renderer/components/Timeline.tsx'], {
      tests: many,
      coChanged: () => new Map(many.map((t, i) => [t, 100 - i]))
    }))
    expect(picked(r)).toEqual(many.slice(0, HISTORY_TOP).sort())
  })

  it('borrows the history of the files that import a file too new to have its own', () => {
    const r = pickTests(input(['src/renderer/app/PanelGrid.tsx'], {
      commitsOf: (f) => (f === 'src/renderer/app/PanelGrid.tsx' ? 1 : 10),
      sources: ['src/renderer/App.tsx', 'src/renderer/app/PanelGrid.tsx'],
      importsOf: (f) => (f === 'src/renderer/App.tsx' ? ['src/renderer/app/PanelGrid.tsx'] : []),
      coChanged: (f) => (f === 'src/renderer/App.tsx' ? new Map([['test/ui/export-dialog.test.ts', 5]]) : new Map())
    }))
    expect(picked(r)).toEqual(['test/ui/export-dialog.test.ts'])
  })

  it('runs the tutorials tests when a tutorial changes', () => {
    const r = pickTests(input(['docs/tutorials/325-the-framing-you-used-last.md'], { tests: ['test/ui/tutorials.test.ts'] }))
    expect(picked(r)).toEqual(['test/ui/tutorials.test.ts'])
  })

  it('splits the picked tests by folder', () => {
    const r = pickTests(input(['test/e2e/export.test.ts', 'src/shared/looks.ts']))
    expect(byFolder(r.picked)).toEqual({
      'test/e2e': ['test/e2e/export.test.ts'],
      'test/smoke': [],
      'test/ui': ['test/ui/looks.test.ts']
    })
  })
})

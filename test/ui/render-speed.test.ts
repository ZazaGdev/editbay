import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 49, renderer speed: moving the playhead, which playing does every
 * frame, and skimming the timeline under the pointer, used to draw every clip
 * on the timeline again each time. Now a clip is drawn again only when
 * something about it changed.
 *
 * React is counted from outside, the way its developer tools count it: a hook
 * installed before the page loads is told of every commit, and walks what
 * changed. A clip is found by what it draws, a `data-testid="clip"` or
 * `"sound-clip"` element as its first child, since a built app has no names.
 * Nothing in the app is there for the test.
 */

const fx = fixtureSet('ui-render-speed')
const root = await mkdtemp(join(tmpdir(), 'editbay-render-speed-'))
let app: ElectronApplication
let page: Page

/** Put on the page before React loads: counts the clips drawn in each commit. */
function countClipRenders(): void {
  const w = window as unknown as { __clipRenders: number; __inspectorRenders: number; __transitionRenders: number; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }
  w.__clipRenders = 0
  w.__inspectorRenders = 0
  w.__transitionRenders = 0
  // Fiber tags and flags, as React 19 numbers them.
  const FUNCTION = 0
  const HOST = 5
  const SIMPLE_MEMO = 15
  const CONTEXT_PROVIDER = 10
  const PERFORMED_WORK = 1
  interface Fiber {
    tag: number
    flags: number
    child: Fiber | null
    sibling: Fiber | null
    alternate: Fiber | null
    memoizedProps: Record<string, unknown> | null
  }
  const isClip = (f: Fiber): boolean => {
    if (f.tag !== FUNCTION && f.tag !== SIMPLE_MEMO) return false
    const c = f.child
    const id = c && c.tag === HOST ? c.memoizedProps?.['data-testid'] : undefined
    return id === 'clip' || id === 'sound-clip'
  }
  const isTransition = (f: Fiber): boolean => {
    if (f.tag !== FUNCTION && f.tag !== SIMPLE_MEMO) return false
    const c = f.child
    return c !== null && c.tag === HOST && c.memoizedProps?.['data-testid'] === 'clip-transition'
  }
  // The Inspector: the one component that hands its folds down as a context.
  const isInspector = (f: Fiber): boolean => {
    if (f.tag !== FUNCTION && f.tag !== SIMPLE_MEMO) return false
    const c = f.child
    const value = c && c.tag === CONTEXT_PROVIDER ? (c.memoizedProps?.['value'] as Record<string, unknown> | undefined) : undefined
    return value !== undefined && value !== null && 'folds' in value && 'onFold' in value
  }
  const renderers = new Map<number, unknown>()
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers,
    inject(r: unknown): number {
      const id = renderers.size + 1
      renderers.set(id, r)
      return id
    },
    checkDCE(): void {},
    onScheduleFiberRoot(): void {},
    onCommitFiberUnmount(): void {},
    onPostCommitFiberRoot(): void {},
    onCommitFiberRoot(_id: number, fiberRoot: { current: Fiber }): void {
      // Walk the new tree beside the old one. A subtree whose children are
      // the very ones it had was not visited at all this commit.
      const stack: [Fiber, Fiber | null][] = [[fiberRoot.current, fiberRoot.current.alternate]]
      while (stack.length > 0) {
        const [next, prev] = stack.pop()!
        if (next === prev) continue
        const drawn = prev === null || (next.flags & PERFORMED_WORK) !== 0
        if (isClip(next) && drawn) w.__clipRenders++
        if (isInspector(next) && drawn) w.__inspectorRenders++
        if (isTransition(next) && drawn) w.__transitionRenders++
        if (prev !== null && next.child === prev.child) continue
        for (let c = next.child; c; c = c.sibling) stack.push([c, c.alternate])
      }
    }
  }
}

async function renders(): Promise<number> {
  return page.evaluate(() => (window as unknown as { __clipRenders: number }).__clipRenders)
}

async function inspectorRenders(): Promise<number> {
  return page.evaluate(() => (window as unknown as { __inspectorRenders: number }).__inspectorRenders)
}

async function clipCount(): Promise<number> {
  return page.locator('[data-testid="clip"], [data-testid="sound-clip"]').count()
}

async function blur(): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

beforeAll(async () => {
  const clip = await fx.cleanClip()
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  // The hook has to be there before React is, so the window is loaded again with it.
  await page.addInitScript(countClipRenders)
  await page.reload()
  await page.waitForSelector('main')
  await page.evaluate((p) => window.api.importFiles([p]), clip)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  // Three times, so there are several clips on each track to be drawn again.
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="clip"]').length === n, i + 1)
  }
}, 300_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

describe('the timeline while the playhead moves', () => {
  it('does not draw the clips again for a step of the playhead', async () => {
    await blur()
    const clips = await clipCount()
    expect(clips).toBeGreaterThanOrEqual(6)
    const playhead = async (): Promise<number> => Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))
    const from = await playhead()
    // The counter works: a new clip is counted as it is drawn.
    expect(await renders()).toBeGreaterThanOrEqual(clips)

    // The Inspector is there, so its drawing can be counted too.
    expect(await inspectorRenders()).toBeGreaterThan(0)
    await page.evaluate(() => {
      const w = window as unknown as { __clipRenders: number; __inspectorRenders: number }
      w.__clipRenders = 0
      w.__inspectorRenders = 0
    })
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight')
    await expect.poll(playhead).toBe(from + 20)
    // Before, every clip was drawn again on every step: 20 times the clips.
    expect(await renders()).toBeLessThan(clips)
    // And the Inspector, on every step, when a handler it was given was new each time (audit 2026-10-01).
    expect(await inspectorRenders()).toBeLessThan(5)

    // And a clip that did change is drawn again: selecting one shows it selected.
    const first = page.locator('[data-testid="clip"]').first()
    const box = (await first.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8)
    await expect.poll(() => first.getAttribute('data-selected')).toBe('yes')
    expect(await renders()).toBeGreaterThan(0)
  })

  it('does not draw the clips again while the pointer skims across them', async () => {
    const clips = await clipCount()
    const skim = (): Promise<string | null> => page.getAttribute('[data-testid="monitor-stage"]', 'data-skim')
    const box = (await page.locator('[data-testid="clip"]').nth(1).boundingBox())!
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + 4, y)
    await expect.poll(skim, { timeout: 5000 }).not.toBe('')
    const before = await skim()

    await page.evaluate(() => ((window as unknown as { __clipRenders: number }).__clipRenders = 0))
    for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + 4 + ((box.width - 8) * i) / 20, y)
    // It did skim: the monitor shows another frame.
    await expect.poll(skim, { timeout: 5000 }).not.toBe(before)
    expect(await renders()).toBeLessThan(clips)

    await page.mouse.move(box.x + box.width / 2, box.y - 200)
    await expect.poll(skim, { timeout: 5000 }).toBe('')
  })
})

describe('the timeline after an edit (audit 2026-10-01)', () => {
  it('draws again only what the edit changed: a marker dropped draws no clip again', async () => {
    await blur()
    const clips = await clipCount()
    const markers = (): Promise<number> => page.locator('[data-testid="marker"]').count()
    const had = await markers()
    await page.evaluate(() => ((window as unknown as { __clipRenders: number }).__clipRenders = 0))
    await page.keyboard.press('KeyM')
    await expect.poll(markers).toBe(had + 1)
    // Before, every document from main was all new, and every clip was drawn again.
    expect(await renders()).toBeLessThan(clips)
  })
})

describe('the timeline with transitions while the playhead moves (audit 2026-10-08)', () => {
  it('does not draw the transitions again for a step of the playhead', async () => {
    await page.evaluate(async () => {
      const { docId } = await window.api.session()
      const p = await window.api.currentProject()
      const s = p.sequences[0]!
      const clips = [...s.videoTracks[0]!.clips].sort((a, b) => a.timelineStart - b.timelineStart)
      for (const c of clips.slice(1)) await window.api.applyEdit(docId, { sequenceId: s.id, kind: 'addTransition', clipId: c.id, side: 'in', length: 10 } as never)
    })
    const transitions = (): Promise<number> => page.locator('[data-testid="clip-transition"]').count()
    await expect.poll(transitions).toBeGreaterThanOrEqual(2)
    const count = await transitions()
    await blur()
    const playhead = async (): Promise<number> => Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))
    const from = await playhead()
    await page.evaluate(() => ((window as unknown as { __transitionRenders: number }).__transitionRenders = 0))
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight')
    await expect.poll(playhead).toBe(from + 20)
    // Before, every transition was drawn again on every step, and each worked
    // out the whole track's windows again to know what to hatch.
    expect(await page.evaluate(() => (window as unknown as { __transitionRenders: number }).__transitionRenders)).toBeLessThan(count)
  })
})

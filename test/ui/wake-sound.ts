import type { Page } from 'playwright-core'

/**
 * Task 2384: the preview opens its sound, and lets its players make any, at
 * the first click or key press (task 2355). On GitHub's Macs the only sound
 * device is also a microphone, so that asks macOS for the microphone, which
 * holds the window up for a while. Left to a test's first click, that came
 * inside a short wait, such as for the clip Add to timeline puts down, and
 * failed it now and then. Woken here, as the window opens, the wait lands
 * where the app used to open its sound, before the long ones for importing.
 */
export async function wakeSound(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointerdown'))
    window.dispatchEvent(new PointerEvent('pointerup'))
  })
}

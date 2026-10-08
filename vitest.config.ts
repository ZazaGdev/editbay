import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 120_000,
    env: {
      // The UI tests launch the real app, and Playwright hands the app whatever
      // environment the test process has. This keeps those windows off the
      // screen and away from the keyboard, so a suite that runs for ten minutes
      // does not take the machine over while it does. See `src/main/index.ts`.
      EDITBAY_TEST_WINDOW: 'hidden',
      // And nothing in it waits for a click, or outlives the run: every native
      // dialog is answered without being shown, and the app quits once the
      // test process that started it is gone. See `src/main/test-mode.ts`.
      EDITBAY_UNDER_TEST: '1'
    },
    // A worktree under .claude holds its own copy of the suite, and a bare
    // `vitest run` would otherwise run both.
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', '.claude/**']
  }
})

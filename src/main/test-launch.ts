/**
 * Whether these arguments are a test's launch: every test suite starts the
 * app with a settings folder of its own. Read from the arguments as given,
 * because Chromium takes that switch for itself and does not report it back.
 * The one place the rule is written (audit 2026-10-01).
 */
export function isTestLaunch(argv: readonly string[]): boolean {
  return argv.some((a) => a.startsWith('--user-data-dir'))
}

/** Whether this process was started by the tests. */
export const testLaunch = isTestLaunch(process.argv)

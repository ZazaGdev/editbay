import { resolve } from 'node:path'
import { isProjectPath } from '../../shared/project-ext'

/**
 * The project file the app was started with, if any: what Windows passes when
 * you double-click a project file, or what a second launch forwards to the
 * one already running. Relative paths are taken from `cwd`.
 *
 * Chromium adds switches of its own to the command line, so this looks for a
 * project file among the arguments rather than at a fixed position.
 */
export function projectPathFromArgs(argv: string[], cwd: string): string | null {
  for (let i = argv.length - 1; i >= 1; i--) {
    const arg = argv[i]
    if (!arg || arg.startsWith('-')) continue
    if (isProjectPath(arg)) return resolve(cwd, arg)
  }
  return null
}

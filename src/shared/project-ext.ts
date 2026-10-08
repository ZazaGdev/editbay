/**
 * The extension that names a project file.
 *
 * It lives here rather than in the four places that need it, so the answer
 * cannot differ between the command line, the Open dialog, the window title
 * and the registry.
 *
 * The app was called Clipper and then briefly Cutroom before this, and read
 * those extensions for a while so existing projects would still open. Nothing
 * was ever saved as `.cutroom`, the one `.clipper` project was converted, and
 * the compatibility was taken out again on 2026-09-24. There is one extension
 * now, which is the right state for a project nobody has installed yet.
 */

/** The extension every save writes, and the only one a project may carry. */
export const PROJECT_EXT = 'editbay'

/** Every extension a project file may carry. One, for now. */
export const PROJECT_EXTS: readonly string[] = [PROJECT_EXT]

/** Whether this path names a project file. Case is ignored, as Windows ignores it. */
export function isProjectPath(path: string): boolean {
  const lower = path.toLowerCase()
  return PROJECT_EXTS.some((ext) => lower.endsWith(`.${ext}`))
}

/**
 * A name without its project extension. A name that does not carry one is
 * returned as it is, so this is safe on any string.
 */
export function stripProjectExt(name: string): string {
  const lower = name.toLowerCase()
  const ext = PROJECT_EXTS.find((e) => lower.endsWith(`.${e}`))
  return ext === undefined ? name : name.slice(0, -(ext.length + 1))
}

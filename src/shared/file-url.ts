/**
 * A Windows path as a URL the renderer can load.
 *
 * Paths from real footage contain spaces routinely and can contain `#` or `?`,
 * which silently truncate a URL: everything after a `#` is treated as a
 * fragment and never reaches the file system.
 */
export function fileUrl(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const withRoot = slashed.startsWith('/') ? slashed : `/${slashed}`
  return `file://${encodeURI(withRoot).replace(/#/g, '%23').replace(/\?/g, '%3F')}`
}

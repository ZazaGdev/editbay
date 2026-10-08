import type { ProjectMedia } from './project'

/**
 * Every file the project's sources are made of, which an export must never
 * take the name of.
 *
 * A project saved beside its recording shares its name: Holiday.editbay next
 * to Holiday.mp4. The joined export is named after the project, so without
 * this it would be Holiday.mp4, and "Replace" would write it over the
 * recording it is made from. The export takes the next free name instead,
 * whatever "When a file is already there" says: that setting is about earlier
 * exports, never about the footage.
 */
export function sourceFiles(media: readonly ProjectMedia[]): string[] {
  return media.flatMap((m) => [
    m.originalPath,
    m.playablePath,
    ...(m.soundCopy ? [m.soundCopy] : []),
    ...(m.trackFiles ?? []).map((f) => f.path)
  ]).filter((p) => p !== '')
}

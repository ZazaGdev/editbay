import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Project } from '../../shared/project'
import { defaultWorkspace, type Workspace } from '../../shared/workspace'
import { joinProjectFile, splitProjectFile, mediaPathCandidates, withOriginalAt } from '../../shared/project-file'
import { writeAtomic, exists } from '../media/cache'
import { mayUse, shareOf, sharesToAsk, usableProject, type PathRules, type Withheld } from '../../shared/source-paths'

/**
 * The project alone, as text. This is what "has it changed since it was saved"
 * compares, so the workspace is deliberately not in it.
 */
export function serialiseProject(p: Project): string {
  return JSON.stringify(p, null, 2)
}

/** Read a project document, checking it is one and bringing it up to date. */
export function parseProject(text: string): Project {
  return splitProjectFile(text).project
}

/** Write the project and its workspace to `target`, whole or not at all. */
export async function saveProjectTo(p: Project, target: string, workspace: Workspace = defaultWorkspace()): Promise<void> {
  await writeAtomic(target, Buffer.from(joinProjectFile(p, workspace, { path, projectPath: target })))
}

export interface LoadedProject {
  project: Project
  workspace: Workspace
  /** Ids of media whose playable file is no longer on disk. */
  missingMedia: string[]
  /** The schema the file was written with. Older than the current one means this version never wrote it. */
  fileSchema: number
  /** Where each source kept offline really was, to be written back there. */
  withheld: Map<string, Withheld>
}

/** Whether two files look like copies of one: the same size, last changed within two seconds of each other. */
async function sameFile(a: string, b: string): Promise<boolean> {
  try {
    const [x, y] = await Promise.all([stat(a), stat(b)])
    // Two seconds, the coarsest time a FAT card keeps.
    return x.size === y.size && Math.abs(x.mtimeMs - y.mtimeMs) <= 2000
  } catch {
    return false
  }
}

/** What a project being opened may touch, and how to ask about the rest. */
export interface SourceAccess extends PathRules {
  /**
   * Asked about shares the project's sources are on that are not allowed yet,
   * before anything touches them. Resolves to the ones the user allows.
   */
  ask: (shares: string[]) => Promise<string[]>
}

/**
 * Open a project file. Each source is looked for beside the project first,
 * where it was saved relative to it, and then where it was. One found beside
 * the project while the original is still there must be a copy of it.
 *
 * Nothing it names is touched until `access` says it may be: a file on
 * another computer only once its share is allowed, and what was made from a
 * source only inside the app's own cache. The rest is taken out first, see
 * `usableProject`. The share the project itself is on is allowed for it,
 * since opening the project already reached it.
 */
export async function loadProjectFrom(target: string, access: SourceAccess): Promise<LoadedProject> {
  const file = splitProjectFile((await readFile(target)).toString())

  const allowed = new Set(access.allowed)
  const own = shareOf(target)
  if (own !== null) allowed.add(own)
  const toAsk = sharesToAsk(file.project.media, allowed)
  if (toAsk.length > 0) for (const s of await access.ask(toAsk)) if (toAsk.includes(s)) allowed.add(s)
  const rules: PathRules = { ...access, allowed }

  const usable = usableProject(file.project.media, file.workspace, rules)
  const media = []
  for (const m of usable.media) {
    let found = m
    const candidates = mediaPathCandidates(path, target, m.originalPath, file.relativePaths.get(m.id))
    for (const candidate of candidates) {
      if (!mayUse(candidate, allowed) || !(await exists(candidate))) continue
      // A file beside the project with the same name, while the one it was cut
      // from is still where it was, is only taken when it is a copy of it: the
      // same size, changed at the same time. A copied project folder then uses
      // its own footage, and a project copied beside another camera card's
      // GX010001.MP4 keeps its own recording.
      if (candidate !== m.originalPath && (await exists(m.originalPath)) && !(await sameFile(candidate, m.originalPath))) continue
      found = withOriginalAt(m, candidate)
      break
    }
    media.push(found)
  }
  const project = { ...file.project, media }

  const missingMedia: string[] = []
  for (const m of project.media) {
    if (!(await exists(m.playablePath))) missingMedia.push(m.id)
  }
  return { project, workspace: usable.workspace, missingMedia, fileSchema: file.fileSchema, withheld: usable.withheld }
}

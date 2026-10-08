import { app } from 'electron'
import { readFile } from 'node:fs/promises'
import { splitProjectFile } from '../../shared/project-file'
import { serialiseProject } from './store'
import { readRecoveryDocument, removeRecovery, type RecoveryCopy } from './recovery'
import { keepVersion, versionsDir } from './versions'
import { describe, notify } from './windows'

/** Recovery copies and earlier versions kept on disk, written one at a time. See lifecycle.ts. */

let recoveryWork: Promise<void> = Promise.resolve()

/** Where earlier versions are kept: the app's own folder, there whether or not the app started up fully. */
export function versionsFolder(): string {
  return versionsDir(app.getPath('userData'))
}

/**
 * Run recovery file work one task at a time. Otherwise a copy that started
 * writing just before a save could land just after it, and be offered after
 * the next launch as if the save had never happened.
 */
export function inOrder(task: () => Promise<void>): Promise<void> {
  const next = recoveryWork.then(task).catch(() => undefined)
  recoveryWork = next
  return next
}

/** Whether a recovery copy's project file holds exactly the work the copy does: the project, not where you were. */
export async function fileHolds(copy: RecoveryCopy): Promise<boolean> {
  if (!copy.recoveryOf) return false
  try {
    const kept = splitProjectFile(await readRecoveryDocument(copy.file)).project
    const there = splitProjectFile((await readFile(copy.recoveryOf)).toString('utf8')).project
    return serialiseProject(kept) === serialiseProject(there)
  } catch {
    return false
  }
}

/**
 * A recovery copy that is no longer wanted, kept as an earlier version and
 * then removed (plan 84). One that could not be kept is left where it is, to
 * be offered again rather than lost.
 */
export async function setRecoveryAside(copy: RecoveryCopy): Promise<void> {
  try {
    const text = await readRecoveryDocument(copy.file)
    await keepVersion(versionsFolder(), { projectPath: copy.recoveryOf, name: copy.name, reason: 'recovery-discarded', text })
  } catch (err) {
    notify(`The recovery copy of ${copy.name} could not be kept as an earlier version, so it stays: ${describe(err)}`, 'waits')
    return
  }
  await removeRecovery(copy.file)
}

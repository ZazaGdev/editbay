import { BrowserWindow, app } from 'electron'
import { dirname, join } from 'node:path'
import { isColour, isDrawn, type Project, type ProjectMedia } from '../../shared/project'
import { shareOf } from '../../shared/source-paths'
import { cacheRoot, sweepBeside } from '../media/cache'
import { trustShares, trustedShares } from '../settings/trusted-shares'
import { unfinishedTakes } from '../voiceover/takes'
import { takesFolder } from '../../shared/voiceover'
import type { SourceAccess } from './store'
import { checkSource } from './reopen'
import { messageBox, notify } from './windows'

/** What a project being opened is checked for: its sources, the shares it reaches, what a crash left. See lifecycle.ts. */

export interface SourceCheck {
  offline: string[]
  rebuild: ProjectMedia[]
  reimport: ProjectMedia[]
}

export const NOTHING_MISSING: SourceCheck = { offline: [], rebuild: [], reimport: [] }

/** Check every source of a project that is about to open. See reopen.ts. */
export async function checkSources(project: Project): Promise<SourceCheck> {
  const check: SourceCheck = { offline: [], rebuild: [], reimport: [] }
  // A text has no file to find: the window draws its picture again if it is gone.
  const files = project.media.filter((m) => !isDrawn(m) && !isColour(m))
  // Several at once, each still answered in the bin's order: one at a time, a
  // drive that does not answer held up every source after it (audit 2026-10-01).
  const actions: Awaited<ReturnType<typeof checkSource>>[] = new Array(files.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const i = next++
      actions[i] = await checkSource(files[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker))
  for (const [i, m] of files.entries()) {
    const action = actions[i]
    if (action === 'offline') check.offline.push(m.id)
    else if (action === 'rebuildDerived') check.rebuild.push(m)
    else if (action === 'reimport') check.reimport.push(m)
  }
  return check
}

/** Where a source kept offline is said to be: a folder of the app's own, with nothing in it. */
export function offlineDir(): string {
  return join(app.getPath('userData'), 'offline')
}

/**
 * What a project being opened may touch. A share not yet allowed is asked
 * about, once for all of them, before anything connects to it.
 */
export function sourceAccess(): SourceAccess {
  // The app's own cache is on a share when the user's settings folder is
  // redirected to one, and it is theirs.
  const cache = shareOf(cacheRoot())
  return {
    allowed: cache ? new Set([...trustedShares(), cache]) : trustedShares(),
    cacheDir: cacheRoot(),
    offlineDir: offlineDir(),
    ask: async (shares) => {
      const listed = shares.join('\n')
      const answer = await messageBox(BrowserWindow.getFocusedWindow(), {
        type: 'warning',
        buttons: ['Keep them offline', 'Connect'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        message: shares.length === 1 ? 'This project uses files on another computer' : 'This project uses files on other computers',
        detail:
          `${listed}\n\nOpening them connects to ${shares.length === 1 ? 'that computer' : 'those computers'} and signs in with your Windows account. ` +
          'Only connect if you know where this project came from. Kept offline, those files show as missing, and you can find them yourself.'
      })
      if (answer !== 1) return []
      await trustShares(shares)
      return shares
    }
  }
}

/**
 * What a crash left beside a project, looked at as it opens (audit
 * 2026-10-01): the scratch files of a save cut short are removed once a day
 * old, and a voice-over take left recording is named, never removed.
 */
export async function tidyBeside(target: string): Promise<void> {
  await sweepBeside(dirname(target)).catch(() => undefined)
  const folder = takesFolder(target, app.getPath('documents'), { join, dirname })
  const left = await unfinishedTakes(folder)
  if (left.length > 0) {
    notify(
      `${left.length === 1 ? 'A voice-over take was' : `${left.length} voice-over takes were`} left recording when Editbay stopped: ${left.join(', ')}, in ${folder}. Bring ${left.length === 1 ? 'it' : 'them'} in from there to use ${left.length === 1 ? 'it' : 'them'}.`,
      'waits'
    )
  }
}

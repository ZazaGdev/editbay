import { stat } from 'node:fs/promises'
import { shareOf } from '../../shared/source-paths'

/**
 * How long another computer gets to answer as a project opens before what is
 * on it is kept offline for now. Windows waits about 21 seconds on one that is
 * switched off, and Editbay used to wait with it, with nothing on screen at
 * start (audit 2026-11-07).
 */
export const SHARE_PATIENCE_MS = 3000

/** Asks a share anything at all: any answer, even that it is not there, means its computer is on. */
export type ShareProbe = (share: string) => Promise<unknown>

const statShare: ShareProbe = (share) => stat(`${share}\\`)

/**
 * The shares, of those given, whose computer did not answer within the
 * patience. Asked one computer at a time: each that is off holds one of the
 * few threads Node reads files with until Windows gives up on it, and asking
 * several at once could leave none for anything else. Another share on a
 * computer that did not answer is not asked again.
 */
export async function silentShares(shares: readonly string[], patienceMs = SHARE_PATIENCE_MS, probe: ShareProbe = statShare): Promise<string[]> {
  const silentHosts = new Set<string>()
  const silent: string[] = []
  for (const share of shares) {
    const host = share.split('\\').find((part) => part !== '')?.toLowerCase() ?? share
    if (silentHosts.has(host) || !(await answersWithin(share, patienceMs, probe))) {
      silentHosts.add(host)
      silent.push(share)
    }
  }
  return silent
}

/** Whether a path is somewhere that answers: on this computer, or on a share whose computer answers in time. */
export async function withinReach(path: string): Promise<boolean> {
  const share = shareOf(path)
  return share === null || (await silentShares([share])).length === 0
}

function answersWithin(share: string, ms: number, probe: ShareProbe): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    const answered = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    probe(share).then(answered, answered)
  })
}

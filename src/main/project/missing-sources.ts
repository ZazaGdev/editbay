import { dialog, type BrowserWindow } from 'electron'
import { basename, dirname } from 'node:path'
import { readdir } from 'node:fs/promises'
import type { ImportProgress, MediaAsset } from '../../shared/types'
import { clipsCutShort, type Project, type ProjectMedia } from '../../shared/project'
import { importFile, markMissing } from '../media/import'
import { trustSharesOf } from '../settings/trusted-shares'
import * as session from './session'
import { matchInFolder, rebuildDerived, sameRecording } from './reopen'
import { describe, messageBox, notify, send } from './windows'
import type { SourceCheck } from './opening-checks'
import { doneRebuilding, relinkOne, replaceSource, stillMissing } from './open-document'

/** Sources the open document has lost: rebuilt in the background, or found again. See lifecycle.ts. */

/** Rebuilding whatever the cache lost for the open document, one source at a time. */
let settling: Promise<void> = Promise.resolve()

export function sendProgress(p: ImportProgress): void {
  send('assets:progress', p)
}

export function sendAsset(a: MediaAsset): void {
  send('assets:changed', a)
}

/** For imports on behalf of the open document: false once it has been replaced. */
export function whileOpen(doc: number): () => boolean {
  return () => doc === session.getDocId()
}

function inProject(id: string): boolean {
  return session.getProject().media.some((x) => x.id === id)
}

/**
 * Rebuild what the cache lost, in the background. The clips are usable while
 * it runs, and each shows as rebuilding until its source is done. Work for a
 * document that has since been replaced is dropped rather than applied to the
 * wrong one.
 */
export function settle(doc: number, check: SourceCheck): void {
  settling = settling.then(async () => {
    for (const m of check.rebuild) {
      if (doc !== session.getDocId()) return
      // Removal waits for this, but a source gone meanwhile is never put back.
      if (!inProject(m.id)) {
        doneRebuilding(m.id, false)
        continue
      }
      let fixed: ProjectMedia | null = null
      try {
        fixed = await rebuildDerived(m)
      } catch (err) {
        notify(`The waveform of ${basename(m.originalPath)} could not be rebuilt: ${describe(err)}`, 'fades')
      }
      if (doc !== session.getDocId()) return
      if (fixed && fixed !== m && inProject(m.id)) replaceSource(fixed)
      doneRebuilding(m.id, false)
    }
    for (const m of check.reimport) {
      if (doc !== session.getDocId()) return
      // It lands on the same cache key as the first time, so its paths come back the same.
      const asset = await importFile(m.originalPath, sendProgress, sendAsset, {
        id: m.id,
        stillWanted: whileOpen(doc)
      })
      if (doc !== session.getDocId()) return
      if (!inProject(m.id)) {
        doneRebuilding(m.id, false)
        continue
      }
      // Changed since it was used, and shorter: never put in silently, cutting
      // clips short for good. Left missing, to be found again by hand, which asks.
      const short = asset.status === 'ready' && !sameRecording(m, asset) ? clipsCutShort(session.getProject(), m.id, asset.durationSec) : 0
      if (short > 0) {
        sendAsset(markMissing(m))
        notify(
          `${basename(m.originalPath)} has changed since it was used and is now shorter, so ${short} ${short === 1 ? 'clip' : 'clips'} would be cut short. It is left as missing: find it by hand to use it anyway.`,
          'waits'
        )
        doneRebuilding(m.id, true)
      } else if (asset.status === 'ready') {
        replaceSource({ ...session.mediaFromAsset(asset), id: m.id })
        doneRebuilding(m.id, false)
      } else {
        notify(`${basename(m.originalPath)} could not be prepared again: ${asset.error ?? 'import failed'}`, 'fades')
        doneRebuilding(m.id, true)
      }
    }
  })
}

/** Resolves once the open document has nothing left to rebuild. For tests. */
export function sourcesSettled(): Promise<void> {
  return settling
}

/** Whether to let a different recording stand in for a missing one, asked with how many clips it would cut short. */
export async function useDifferent(win: BrowserWindow | null, missing: ProjectMedia, found: MediaAsset, path: string): Promise<boolean> {
  const short = clipsCutShort(session.getProject(), missing.id, found.durationSec)
  const shorter = found.durationSec < missing.durationSec - 1 / Math.max(1, missing.fps)
  const detail = short > 0
    ? `It is ${(missing.durationSec - found.durationSec).toFixed(1)} s shorter, so ${short} ${short === 1 ? 'clip runs' : 'clips run'} past its end and would be cut short, and would stay short if the right file turns up later.`
    : shorter
      ? 'It is shorter, though no clip reaches past its end.'
      : 'It is a different length, size or number of sound tracks.'
  const response = await messageBox(win, {
    type: 'warning',
    title: 'Editbay',
    message: `${basename(path)} is not the same recording as ${basename(missing.originalPath)}`,
    detail,
    buttons: ['Use it anyway', "Don't use it"],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })
  return response === 0
}

/**
 * Ask where a missing source went, then look in that folder for the other
 * missing ones by name and relink every one that is the same recording, since
 * files usually move together. Says how many more it found.
 */
export async function relink(win: BrowserWindow | null, mediaId: string): Promise<Project> {
  const doc = session.getDocId()
  const options = { properties: ['openFile' as const], title: 'Find the missing file' }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  const path = result.filePaths[0]
  const chosen = session.getProject().media.find((m) => m.id === mediaId)
  if (result.canceled || !path || !chosen || doc !== session.getDocId()) return session.getProject()
  // You chose it, so the share it is on is one you use.
  await trustSharesOf([path])

  if ((await relinkOne(doc, chosen, path, false, win)) !== 'relinked') return session.getProject()

  const others = session.getProject().media.filter((m) => stillMissing().includes(m.id))
  if (others.length === 0) return session.getProject()

  const folder = dirname(path)
  const names = await readdir(folder).catch(() => [] as string[])
  let found = 0
  const different: string[] = []
  for (const match of matchInFolder(others, folder, names)) {
    const missing = others.find((m) => m.id === match.id)
    if (!missing || doc !== session.getDocId()) break
    const outcome = await relinkOne(doc, missing, match.path, true)
    if (outcome === 'relinked') found += 1
    else if (outcome === 'different') different.push(basename(match.path))
  }
  if (doc !== session.getDocId()) return session.getProject()

  const left = stillMissing().length
  const parts = [
    found === 0
      ? `None of the other missing files were in ${folder}.`
      : `Found ${found} more missing ${found === 1 ? 'file' : 'files'} in ${folder}.`
  ]
  if (different.length > 0) {
    parts.push(`${different.join(', ')} there ${different.length === 1 ? 'is a different recording' : 'are different recordings'}, so ${different.length === 1 ? 'it was' : 'they were'} not used.`)
  }
  if (left > 0) parts.push(`${left} ${left === 1 ? 'is' : 'are'} still missing.`)
  notify(parts.join(' '), 'fades')
  return session.getProject()
}

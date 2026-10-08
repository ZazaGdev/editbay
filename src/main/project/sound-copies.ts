import { basename } from 'node:path'
import { wantingCareCopy, wantingCleanCopy, wantingSoundCopy, wantingVoiceCopy, type ProjectMedia } from '../../shared/project'
import { careRecipe } from '../../shared/voice-care'
import { voiceRecipe } from '../../shared/voice'
import { exists } from '../media/cache'
import { makeCareCopy, makeCleanCopy, makeSoundCopy, makeVoiceCopy } from '../media/tracks'
import * as session from './session'
import { notify } from './windows'
import { replaceSource } from './open-document'

/** The sound-only, cleaned, enhanced and treated copies the open document plays. See lifecycle.ts. */

/** The sound-only copies being made, one at a time. */
let copying: Promise<void> = Promise.resolve()
/** Whether a pass over the sound-only copies is waiting to start: one is enough. */
let copyPassWaiting = false
/** Copies that failed, by source and playable file, not tried again until the source changes. */
const copyFailed = new Set<string>()

/**
 * Make, in the background, the sound-only copy of every recording whose first
 * track a clip on an audio row plays, and remake one the cache has lost. The
 * preview plays the recording itself until its copy is there. Safe to call
 * after every edit: a recording is only copied once.
 */
export function prepareSoundCopies(): Promise<void> {
  // Every edit asks, and a drag is many edits: one pass waiting covers them all.
  if (copyPassWaiting) return copying
  copyPassWaiting = true
  copying = copying.then(async () => {
    copyPassWaiting = false
    const doc = session.getDocId()
    const project = session.getProject()
    const lost: ProjectMedia[] = []
    for (const m of project.media) if (m.soundCopy && !(await exists(m.soundCopy))) lost.push(m)
    for (const m of [...wantingSoundCopy(project), ...lost]) {
      const key = `${m.id}|${m.playablePath}`
      if (copyFailed.has(key)) continue
      try {
        const path = await makeSoundCopy(m)
        if (doc !== session.getDocId()) return
        const now = session.getProject().media.find((x) => x.id === m.id)
        if (now && now.playablePath === m.playablePath) replaceSource({ ...now, soundCopy: path })
      } catch {
        // The preview goes on playing the recording itself, which works, only
        // at more cost. Not tried again until the source changes, since each
        // try reads the whole recording.
        copyFailed.add(key)
      }
    }
    // A cleaned copy the cache has lost is forgotten, so it is made again below.
    for (const m of session.getProject().media) {
      const kept: { track: number; path: string }[] = []
      for (const c of m.cleaned ?? []) if (await exists(c.path)) kept.push(c)
      if (kept.length !== (m.cleaned ?? []).length) {
        const { cleaned: _lost, ...rest } = m
        replaceSource(kept.length > 0 ? { ...rest, cleaned: kept } : rest)
      }
    }
    // Tracks cleaned of noise, for the clips that ask for it. Until one is
    // there the clip plays its track as it is, in the preview; an export waits.
    for (const { media: m, track } of wantingCleanCopy(session.getProject())) {
      const key = `clean|${m.id}|${track}|${m.playablePath}`
      if (copyFailed.has(key)) continue
      try {
        const path = await makeCleanCopy(m, track)
        if (doc !== session.getDocId()) return
        const now = session.getProject().media.find((x) => x.id === m.id)
        if (now && now.playablePath === m.playablePath) {
          replaceSource({ ...now, cleaned: [...(now.cleaned ?? []).filter((c) => c.track !== track), { track, path }] })
        }
      } catch {
        notify(`The noise could not be cleaned out of ${basename(m.originalPath)}, so it plays as it was recorded.`, 'fades')
        copyFailed.add(key)
      }
    }
    // An enhanced copy the cache has lost is forgotten, so it is made again below.
    for (const m of session.getProject().media) {
      const kept: { track: number; recipe: string; path: string }[] = []
      for (const e of m.enhanced ?? []) if (await exists(e.path)) kept.push(e)
      if (kept.length !== (m.enhanced ?? []).length) {
        const { enhanced: _lost, ...rest } = m
        replaceSource(kept.length > 0 ? { ...rest, enhanced: kept } : rest)
      }
    }
    // Voices enhanced, for the clips that ask for it, after the cleaned copies
    // some are made from. Until one is there the clip plays the best thing it
    // has, in the preview; an export waits.
    for (const { media: m, track, strength, clean } of wantingVoiceCopy(session.getProject())) {
      const recipe = voiceRecipe(strength, clean)
      const key = `voice|${m.id}|${track}|${recipe}|${m.playablePath}`
      if (copyFailed.has(key)) continue
      try {
        const path = await makeVoiceCopy(m, track, strength, clean)
        if (doc !== session.getDocId()) return
        const now = session.getProject().media.find((x) => x.id === m.id)
        if (now && now.playablePath === m.playablePath) {
          replaceSource({
            ...now,
            enhanced: [...(now.enhanced ?? []).filter((e) => !(e.track === track && e.recipe === recipe)), { track, recipe, path }]
          })
        }
      } catch {
        notify(`The voice in ${basename(m.originalPath)} could not be enhanced, so it plays without it.`, 'fades')
        copyFailed.add(key)
      }
    }
    // A treated copy the cache has lost is forgotten, so it is made again below.
    for (const m of session.getProject().media) {
      const kept: { track: number; recipe: string; path: string }[] = []
      for (const e of m.treated ?? []) if (await exists(e.path)) kept.push(e)
      if (kept.length !== (m.treated ?? []).length) {
        const { treated: _lost, ...rest } = m
        replaceSource(kept.length > 0 ? { ...rest, treated: kept } : rest)
      }
    }
    // Breaths softened and clicks taken out, for the tracks that ask for it
    // (plan 81). Until a copy is there the clip plays the best thing it has,
    // in the preview; an export waits.
    for (const { media: m, track, care, clean, voice } of wantingCareCopy(session.getProject())) {
      const recipe = careRecipe(care, clean, voice)
      const key = `care|${m.id}|${track}|${recipe}|${m.playablePath}`
      if (copyFailed.has(key)) continue
      try {
        const path = await makeCareCopy(m, track, care, clean, voice)
        if (doc !== session.getDocId()) return
        const now = session.getProject().media.find((x) => x.id === m.id)
        if (now && now.playablePath === m.playablePath) {
          replaceSource({
            ...now,
            treated: [...(now.treated ?? []).filter((e) => !(e.track === track && e.recipe === recipe)), { track, recipe, path }]
          })
        }
      } catch {
        notify(`The breaths and clicks in ${basename(m.originalPath)} could not be treated, so it plays without it.`, 'fades')
        copyFailed.add(key)
      }
    }
  })
  return copying
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Project } from '../../shared/project'
import { keepSame } from '../../shared/keep-same'
import { emptyHistory, recorded, stepBack, stepForward, type History } from '../../shared/history'
import type { OpenedDocument, ProjectEdit, ProjectStatus } from '../../shared/types'
import { editMade } from './toasts'
import { replacesMove } from './dragMoves'

const MAX_HISTORY = 100

export interface ProjectState {
  project: Project | null
  status: ProjectStatus | null
  /** Which document is open, as main counts them. */
  docId: number
  missingMedia: string[]
  rebuildingMedia: string[]
  canUndo: boolean
  canRedo: boolean
  /**
   * Resolves to the document the edit produced, once main has applied it.
   * `continuing` marks the later movements of a drag: they are applied like
   * any edit, but the undo point was recorded by the first, so one undo puts
   * the whole drag back.
   */
  edit: (e: ProjectEdit, opts?: { continuing?: boolean; unrecorded?: boolean }) => Promise<Project>
  undo: () => void
  redo: () => void
  /**
   * Which step of history the document is at. An Undo offered for an edit is
   * only right while this is still the step that edit made.
   */
  step: () => number
  newProject: () => void
  open: (path?: string) => void
  /** Resolves to where it was saved, or null if it was not. */
  save: (saveAs?: boolean) => Promise<string | null>
  relink: (mediaId: string) => void
}

/**
 * The document lives in main; this holds the renderer's view of it plus the
 * undo stack. Undo is whole-document snapshots, which is simple and exact: a
 * project is a few kilobytes, so a hundred of them is under a megabyte.
 *
 * The current document is kept in a ref as well as in state. React state does
 * not update until the next render, and someone holding Ctrl+Z fires undos far
 * faster than that. Reading the document from state would make each of those
 * presses push a stale snapshot onto the redo stack, silently losing steps.
 *
 * Edits, undos and redos go to main one at a time, each once the one before
 * it has come back. Sent together, a result could arrive after an undo that
 * followed it and put the undone change back on screen, and an edit sent
 * before the one ahead of it had come back would record, as the document to
 * undo to, one that did not have that edit in it yet, so one undo took two.
 *
 * A whole new document, from New, Open, a restored copy or the app starting,
 * always arrives as one message from main. `onOpened` hears it too, so the
 * window can put you back where you were in it.
 */
/**
 * The sequences an undo or redo changed, by id, in the order the project
 * keeps them: the history is one for the whole project, so a step can change
 * a sequence other than the one on screen (audit 2026-10-01).
 */
export function sequencesChanged(from: Project, to: Project): string[] {
  const was = new Map(from.sequences.map((s) => [s.id, JSON.stringify(s)]))
  return to.sequences.filter((s) => was.get(s.id) !== JSON.stringify(s)).map((s) => s.id)
}

export function useProject(onOpened: (d: OpenedDocument) => void, onStepped?: (changed: string[]) => void): ProjectState {
  const [project, setProjectState] = useState<Project | null>(null)
  const [status, setStatus] = useState<ProjectStatus | null>(null)
  const noneMissing = useRef<string[]>([])
  const [docId, setDocId] = useState(0)
  // Read by edits fired faster than React renders, like undo, so kept in a ref too.
  const doc = useRef(0)
  const current = useRef<Project | null>(null)
  /** The last edit, undo or redo sent, which the next waits for. */
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  /** How many of those are still on their way. */
  const waiting = useRef(0)
  /**
   * A drag's movement last in line and not sent yet, which a newer movement
   * of the same drag takes the place of rather than following.
   */
  const waitingMove = useRef<{ edit: ProjectEdit; sentFor: number; result: Promise<Project> } | null>(null)
  /** Put a step of history in line behind the ones already sent. */
  const inTurn = useCallback(<T,>(step: () => Promise<T>): Promise<T> => {
    // Anything put in line after a movement means it is no longer last.
    waitingMove.current = null
    waiting.current += 1
    const run = queue.current.then(step).finally(() => {
      waiting.current -= 1
    })
    queue.current = run.catch(() => undefined)
    return run
  }, [])
  const history = useRef<History<Project>>(emptyHistory())
  /**
   * Whether the last undo step is still open for a drag to add to. An undo or
   * redo in the middle of a drag closes it, so the rest of the drag records a
   * step of its own rather than none.
   */
  const stepOpen = useRef(false)
  /** Counts every step of history taken: each edit, undo and redo, and each whole new document. */
  const steps = useRef(0)
  const [, bump] = useState(0)
  const opened = useRef(onOpened)
  opened.current = onOpened
  const stepped = useRef(onStepped)
  stepped.current = onStepped

  const adopt = useCallback((p: Project) => {
    // What did not change stays the object it was, so what is drawn from it is not drawn again (audit 2026-10-01).
    // The project itself is always new: a document adopted is one the window hears of.
    const was = current.current
    const kept = was ? keepSame(was, p) : p
    const next = kept === was ? { ...kept } : kept
    current.current = next
    setProjectState(next)
  }, [])

  const clearHistory = useCallback(() => {
    stepOpen.current = false
    history.current = emptyHistory()
    bump((n) => n + 1)
  }, [])

  const take = useCallback(
    (d: OpenedDocument) => {
      steps.current += 1
      clearHistory()
      adopt(d.project)
      setStatus(d.status)
      doc.current = d.docId
      setDocId(d.docId)
      opened.current(d)
    },
    [adopt, clearHistory]
  )

  useEffect(() => {
    // Listen before asking, so a document that arrives in between is not missed.
    const offOpened = window.api.onProjectOpened(take)
    const offChanged = window.api.onProjectChanged(adopt)
    const offStatus = window.api.onProjectStatus(setStatus)
    void window.api.session().then(take)
    return () => {
      offOpened()
      offChanged()
      offStatus()
    }
  }, [adopt, take])

  const edit = useCallback(
    (e: ProjectEdit, opts: { continuing?: boolean; unrecorded?: boolean } = {}): Promise<Project> => {
      // Upkeep rather than an edit, as a text drawn again for a picture that
      // went missing: nothing to undo, so no step, and a drag stays open.
      if (opts.unrecorded === true) {
        const sentFor = doc.current
        return inTurn(async () => {
          const p = await window.api.applyEdit(sentFor, e, false)
          if (doc.current === sentFor) adopt(p)
          return p
        })
      }
      // A drag carries on only a step that is still open: an undo in the
      // middle of it closed the step, and the rest of the drag starts anew.
      const continues = opts.continuing === true && stepOpen.current
      const held = waitingMove.current
      if (continues && held && held.sentFor === doc.current && replacesMove(held.edit, e)) {
        held.edit = e
        return held.result
      }
      // Any other edit makes an Undo on offer undo something else.
      if (!continues) {
        editMade()
        steps.current += 1
      }
      stepOpen.current = true
      const sentFor = doc.current
      const move = continues ? { edit: e, sentFor, result: Promise.resolve(null as unknown as Project) } : null
      const result = inTurn(async () => {
        // Sent now: a later movement queues behind it rather than replacing it.
        if (waitingMove.current === move) waitingMove.current = null
        // The document to undo to is taken now, with every edit before this
        // one in it, rather than when it was asked for.
        const before = current.current
        if (before && !continues) {
          history.current = recorded(history.current, before, MAX_HISTORY)
          bump((n) => n + 1)
        }
        const p = await window.api.applyEdit(sentFor, move ? move.edit : e, continues)
        // A whole new document came meanwhile: this belonged to the last one.
        if (doc.current === sentFor) adopt(p)
        return p
      })
      if (move) {
        move.result = result
        waitingMove.current = move
      }
      return result
    },
    [adopt, inTurn]
  )

  const stepOf = useCallback(() => steps.current, [])

  const undo = useCallback(() => {
    // Nothing to undo, and nothing on its way that could make something.
    if (history.current.past.length === 0 && waiting.current === 0) return
    editMade()
    steps.current += 1
    stepOpen.current = false
    const sentFor = doc.current
    void inTurn(async () => {
      const now = current.current
      const step = now ? stepBack(history.current, now) : null
      if (!step || !now || doc.current !== sentFor) return
      const previous = step.to
      history.current = step.history
      // Taken straight away, so an undo after this one steps back from here.
      current.current = previous
      bump((n) => n + 1)
      const p = await window.api.setProject(sentFor, previous)
      if (doc.current === sentFor) {
        adopt(p)
        stepped.current?.(sequencesChanged(now, p))
      }
    })
  }, [adopt, inTurn])

  const redo = useCallback(() => {
    if (history.current.future.length === 0 && waiting.current === 0) return
    editMade()
    steps.current += 1
    stepOpen.current = false
    const sentFor = doc.current
    void inTurn(async () => {
      const now = current.current
      const step = now ? stepForward(history.current, now) : null
      if (!step || !now || doc.current !== sentFor) return
      const next = step.to
      history.current = step.history
      current.current = next
      bump((n) => n + 1)
      const p = await window.api.setProject(sentFor, next)
      if (doc.current === sentFor) {
        adopt(p)
        stepped.current?.(sequencesChanged(now, p))
      }
    })
  }, [adopt, inTurn])

  const canUndo = history.current.past.length > 0
  const canRedo = history.current.future.length > 0
  // The same object until something in it changes: the window holds handlers
  // made from it, and a new one every render drew the Inspector again on every
  // frame of playback (audit 2026-10-01).
  return useMemo(
    () => ({
      project,
      status,
      docId,
      // The same empty list every time, so an effect that depends on it only
      // runs when something actually goes missing.
      missingMedia: status?.offline ?? noneMissing.current,
      rebuildingMedia: status?.rebuilding ?? noneMissing.current,
      canUndo,
      canRedo,
      edit,
      undo,
      redo,
      step: stepOf,
      // Main asks about unsaved changes, and a document that does open arrives
      // through the listener above like any other.
      newProject: () => void window.api.newProject(),
      open: (path) => void window.api.openProject(path),
      save: (saveAs = false) => window.api.saveProject(saveAs),
      relink: (mediaId) => {
        void window.api.relinkMedia(mediaId).then(adopt)
      }
    }),
    [project, status, docId, canUndo, canRedo, edit, undo, redo, stepOf, adopt]
  )
}

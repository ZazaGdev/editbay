import { useCallback, useEffect, useRef } from 'react'
import type { Workspace } from '../../shared/workspace'

/** How far behind main's copy may run while you work. */
const PUSH_DELAY_MS = 500

/**
 * Keep main's copy of the workspace current, so saving, autosaving and closing
 * can write it without asking the window.
 *
 * Pushes wait until things settle, because the playhead moves every frame
 * during playback. Nothing is sent until `ready`, which is when this window
 * has taken the workspace of the open document: sending the window's starting
 * values before then would overwrite the one the project was saved with.
 *
 * Returns a flush that sends whatever is waiting straight away, for a save.
 */
export function useWorkspaceSync(workspace: Workspace, docId: number, ready: boolean): () => Promise<void> {
  const latest = useRef({ workspace, docId })
  latest.current = { workspace, docId }
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!ready) return
    timer.current = window.setTimeout(() => {
      timer.current = null
      void window.api.setWorkspace(docId, workspace)
    }, PUSH_DELAY_MS)
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [workspace, docId, ready])

  return useCallback(async () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    await window.api.setWorkspace(latest.current.docId, latest.current.workspace)
  }, [])
}

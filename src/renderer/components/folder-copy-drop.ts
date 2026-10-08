import { useState, type DragEvent } from 'react'
import { SOURCE_TYPE } from './timeline/drag'
import { dropHandled, markDropHandled } from '../state/drops'
import { showToast } from '../state/toasts'

/**
 * Task 103: files from File Explorer, or a source dragged from the project's
 * bin, let go on a folder in Sources are copied into that folder on disk, the
 * originals left where they are. The folder lists them on its next look.
 */

/** Whether a drag holds files or a source from the bin, which a folder takes a copy of. */
function copyable(e: DragEvent): boolean {
  return e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(SOURCE_TYPE)
}

/** What a drop carries, read while the drop lasts: the browser empties it afterwards. */
function carried(e: DragEvent): { paths: string[]; sourceId: string } {
  return {
    paths: Array.from(e.dataTransfer.files)
      .map((f) => window.api.pathForFile(f))
      .filter((p) => p !== ''),
    sourceId: e.dataTransfer.getData(SOURCE_TYPE)
  }
}

async function copyDropped(entryId: string, under: string, folderName: string, what: { paths: string[]; sourceId: string }): Promise<void> {
  const paths = [...what.paths]
  if (what.sourceId !== '') {
    const media = (await window.api.currentProject()).media.find((m) => m.id === what.sourceId)
    if (media) paths.push(media.originalPath)
  }
  if (paths.length === 0) return
  const made = await window.api.copyIntoFolder(entryId, under, paths)
  showToast({
    kind: 'folder-copy',
    text:
      made.length === 0
        ? `Nothing copied into ${folderName}: only video, sound and pictures go in.`
        : `Copied ${made.length === 1 ? (made[0]!.split(/[\\/]/).pop() ?? 'it') : `${made.length} files`} into ${folderName}. The original is where it was.`
  })
}

/**
 * The drag handlers that make an element a place to drop a copy into the
 * folder at `under` below an entry, and whether something is held over it.
 * The deepest folder under the pointer takes the drop, and the window then
 * leaves it alone rather than importing the files too.
 */
export function useCopyDrop(
  entryId: string,
  under: string,
  folderName: string,
  on: boolean
): { over: boolean; drop: { onDragOver?: (e: DragEvent) => void; onDragLeave?: (e: DragEvent) => void; onDrop?: (e: DragEvent) => void } } {
  const [over, setOver] = useState(false)
  if (!on) return { over: false, drop: {} }
  return {
    over,
    drop: {
      onDragOver: (e) => {
        if (!copyable(e) || dropHandled(e)) {
          setOver(false)
          return
        }
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        markDropHandled(e)
        setOver(true)
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      },
      onDrop: (e) => {
        setOver(false)
        if (!copyable(e) || dropHandled(e)) return
        e.preventDefault()
        markDropHandled(e)
        void copyDropped(entryId, under, folderName, carried(e))
      }
    }
  }
}

import { useCallback, useEffect, useState } from 'react'
import type { MediaAsset, ImportProgress } from '../../shared/types'
import { keepSame } from '../../shared/keep-same'

export interface AssetsState {
  assets: MediaAsset[]
  progress: Map<string, ImportProgress>
  /** When each source's conversion began, for the time it has left. */
  convertingSince: Map<string, number>
  importPaths: (paths: string[]) => void
  /** Take a waiting file off the queue, or stop the one being imported. */
  cancel: (id: string) => void
  retry: (id: string) => void
  /** Out of the bin and the project. False when a clip uses it. */
  remove: (id: string) => Promise<boolean>
  show: (id: string) => void
}

export function useAssets(): AssetsState {
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [progress, setProgress] = useState<Map<string, ImportProgress>>(new Map())
  const [convertingSince, setConvertingSince] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    // The list as it was where nothing changed, so the bin is not drawn again for an edit that did not touch it (audit 2026-10-01).
    const relist = (): void => void window.api.listAssets().then((list) => setAssets((prev) => keepSame(prev, list)))
    relist()

    // The bin is emptied and refilled by main when a project is created or
    // opened, so resync the whole list whenever the document changes rather
    // than only appending what arrives.
    const offProject = window.api.onProjectChanged(relist)
    const offOpened = window.api.onProjectOpened(relist)

    const offAsset = window.api.onAssetChanged((asset) => {
      // Done or failed, its import has nothing more to say: its progress goes, rather than being kept for as long as the app runs (audit 2026-10-01).
      if (asset.status === 'ready' || asset.status === 'failed') {
        setProgress((prev) => {
          if (!prev.has(asset.id)) return prev
          const next = new Map(prev)
          next.delete(asset.id)
          return next
        })
      }
      setAssets((prev) => {
        const i = prev.findIndex((a) => a.id === asset.id)
        if (i < 0) return [...prev, asset]
        const next = [...prev]
        next[i] = asset
        return next
      })
    })
    const offRemoved = window.api.onAssetRemoved((id) => {
      setAssets((prev) => prev.filter((a) => a.id !== id))
      setProgress((prev) => {
        const next = new Map(prev)
        next.delete(id)
        return next
      })
    })
    const offProgress = window.api.onImportProgress((p) => {
      setProgress((prev) => new Map(prev).set(p.id, p))
      setConvertingSince((prev) => {
        const converting = p.stage === 'converting'
        if (converting === prev.has(p.id)) return prev
        const next = new Map(prev)
        if (converting) next.set(p.id, Date.now())
        else next.delete(p.id)
        return next
      })
    })
    return () => {
      offProject()
      offOpened()
      offAsset()
      offRemoved()
      offProgress()
    }
  }, [])

  const importPaths = useCallback((paths: string[]) => {
    if (paths.length > 0) void window.api.importFiles(paths)
  }, [])
  const cancel = useCallback((id: string) => void window.api.cancelImport(id), [])
  const retry = useCallback((id: string) => void window.api.retryImport(id), [])
  const remove = useCallback((id: string) => window.api.removeSource(id), [])
  const show = useCallback((id: string) => void window.api.showSource(id), [])

  return { assets, progress, convertingSince, importPaths, cancel, retry, remove, show }
}

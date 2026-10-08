import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranscribeResult } from '../../shared/types'
import type { Stretch } from '../../shared/captions'

/**
 * The speech engine as the window knows it: whether it is on this computer,
 * its download, and the listening that makes captions. Kept above the
 * Captions dialog, so a download carries on with the dialog closed and the
 * top bar can show how far it has got, as an export does.
 */
export interface SpeechRun {
  /** Whether the engine is on this computer, or null until that is known. */
  ready: boolean | null
  downloading: boolean
  /** 0 to 1, while downloading. */
  downloadFraction: number
  /** Why the last download failed, in plain words. */
  downloadError: string | null
  /** Ask again whether the engine is here, as when it is about to be used. */
  check: () => Promise<boolean>
  /** Download the engine. Resolves to whether it is now ready. */
  download: () => Promise<boolean>
  cancelDownload: () => void
  transcribing: boolean
  /** 0 to 1, while listening. */
  transcribeFraction: number
  transcribe: (sequenceId: string, trackIds: string[], stretches?: Stretch[]) => Promise<TranscribeResult>

  cancelTranscribe: () => void
}

export function useSpeech(): SpeechRun {
  const [ready, setReady] = useState<boolean | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadFraction, setDownloadFraction] = useState(0)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  const [transcribeFraction, setTranscribeFraction] = useState(0)
  // Set at once, not at the next render, so a second click never starts a second one.
  const fetching = useRef(false)
  const listening = useRef(false)

  useEffect(() => {
    void window.api.speechStatus().then((s) => {
      setReady(s.ready)
      setDownloading(s.downloading)
    })
    return window.api.onSpeechProgress((p) => {
      if (p.stage === 'download') setDownloadFraction(p.fraction)
      else setTranscribeFraction(p.fraction)
    })
  }, [])

  const download = useCallback(async (): Promise<boolean> => {
    if (fetching.current) return false
    fetching.current = true
    setDownloading(true)
    setDownloadError(null)
    setDownloadFraction(0)
    try {
      const result = await window.api.downloadSpeech()
      if (!result.ok && !result.cancelled) setDownloadError(result.error ?? 'The speech model could not be downloaded.')
      const now = await window.api.speechStatus()
      setReady(now.ready)
      return now.ready
    } finally {
      fetching.current = false
      setDownloading(false)
    }
  }, [])

  const transcribe = useCallback(async (sequenceId: string, trackIds: string[], stretches?: Stretch[]): Promise<TranscribeResult> => {
    if (listening.current) return { ok: false, error: 'Captions are already being made.' }
    listening.current = true
    setTranscribing(true)
    setTranscribeFraction(0)
    try {
      return await window.api.transcribe(sequenceId, trackIds, stretches)
    } finally {
      listening.current = false
      setTranscribing(false)
    }
  }, [])

  const check = useCallback(async (): Promise<boolean> => {
    const now = await window.api.speechStatus()
    setReady(now.ready)
    return now.ready
  }, [])

  const cancelDownload = useCallback(() => void window.api.cancelSpeechDownload(), [])
  const cancelTranscribe = useCallback(() => void window.api.cancelTranscribe(), [])

  return { ready, downloading, downloadFraction, downloadError, check, download, cancelDownload, transcribing, transcribeFraction, transcribe, cancelTranscribe }
}

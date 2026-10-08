/**
 * What the bin says about a source in plain words: why it was converted on
 * import, and what went wrong when it could not be imported, with what to do.
 */

/** Why a source was converted, one reason at a time, as the end of "because ...". */
const REASONS: Record<string, string> = {
  'variable-frame-rate': 'its frame timing varies',
  'unsupported-codec': 'the preview cannot play its video format',
  'high-bit-depth': 'it has 10-bit colour',
  'hdr-transfer': 'it is HDR',
  'rotation-metadata': 'it was filmed rotated',
  container: 'the preview cannot open its kind of file',
  'non-square-pixels': 'its pixels are not square',
  'sound-format': 'the preview cannot play its sound format'
}

/** "a", "a and b", "a, b and c". */
function listed(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** Why a source was converted on import, or null when it was not. */
export function conformWords(reasons: string[]): string | null {
  if (reasons.length === 0) return null
  return `Converted on import because ${listed(reasons.map((r) => REASONS[r] ?? r.replace(/-/g, ' ')))}.`
}

/**
 * What went wrong with an import, in plain words, and the words it came with
 * for anyone who wants them. Details is null when the plain words say it all.
 */
export function importErrorWords(raw: string | undefined): { text: string; details: string | null } {
  const message = (raw ?? '').trim()
  const plain = (text: string): { text: string; details: string | null } => ({ text, details: message || null })
  if (message === '') return { text: 'It could not be imported.', details: null }
  // A source of an opened project whose file has gone: Find is in the notice at the top.
  if (message === 'file not found') {
    return { text: 'The file is not where it was. Use Find at the top of the window, or put it back and press Retry.', details: null }
  }
  if (/ENOENT/.test(message)) return plain('The file is not there any more. It may have been moved or deleted.')
  if (/no video or sound/i.test(message)) return plain('No video or sound in this file.')
  if (/no video stream|no picture in/i.test(message)) return plain('No picture in this file.')
  if (/ENOSPC/.test(message)) return plain('The disk is full. Make some room, then try again.')
  if (/EBUSY|EACCES|EPERM/.test(message)) {
    return plain('The file could not be opened. Another program may be using it; close it, then try again.')
  }
  if (/missing required encoders/i.test(message)) return { text: message, details: null }
  if (/ffprobe/.test(message)) {
    return plain('This file could not be read. It may be damaged, or not a video or sound file.')
  }
  if (/ffmpeg/.test(message)) return plain('Converting it failed. It may be damaged; try again, or look at the details.')
  return plain('It could not be imported.')
}

/**
 * What a source's card says while it is being imported: waiting, reading,
 * converting with how far and how long, then each step after. Null once it
 * is ready or has failed, which say something else.
 */
export function importStatusWords(
  status: string,
  progress: { stage?: string; fraction?: number; tracks?: number } | undefined,
  timeLeft: string | null
): string | null {
  switch (status) {
    case 'queued':
      return 'waiting'
    case 'probing':
      return 'reading'
    case 'conforming': {
      const percent = `converting, ${Math.round((progress?.fraction ?? 0) * 100)}%`
      return timeLeft ? `${percent}, ${timeLeft}` : percent
    }
    case 'analysing':
      if (progress?.stage === 'filmstrip') return 'making the filmstrip'
      if (progress?.stage === 'tracks') {
        const n = progress.tracks ?? 0
        return n === 1 ? 'copying 1 audio track' : `copying ${n} audio tracks`
      }
      return 'drawing the waveform'
    default:
      return null
  }
}

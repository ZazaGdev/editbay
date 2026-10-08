/**
 * The arithmetic of a voice over take, kept apart from the microphone and the
 * files so it can be tested: what a take is called, where it is saved, and
 * which of its samples is the frame where recording began.
 */

/** The folder a saved project's takes go in, beside the project file. */
export const TAKES_FOLDER = 'Voice overs'

function two(n: number): string {
  return String(n).padStart(2, '0')
}

/** What a take is called, from the local time it began: "Voice over 2026-09-22 14-03-05.wav". */
export function takeName(at: Date): string {
  const day = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
  const time = `${two(at.getHours())}-${two(at.getMinutes())}-${two(at.getSeconds())}`
  return `Voice over ${day} ${time}.wav`
}

/** Whether a file is named as `takeName` names a take, perhaps numbered when two began in the same second. */
export function isTakeName(fileName: string): boolean {
  return /^Voice over \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}( \(\d+\))?\.wav$/i.test(fileName)
}

/**
 * Where takes are saved: a `Voice overs` folder beside the project file, so
 * they travel with it, or `Documents\Editbay\Voice overs` before the project
 * has a file of its own.
 */
export function takesFolder(
  projectPath: string | null,
  documents: string,
  path: { join: (...parts: string[]) => string; dirname: (p: string) => string }
): string {
  return projectPath ? path.join(path.dirname(projectPath), TAKES_FOLDER) : path.join(documents, 'Editbay', TAKES_FOLDER)
}

/** What is known, when a take stops, about how its samples line up with the sequence. */
export interface LineUpInput {
  sampleRate: number
  /** The audio clock's time, in seconds, of the first sample captured. */
  firstCaptured: number
  /**
   * The audio clock's time, in seconds, that is heard at the speakers at the
   * moment the sequence was at the frame where recording began.
   */
  startedAt: number
  /** Seconds from a sound reaching the microphone to the audio clock seeing it. */
  inputLatency: number
  /** Seconds from the audio clock to the speakers. */
  outputLatency: number
}

/**
 * How many samples to drop from the head of a take, or how many of silence
 * to put before it, so that its first sample is the frame where recording
 * began, as heard and answered.
 *
 * The preview's clock is what is heard: its picture's time is the position
 * being played out, and every other player is held to it. So `startedAt`,
 * read against the audio clock as heard, is when that frame was heard. What
 * was said then took `inputLatency` to reach the audio clock, which works
 * `outputLatency` ahead of what is heard. So the sample that belongs to that
 * frame is the one the audio clock saw at `startedAt + inputLatency +
 * outputLatency`.
 */
export function lineUp(l: LineUpInput): { drop: number; pad: number } {
  const target = l.startedAt + Math.max(0, l.inputLatency) + Math.max(0, l.outputLatency)
  const offset = Math.round((target - l.firstCaptured) * l.sampleRate)
  return offset >= 0 ? { drop: offset, pad: 0 } : { drop: 0, pad: -offset }
}

/** How long a take has run, as the transport shows it: "0:07", "1:05", "12:40". */
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${two(whole % 60)}`
}

import type { Stretch } from '../../shared/silences'
import type { Timeline } from '../../shared/project'
import type { MonitorLayout } from '../../shared/monitor-layout'
import type { SourceZoom } from '../../shared/source-zoom'

/**
 * The seam between the editor and whatever actually plays video.
 *
 * Nothing outside this folder knows that the current implementation is a pair
 * of HTML video elements and a canvas. When preview needs to become frame
 * exact, a new implementation of this interface replaces the old one and
 * nothing else moves.
 */
export interface PreviewEngine {
  /** Put the player into this element. Called once. */
  mount(host: HTMLElement): void
  /** The document to play. Safe to call on every change; the picture follows it. */
  setTimeline(timeline: Timeline): void
  /** Move to a timeline frame. Stops playback. */
  seek(frame: number): void
  /**
   * Move to a timeline frame and let the sound there be heard for a moment:
   * the playhead being dragged along the ruler. It moves the playhead and
   * reports it, exactly as `seek` does.
   */
  scrub(frame: number): void
  /** The drag is over. Stops the sound and puts every player back on the playhead. */
  endScrub(): void
  /**
   * Show a timeline frame without moving to it, for a skim, or put the picture
   * back on the playhead with null. Reports nothing back: nothing has moved.
   */
  showFrame(frame: number | null): void
  play(): void
  pause(): void
  isPlaying(): boolean
  /** Called with the timeline frame while playing, and after a seek. */
  onPosition(handler: (frame: number) => void): () => void
  /** Called when playback runs off the end of the timeline. */
  onEnded(handler: () => void): () => void
  /**
   * Called with where the sequence is, in seconds, and the `performance.now()`
   * it is there at: when playback starts, and again when the clock first
   * takes its time from the picture it plays, which starts a moment later. A
   * voice over lines up with the last of these before it stops.
   */
  onClock(handler: (sec: number, at: number) => void): () => void
  /** Play the whole sequence silent, or as its clips say again: muted while a voice over records. */
  setMuted(muted: boolean): void
  /**
   * How loud the preview is played, 0 to 1. The listener's volume, not the
   * edit's: it changes nothing that is exported and nothing a clip holds. It
   * only ever turns the preview down, so it never fights `PreviewLoudness`,
   * which is what makes a clip above 100% louder.
   */
  setMonitorVolume(volume: number): void
  /** The audio tracks listened to alone, empty when every one is heard. */
  setSolo(trackIds: readonly string[]): void
  /**
   * Where the voice is, in frames of the sequence, which a track that ducks
   * comes down under: `voiceStretches`, the same answer the export uses.
   */
  setVoice(stretches: readonly Stretch[]): void
  /**
   * Keep to the clock on the wall, holding the picture to it, rather than
   * following the picture: while a voice over records, which is one straight
   * run of time and would drift from a sequence that falls behind at every cut.
   */
  setWallClock(on: boolean): void
  /**
   * How fast playing goes, and which way: 1 as recorded, 2 twice as fast, -1
   * backwards, silent. Changed while playing, it goes on from where it is.
   */
  setRate(rate: number): void
  /**
   * Frames `from` to `to` played over and over: playing reaches `to` and goes
   * back to `from`, and starts from `from` when played from outside them. Null
   * for none. Playing backwards ignores it.
   */
  setLoop(loop: { from: number; to: number } | null): void
  /** Whether a playable picture is on screen right now. */
  hasPicture(): boolean
  /**
   * Where each view goes in the host, in layout pixels, or null for a view
   * not shown: one alone has the whole host, or both side by side. The source
   * view is the whole of the file being played; the program view is the
   * finished frame with every picture in its place. The engine works out
   * where everything goes within them from the timeline it already has.
   */
  setLayout(layout: MonitorLayout): void
  /**
   * The Source view zoomed in on the recording at `path`, or fitted, for null.
   * Only that recording is zoomed, whichever of its clips is shown, and only
   * while the Source view shows it.
   */
  setSourceZoom(zoom: { path: string; zoom: SourceZoom } | null): void
  /**
   * The selected clip. When it is a picture on a video row under the
   * playhead, the Source view shows its recording rather than V1's.
   */
  setFocus(clipId: string | null): void
  destroy(): void
}

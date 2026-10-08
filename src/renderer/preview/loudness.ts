/**
 * Playing the preview louder than a media element can.
 *
 * A media element's `volume` stops at 1. A clip set to 400% therefore cannot
 * be played at 400%: the preview lowers every other clip instead, so the
 * balance is right but nothing is louder, and a clip that is the only one
 * heard sounds exactly as it did at 100%. That is the whole of "the volume
 * slider does nothing above 100%".
 *
 * Web Audio has no such ceiling. Every player is routed through one gain,
 * set to however far past 1 the loudest clip goes, which cancels the lowering
 * and puts each clip back at its own loudness.
 *
 * Nothing is built until something asks to be louder than 1, and nothing is
 * routed until the audio context is actually running: an element routed into
 * a suspended context is silent, and a preview with no sound is far worse
 * than one that is merely quiet. If the browser refuses at any point, nothing
 * is routed and the preview behaves exactly as it did before.
 */
export class PreviewLoudness {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  /** The elements already routed. An element can be given a source node once and no more. */
  private readonly routed = new WeakSet<HTMLMediaElement>()
  /** Web Audio refused: never tried again, so a failure costs one attempt and not one a frame. */
  private broken = false
  /** How loud the mix wants to be, as a multiple of what an element allows. */
  private wanted = 1
  /**
   * The source node of each player routed, so it can be taken off the gain
   * when its player goes. Left connected, the node and its player live as long
   * as the context, which is as long as the window: every track removed, and
   * every project opened, left two more behind.
   */
  private readonly nodes = new Map<HTMLMediaElement, AudioNode>()

  /**
   * The mix wants to be `gain` times louder than a media element allows, over
   * these players. 1 asks for nothing.
   *
   * Safe to call as often as the clips change: it builds at most one context,
   * routes each element at most once, and does nothing at all while the mix
   * stays inside what an element can do.
   */
  want(gain: number, elements: Iterable<HTMLMediaElement>): void {
    this.wanted = Number.isFinite(gain) && gain > 1 ? gain : 1
    if (this.broken) return
    if (this.wanted === 1 && !this.ctx) return
    if (!this.open()) return
    const master = this.master
    if (!master) return
    master.gain.value = this.wanted
    for (const el of elements) this.route(el)
  }

  /**
   * Playback is starting. A context begins suspended until a gesture, and
   * pressing play is one, so this is where a mix that asked to be louder
   * before anyone had touched the window finally gets its chance.
   */
  resume(elements: Iterable<HTMLMediaElement>): void {
    if (this.broken || !this.ctx) return
    void this.ctx.resume().catch(() => undefined)
    this.want(this.wanted, elements)
  }

  /** Whether the players are being heard through the gain rather than on their own. */
  get routing(): boolean {
    return this.nodes.size > 0 && this.ctx?.state === 'running'
  }

  /** A player is going for good: its source node is taken off the gain and let go of. */
  release(el: HTMLMediaElement): void {
    const node = this.nodes.get(el)
    if (!node) return
    this.nodes.delete(el)
    try {
      node.disconnect()
    } catch {
      // Already disconnected, as when the context has closed. Nothing is held.
    }
  }

  close(): void {
    const ctx = this.ctx
    this.ctx = null
    this.master = null
    for (const el of [...this.nodes.keys()]) this.release(el)
    void ctx?.close().catch(() => undefined)
  }

  /** The context and its gain, made once, and only while it is running. */
  private open(): boolean {
    if (this.broken) return false
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext()
        this.master = this.ctx.createGain()
        this.master.gain.value = 1
        this.master.connect(this.ctx.destination)
      } catch {
        this.broken = true
        this.ctx = null
        this.master = null
        return false
      }
    }
    if (this.ctx.state === 'running') return true
    // Suspended until a gesture. Asked to start, and left alone until it has:
    // routing into it now would take the sound away rather than raise it.
    void this.ctx.resume().catch(() => undefined)
    return false
  }

  private route(el: HTMLMediaElement): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master || this.routed.has(el)) return
    try {
      const node = ctx.createMediaElementSource(el)
      node.connect(master)
      this.routed.add(el)
      this.nodes.set(el, node)
    } catch {
      // Already routed by something else, or refused. Left on its own: it is
      // quieter than the rest, which is better than silent.
      this.routed.add(el)
    }
  }
}

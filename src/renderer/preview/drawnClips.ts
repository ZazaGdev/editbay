/**
 * Which clips the Output view was last drawn with a picture of, and who waits
 * for one to be: a shape just drawn keeps its outline until then (task 86).
 */
export class DrawnClips {
  private drawn = new Set<string>()
  private awaited: { clipId: string; done: () => void } | null = null

  /** The Output view was just drawn with these clips' pictures. */
  drew(clipIds: readonly string[]): void {
    this.drawn = new Set(clipIds)
    const awaited = this.awaited
    if (awaited && this.drawn.has(awaited.clipId)) {
      this.awaited = null
      awaited.done()
    }
  }

  /** Tell `done` once a clip's picture has been drawn; the returned function stops waiting. */
  when(clipId: string, done: () => void): () => void {
    if (this.drawn.has(clipId)) {
      done()
      return () => {}
    }
    const awaited = { clipId, done }
    this.awaited = awaited
    return () => {
      if (this.awaited === awaited) this.awaited = null
    }
  }
}

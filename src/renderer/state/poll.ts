/**
 * Ask `look` now, and again `everyMs` after each answer comes, until the
 * returned stop is called. Never a second asking while one is unanswered: a
 * folder on a share that stops answering used to be asked again every few
 * seconds regardless, and each unanswered look held one of main's file
 * threads, so saves queued behind them (audit 2026-10-01).
 */
export function pollAfterAnswer(look: () => Promise<unknown>, everyMs: number): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const again = (): void => {
    if (stopped) return
    void look()
      .catch(() => undefined)
      .then(() => {
        if (!stopped) timer = setTimeout(again, everyMs)
      })
  }
  again()
  return () => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
  }
}

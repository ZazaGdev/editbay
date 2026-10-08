/**
 * Drops a part of the window has dealt with itself, such as files let go on a
 * folder in Sources (task 103), which the window's own drop then leaves alone
 * rather than bringing the files into the project as well.
 */
const handled = new WeakSet<Event>()

export function markDropHandled(e: { nativeEvent: Event }): void {
  handled.add(e.nativeEvent)
}

export function dropHandled(e: { nativeEvent: Event }): boolean {
  return handled.has(e.nativeEvent)
}

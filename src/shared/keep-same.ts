/**
 * `now`, with every part that is the same as in `was` taken from `was`.
 *
 * A document from main arrives as all new objects even when one clip changed,
 * so nothing drawn from it could tell what had: every clip on the timeline was
 * drawn again on each edit, and each undo step held a whole copy (audit
 * 2026-10-01). Kept this way, a part that did not change is the very object it
 * was, so a memo holds on it, and undo steps share it.
 *
 * Items of a list that have an `id` are matched by it, so a clip put in before
 * others does not make all of them look new. Plain data only: what a document
 * is made of.
 */
export function keepSame<T>(was: T, now: T): T {
  if (Object.is(was, now)) return was
  if (Array.isArray(was) && Array.isArray(now)) return keepList(was, now) as T
  if (isRecord(was) && isRecord(now)) return keepRecord(was, now) as T
  return now
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function idOf(x: unknown): string | undefined {
  return isRecord(x) && typeof x['id'] === 'string' ? x['id'] : undefined
}

function keepList(was: unknown[], now: unknown[]): unknown[] {
  let byId: Map<string, unknown> | null = null
  const out = now.map((item, i) => {
    const id = idOf(item)
    if (id === undefined) return keepSame(was[i], item)
    // Most lists keep their order: the same place is looked at before every id.
    if (idOf(was[i]) === id) return keepSame(was[i], item)
    if (byId === null) {
      byId = new Map()
      for (const w of was) {
        const wid = idOf(w)
        if (wid !== undefined) byId.set(wid, w)
      }
    }
    return byId.has(id) ? keepSame(byId.get(id), item) : item
  })
  return out.length === was.length && out.every((x, i) => x === was[i]) ? was : out
}

function keepRecord(was: Record<string, unknown>, now: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(now)
  let same = keys.length === Object.keys(was).length
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    const v = Object.prototype.hasOwnProperty.call(was, k) ? keepSame(was[k], now[k]) : now[k]
    out[k] = v
    if (v !== was[k] || !Object.prototype.hasOwnProperty.call(was, k)) same = false
  }
  return same ? was : out
}

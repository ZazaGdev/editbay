/**
 * Reading the fields of an edit list (`edit-list.ts`): each check refuses with
 * an `EditListError` whose message starts with the field it is about, as
 * `cuts[2].toSec` or `reels[1].cuts[2].toSec`, so whoever wrote it can find it.
 */

/** A list that cannot be read or honoured. The message starts with the field it is about. */
export class EditListError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditListError'
  }
}

export function refuse(where: string, why: string): never {
  throw new EditListError(where === '' ? why : `${where}: ${why}`)
}

export type Fields = Record<string, unknown>

/** An object, with nothing in it but the fields named: a misspelt field would otherwise be lost without a word. */
export function object(raw: unknown, where: string, required: readonly string[], optional: readonly string[] = []): Fields {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) refuse(where, 'must be an object')
  const o = raw as Fields
  for (const key of Object.keys(o)) {
    if (!required.includes(key) && !optional.includes(key)) {
      refuse(at(where, key), `is not a field of the edit list here; expected ${[...required, ...optional].join(', ')}`)
    }
  }
  for (const key of required) if (!(key in o)) refuse(at(where, key), 'is missing')
  return o
}

export function at(where: string, key: string): string {
  return where === '' ? key : `${where}.${key}`
}

export function seconds(raw: unknown, where: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) refuse(where, 'must be a number of seconds')
  return raw
}

export function notNegative(raw: unknown, where: string): number {
  const n = seconds(raw, where)
  if (n < 0) refuse(where, 'must not be negative')
  return n
}

export function text(raw: unknown, where: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') refuse(where, 'must be some text')
  return raw
}

export function oneOf<T extends string>(raw: unknown, where: string, allowed: readonly T[]): T {
  if (typeof raw !== 'string' || !allowed.includes(raw as T)) refuse(where, `must be one of ${allowed.join(', ')}`)
  return raw as T
}

export function flag(raw: unknown, where: string): boolean {
  if (typeof raw !== 'boolean') refuse(where, 'must be true or false')
  return raw
}

export function list(raw: unknown, where: string): unknown[] {
  if (!Array.isArray(raw)) refuse(where, 'must be a list')
  return raw
}

/** A stretch from `fromSec` to `toSec`, which must come after it. */
export function stretch(o: Fields, where: string): { fromSec: number; toSec: number } {
  const fromSec = notNegative(o.fromSec, at(where, 'fromSec'))
  const toSec = notNegative(o.toSec, at(where, 'toSec'))
  if (toSec <= fromSec) refuse(where, `ends at ${toSec} s, which is not after where it starts, ${fromSec} s`)
  return { fromSec, toSec }
}

/** None of these stretches overlapping another; the later one of a pair is named, with the one it overlaps. */
export function noOverlaps(items: readonly { fromSec: number; toSec: number }[], name: string): void {
  const order = items.map((s, i) => ({ s, i })).sort((a, b) => a.s.fromSec - b.s.fromSec)
  for (let k = 1; k < order.length; k++) {
    const before = order[k - 1]!
    const now = order[k]!
    if (now.s.fromSec < before.s.toSec) {
      const [first, second] = before.i < now.i ? [before.i, now.i] : [now.i, before.i]
      refuse(`${name}[${second}]`, `overlaps ${name}[${first}]`)
    }
  }
}

export function fraction(raw: unknown, where: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1) refuse(where, 'must be a fraction from 0 to 1')
  return raw
}

/** A rectangle in fractions of whatever it is of, `{ x, y, w, h }`, inside it and not empty. */
export function fractionRect(raw: unknown, where: string): { x: number; y: number; w: number; h: number } {
  const r = object(raw, where, ['x', 'y', 'w', 'h'])
  const rect = { x: fraction(r.x, at(where, 'x')), y: fraction(r.y, at(where, 'y')), w: fraction(r.w, at(where, 'w')), h: fraction(r.h, at(where, 'h')) }
  if (rect.w === 0) refuse(at(where, 'w'), 'must be more than 0')
  if (rect.h === 0) refuse(at(where, 'h'), 'must be more than 0')
  // A little over 1 is rounding in whatever wrote it, not a rectangle off the picture.
  if (rect.x + rect.w > 1 + 1e-6 || rect.y + rect.h > 1 + 1e-6) refuse(where, 'reaches past the edge of the picture')
  return rect
}

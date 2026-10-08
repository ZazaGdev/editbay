import type { MediaAsset } from './types'

/**
 * What the Source bin shows and in what order: filtered by kind, searched by
 * name, sorted, and folded into sections by the day each source came in.
 * Pure, so every question about the list is answered in one tested place
 * rather than in the component that draws it.
 */

export type BinSort = 'added' | 'name' | 'length'

/** What kind of thing a source is, for the filter. */
export type BinKind = 'all' | 'video' | 'sound' | 'image'

export type BinGroupId = 'today' | 'yesterday' | 'week' | 'earlier'

export interface BinGroup {
  id: BinGroupId
  label: string
  assets: MediaAsset[]
}

const GROUP_LABELS: Record<BinGroupId, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  earlier: 'Earlier'
}

const DAY_MS = 24 * 60 * 60 * 1000

export function nameOf(asset: MediaAsset): string {
  return asset.originalPath.split(/[\\/]/).pop() ?? asset.originalPath
}

/** Whether a source is of the kind asked for. One still importing counts as anything, so it never vanishes mid-import. */
export function isKind(asset: MediaAsset, kind: BinKind): boolean {
  if (kind === 'all' || asset.status !== 'ready') return true
  const is: BinKind = asset.hasVideo === false ? 'sound' : asset.still === true ? 'image' : 'video'
  return is === kind
}

/**
 * How long a source is, for sorting by length. A picture has none of its own,
 * whatever its nominal length is, so it sorts as the shortest.
 */
function lengthOf(asset: MediaAsset): number {
  return asset.still === true ? 0 : asset.durationSec
}

/** Local midnight at the start of the day `ms` falls in. */
function dayStart(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Which section a source goes in, by the day it came in, counted in local
 * days from `now`. A source with no date, brought in before sources had one,
 * is Earlier: that is the one thing certain about it.
 */
export function groupOf(addedAt: number | undefined, now: number): BinGroupId {
  if (addedAt === undefined) return 'earlier'
  const today = dayStart(now)
  if (addedAt >= today) return 'today'
  if (addedAt >= today - DAY_MS) return 'yesterday'
  if (addedAt >= today - 6 * DAY_MS) return 'week'
  return 'earlier'
}

/**
 * The bin's sections, newest first, each already in the order asked for, and
 * only those with something in them. `addedAt` is when each source came into
 * the project, by id; the assets are in the order they came in, oldest first.
 */
export function binGroups(
  assets: MediaAsset[],
  addedAt: ReadonlyMap<string, number>,
  opts: { search: string; sort: BinSort; kind: BinKind; now: number }
): BinGroup[] {
  const words = opts.search.trim().toLowerCase()
  const found = assets.filter((a) => isKind(a, opts.kind) && (words === '' || nameOf(a).toLowerCase().includes(words)))
  // Copied before it is put in order: the list handed in belongs to the
  // project, and sorting or reversing it in place would reorder the project.
  const sorted = [...found]
  if (opts.sort === 'name') sorted.sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }))
  else if (opts.sort === 'length') sorted.sort((a, b) => lengthOf(b) - lengthOf(a))
  // Added: newest first. The recording just brought in is the one about to be
  // used. The order they came in breaks a tie, which is what a source with no
  // date has to go on.
  else sorted.reverse()
  const order: BinGroupId[] = ['today', 'yesterday', 'week', 'earlier']
  return order
    .map((id) => ({ id, label: GROUP_LABELS[id], assets: sorted.filter((a) => groupOf(addedAt.get(a.id), opts.now) === id) }))
    .filter((g) => g.assets.length > 0)
}

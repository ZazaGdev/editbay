import { cacheRoot } from './cache'
import { cacheKeysImporting } from './import'
import { cacheUsedBy } from './prune'
import { getProject, heldMedia } from '../project/session'

/**
 * What of the cache must stay when it is freed: what the open project uses,
 * what the sources an undo may bring back use, and the folders of imports
 * under way, none of which is in the project yet (audit 2026-10-08).
 */
export function cacheInUse(): Set<string> {
  const used = cacheUsedBy(cacheRoot(), [...getProject().media, ...heldMedia()])
  for (const key of cacheKeysImporting()) used.add(key)
  return used
}

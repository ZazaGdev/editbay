import { createHash } from 'node:crypto'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gunzip, gzip } from 'node:zlib'
import { writeAtomic } from '../media/cache'
import { isVersionId, versionsToLetGo, VERSION_REASONS, type KeptVersion, type VersionReason } from '../../shared/versions'

/**
 * Plan 84: earlier versions of a project on disk, in the app's own folder.
 *
 * One folder per project, named from a hash of its path as the recovery
 * copies are, and `untitled` for work never saved. Each version is the whole
 * project file, gzipped, after one line saying what it is, so a version is
 * one file with no index to fall out of step with it. A project file is a
 * few hundred kilobytes at most, and a fraction of that gzipped.
 */

const zip = promisify(gzip)
const unzip = promisify(gunzip)
const EXTENSION = '.editbay.gz'

export function versionsDir(settingsDir: string): string {
  return join(settingsDir, 'versions')
}

/** The folder one project's versions go in. Windows paths ignore case, so one project is never two folders. */
export function versionsKey(projectPath: string | null): string {
  if (!projectPath) return 'untitled'
  return createHash('sha256').update(projectPath.toLowerCase()).digest('hex').slice(0, 16)
}

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}

interface Header {
  projectPath: string | null
  name: string
  hash: string
}

async function readWhole(dir: string, id: string): Promise<{ header: Header; text: string }> {
  const raw = (await unzip(await readFile(join(dir, id)))).toString('utf8')
  const cut = raw.indexOf('\n')
  const header = JSON.parse(raw.slice(0, cut)) as Header
  return { header, text: raw.slice(cut + 1) }
}

/** One project's versions by name alone, newest first: what the folder says, read from nothing else. */
async function namesOf(dir: string, projectPath: string | null): Promise<Pick<KeptVersion, 'id' | 'keptAt' | 'reason'>[]> {
  const key = versionsKey(projectPath)
  let names: string[]
  try {
    names = await readdir(join(dir, key))
  } catch {
    return []
  }
  return names
    .map((name) => `${key}/${name}`)
    .filter(isVersionId)
    .map((id) => {
      const name = id.slice(key.length + 1)
      return { id, keptAt: Number(name.slice(0, 13)), reason: name.slice(14, -EXTENSION.length) as VersionReason }
    })
    .sort((a, b) => b.keptAt - a.keptAt)
}

/** One project's versions, newest first. One that cannot be read is left out. */
export async function listVersions(dir: string, projectPath: string | null): Promise<KeptVersion[]> {
  const out: KeptVersion[] = []
  for (const v of await namesOf(dir, projectPath)) {
    try {
      const { header } = await readWhole(dir, v.id)
      out.push({ ...v, projectPath: header.projectPath, name: header.name, hash: header.hash })
    } catch {
      // Damaged: not offered, and let go of with the rest in time.
    }
  }
  return out
}

/** A version's project file as it was kept. */
export async function readVersion(dir: string, id: string): Promise<{ projectPath: string | null; text: string }> {
  if (!isVersionId(id)) throw new Error('that is not an earlier version')
  const { header, text } = await readWhole(dir, id)
  return { projectPath: header.projectPath, text }
}

/**
 * Keep a project file as an earlier version, unless it is what the newest
 * version already holds, and let go of what is no longer kept. Returns the
 * version, or null when there was nothing new to keep. Throws when it could
 * not be written, so the caller does not throw away what it was keeping.
 */
export async function keepVersion(
  dir: string,
  what: { projectPath: string | null; name: string; reason: VersionReason; text: string },
  now = Date.now()
): Promise<KeptVersion | null> {
  if (!VERSION_REASONS.includes(what.reason)) throw new Error(`no such reason: ${what.reason}`)
  const hash = hashOf(what.text)
  const kept = await namesOf(dir, what.projectPath)
  const newest = kept[0] ? await readWhole(dir, kept[0].id).catch(() => null) : null
  if (newest?.header.hash === hash) return null
  const key = versionsKey(what.projectPath)
  // Two in the same millisecond would share a name: the later one is a millisecond on.
  let keptAt = Math.max(now, (kept[0]?.keptAt ?? 0) + 1)
  if (kept.some((v) => v.keptAt === keptAt)) keptAt += 1
  const id = `${key}/${keptAt}-${what.reason}${EXTENSION}`
  const header: Header = { projectPath: what.projectPath, name: what.name, hash }
  await writeAtomic(join(dir, id), await zip(Buffer.from(`${JSON.stringify(header)}\n${what.text}`, 'utf8')))
  const version: KeptVersion = { id, projectPath: what.projectPath, name: what.name, keptAt, reason: what.reason, hash }
  for (const old of versionsToLetGo([version, ...kept], now)) await rm(join(dir, old), { force: true }).catch(() => undefined)
  return version
}

/** When the newest version of a project was kept, or null when none is. */
export async function newestKeptAt(dir: string, projectPath: string | null): Promise<number | null> {
  return (await namesOf(dir, projectPath))[0]?.keptAt ?? null
}

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ASSET_FOLDERS } from '../shared/asset-clip'

/**
 * Plan 96: the Video, Audio and Images folders inside the assets folder,
 * made where they are missing. Nothing there is ever renamed or deleted, and
 * a folder that cannot be made is left for the save that needs it to report.
 */
export async function makeAssetFolders(assets: string): Promise<void> {
  for (const name of Object.values(ASSET_FOLDERS)) await mkdir(join(assets, name), { recursive: true }).catch(() => undefined)
}

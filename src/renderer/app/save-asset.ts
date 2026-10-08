import { ASSET_FOLDERS } from '../../shared/asset-clip'
import { showToast } from '../state/toasts'

/**
 * Plan 96: clips saved into the assets folder as they play, saying where
 * they went, or why they could not be saved.
 */
export async function saveAsAsset(sequenceId: string, clipIds: readonly string[]): Promise<void> {
  showToast({ kind: 'asset-saving', text: 'Saving it as an asset...' })
  const saved = await window.api.saveAsAsset(sequenceId, [...clipIds])
  if (!saved.ok || !saved.path || !saved.kind) {
    showToast({ kind: 'asset-failed', text: `It was not saved as an asset: ${saved.error ?? 'something went wrong.'}` })
    return
  }
  const name = saved.path.split(/[\/]/).at(-1)
  showToast({ kind: 'asset-saved', text: `Saved to Assets, ${ASSET_FOLDERS[saved.kind]}, as ${name}.` })
}

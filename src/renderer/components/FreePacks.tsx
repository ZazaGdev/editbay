import type { JSX } from 'react'
import { FREE_PACKS } from '../../shared/free-packs'
import { accent, ink, radius, space, surface, type } from '../theme'
import { Button } from '../ui/Button'
import { Modal, ModalActions } from './Modal'
import { HelpTip } from '../ui/HelpTip'

/**
 * Task 44: free packs to fill the assets folder with, each with what is in
 * it, how it comes, and whether a video using it needs a credit in its
 * description, with the exact line when it does. Each opens in the browser;
 * you download and unpack it into the assets folder yourself.
 */
export function FreePacks(props: { onClose: () => void }): JSX.Element {
  return (
    <Modal title="Free assets to download" testid="free-packs" onClose={props.onClose} width={560}>
      <p style={{ font: type.body, color: ink.secondary, margin: 0 }}>
        Free for published, monetised videos when last checked (2 October 2026). Licences change, so read the page before you rely on it.{' '}
        <HelpTip
          text="Download a pack in your browser and unpack it into your assets folder. Where a credit is needed, keep its line in a credit.txt in the pack's folder, and every export lists it for you."
          tutorial="345-get-free-assets"
          style={{ verticalAlign: 'middle' }}
        />
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm, maxHeight: 420, overflowY: 'auto', marginTop: space.sm }}>
        {FREE_PACKS.map((p) => (
          <div
            key={p.id}
            data-testid="free-pack"
            data-pack={p.id}
            data-credit={p.credit ? 'yes' : 'no'}
            style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: space.sm, borderRadius: radius.control, background: surface.well }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
              <span style={{ flex: 1, font: type.body, color: ink.primary }}>{p.name}</span>
              <Button testid="free-pack-open" size="small" title={p.url} onClick={() => void window.api.openPack(p.id)}>
                Open page
              </Button>
            </div>
            <span style={{ font: type.meta, color: ink.secondary }}>
              {p.contains}. {p.download}.
            </span>
            {p.credit ? (
              <span data-testid="free-pack-credit" style={{ font: type.meta, color: accent.bright }}>
                Credit needed in the description: <span style={{ userSelect: 'text' }}>{p.credit}</span>.
              </span>
            ) : (
              <span style={{ font: type.meta, color: ink.muted }}>No credit needed.</span>
            )}
            {p.note && <span style={{ font: type.meta, color: ink.muted }}>{p.note}</span>}
          </div>
        ))}
      </div>
      <ModalActions>
        <Button testid="free-packs-close" variant="primary" onClick={props.onClose}>
          Done
        </Button>
      </ModalActions>
    </Modal>
  )
}

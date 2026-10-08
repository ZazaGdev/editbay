import { useEffect, useState, type JSX } from 'react'
import { creditKey, creditLine, MAX_CREDIT } from '../../shared/credits'
import { ink, radius, space, surface, type } from '../theme'
import { Button } from '../ui/Button'
import { Modal, ModalActions } from './Modal'

/**
 * Task 47: one file marked by hand as needing a credit in the description of
 * any video that uses it, with the line to give, or the mark taken off. A
 * pack whose every file needs the same line keeps it in a credit.txt instead.
 */
export function CreditAsk(props: { path: string; name: string; onClose: () => void }): JSX.Element {
  const key = creditKey(props.path)
  const [line, setLine] = useState('')
  const [had, setHad] = useState(false)
  useEffect(() => {
    void window.api.appSettings().then((s) => {
      const now = s.credits[key]
      if (now) {
        setLine(now)
        setHad(true)
      }
    })
  }, [key])
  const save = async (value: string | null): Promise<void> => {
    const now = (await window.api.appSettings()).credits
    const next = { ...now }
    if (value === null) delete next[key]
    else next[key] = value
    await window.api.setAppSettings({ credits: next })
    props.onClose()
  }
  const clean = creditLine(line)
  return (
    <Modal title="Credit for the description" testid="credit-ask" onClose={props.onClose} width={460}>
      <p style={{ font: type.body, color: ink.secondary, margin: 0 }}>
        The line a video's description must carry when it uses {props.name}.
      </p>
      <input
        data-testid="credit-line"
        aria-label="The credit line"
        value={line}
        maxLength={MAX_CREDIT}
        placeholder='For example: "Boing" by Ann licensed under CC BY 4.0'
        onChange={(e) => setLine(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        style={{
          font: type.body,
          color: ink.primary,
          background: surface.well,
          border: `1px solid ${surface.lineStrong}`,
          borderRadius: radius.control,
          padding: '6px 8px',
          marginTop: space.sm,
          width: '100%',
          boxSizing: 'border-box'
        }}
      />
      <ModalActions>
        {had && (
          <Button testid="credit-remove" onClick={() => void save(null)}>
            Needs no credit
          </Button>
        )}
        <Button testid="credit-cancel" onClick={props.onClose}>
          Cancel
        </Button>
        <Button testid="credit-save" variant="primary" disabled={clean === null} onClick={() => clean && void save(clean)}>
          Save
        </Button>
      </ModalActions>
    </Modal>
  )
}

import { useState, type JSX } from 'react'
import { ink, type } from '../theme'
import { Button } from '../ui/Button'
import { Modal, ModalActions } from './Modal'

/**
 * Task 34: a button that puts one style on every other text, or on every
 * sequence's captions, once you have said you are sure. Cancel changes nothing.
 */
export function ApplyToAll(props: {
  testid: string
  label: string
  title: string
  /** The question the confirmation asks. */
  question: string
  /** What will change, and what each one keeps. */
  explain: string
  confirm: string
  onApply: () => void
}): JSX.Element {
  const [asking, setAsking] = useState(false)
  return (
    <>
      <Button testid={props.testid} size="small" title={props.title} onClick={() => setAsking(true)} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
        {props.label}
      </Button>
      {asking && (
        <Modal title={props.question} testid={`${props.testid}-ask`} onClose={() => setAsking(false)} width={420}>
          <p style={{ font: type.body, color: ink.secondary, margin: 0 }}>{props.explain}</p>
          <ModalActions>
            <Button testid={`${props.testid}-cancel`} onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button
              testid={`${props.testid}-confirm`}
              variant="primary"
              onClick={() => {
                setAsking(false)
                props.onApply()
              }}
            >
              {props.confirm}
            </Button>
          </ModalActions>
        </Modal>
      )}
    </>
  )
}

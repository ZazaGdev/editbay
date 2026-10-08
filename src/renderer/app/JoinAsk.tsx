/**
 * A join that would bring back what was cut between the pieces, asked about
 * before it is done.
 */

import type { JSX } from 'react'
import type { Timeline as TimelineData } from '../../shared/project'
import { Modal, ModalActions } from '../components/Modal'
import { Button } from '../ui/Button'
import { ink, type } from '../theme'
import { secondsOf } from './edit-words'
import type { AppState } from './app-state'

export function JoinAsk({ app, joinAsk, timeline }: { app: AppState; joinAsk: NonNullable<AppState['joinAsk']>; timeline: TimelineData }): JSX.Element {
  const { setJoinAsk, editClip, select } = app
  return (
    <Modal title="Bring back what was cut?" testid="join-ask" onClose={() => setJoinAsk(null)} width={420}>
      <p style={{ font: type.body, color: ink.secondary, margin: 0 }}>
        Joining these brings back {secondsOf(joinAsk.frames, timeline.fps)} that was taken out between them, so the sequence gets that
        much longer. To make them one clip and keep the cut, group them instead.
      </p>
      <ModalActions>
        <Button testid="join-ask-cancel" onClick={() => setJoinAsk(null)}>
          Cancel
        </Button>
        <Button
          testid="join-ask-join"
          variant="primary"
          onClick={() => {
            const ask = joinAsk
            setJoinAsk(null)
            void editClip({ kind: 'joinClips', clipIds: ask.clipIds, bringBack: true, ...(ask.alone ? { alone: true } : {}) })
            if (ask.select) select(ask.select, ask.alone)
          }}
        >
          Join, bringing it back
        </Button>
      </ModalActions>
    </Modal>
  )
}

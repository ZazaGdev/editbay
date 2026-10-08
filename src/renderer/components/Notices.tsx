import { useEffect, useState, type JSX, type CSSProperties } from 'react'
import type { RecoveryOffer } from '../../shared/types'
import { showToast } from '../state/toasts'
import { space, radius, type, elevation, meaning, wash, accent, ink } from '../theme'
import { Button } from '../ui/Button'

interface Message {
  id: number
  text: string
}

function when(ms: number): string {
  const d = new Date(ms)
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return sameDay ? `today at ${time}` : `${d.toLocaleDateString()} at ${time}`
}

const bar: CSSProperties = {
  display: 'flex',
  gap: space.md,
  alignItems: 'center',
  padding: `${space.sm}px ${space.md}px`,
  borderRadius: radius.control,
  font: type.meta,
  boxShadow: elevation.over
}

/**
 * Things main needs you to know, across the top of the window: a recovery
 * copy to restore after a crash, and the messages that have to be read rather
 * than seen. Neither blocks the window, so you can look before deciding.
 *
 * Only the messages that wait are drawn here. A message that simply says
 * something refused to happen goes to the toasts instead and fades on its own:
 * nothing was lost and nothing is being asked, so there is nothing to press.
 * Everything used to come here, which made "A1 is locked, so nothing on it
 * changed" a box to clear before carrying on.
 */
export function Notices(): JSX.Element | null {
  const [offer, setOffer] = useState<RecoveryOffer | null>(null)
  const [messages, setMessages] = useState<Message[]>([])

  useEffect(() => {
    void window.api.recoveryOffer().then(setOffer)
    let next = 0
    // Main keeps the messages until they are taken, so one sent before this
    // window was listening still arrives, and none arrives twice.
    const take = (): void => {
      void window.api.takeNotices().then((notices) => {
        const waiting = notices.filter((n) => n.waits)
        if (waiting.length > 0) setMessages((prev) => [...prev, ...waiting.map((n) => ({ id: next++, text: n.text }))])
        for (const n of notices) if (!n.waits) showToast({ kind: 'notice', text: n.text })
      })
    }
    const off = window.api.onNotice(take)
    take()
    return off
  }, [])

  if (!offer && messages.length === 0) return null

  return (
    <div
      // Read out as they come, for someone using a screen reader (audit 2026-10-01).
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        // Under the top bar, so a notice never covers the buttons it may ask you to press.
        top: 56,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: space.sm,
        zIndex: 50,
        maxWidth: 'min(640px, calc(100vw - 32px))'
      }}
    >
      {offer && (
        <div
          data-testid="recovery-offer"
          style={{
            ...bar,
            // Work that is not saved: the one thing the attention colour is for.
            background: wash.attention,
            border: `1px solid ${wash.attentionLine}`,
            color: meaning.attention
          }}
        >
          <span style={{ flex: 1 }}>
            {offer.unanswered ? (
              <>
                A recovery copy of <b>{offer.name}</b> from {when(offer.writtenAt)} is still waiting to be restored or
                discarded.
              </>
            ) : (
              <>
                Editbay did not close properly. There is a recovery copy of <b>{offer.name}</b> from{' '}
                {when(offer.writtenAt)}.
              </>
            )}
          </span>
          <Button
            variant="primary"
            size="small"
            testid="recovery-restore"
            onClick={() => {
              // Ask again afterwards: choosing Cancel at "save changes?" keeps the offer.
              void window.api
                .restoreRecovery()
                .then(() => window.api.recoveryOffer())
                .then(setOffer)
            }}
          >
            Restore
          </Button>
          <Button
            size="small"
            testid="recovery-discard"
            onClick={() => {
              setOffer(null)
              void window.api.discardRecovery()
            }}
          >
            Discard
          </Button>
        </div>
      )}
      {messages.map((m) => (
        <div
          key={m.id}
          data-testid="notice"
          style={{ ...bar, background: accent.wash, border: `1px solid ${accent.washLine}`, color: ink.primary }}
        >
          <span style={{ flex: 1 }}>{m.text}</span>
          <Button size="small" title="Dismiss" onClick={() => setMessages((prev) => prev.filter((x) => x.id !== m.id))}>
            OK
          </Button>
        </div>
      ))}
    </div>
  )
}

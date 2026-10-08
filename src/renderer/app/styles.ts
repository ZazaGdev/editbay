/** The styles the App's columns and banners share. */

import { radius, space, surface, type } from '../theme'

export const panel = {
  background: surface.panel,
  borderRadius: radius.panel,
  padding: space.md,
  overflowY: 'auto' as const,
  minHeight: 0
}
/** A column that takes no clicks or drags while a voice over records. */
export const held = { pointerEvents: 'none' as const, opacity: 0.55 }
export const banner = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  gap: space.sm,
  padding: `${space.sm}px 14px`,
  font: type.body
}

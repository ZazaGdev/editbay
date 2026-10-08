/**
 * Task 34: one text's style, or one sequence's caption style, put on every
 * other text or every sequence's captions, keeping where each one sits.
 */

import type { CaptionStyle, CaptionStyleChange } from './captions'
import type { DrawnText, Project, ProjectMedia } from './project'
import { setTextOn } from './drawn-media'
import { editSequence } from './sequences'
import { setCaptionStyle } from './timeline-captions'
import type { TextStyle } from './text'

/**
 * Another text as it looks after taking on `source`'s style: its own words
 * and alignment stay, everything else is copied. Where it sits and when it
 * plays are its clip's, so they stay too; its box grows or shrinks with the
 * copied size from the side its alignment keeps still.
 */
export function textStyledAs(source: TextStyle, target: TextStyle): TextStyle {
  return { ...source, text: target.text, align: target.align }
}

/** Every text of the project but this one, in any sequence. */
export function otherTexts(p: Pick<Project, 'media'>, mediaId: string): (ProjectMedia & { text: TextStyle })[] {
  return p.media.filter((m): m is ProjectMedia & { text: TextStyle } => m.text !== undefined && m.id !== mediaId)
}

/** Several texts restyled in one step, each with the picture drawn again from its style. */
export function setTextsOn(p: Project, texts: readonly { mediaId: string; style: TextStyle; drawn: DrawnText }[]): Project {
  return texts.reduce((q, t) => setTextOn(q, t.mediaId, t.style, t.drawn), p)
}

/** A sequence's caption style as a change for another sequence: everything but where captions sit. */
export function captionLook(style: CaptionStyle): CaptionStyleChange {
  const { height: _height, across: _across, pcFont, ...look } = style
  return { ...look, pcFont: pcFont ?? null }
}

/** The caption style put on every sequence's captions, each keeping where its captions sit. */
export function captionStyleEverywhere(p: Project, change: CaptionStyleChange): Project {
  return p.sequences.reduce((q, s) => editSequence(q, s.id, (t) => setCaptionStyle(t, change)), p)
}

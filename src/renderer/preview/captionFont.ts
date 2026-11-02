import { CAPTION_FONTS } from '../../shared/caption-fonts'
import { TEXT_FONTS } from '../../shared/popular-fonts'

/**
 * Every font file the app ships, as the window's assets have it, by file
 * name: found from the folder rather than listed by hand beside
 * CAPTION_FONTS, so a font added there is loaded here too (audit 2026-10-01).
 */
const URLS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob('../../../resources/fonts/*.ttf', { query: '?url', import: 'default', eager: true })).map(([path, url]) => [
    path.split('/').pop() ?? path,
    url
  ])
)

/** The same for the fonts only texts use (task 1087), kept apart so the export does not copy them. */
const TEXT_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob('../../../resources/text-fonts/*.ttf', { query: '?url', import: 'default', eager: true })).map(([path, url]) => [
    path.split('/').pop() ?? path,
    url
  ])
)

/**
 * The fonts captions can be drawn in, bundled with the app so the Output view
 * and the export look the same. Loaded once, when the window starts; until one
 * is here the preview draws captions in a stand-in, and draws them again after.
 * Texts can use them too.
 */
export function loadCaptionFont(): void {
  if (typeof FontFace === 'undefined') return
  for (const font of CAPTION_FONTS) {
    const url = URLS[font.file]
    if (!url) continue
    // Quoted: an install folder such as "Program Files (x86)" has brackets in its address.
    const face = new FontFace(font.family, `url("${url}")`)
    document.fonts.add(face)
    void face.load().catch(() => undefined)
  }
  // The fonts texts can be drawn in (task 1087), each read only once a text asks for it.
  for (const font of TEXT_FONTS) {
    const url = TEXT_URLS[font.file]
    if (url) document.fonts.add(new FontFace(font.family, `url("${url}")`))
  }
}

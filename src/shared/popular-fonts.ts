/**
 * Task 1087: popular free fonts the app brings for texts, besides the caption
 * fonts, so a text looks the same on any computer. A text is drawn in the
 * window and kept as a picture, so the export needs nothing more than the
 * window having the font. Each by its family name and its file in
 * resources/text-fonts; their licences are in resources/licences.
 */
export const TEXT_FONTS: readonly { family: string; file: string }[] = [
  'Archivo Black',
  'Barlow',
  'DM Sans',
  'Dancing Script',
  'Fira Sans',
  'Inter',
  'JetBrains Mono',
  'Lato',
  'Lobster',
  'Merriweather',
  'Noto Sans',
  'Nunito',
  'Open Sans',
  'Oswald',
  'PT Serif',
  'Pacifico',
  'Permanent Marker',
  'Playfair Display',
  'Quicksand',
  'Raleway',
  'Roboto',
  'Roboto Slab',
  'Rubik',
  'Source Sans 3',
  'Space Grotesk',
  'Work Sans'
].map((family) => ({ family, file: `${family.replace(/ /g, '')}-Regular.ttf` }))

/**
 * The fonts on this PC the font lists offer, after the ones that come with
 * the app. Every font installed was too many: a PC with a language pack has
 * dozens of one script's fonts, and finding a title font among them was slow.
 * These are the common ones Windows and the Mac have, and a font a text or a
 * caption already uses is still shown for it.
 */
export const POPULAR_PC_FONTS: readonly string[] = [
  'Arial',
  'Arial Black',
  'Avenir Next',
  'Calibri',
  'Cambria',
  'Comic Sans MS',
  'Consolas',
  'Courier New',
  'Georgia',
  'Helvetica',
  'Helvetica Neue',
  'Impact',
  'Menlo',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana'
]

/** Of the families on this PC, the popular ones, each once and in alphabetical order, named as the PC names it. */
export function popularOf(families: readonly string[]): string[] {
  const wanted = new Set(POPULAR_PC_FONTS.map((f) => f.toLowerCase()))
  const found = new Map<string, string>()
  for (const family of families) {
    const key = family.toLowerCase()
    if (wanted.has(key) && !found.has(key)) found.set(key, family)
  }
  return [...found.values()].sort((a, b) => a.localeCompare(b))
}

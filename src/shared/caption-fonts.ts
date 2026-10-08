/**
 * Plan 76: the fonts captions can be drawn in, bundled with the app so the
 * Output view and the export draw the same letters, and so a project opened on
 * another computer has them. Each with what the layout needs to break a
 * caption's lines the same way in both: its family name as libass finds it,
 * how wide each character is, and the heights libass and a canvas size it by.
 *
 * The figures are read from each font file by `scripts/font-metrics.mjs`,
 * which gives exactly the figures Montserrat had here by hand before.
 */
export interface CaptionFont {
  id: string
  /** What it is called in the font list. */
  label: string
  /** The font's own family name, which libass and the canvas find it by. */
  family: string
  /** Its file, in the app's fonts folder. */
  file: string
  /** The height of its capitals, in ems. */
  capHeight: number
  /** libass sizes a font so its Windows ascent and descent together are the size asked for: this many ems. */
  assSizePerEm: number
  /** Below the baseline to the bottom of libass's line box, in ems. */
  assDescent: number
  /** A character not in `advance` is taken to be as wide as its average capital, in thousandths of an em. */
  averageAdvance: number
  /** How wide each character is, in thousandths of an em. */
  advance: Record<string, number>
}

export const CAPTION_FONTS: readonly CaptionFont[] = [
  {
    id: 'montserrat',
    label: 'Montserrat ExtraBold',
    family: 'Montserrat ExtraBold',
    file: 'Montserrat-ExtraBold.ttf',
    capHeight: 0.7,
    assSizePerEm: 1.562,
    assDescent: 0.453,
    averageAdvance: 743,
    advance: {
      '0': 685, '1': 405, '2': 599, '3': 603, '4': 700, '5': 607, '6': 649, '7': 632, '8': 669, '9': 649,
      ' ': 291, '!': 301, '"': 462, '#': 730, $: 647, '%': 897, '&': 752, "'": 242, '(': 369, ')': 369,
      '*': 453, '+': 609, ',': 283, '-': 388, '.': 283, '/': 415, ':': 283, ';': 283, '<': 609, '=': 609,
      '>': 609, '?': 597, '@': 1036, A: 786, B: 769, C: 730, D: 826, E: 672, F: 642, G: 770, H: 806,
      I: 339, J: 557, K: 752, L: 610, M: 954, N: 806, O: 846, P: 737, Q: 846, R: 740, S: 647, T: 635,
      U: 786, V: 766, W: 1184, X: 737, Y: 693, Z: 679, '[': 389, '\\': 415, ']': 389, '^': 610, _: 500,
      '`': 600, a: 628, b: 695, c: 603, d: 698, e: 642, f: 406, g: 705, h: 696, i: 313, j: 320, k: 677,
      l: 313, m: 1045, n: 696, o: 666, p: 695, q: 695, r: 443, s: 547, t: 447, u: 692, v: 620, w: 956,
      x: 619, y: 620, z: 556, '{': 414, '|': 314, '}': 414, '~': 609, '\u2019': 283, '\u2018': 283,
      '\u201c': 545, '\u201d': 545, '\u2026': 858, '\u2014': 1000
    }
  },
  {
    id: 'anton',
    label: 'Anton',
    family: 'Anton',
    file: 'Anton-Regular.ttf',
    capHeight: 0.859,
    assSizePerEm: 1.733,
    assDescent: 0.329,
    averageAdvance: 474,
    advance: {
      '0': 494, '1': 331, '2': 494, '3': 494, '4': 494, '5': 494, '6': 494, '7': 494, '8': 494, '9': 494,
      ' ': 234, '!': 229, '"': 429, '#': 546, $: 462, '%': 1057, '&': 520, "'": 214, '(': 291, ')': 291,
      '*': 452, '+': 355, ',': 236, '-': 311, '.': 229, '/': 405, ':': 242, ';': 245, '<': 321, '=': 311,
      '>': 321, '?': 492, '@': 864, A: 485, B: 479, C: 474, D: 493, E: 412, F: 399, G: 485, H: 499, I: 227,
      J: 466, K: 472, L: 397, M: 746, N: 498, O: 486, P: 472, Q: 494, R: 477, S: 461, T: 396, U: 474,
      V: 469, W: 712, X: 484, Y: 446, Z: 410, '[': 318, '\\': 405, ']': 318, '^': 474, _: 365, '`': 317,
      a: 483, b: 501, c: 491, d: 498, e: 488, f: 280, g: 504, h: 505, i: 243, j: 263, k: 491, l: 248,
      m: 758, n: 499, o: 497, p: 501, q: 498, r: 347, s: 475, t: 305, u: 499, v: 461, w: 696, x: 459,
      y: 461, z: 386, '{': 340, '|': 216, '}': 340, '~': 493, '\u2019': 232, '\u2018': 235, '\u201c': 464,
      '\u201d': 463, '\u2026': 708, '\u2014': 563
    }
  },
  {
    id: 'bebas',
    label: 'Bebas Neue',
    family: 'Bebas Neue',
    file: 'BebasNeue-Regular.ttf',
    capHeight: 0.7,
    assSizePerEm: 1.3,
    assDescent: 0.35,
    averageAdvance: 389,
    advance: {
      '0': 400, '1': 400, '2': 400, '3': 400, '4': 400, '5': 400, '6': 400, '7': 400, '8': 400, '9': 400,
      ' ': 160, '!': 210, '"': 336, '#': 412, $: 400, '%': 589, '&': 417, "'": 188, '(': 276, ')': 276,
      '*': 422, '+': 400, ',': 188, '-': 270, '.': 188, '/': 389, ':': 188, ';': 188, '<': 400, '=': 400,
      '>': 400, '?': 363, '@': 696, A: 401, B: 404, C: 383, D: 406, E: 363, F: 344, G: 391, H: 420, I: 192,
      J: 265, K: 414, L: 344, M: 538, N: 427, O: 400, P: 386, Q: 400, R: 403, S: 372, T: 364, U: 402,
      V: 382, W: 557, X: 406, Y: 394, Z: 362, '[': 276, '\\': 389, ']': 276, '^': 400, _: 300, '`': 500,
      a: 401, b: 404, c: 383, d: 406, e: 363, f: 344, g: 391, h: 420, i: 192, j: 265, k: 414, l: 344,
      m: 538, n: 427, o: 400, p: 386, q: 400, r: 403, s: 372, t: 364, u: 402, v: 382, w: 557, x: 406,
      y: 394, z: 362, '{': 276, '|': 500, '}': 276, '~': 400, '\u2019': 188, '\u2018': 188, '\u201c': 336,
      '\u201d': 336, '\u2026': 500, '\u2014': 500
    }
  },
  {
    id: 'poppins',
    label: 'Poppins Black',
    family: 'Poppins Black',
    file: 'Poppins-Black.ttf',
    capHeight: 0.713,
    assSizePerEm: 1.762,
    assDescent: 0.627,
    averageAdvance: 705,
    advance: {
      '0': 662, '1': 399, '2': 566, '3': 615, '4': 704, '5': 660, '6': 633, '7': 512, '8': 657, '9': 597,
      ' ': 170, '!': 455, '"': 490, '#': 933, $: 665, '%': 938, '&': 831, "'": 265, '(': 463, ')': 463,
      '*': 561, '+': 551, ',': 342, '-': 576, '.': 319, '/': 399, ':': 319, ';': 385, '<': 497, '=': 626,
      '>': 497, '?': 538, '@': 1129, A: 773, B: 684, C: 753, D: 743, E: 556, F: 575, G: 752, H: 755,
      I: 322, J: 590, K: 755, L: 506, M: 951, N: 779, O: 788, P: 649, Q: 788, R: 670, S: 625, T: 616,
      U: 719, V: 763, W: 1100, X: 764, Y: 730, Z: 630, '[': 533, '\\': 878, ']': 533, '^': 758, _: 764,
      '`': 324, a: 680, b: 680, c: 609, d: 680, e: 616, f: 385, g: 680, h: 697, i: 322, j: 320, k: 676,
      l: 322, m: 1076, n: 697, o: 636, p: 680, q: 680, r: 467, s: 579, t: 436, u: 697, v: 671, w: 903,
      x: 668, y: 677, z: 518, '{': 484, '|': 262, '}': 484, '~': 711, '\u2019': 378, '\u2018': 378,
      '\u201c': 648, '\u201d': 648, '\u2026': 869, '\u2014': 936
    }
  }
]

/** Montserrat ExtraBold, which captions have always been drawn in. */
export const DEFAULT_CAPTION_FONT = 'montserrat'

/** A caption font by its id, or the default for one this build does not have. */
export function captionFont(id: string | undefined): CaptionFont {
  return CAPTION_FONTS.find((f) => f.id === id) ?? CAPTION_FONTS[0]!
}

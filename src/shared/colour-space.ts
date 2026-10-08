/**
 * Whether a video's colours were made by the older SD matrix, BT.601, from
 * the matrix its file names. ffmpeg names it two ways, by the 525 and the 625
 * line systems; both use the same matrix. A file that names none is not
 * taken as BT.601: the app reads such files as BT.709 throughout.
 */
export function isBt601(colorSpace: string | null | undefined): boolean {
  return colorSpace === 'smpte170m' || colorSpace === 'bt470bg'
}

/** The filter that turns BT.601 colours into BT.709 ones, keeping them at video range. */
export const BT601_TO_709 = 'scale=in_color_matrix=bt601:out_color_matrix=bt709:in_range=tv:out_range=tv'

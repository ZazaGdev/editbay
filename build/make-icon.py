"""
Editbay's icon: a 9:16 frame cut in two, the halves pulled apart in opposite
directions.

The mark says the two things the app is for, in one shape. The 9:16 outline is
what it makes. The gap through the middle is what it does to get there.

Run this only when the icon changes. Its output is committed, so nobody needs
Python to build or run Editbay.

    python build/make-icon.py

Needs Pillow. Writes build/icon.ico, which electron-builder picks up from
buildResources, and build/icon.png for the README and anywhere else a flat
image is wanted, and build/icon.icns for the Mac.

Every measurement below is on a 1024 canvas. The gap is deliberately wide: at
10% of the canvas it survives down to a legible line at 16 pixels, where a
narrower one turns into a smudge and the mark reads as a single bar.
"""

from PIL import Image, ImageDraw

CANVAS = 1024

# The window's own colours, from src/renderer/theme.ts, so the icon in the
# taskbar and the window it opens are the same object.
CANVAS_TOP = (18, 21, 26)  # surface.panel
CANVAS_BOTTOM = (11, 13, 16)  # surface.canvas
MARK_TOP = (111, 163, 255)  # accent.bright
MARK_BOTTOM = (76, 141, 245)  # accent.base

TILE_RADIUS = 224

# The mark. 470 by 836 is 9:16, and it fills four fifths of the tile, because
# the whole point of the shape is the proportion and a timid one does not read.
MARK_W = 470
MARK_H = 836
PIECE_RADIUS = 56
# The cut sits above the middle rather than on it. An even split gives two
# squarish blocks and the 9:16 disappears; an uneven one keeps a tall piece
# that still reads as a vertical frame, with a slice taken off the top.
TOP_H = 318
# How far each piece slides away from the centre line. Kept small on purpose:
# far enough to say the pieces moved, near enough that they stay one object.
OFFSET = 28
# Narrow on purpose: a kerf, not a chasm. Wide enough and the eye stops seeing
# one frame that has been cut and starts seeing two separate blocks, which is
# the mistake the first two attempts at this icon both made.
GAP = 40

# At and below this size none of that survives. A sub-pixel offset only blurs
# the edges and a sub-pixel gap closes up in the reduction, leaving a single
# bar. So the small sizes get their own drawing: no offset, and a gap wide
# enough to still be a gap after the reduction.
SMALL = 32
SMALL_GAP = 110

# Rendered at this multiple of the final size and then reduced, which is where
# the smooth edges come from.
SUPERSAMPLE = 4


def vertical_gradient(size: int, top: tuple, bottom: tuple) -> Image.Image:
    """A square of colour running from `top` to `bottom`."""
    strip = Image.new('RGB', (1, size))
    px = strip.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        px[0, y] = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
    return strip.resize((size, size), Image.Resampling.NEAREST)


def render(size: int) -> Image.Image:
    """The icon at `size` pixels, drawn large and reduced."""
    big = size * SUPERSAMPLE
    k = big / CANVAS

    def s(v: float) -> float:
        return v * k

    tile_mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(tile_mask).rounded_rectangle(
        (0, 0, big - 1, big - 1), radius=s(TILE_RADIUS), fill=255
    )

    icon = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    icon.paste(vertical_gradient(big, CANVAS_TOP, CANVAS_BOTTOM).convert('RGBA'), (0, 0), tile_mask)

    gap = SMALL_GAP if size <= SMALL else GAP
    offset = 0 if size <= SMALL else OFFSET
    # The slice keeps its height and the tall piece gives up whatever the wider
    # gap needs, so the mark stays the same height at every size.
    bottom_h = MARK_H - TOP_H - gap

    left = (CANVAS - MARK_W) / 2
    top = (CANVAS - MARK_H) / 2

    mark_mask = Image.new('L', (big, big), 0)
    pen = ImageDraw.Draw(mark_mask)
    # Upper piece slides left, lower slides right, so the cut reads as two
    # pieces that have been moved rather than one shape with a line drawn on it.
    #
    # Only the outer corners are rounded. The two edges either side of the cut
    # are left square, because that is what makes the mark read as one frame
    # that has been sliced rather than as two blocks that happen to be stacked.
    # Corners run top-left, top-right, bottom-right, bottom-left.
    for y0, h, dx, corners in (
        (top, TOP_H, -offset, (True, True, False, False)),
        (top + TOP_H + gap, bottom_h, offset, (False, False, True, True)),
    ):
        pen.rounded_rectangle(
            (s(left + dx), s(y0), s(left + dx + MARK_W) - 1, s(y0 + h) - 1),
            radius=s(PIECE_RADIUS),
            corners=corners,
            fill=255,
        )

    icon.paste(vertical_gradient(big, MARK_TOP, MARK_BOTTOM).convert('RGBA'), (0, 0), mark_mask)
    return icon.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    here = __file__.rsplit('make-icon.py', 1)[0]
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [render(n) for n in sizes]

    # Pillow builds the whole .ico from one image and a size list, but it
    # reduces that one image for every entry. Each size is drawn on its own
    # here instead, so 16 is not a squashed 256.
    frames[-1].save(here + 'icon.ico', format='ICO', sizes=[(n, n) for n in sizes],
                    append_images=frames[:-1])

    render(1024).save(here + 'icon.png', format='PNG')
    # The Mac's icon (plan 104): Pillow writes every size a .icns holds from the 1024 one.
    render(1024).save(here + 'icon.icns', format='ICNS')
    print('wrote build/icon.ico (' + ', '.join(str(n) for n in sizes) + '), build/icon.png and build/icon.icns')


if __name__ == '__main__':
    main()

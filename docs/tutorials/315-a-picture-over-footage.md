---
title: Put an image over the footage
category: Layers
keywords: image, png, jpg, gif, animated, logo, meme, sticker, watermark, still, photo, overlay, rotate, turn, opacity, transparent
---

Put a logo, a meme or any image over your video.

## Steps

1. Put the footage on V1. {show: timeline-tracks}
2. Drag the image from the Source bin onto the dashed lane above V1. {show: new-track-lane}
3. Trim either edge of its clip to the length you want. {show: clip on:overlay}
4. Press `V` for the Output view, then drag the image's box to move it, or a corner to resize it. {show: monitor-picture or:monitor-view on:overlay "Press V for the Output view, then drag the image"}
5. Drag the round handle above it to turn it.

## Details

PNG, JPEG, WebP, BMP and GIF files come in like any recording: drop them in the window and they
land in the Source bin, described as an image with its size. An animated GIF plays, looping, for
as long as its clip runs.

Dropping on the dashed lane makes V2, and whatever is on V2 is drawn over V1. The image lands
**five seconds long**, whole, fitted inside the frame. Trim it as far as you like: an image has
no length of its own to run out of.

You can move it partly off the frame. Turning snaps to a quarter turn, and `Shift` turns it
freely. [Opacity] in the Inspector makes it see-through. To have it pop or fade in, see Make it
pop or fade in.

**Transparent parts stay transparent.** A PNG logo or a cut-out meme shows the footage around
it, in the preview and in the export alike. On V1 with nothing under it, those parts are black.

---
title: Put one recording over another
category: Layers
keywords: overlay, facecam, on top, v2, second track, composite, stack, corner, small picture
---

Show a second recording over the first, such as a facecam in a corner of your game.

## Steps

1. Put the background recording on V1 the usual way. {show: timeline-tracks}
2. Drag the second recording from the Source bin onto the dashed lane above V1. {show: new-track-lane}
3. Select the new clip on V2, and drag the box on the Source view to choose the part you want. {show: clip on:above}
4. In the Inspector's [Picture in picture] section, tick [On]. {show: pip-on on:above}
5. Drag it on the Output view to the corner you want. {show: monitor-picture or:monitor-view on:video "Drag it on the Output view"}

## Details

Video tracks stack. **V1 is the bottom one** and everything above it is drawn over it, so
putting one recording over another means getting it onto a track above V1. Dropping on the
dashed lane creates V2.

With the V2 clip selected, the Source view shows that recording with a box over it. Only the
part inside the box is used.

[On] puts it in a corner over V1. The same section sets the corner, its size, how far in from
the edges it sits, its shape, a border and a shadow; see Set up picture in picture. The same
controls are on a small toolbar beside it on the Output view (`V`).

Drag it on the Output view to put it anywhere: the corners it can go to show as you drag, and
let go near one and it snaps there. [Same for every clip of this recording] gives a run of cuts
the same picture in picture.

If you do not want its sound, mute its audio track or set the clip's volume to zero.

To have it step aside for a moment, see Move the small picture out of the way.

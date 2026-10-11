---
title: Zoom with keyframes
category: Framing
keywords: zoom, keyframe, diamond, alt+k, add more points, ease, starts slowly, ends slowly, jump, strip, scale, move a keyframe
---

Zoom with as many points in a clip as you like, each easing into the next.

## Steps

1. Select a clip, open [Zoom] in the inspector and press [Keyframes]. {show: zoom-mode on:video "Choose Keyframes here"}
2. Put the playhead where the zoom should start and press [Add keyframe], or `Alt+K`. {show: zoom-key or:zoom-mode on:video "Choose Keyframes here, then press Add keyframe"}
3. Move the playhead on and type a new [Scale %]. A second keyframe is made there.
4. With the playhead between the two, choose how it gets to the next in [To the next keyframe]: [Smooth] glides, [Jump] cuts. {show: zoom-ease-select or:zoom-key on:video "Add a second keyframe first, then put the playhead between them"}

## Details

[Keyframes], or [Add more points] under a Simple zoom, turns Start and End into two keyframes, so
nothing on screen changes. `Alt+K` on a Simple clip does it too. The picture eases from each
keyframe to the next, Smoothly unless you choose otherwise. If the picture jumps rather than
moves, the keyframe before has [Jump]: a Punch in, and a cut zoom from an edit list, make those.
Once you have put or picked a keyframe here, dragging the crop box or typing the Crop numbers
makes a keyframe at the playhead as well. With none picked, they only crop, and every keyframe
moves with the crop.

The strip under the numbers shows the clip with a diamond for each keyframe. Click one to go to
it, drag it to move it, press `Delete` to remove it, or right click for [Smooth], [Steady],
[Starts slowly], [Ends slowly] or [Jump]. `Alt+[` and `Alt+]` step between them.

The same diamonds sit on the clip on the timeline: see Zoom keyframes on the timeline.

Keyframes stay on the recording's frames, so a split or a trim leaves every zoom where it was on
the picture.

Going back to [Simple] keeps the first frame's picture as Start and the last's as End. When
keyframes in between would go, it asks first, and Undo brings them back.

---
title: Move the small picture out of the way
category: Layers
keywords: pip, facecam, move out of the way, step aside, hide for a moment, animate, keyframe, slide, fade, corner
---

Let a small picture step aside when it covers something, and come back, without a cut.

## Steps

1. Mark In and Out around the moment with `Shift+I` and `Shift+O`.
2. Select the small picture on the Output view. {show: monitor-picture or:monitor-view on:video "Select the small picture on the Output view"}
3. On its toolbar, press [Move out of the way and back]. {show: monitor-picture or:monitor-view on:video "Select the small picture here, then press Move out of the way and back on its toolbar"}
4. Choose [Slide] or [Fade].

## Details

[Slide] sends it to the free corner beside it in a quarter of a second and brings it back the
same way. [Fade] makes it disappear where it is and reappear. With nothing marked, it stays away
for a second and a half from the playhead.

The same two are in the clip's right click menu under [Framing], as [Move the box out of the
way] and [Fade the box out of the way].

**It is done with keyframes, so you can shape it by hand.** The box's keyframes are the same
diamonds as the zoom's, on the clip and in the Zoom strip: click one to go to it, drag it to
move it, right click for how it gets to the next, `Delete` to take it off.

Once the box has keyframes, dragging it on the Output view moves it on the frame under the
playhead and makes a keyframe there. Put the playhead anywhere and drag the box to where it
should be then; its size changes the same way. `Alt+K` on the small picture pins the box where
it is, which is how to start one by hand. The export draws it exactly where the Output view
does.

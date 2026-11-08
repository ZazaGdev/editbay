---
title: Tracks: add, name and stack
category: Timeline
keywords: v1, a1, rename, facecam, music, more tracks, order, add track, new track, add video track, add audio track, hide, mute, solo, lock, track settings, inspector, reorder, drag track, move track, captions order, captions under video
---

Add video and audio tracks, and name them so you know which is which.

## Steps

1. Press [Video] beside the ruler, above the track names, for a new video track on top. {show: add-video-track}
2. Or press [Audio] beside it for a new audio track at the bottom. {show: add-audio-track}
3. To name a track, open its menu and choose [Rename track]. {show: track-menu-open "Press this, then choose Rename track"}
4. Or click the track's header, away from its buttons, and type its name in the Inspector. {show: track-header}
5. To change the order, drag a track's header up or down and let go where the line shows. The Captions header drags the same way. {show: track-header}

## Details

**V1** is the bottom video track and everything above it is drawn over it. **A1** downwards are
the audio tracks. A track dragged by its header takes its clips with it, and moves among the tracks
of its own kind: a video track among the video tracks, an audio track among the audio ones. The
**Captions** track moves among the video tracks too: drag it below V2 and V2's picture is drawn over
the captions, in the Output view and the export. Under V1 a recording covers them, since it fills
the frame. A
track you have named keeps its name; one you have not takes the number of its new place, so the
bottom video track is always V1. Escape during the drag leaves it where it was. `Ctrl+Shift+V` and `Ctrl+Shift+A` add a video track and an audio track as the
buttons do, and both are in the `Ctrl+K` search.

Each track header has a menu, and a track can be **renamed**. V1 can be called Facecam and A2 can
be Music. On a sequence with six tracks this is the difference between knowing where you are and
guessing.

A video track can be hidden, which removes it from the Output view and the export. An audio
track can be muted, soloed or locked.

A track header clicked anywhere but on its buttons shows that track in the Inspector, with the
same settings its header has: its name, Lock, and Hide for a video track or Mute, Solo and Duck
for an audio one. The Captions header shows the caption track, with a button for how captions
look.

Tracks are part of the sequence, so their order, names, mutes and locks are all saved with the
project and all undo.

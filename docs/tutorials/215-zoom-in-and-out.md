---
title: Zoom in and out during a clip
category: Framing
keywords: zoom, scale, push in, ken burns, ease, start, end, simple, zoom out, swap, gets there, smooth, steady, no move, 125%, 150%, 200%
---

Make a clip move from one framing to another, from its first frame to its last.

## Steps

1. Select a clip, then open [Zoom] in the inspector. It starts on [Simple]. {show: clip on:video "Select this clip, then open Zoom in the inspector"}
2. Press [Start] and frame it: type [Scale %], [X] and [Y], or drag the crop box. {show: zoom-start or:zoom-mode on:video "Choose Simple here, then press Start"}
3. Press [End] and frame it closer, or further out. {show: zoom-end or:zoom-mode on:video "Choose Simple here, then press End"}
4. Choose how it [Gets there]: [Smooth], [Steady] or [Cut]. {show: zoom-ease or:zoom-mode on:video "Choose Simple here, then choose under Gets there"}

## Details

[Scale %] says how close in the picture is, 100% being the most of the recording the frame can
show. [X] and [Y] are the middle of what is shown, in the recording's pixels. The switch at the
top chooses [Simple] or [Keyframes].

Simple is two pictures. Start shows on the clip's first frame and End on its last, and the
picture moves from one to the other. Choosing one sends the playhead to its frame, and the Source
view names the crop box Start or End, with the other drawn dashed.

A new clip stays still: End is the same as Start. [Zoom in to 150%] and [Zoom out from 150%] start
you off, as far as [How far] says (125%, 150% or 200%). [Cut] stays on Start and jumps to End
halfway. [Swap] turns a zoom in into a zoom out, and [No move] makes the clip still again.

Start and End always sit on the clip's ends, so trimming the clip stretches or squeezes the move
to fit. Splitting it gives each piece its own move, from where the picture was at the cut. On
the timeline a Simple zoom shows as two diamonds, at the clip's two ends.

For more than two points, see Zoom with keyframes.

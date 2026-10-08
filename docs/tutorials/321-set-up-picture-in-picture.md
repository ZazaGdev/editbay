---
title: Set up picture in picture
category: Layers
keywords: pip, corner, square camera, tall, wide, box shape, width, height, circle, round camera, facecam, margin, snap, rounded corners, border, shadow, small picture
---

Choose the small picture's corner, size, shape, border and shadow.

## Steps

1. Select a clip with a small picture. {show: clip on:video}
2. Open the Inspector's [Picture in picture] section, under Frame. {show: pip-section or:layout on:video "Press Picture in picture here first"}
3. Set [Where], [Size], [Box] and [Shape].
4. Or select the small picture on the Output view and use the toolbar beside it. {show: monitor-picture or:monitor-view on:video "Select the small picture on the Output view"}

## Details

The section is there however the clip got a small picture: an OBS canvas with two views, or a
recording on a track over another.

| Setting | What it does |
|---|---|
| [Small picture] | Which view of a two-view recording is the small one, Right or Left |
| [Where] | A corner. It says Custom once you have dragged it elsewhere |
| [Size] | Its width as a share of the frame's; it keeps its corner as it grows |
| [Box] | Square, Tall (9 by 16), Wide (16 by 9), As recorded, or a width and height in pixels |
| [Margin] | How far in from the frame's edges a corner sits |
| [Shape] | Square, Rounded or Circle, a round box for a camera |
| [Border], [Shadow] | A border with its width and colour, and a shadow |

You can also drag a side of the box on the Output view. The picture fills the box, cropped
rather than stretched, so a camera in a square box shows its middle; move the crop to frame it.
Border and shadow show exactly as they are exported.

The toolbar has the same: corners, smaller and larger, shape, border and shadow. Dragged, it
snaps into a corner you let go right by; `Alt` lets it go anywhere, and [Snap] under the monitor
turns snapping off. Picking another clip keeps the small picture chosen when that clip has one,
so you can work down a row of cuts.

---
title: Output shapes
category: Framing
keywords: vertical, landscape, square, aspect ratio, 9:16, 1080p, resolution, handoff, default shape, new project
---

Choose the shape of a sequence: vertical, landscape, square or handoff.

## Steps

1. Open the shape list beside the sequence tabs. {show: export-preset}
2. Pick [Vertical 1080x1920], [Landscape 1920x1080], [Square 1080x1080] or [Handoff master]. {show: export-preset "Open this list, then pick a shape"}

## Details

The shape is chosen per sequence.

- Vertical, 1080x1920. For phones.
- Landscape, 1920x1080. The ordinary one.
- Square, 1080x1080.
- Handoff keeps the source resolution instead of scaling to a fixed size, and writes one file per
  clip. It is for feeding into another tool that will do its own scaling.

Social output never needs to exceed 1080p, which is why the first three are capped there. Source
resolution above 1080p is still worth having, because a vertical reframe throws most of the
width away and you want pixels to spare.

Changing a sequence's shape lays every crop out again for the new frame rather than leaving your
framing wrong.

A new project's first sequence starts on the shape you chose last, so if you always cut for
YouTube it opens as Landscape.

Saved layouts are in the same list. See Switch shape with a saved layout.

---
title: Remove a background
category: Framing
keywords: green screen, chroma key, blue screen, key, cutout, transparent, black background, white background, plain background, any colour, overlay, effect, tools
---

Take out a green screen, or any plain background, so the video track below shows through.

## Steps

1. Put the clip on a video track above the clip it should sit over. {show: clip on:video}
2. Right click it and choose [Tools], then [Remove background]. {show: clip on:video "Right click this clip, then choose Tools, then Remove background"}
3. If too much or too little goes, set [Strength] in [Tools] in the inspector. {show: remove-background-strength or:tools-section on:video "Strength shows here in Tools once the background is removed"}
4. To undo it, press [Keep the background].

## Details

It works on a green or blue screen, an effect on a black background, or anything standing on one
plain colour, such as a white or grey wall.

Editbay looks at the edges of the clip's first picture, works out which plain colour it stands
on, takes that colour out and tells you which one it found. The button then reads, for example,
[Removed green background] or [Removed white background]. When the edges are not one plain
colour, as in ordinary footage of a room, it says it cannot remove it and leaves the clip as it
was. The same button is in the [Tools] group of the inspector.

Turn [Strength] up to take out colours closer to the background too, or down if parts of the
subject are going see-through. On V1, with nothing under it, the background turns black. The
Output view shows the result exactly as the export writes it.

The key works on the background's colour alone, so a subject wearing the same colour goes
see-through too, and fine edges such as hair can come out hard. It is made for effects and clean
screens rather than cutting a person out of ordinary footage.

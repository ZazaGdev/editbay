---
title: Delete, and closing the gap
category: Cutting
keywords: remove, ripple, lift, gap, shift delete, tighten, pull up
---

Take a clip out, either leaving a gap or pulling everything after it up.

## Steps

1. Select the clip on the timeline. {show: clip on:picture}
2. Press `Delete` to take it out and leave a gap.
3. Or press `Shift+Delete` to take it out and close the gap up.

## Details

`Delete` takes the selection out and **leaves a gap** where it was. Everything else stays exactly
where it is, which is what you want when the timing of what follows matters. A clip's right click
menu has it too, as [Delete, leaving a gap].

`Shift+Delete` takes it out and **closes the gap up**, pulling everything after it earlier. This
is the one you want when you are tightening a cut down.

The difference matters more than it sounds. Closing up moves every later clip on every track, so
Editbay checks first: if something on another track cannot move cleanly, it refuses and names the
track in the way, rather than quietly leaving your picture and sound out of step.

The time taken out is what the clip's picture covered on V1. A sound that starts early under the
shot before, or runs on under the shot after, does not add to it, so a title over that other shot
stays where it was. When the next shot's sound starts early under the clip you take out, closing
up would run it over the shot before; Editbay refuses that rather than leaving black on V1.

Linked picture and sound always move together, so deleting a clip takes its audio with it.

Deleting leaves the playhead and the timeline where they were. The next clip along on the track is
selected, so pressing `Delete` again takes that one too.

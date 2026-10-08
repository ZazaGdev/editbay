---
title: Set a clip volume exactly
category: Sound
keywords: gain, loudness, level, slider, percent, type a number, 100%
---

Set a clip's volume to the exact percent you want, or put it back to 100%.

## Steps

1. Select the sound clip on the timeline. {show: sound-clip on:sound}
2. In the inspector's [Sound] group, type the figure into the box beside its slider. {show: linked-sound-level-typed on:sound}
3. Press `Enter`.
4. To go back to 100%, double click the slider.

## Details

The slider next to a volume runs from 0 to 400%. Across that range one pixel is nearly 5%, so it
is for finding roughly the right level rather than an exact one. Typing into the box is the
accurate way, and it is what the box is there for.

Both go through undo as a single step, including the double click reset, so putting a level back
never leaves you pressing `Ctrl+Z` twice to get where you were.

A clip above 100% really is louder, rather than everything else being made quieter to fake it.

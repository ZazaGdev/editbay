---
title: Shape and change a transition
category: Cutting
keywords: length, longer, shorter, slide, align, alignment, centre at cut, remove, held frame
---

Make a transition longer or shorter, slide it across the cut, change its kind or remove it.

## Steps

1. Drag either end of the transition to change how long it is. {show: transition-end on:transition}
2. Drag its body to slide it across the cut. {show: clip-transition on:transition}
3. Right click it for its kind, where it sits, and [Remove the transition]. {show: clip-transition on:transition "Right click the transition for its kind, where it sits, and Remove"}

## Details

A transition is drawn as a rounded rectangle straddling the cut, over both clips, with a handle
at each end. Sliding the body moves the transition without moving the cut itself. Each drag is
one undo, so putting one back never takes several presses.

The right click menu has three alignments under Where it sits: [Centre at cut], [End at cut]
and [Start at cut], meaning centred on the cut, ending at it, or starting from it.

Changing kind never removes and re-adds, so the length and position you set survive it. The kinds
are listed in Transition kinds.

**If there is no spare footage** either side of the cut, you still get a transition. It is filled
with a held frame and the app says so, rather than silently refusing or inventing movement that is
not in the recording.

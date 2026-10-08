---
title: Fix a word it got wrong
category: Captions
keywords: edit text, mistake, wrong word, correct, retype, accuracy
---

Correct a word the speech model misheard, without knocking the caption out of sync.

## Steps

1. Click the caption on the timeline. {show: caption on:caption}
2. Type the right words in the Inspector and press `Enter`. {show: caption-words on:caption}

## Details

Click a caption and edit its words. That is the whole thing.

Whisper gets words wrong, and more so under game sound and gunfire. **Fixing them by hand is
part of the job rather than a sign something is broken.** No speech model available today gets a
shouted line over an explosion right.

The word timings survive an edit, so correcting a word does not knock the caption out of sync
with the speech.

If a caption covers too much or too little, it can be split, trimmed and moved like any other
clip: see Retime and split captions.

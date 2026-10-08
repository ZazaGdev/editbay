---
title: The first time takes a while
category: Captions
keywords: download, model, 540mb, slow, first run, offline, one time, english
---

The speech model is downloaded once, the first time you make captions, then shared by every project.

## Steps

1. Press [Captions] in the top bar. {show: open-captions}
2. Press [Download] when it asks for the speech model.
3. Wait for it once. After that, captions start straight away.

## Details

The speech model is downloaded **once**, the first time you ask for captions, and is then shared
by every project on the machine.

It is about 540 MB, so the first time is slow. After that there is nothing to wait for and
nothing to download again. This is the only network request the application ever makes, apart
from the small program that runs the model, and both are checked against a fixed checksum before
anything runs them.

It is the **medium English model**. A smaller and faster one was used until 2026-09-24 and was
replaced because it missed short shouted lines under game audio. Expect roughly a third of real
time on a quiet machine.

English only. Another language will not produce anything useful.

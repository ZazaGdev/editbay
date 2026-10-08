---
title: Duck music under a voice
category: Sound
keywords: ducking, music, background, voice, lower, sidechain, auto volume, d
---

Bring music down automatically wherever someone is talking, and back up in the gaps.

## Steps

1. Put the music on an audio track of its own.
2. Press [D] on that track's header. {show: track-duck}

## Details

From then on the music comes down by 12 dB wherever anything is heard on the other tracks, and
comes back up in the gaps.

It eases down just before you start talking, so your first word is clear, and back up over half
a second once you stop. Pauses shorter than half a second keep it down, so it does not pump up
and down between words.

What counts as talking is everything heard on the tracks that do not duck. A track muted with
[M] is neither talking nor ducked. Solo does not change it, because solo is only for listening
and the export does not have it.

You hear it in the preview exactly as it will be exported: both work out where the voice is from
the same waveforms.

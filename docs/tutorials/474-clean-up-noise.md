---
title: Clean up a noisy microphone
category: Sound
keywords: noise reduction, denoise, hiss, hum, background noise, fan, mic, microphone
---

Take the hiss and hum out of a recording's sound.

## Steps

1. Select the sound clip on the timeline. {show: sound-clip on:sound}
2. In the inspector's [Sound] group, tick [Clean up noise]. {show: sound-clip-denoise on:sound}

## Details

Its hiss and hum are taken down, in the preview and in the export alike.

The first time, the app makes a cleaned copy of that recording's track in the background. It
learns what the noise sounds like from the quietest second of the track, where nobody is
talking, takes out everything below any voice, where hum and rumble live, and turns the rest of
the noise down. Until the copy is ready the clip plays as it was recorded and the inspector
says so; an export started meanwhile waits for it.

It works best on steady noise: a fan, an air conditioner, a hissing microphone. It works on
the clip you tick, so one take can be cleaned and the next left alone. Every clip of the same
track of the same recording shares the one cleaned copy, so ticking the rest costs nothing more.

With [Enhance voice] ticked too, the voice is enhanced from the cleaned copy, so the noise comes
out before anything makes the voice louder.

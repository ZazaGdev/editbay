---
title: Soften breaths and remove mouth clicks
category: Sound
keywords: breath, breathing, breaths, mouth clicks, lip smack, clicks, saliva, de-click, de-breath, voice, podcast, talking head
---

Turn down the breaths between phrases and take out mouth clicks in a talking recording.

## Steps

1. Select the sound clip on the timeline. {show: sound-clip on:sound}
2. In the inspector's [Sound] group, set [Breaths] to [Gentle] or [Strong]. {show: sound-clip-breaths on:sound}
3. Tick [Remove mouth clicks]. {show: sound-clip-clicks on:sound}

## Details

Clean up noise does not touch breaths or clicks, since it takes out steady noise such as hum and
hiss. These two switches do:

- Breaths between phrases are turned down, about 10 dB for Gentle and 20 dB for Strong, not cut
  out, which would sound unnatural. Words are left as they are. [Off] leaves them as recorded.
- Short clicks and lip smacks are taken out of the voice and filled in from the sound either side.

Both belong to the recording's track, not to one clip: a mic has the same breaths all the way
through. Set them from any clip that plays the track and every clip of it has them, and each
shows them. The inspector says so under the switches. Each change is one undo.

They are heard in the preview and in the export alike. The first time, the app makes a treated
copy of the track in the background, with Clean up noise and Enhance voice in the same pass if the
clip has those on, in the order a voice is treated: clicks, then noise, then breaths, then the
enhance. Until the copy is ready the clip plays without it and the inspector says so; an export
started meanwhile waits for it.

A very quiet start or end of a word, such as a soft "s", can come down a little with the breaths.
If it does, try Gentle before Strong. To get fewer of them in the first place, see Record fewer
breaths and clicks.

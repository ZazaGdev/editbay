---
title: Keep a face in frame
category: Framing
keywords: follow face, centre on face, center face, picture in picture face, auto reframe, reframe, track, tracking, face tracking, vertical, 9:16, short, talking head, pan, keep in frame
---

Have the crop follow a face, so someone who moves stays in a narrow vertical frame.

## Steps

1. Select the clip on the timeline. {show: clip on:video}
2. With more than one person in it, drag the crop roughly over the one you want. {show: monitor-view on:video "Drag the crop over the person on the Source view"}
3. To be closer on the face, set [Scale %] first.
4. Open [Zoom] in the inspector and press [Follow face]. {show: follow-face on:video}

## Details

It is made for cutting a wide recording down to a vertical short, where the crop is a narrow
strip and someone who moves walks out of it.

Editbay looks through the clip for the face, on this PC, with nothing sent anywhere. A minute of
video takes a few seconds. Then it puts zoom keyframes on the clip that keep the face in the
crop.

The crop keeps the size it has, so only its position follows the face. It stays still while the
face is near its middle and makes one smooth pan when the face moves off to one side, so you get
a few calm moves rather than a picture that shakes. A face that is lost for a moment, turned away
or covered, leaves the crop where it was. It follows the face the crop is already on, and
someone walking past does not take the crop.

What it makes are ordinary keyframes, so the Zoom group switches to [Keyframes] and you can drag,
delete or ease any of them as in Zoom with keyframes. One `Ctrl+Z` takes the whole thing back.

When the clip has no face it can find, it says so and changes nothing.

## Centre on face

For a round picture in picture of you at a desk, where the face should sit in the middle of the
circle all the way through, choose that picture in the inspector (Picture 2, say), open [Zoom]
and press [Centre on face]. {show: centre-face on:video}

It goes through every clip on the timeline that has that picture, finds where the face mostly is
in each, and moves the crop so the face is in its middle. Each clip gets one still place, with no
keyframes, so the circle never pans. The crop keeps its size. A clip where no face is found is left
as it is, and the message says how many. One `Ctrl+Z` puts every clip back.

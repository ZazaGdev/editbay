# The edit list

What `npm run --silent cli -- build` reads: a plain JSON file describing a rough cut, written by a
person or an agent. The tool turns it into an `.editbay` project with Editbay's own editing
code, so the project is one the app could have made by hand.

A list comes in two forms. **Version 2** holds **reels**: several main recordings laid one
after another, such as an episode recorded as three OBS files. **Version 1** is the short way
of writing a single reel, with its fields at the top level. Both are read by the same code
and refused by the same rules.

All times in a reel are in **seconds of that reel's main source's own clock**. The tool turns
them into frames and lays the kept parts end to end on the timeline, reel after reel.

## Version 2: reels and shots

```json
{
  "version": 2,
  "shape": "landscape",
  "reels": [
    {
      "sources": [
        { "id": "a", "path": "D:/OBS-recordings/2026-09-24 00-52-32.mkv", "offsetSec": 0 },
        { "id": "a-cam", "path": "D:/OBS-recordings/2026-09-24 00-52-32.mkv", "offsetSec": 0 }
      ],
      "main": "a", "sound": "a", "soundTrack": 3, "view": "left",
      "corner": { "source": "a-cam", "at": "bottom-right", "view": "right" },
      "cuts": [], "zooms": [], "markers": []
    },
    {
      "sources": [{ "id": "a", "path": "D:/OBS-recordings/2026-09-24 01-42-47.mkv", "offsetSec": 0 }],
      "main": "a", "sound": "a", "soundTrack": 3, "view": "left",
      "cuts": [], "zooms": [], "markers": [],
      "shots": [
        { "fromSec": 40.2, "toSec": 49.9, "view": "right", "why": "closing lines to camera", "mark": true }
      ]
    }
  ]
}
```

- `reels`: at least one, laid end to end in the order given. Each holds the fields of a
  version 1 list below, except `version` and `shape`, with the same meaning and the same
  refusals, and may add `shots`. Source ids belong to their reel, so two reels may both call
  their recording `a`. A refusal inside a reel names it: `reels[1].cuts[0]: ...`.
- `shots` (optional, version 2 only): a change of framing for a stretch of the reel, on its
  main recording's clock. `fromSec`, `toSec`, `why` (text), and at least one of `view`
  (`left`, `right` or `split`, as the reel's `view`, needs a side-by-side main recording;
  a full-camera hook in a split Short is a shot with `view: "right"`) and `corner`
  (`false` hides the reel's corner for the shot; a reel without a corner is refused one).
  `mark` puts a marker where the shot starts, named "Shot: why". Outside every shot the
  reel's own `view` and `corner` hold. Shots may not overlap each other, a shot wholly inside
  cuts or outside the range is refused, and a zoom may not cross a shot's edge (refused,
  naming both). A zoom inside a shot with a `view` reads its `rect` in fractions of the
  shot's half.
- The picture, the sound and the corner are cut at a shot's edges together, as the app's
  own Cut at playhead cuts every track, so each piece stays linked to its sound.

`build` prints where each reel starts and ends in the cut (`reels`, in seconds of the cut),
and for every piece of picture which reel it came from, so times can be given in the cut. Its
`cuts` lists every stretch taken out, by reel, in its reel's main source's seconds, with its
`why` and its `words`.

## Version 1: one reel

```json
{
  "version": 1,
  "shape": "landscape",
  "sources": [
    { "id": "screen", "path": "D:/OBS-recordings/2026-10-01 10-00-00.mkv", "offsetSec": 0 },
    { "id": "camera", "path": "D:/Phone/VID_0001.mp4", "offsetSec": -2.35 }
  ],
  "main": "screen",
  "sound": "screen",
  "view": "left",
  "corner": { "source": "camera", "at": "bottom-right" },
  "range": { "fromSec": 0, "toSec": 612.4 },
  "cuts": [
    { "fromSec": 12.10, "toSec": 13.55, "why": "pause", "mark": false },
    { "fromSec": 40.20, "toSec": 51.80, "why": "retake", "words": "so this is the, so this is the editor", "mark": true }
  ],
  "zooms": [
    { "fromSec": 75.0, "toSec": 81.5, "rect": { "x": 0.55, "y": 0.05, "w": 0.4, "h": 0.4 }, "how": "cut", "why": "pointing at the export button", "mark": true }
  ],
  "markers": [
    { "atSec": 140.2, "label": "Unsure: two takes of the intro, kept both" }
  ],
  "layers": [
    { "path": "D:/Sketches/floor-plan.png", "fromSec": 95.0, "toSec": 104.0, "box": "left-half", "why": "the sketch beside the result", "mark": true },
    { "path": "D:/Assets/subscribe-green.mp4", "fromSec": 300.0, "key": "green", "why": "subscribe", "mark": true }
  ]
}
```

## The fields of a reel

- `version`: 1. (2 is the form above.)
- `shape`: an output shape id from `presets.ts` (`vertical`, `landscape`, `square`, `handoff`).
- `sources`: every file used. `offsetSec` is where this file's clock sits against the main
  source's: a file whose 0 s is 2.35 s into the main source has `offsetSec: 2.35`. `sync`
  prints these.
- `main`: the source that fills the frame. `sound`: the source whose sound is heard (its
  first audio track, or `soundTrack` for another, counted from 0). Usually the same file.
- `soundChannel` (optional): `left` or `right`, that side of the sound track played on both,
  for a voice recorded on one side only (a mono microphone on the left of a stereo track).
  Every piece of the reel's sound keeps it, in the preview and the export. A track that is
  mono already is played as it is.
- `view` (optional): `left` or `right`, the half of a side-by-side main recording that fills
  the frame, such as the screen or the camera of an OBS canvas 3840x1080. It is framed as
  Editbay frames a view: the largest crop of the output shape inside that half, centred.
  Left out, the frame starts on the middle of the whole canvas, as a source dropped in the
  app does. A recording that is not side by side (at least three times as wide as tall) is
  refused a `view`. `split` shows both halves, laid out as the app's Split layout: on a
  `vertical` or `square` frame the left half fills the top and the right half the bottom,
  such as the screen over the face in a Short; on a wider frame they sit side by side. Each
  half is cropped to its box's shape, around its middle. A zoom moves the left half's picture
  and reads its `rect` in fractions of the left half. A shape with no frame is refused it.
- `corner` (optional): a second source shown picture-in-picture, at `top-left`,
  `top-right`, `bottom-left` or `bottom-right`, for the whole cut. Its own optional `view`
  picks the half of a side-by-side recording the box shows; the box takes that half's shape.
  The corner source can be the main source's own file, listed a second time under another
  id, to show the camera half over the screen half.
- `range` (optional): the part of the main source the cut covers; default the whole file.
- `cuts`: stretches to remove, in any order, never overlapping. `why` is one of `pause`,
  `retake`, `false-start`, `other`. `words` is what was said in it, for the report. `mark`
  puts a marker at the join, named from `why` and `words`.
- `zooms`: a punch-in on the main picture between two times. `rect` is the part of the main
  picture to show, as fractions of its width and height: of the half chosen by `view` when
  there is one, otherwise of the whole recording. The tool grows it around its middle to the
  output shape. `how` is `cut` (jumps in, holds, and jumps back out on `toSec`, or stays in
  when it runs to the end of the recording) or `smooth` (eases in over half a second, less
  for a zoom under a second, and out again by `toSec`). A smooth zoom may give `easeSec`, how
  long it takes to push in and to come back out: `0.2` makes a quick punch-in that settles,
  where half a second is a slow push. Refused: an `easeSec` on a cut zoom, under one frame, or
  longer than half the zoom. Refused: a zoom wholly inside cuts
  or outside the range, a smooth one too short to ease (under about three frames), and a
  `rect` that is not closer than the frame already is, closer than 400%, or on the other half
  of a side-by-side canvas. Two zooms may meet on one frame, but not overlap.
- `markers`: free markers, named by `label`.
- `layers` (optional): pictures and clips laid over the cut, described below.

## Layers: pictures and overlay clips

A layer is a still picture, such as a hand sketch (PNG, JPEG, WebP, BMP or GIF), or a video
clip, such as a subscribe animation, shown over the cut for a while. Each lands as an ordinary
clip on a picture track above the cut, as a drop from Sources would, so it can still be moved,
trimmed, keyed or deleted in the app.

- `path`: the file. A path that is not whole is taken from the edit list's own folder, as a
  source's is. The same file may be laid any number of times; the project holds it once.
- `fromSec`: where it comes in, on the reel's main recording's clock, as a marker's `atSec`.
  It lands where that moment lands in the cut. A moment inside a cut or outside the `range` is
  refused, as a marker there is.
- `toSec`: where it goes, on the same clock; a moment taken out lands on its join. Needed for a
  picture. A clip left without it plays whole, from its start, unbroken by any cut after
  `fromSec`; with it, the clip is trimmed to end there, and refused if that is longer than the
  clip.
- `box` (optional): the part of the frame it is fitted inside, keeping its own shape and
  centred: `full` (the default), `left-half`, `right-half`, or `{ "x", "y", "w", "h" }` in
  fractions of the frame, as `{ "x": 0.6, "y": 0.05, "w": 0.35, "h": 0.4 }` for the top right.
- `key` (optional): `green`, `blue` or `black`, the plain background taken out, as Remove
  background does in the app. Use the green-screen render of an animation with `"key": "green"`,
  not a transparent WebM: the export reads a WebM without its transparency, so the clip would
  cover the cut in black.
- `why` (optional) and `mark`: `mark` puts a marker where it comes in, named by `why`, or by the
  file's name without one.

A clip's sound comes with it, on an audio track of its own, linked to its picture. Layers go on
the lowest layer track with room, so ones that overlap stack in the order given, a later one
over an earlier one; layer tracks are above the corner's. A layer that would run past the end
of its reel in the cut is refused, as is one on a shape with no frame (`handoff`). `build`
reports every layer laid as `layers`, with its `atSec` and `toSec` in seconds of the cut.

## Grading the camera

A reel may hold a `grade`: one of Editbay's looks and the four sliders, on every picture of
one camera and nothing else, so camera footage is graded and the screen recording stays as
recorded.

```json
{ "grade": { "source": "a", "view": "right", "look": "warm", "lookStrength": 35, "adjust": { "contrast": 8, "saturation": 10 } } }
```

- `source`: a source id of the reel. Every picture of its file is graded, whichever id shows
  it, so the corner (the same OBS file listed again) is graded too.
- `view` (optional): `left` or `right`, the camera's half of a side-by-side recording. Only
  pictures showing that half are graded. Left out, every picture of the file is.
- `look`: `mono`, `sepia`, `warm`, `cool`, `faded`, `contrast` or `vivid`, as the Inspector's
  Look section. `lookStrength` 0 to 100 (full when left out). `adjust`: any of
  `brightness`, `contrast`, `saturation` and `warmth`, each -100 to 100. At least one of
  `look` and `adjust`.

A clip all of whose pictures are the camera's, such as a full-camera shot, takes the grade as
its own look. The camera's picture inside a clip that also shows the screen, such as the
bottom half of a `split` Short, takes it as that picture's own look, on top of the clip's;
the face circle a script adds after `build` can be given the same fields
(`look`, `lookStrength`, `adjust`) on its layer. Refused: a grade that changes nothing, a look
Editbay does not have, a reel that never shows that camera, and a clip whose main picture is
the camera while another of its pictures is not (a clip's look is on all of its pictures).

## Sound effects, music and gain

A reel may hold `sounds` and `gains`, and the list (beside `version` and `shape`) may hold
`music`. Each lands as the app would leave it by hand, so it can be moved, trimmed, faded or
turned up in the app.

```json
{
  "sounds": [
    { "path": "D:/Editbay/sfx/pop.wav", "fromSec": 75.2, "gainDb": -8, "why": "sticker in", "mark": false }
  ],
  "gains": [
    { "fromSec": 312.0, "toSec": 330.5, "gainDb": 4.5, "why": "phone voice 4.5 dB under" }
  ],
  "music": [
    { "path": "D:/Music/bed.mp3", "startSec": 4.0, "gainDb": -20, "fadeOutSec": 2 }
  ]
}
```

- `sounds`: a sound file (WAV, MP3, M4A and the like; a file with a picture is refused, lay
  it as a layer) laid from `fromSec`, on the reel's main recording's clock as a layer's, so
  it moves with the cut on a rebuild. It plays to its own end, or to `toSec` on the same
  clock. `startSec` is where in the file it starts. `gainDb` is its volume from the file's
  own level (0 when left out), `fadeInSec` and `fadeOutSec` fade it from and to silence,
  each at most half of what it plays. `why` and `mark` as a layer's. One file keeps to one
  sound track, named `sound1` and up; a sound overlapping another of the same file takes a
  track of its own. Refused, as a layer is: inside a cut, or running past the end of its
  reel in the cut.
- `gains`: the reel's own sound (the one `sound` names) raised or lowered by `gainDb` from
  `fromSec` to `toSec` on the reel's clock, for a quieter second voice or one reel against
  another. Its sound is cut at both edges, with its picture, as Cut at playhead cuts, and the
  pieces between take the gain. Refused: 0 dB, louder than the app's 400% (+12 dB), and two
  that overlap.
- `music`: songs under the cut, which may run over several reels, so their times are in
  seconds of the cut: `fromCutSec` (0 when left out) and `toCutSec` (when left out, the end
  of the cut or of the song, whichever comes first). `startSec`, `gainDb`, `fadeInSec`,
  `fadeOutSec` and `why` as a sound's. Each goes on a `music` track. Laid after the dip to
  black, so a song keeps its own fade out; give it one when the cut dips.

`build` reports every sound and song laid as `sounds`, with its `atSec` and `toSec` in
seconds of the cut and its `gainDb`.

## Ending on a dip to black

`endDipToBlackSec` (optional) sits at the top of the list, beside `version` and `shape`, in a
version 1 or a version 2 list, and ends the whole cut with a dip to black that many seconds
long:

```json
{ "version": 2, "shape": "landscape", "endDipToBlackSec": 2, "reels": [] }
```

It is an ordinary Editbay transition, Dip to black, on the out edge of every clip that ends
where the cut ends: the last piece of the main picture, the corner and any layer still
showing dip to black, and their sound fades to silence, all over the same last seconds. It
ends on the cut's last frame, so the cut is no longer for it, and it can still be lengthened,
changed or taken off in the app. In a version 2 list only the last reel's end dips; joins
between reels are left as cuts. A layer or a sound shorter than the dip fades over the whole
of itself. Refused: 0 or less, and a dip longer than the last piece of the cut (the refusal
gives that piece's length).

Everything after the main source's end, or outside `range`, is left out. The tool refuses
a list it cannot honour and says which entry and why; it never quietly drops one.

## Transcribing long recordings

`transcribe` listens to a recording a stretch at a time: it finds the pauses of 2 s or more
as Remove silences does, transcribes each stretch with sound between them on its own, and
gives every word on the recording's clock. `--from` and `--to` limit it to a part. This stops
whisper getting stuck after a long silence and repeating one phrase to the end of the file.
A sentence spoken across a 2 s pause comes out as two pieces, which is fine for finding cuts.

`suspect` lists the stretches whose words are not to be trusted, each with its `fromSec`,
`toSec` and a `reason`:

- `"repeat"`: one phrase of up to six words more than four times in a row, with `phrase` and
  `times`. Whisper looping, most likely; a real chant or countdown would be flagged too.
- `"short sound"`: words from a stretch holding under half a second of sound (its length
  less the quiet inside it, as Remove silences finds quiet), with the `words`. Whisper given a
  click or a breath between long silences writes a sign-off never said, "Thank you for
  watching!", "I'll see you next time.", so treat these words as unheard. A real one-word
  answer can land here too; listen before cutting to it.

The words stay in `words` either way: `suspect` reports, it never deletes.

Whisper also tidies speech: a phrase said twice, a retake, can come out once, and whether it
does depends on where its stretch starts (measured on the owner's recording). Do not take
missing words as proof there was no retake: a second or more of sound with no words in it,
between two words, is worth a look with `frames` or by listening.

`--window S` hears consecutive stretches together, pauses included, in windows of at most `S`
seconds (longer only when one stretch is), never splitting a stretch. Whisper then has the
context to keep a retake. But a window can still hold a pause of most of its length, and
whisper fills a long silence with words never said: on a 20 minute recording a 60 s window
heard 40 s of silence and wrote "If you like this video, give us a thumbs up and subscribe to
our channel", nothing repeated, so `suspect` does not catch it, and 180 s windows wrote one
sentence twice. So the default is 0, each stretch alone. Use a window on a short file, or on a
part chosen with `--from` and `--to`, and distrust words packed a hundredth of a second apart.

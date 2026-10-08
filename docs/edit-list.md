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
  (`left` or `right`, as the reel's `view`, needs a side-by-side main recording) and `corner`
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
- `view` (optional): `left` or `right`, the half of a side-by-side main recording that fills
  the frame, such as the screen or the camera of an OBS canvas 3840x1080. It is framed as
  Editbay frames a view: the largest crop of the output shape inside that half, centred.
  Left out, the frame starts on the middle of the whole canvas, as a source dropped in the
  app does. A recording that is not side by side (at least three times as wide as tall) is
  refused a `view`.
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
  for a zoom under a second, and out again by `toSec`). Refused: a zoom wholly inside cuts
  or outside the range, a smooth one too short to ease (under about three frames), and a
  `rect` that is not closer than the frame already is, closer than 400%, or on the other half
  of a side-by-side canvas. Two zooms may meet on one frame, but not overlap.
- `markers`: free markers, named by `label`.

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

# Changelog

## 1.0

The first public release. Everything since 0.1.0: the work of making the project public, and the features added while
it was being done.

### Changed

- The app is now called **Editbay**. It was Clipper while it was being built, and briefly
  Cutroom, which was dropped when it turned out seventy other projects already use that name.
- Projects are saved as `.editbay`, and that is the only extension the app reads. The one
  project that existed under the old name was converted, so nothing is left to be compatible
  with and the compatibility was taken out again.
- Comments throughout the source no longer address a single owner.
- The app is described as what it is, a general video editor, rather than as a tool for short
  vertical clips. That was how it started and it outgrew it: there are four output shapes,
  several video and audio tracks, layers and sequences.
- **"What it does not do" says only what has held.** It used to say no transitions, no
  effects, no keyframes and no filters. All of those went in against it, so it now says no
  LUTs or full grading, no speed ramps and no plugins, as a description of the tool rather
  than a promise about it.

### Added

- **A command line for agents** (plan 74). `npm run --silent cli -- <command>` measures
  recordings and writes projects, with the app's own code, each command printing one JSON
  object: `probe`, `sync` (the offset between two recordings, found from their sound),
  `transcribe` (every word with its times, from the speech engine Editbay downloaded),
  `pauses` (what Remove silences would find), `frames` (a JPEG at each time), `build` (a
  project from an edit list, see `docs/edit-list.md`) and `open`. A built project opens in
  Editbay like any other: every source goes through the app's own import, as after the cache
  is cleared. An edit list can pick the left or right half of a side-by-side OBS canvas for
  the main picture and for the corner. Built with `npm run cli:build`, which has to be run
  again after pulling. The app itself is unchanged.
- **Reels, shots and transcripts that do not loop** (plan 75). An edit list version 2 holds
  several recordings laid end to end, each with its own cuts, zooms, view and corner, and
  shots that change a recording's framing for a stretch: the camera half full frame for the
  closing lines, the corner hidden. `transcribe` works a stretch between long pauses at a
  time, takes `--from` and `--to`, and lists stretches that look like whisper repeating
  itself. Version 1 lists build exactly as before.
- **Images.** PNG, JPEG, WebP, BMP and GIF files come in like recordings and go on any video
  track, five seconds long and trimmable to any length. They land whole, in a box of their own
  shape, and their transparent parts show the footage underneath, in the preview and in the
  export. An animated GIF plays, looping. The bin's filter has **Image**.
- **An image placed freely.** Its box can go partly off the frame, turn with a handle above
  it, and be made see-through with Opacity in the Inspector.
- **Text over the video.** `T` puts words on at the playhead: several lines, any installed font,
  size, colour, outline, shadow and a box behind them, all in the Inspector's Text section.
  Dragging a corner scales it and draws it again, sharp.
- **A zoom on a clip.** A clip's picture can end somewhere other than where it started: a cut
  straight to a closer framing, which hides a jump cut, or an eased move across a second. The
  crop box edits where it ends as readily as where it begins, and copying a clip's framing
  carries the move with it.
- **Captions break where a reader would pause.** Inside a sentence, a caption ends at a comma
  or before "and" or "because" rather than wherever the word count ran out, never leaves one
  word alone when the words could be shared out better, and avoids ending on "the" or "to".
  **Group again**, under "How captions look", regroups captions made before this.
- **A Settings window.** Every preference the app keeps in one place: saving automatically,
  the ALL strip, skimming, the next transition and a transition on every cut, the microphone,
  muting while recording, the recordings folder, the guides and which safe zones to shade, the
  Source and Output side by side, what Remove silences counts as a pause, how exports go, and a
  way into the shortcuts. `Ctrl+,`, the gear in the top bar, or Settings in `Ctrl+K`.
- **Export preferences.** A folder every project exports to until it picks its own, the mode
  and file names a new project starts with, whether to ask, replace or keep both when a file is
  already there, and whether to show the file in its folder when it finishes. A project that
  has exported keeps what it used.
- **Switches in the palette.** An on or off preference found in `Ctrl+K` shows whether it is on,
  flips on Enter, and leaves the palette open for the next one.
- **Skimming the timeline can be turned off**, for anyone who wants the monitor to stay on the
  playhead however the pointer moves.
- **Black and white on a clip.** A Look section in the Inspector takes the colour out of every
  picture of a clip, in the Output view and in the export alike. It is the first look, and the
  list is built to take more; plan 35 says which are worth having and why most are not.

- `LICENSE`: MIT, for Editbay's own source.
- `THIRD-PARTY-NOTICES.md`, and a `licences` folder installed with the app, covering the
  GPL-3.0 ffmpeg build the installer carries and where to get its source.
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue templates and a
  CI workflow.
- The handovers written while the app was built are archived.
- **Tutorials, built into the app.** `F1` opens short entries in eight categories, with one
  search box across all of them. They are plain Markdown in `docs/tutorials/`, which is
  the single source of truth: the app renders those files and GitHub serves the same ones.
  `docs/how-to-use.md` is retired, because two copies of the same instructions means the
  second one is always wrong.
- **Earlier versions** (plan 84): every save keeps the version it replaced, and Open recent
  lists them, so a change you regret can be gone back on.
- **Looks, colour adjustments and blur** (plan 85), the same in the preview and the export.
- **The media cache tidies itself** (plan 86): copies no project has used for two months go,
  and Settings shows how much room it takes, with a button to free it.
- **Remove background** (plans 90, 96, 98): green, blue, black or any other plain colour taken
  out of a clip, found by looking at the clip, the same in the preview and the export.
- **Effects and assets** (plans 90, 96): an effects folder and one assets folder with Video,
  Audio and Images, Save as asset on a clip, Get free assets listing free packs, and every
  export writing the description credits its files need beside the video.
- **Inspector sections beside the timeline** (plan 92), dragged by their heading, with a picker
  for which the Inspector shows.
- **The framing used last** (plan 93) offered to a recording on a new project.
- **Five more transitions** (plan 95): zoom out, pixelate, RGB split, spin and flash.
- **A picture in picture box that moves** (plan 97) by keyframes, and Move out of the way.
- **Caption and text styling** (plan 99): a box behind the words, a glow, the word being said
  bigger or boxed, and saved caption and text styles, with Apply to all.
- **Themes** in Settings: Classic, Arctic and Electric.
- **Follow face** (plan 100): finds the face in a clip on your machine and keyframes the crop to
  keep it in frame. ONNX Runtime and the YuNet face model ship with the app for it.

### Fixed

- The full audit of 2026-10-01 (plans 83 and 86): exports that differed from the preview,
  sound and colour among them; ways a change could be lost; edits that left linked clips out of
  step; paths the window sends being trusted; the installed app's Node and debugger switches;
  and a long list of speed and memory problems on long projects.

## 0.1.0

The first public release. The app existed and was used daily before this point; the version
number starts here because this is the first build anyone else could install.

What it does, in one line: a local video editor with a multi-track timeline, transitions,
layers, sound and captions, and deliberately no grading, effects or speed ramps.

- Import mixed footage, with variable frame rate, HEVC, 4K and rotation metadata all handled
  on the way in.
- Cut on a multi-track timeline, with silence detection that shows what you would save before
  it cuts anything.
- Reframe with a crop box for vertical, landscape, square, or a handoff shape that keeps
  source scale.
- Captions generated locally with whisper, editable word by word.
- Multiple sound tracks, per-clip volume and mute, voice over recording.
- Picture in picture, coloured marks, markers, and several cuts of the same sources in one
  project.
- Transitions on any cut, or on a clip's head or tail: seven kinds for picture and three for
  sound, dragged to length on the timeline.
- Export as one joined video or one file per clip.
- Reads OBS's own settings to find your newest recording.
- Windows 11 x64. English captions only.

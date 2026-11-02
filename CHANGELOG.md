# Changelog

## 2.0

Editbay on a Mac, clip speed, a Portrait picture in picture, a tidier Inspector, and a long
list of fixes to the timeline, the preview and the export.

### Changed

- **Projects saved by 2.0 open only in 2.0 and later.** They are written as a newer kind of
  file, because a clip can now have a speed. Editbay 1.0 to 1.2 say such a file needs a newer
  app rather than opening it out of step. 2.0 opens every project the older versions saved.
- The Inspector's sections each sit on a card with the heading on a darker band, and Zoom is
  split into Framing, One-click zooms and Face, each named with what it is for.
- The sections to the right of the timeline fold down to a thin bar under the Inspector, which
  takes their height, and the bar opens them again.
- The font lists offer the 30 fonts Editbay brings with it and the common ones on the computer,
  rather than every font installed.
- The preview plays its sound through the browser's own audio engine, at normal speed and
  seamless across cuts.
- The export folder's button is **Choose...**, which picks the folder to export into. Opening the
  folder moves to a small icon beside it.
- Short notices, such as "Saved <file>.editbay", show at the top in the middle, under the top
  bar, rather than low on the right over the Inspector.

### Added

- **Mac versions**, one for Apple Silicon and one for Intel, built and tested on GitHub's Macs.
  They are not signed by Apple; the README's **Mac** section says how to open them. Shortcuts
  use Cmd, the menu bar has the app's menus, and speech and face follow work on both chips.
- **Clip speed**, in the Inspector, the preview and the export: a time-lapse up to 16x and slow
  motion down to 0.1x. The sound stays from 0.5x to 2x, keeping its pitch, and is silent beyond
  that. Captions made for a clip at a speed hear all of its recording.
- **Portrait**, a tall 9 by 16 card like a phone, with corners that grow with it and a thin light
  edge, as a picture in picture shape beside Square, Rounded and Circle, in the Inspector and
  the toolbar. It exports as previewed.
- **Remove background from the command search.** The pointer becomes a picker, and the clip or
  asset clicked next is the one it acts on; Enter takes the selected clip, and Esc or a right
  click cancels. Make captions for a clip and Show where a clip came from work the same way.
- A sound clip can play one side of its track on both sides, for a voice recorded on the left
  only, in the preview and the export.
- A layer can have a look of its own, over its clip's.
- The command line's edit lists can lay layers, pictures and overlay clips over the cut, end
  the cut with a dip to black (`endDipToBlackSec`), set how long a smooth zoom pushes in
  (`easeSec`), show both halves of a side-by-side recording as the Split layout does, lay sound
  effects and songs with volume and fades, raise or lower a reel's own sound over a stretch,
  play one channel on both sides (`soundChannel`), and grade one camera's pictures. See
  `docs/edit-list.md`.

### Fixed

- A speed on a shot whose sound leads in or runs on keeps the sound in step at both ends, or is
  refused, naming the clip in the way.
- A slowed clip whose start falls part way into a frame opens the export on the frame the
  preview shows, and stays with its sound.
- A gap closes, and a clip taken out closes up, when sped-up clips further on already overlap by
  a frame: they move up together rather than drifting out of step with the music under them.
- Ctrl+drag of a shot whose sound leads in or runs on moves only its picture's stretch, so no
  black is left, and names what is in the way.
- Remove silences cuts every track it listened to at each pause, linked to V1 or not, so a
  separately recorded voice stays in step with the pictures.
- A locked track refuses every edit to its clips, a fade, a volume, a link, a group or a look,
  not only a move in time.
- A dip to black is darkest on the cut, and the blur transition blurs both ways instead of
  smearing sideways.
- A recording whose file names BT.709 colours but no matrix keeps its colours in the export.
- Ctrl+wheel zoom keeps the moment under the pointer on a long cut, also while playing and after
  reaching either end.
- Resizing the crop box keeps up with the pointer on a clip whose zoom has keyframes.
- Export progress never moves backwards.
- A key that moves the playhead just after an edit is no longer undone by the preview catching
  up.
- The Export dialog shows the mode and names from Settings from the start, rather than the
  project's own for a moment.
- A menu taller than the window stays inside it and scrolls, and a dropdown no longer closes as
  it opens just after a scroll.
- A file in a folder reached through a link shows as imported.
- Long, grouped timelines stay smooth: playback redraws only the playhead, and an edit settles
  groups in a few milliseconds even on an hour of footage.
- A project built by the command line plays its recordings from their own files, so a large OBS
  recording shows its picture on first open instead of staying black while it is imported
  again.

## 1.2

Cropping that only crops, and fixes to J-cuts and L-cuts on the timeline.

### Fixed

- Dragging a shot's head edge longer on V1, where the next shot's sound leads in from before
  it, no longer cuts that sound in two and runs this shot's sound over it. The next shot moves
  on whole, its sound with it.
- Pressing I on a sound inside its lead-in, before its picture starts, now closes up on every
  track. Before, a title on V2 over a later shot stayed where it was and ended up over a
  different frame.
- After S near where one shot's sound runs on under the next, or starts early under the one
  before, Join puts the two pieces back. It used to refuse, and joining with Alt left the
  picture and its sound apart, so dragging the picture left the sound behind.
- Cropping a clip no longer adds zoom keyframes or starts it zooming. The crop box, the Crop
  numbers and the nudge keys change the zoom only while Start, End or a keyframe is picked in
  the Zoom section. Otherwise they only crop, and a clip that already zooms keeps its motion,
  the whole zoom moving with the crop.

## 1.1

A security fix for projects sent by someone else, and smaller fixes to the timeline.

### Added

- `Ctrl+A` selects every clip on the timeline, on every track. It can be changed in the
  shortcuts window, and in a text field it still selects the text.

### Fixed

- **Security:** a project someone sent you could make Windows sign in to their computer, and so
  hand over your password hash, through the preview: its player read a playlist dressed as an
  `.mp4` and followed it to a network share. Every file the window loads is now checked, and one
  on a share you have not allowed is refused; a source that is really a playlist opens as
  missing, as does one named `clip.m3u8.` with a dot after it.
- Taking out, or trimming with O or a ripple drag, the shot before one whose sound starts early
  (a J-cut) no longer leaves black frames on V1 or moves a title over the shot before. The time
  taken out is the picture's, and an edit that cannot close up cleanly is refused with the track
  in the way named.
- Ctrl+wheel over the timeline keeps zooming about the pointer. While a clip played it jumped
  back to the playhead after a notch or two, and slow notches drifted a pixel each.
- The band drawn at a clip's edge on the timeline is narrower, 16 pixels at a cut, 8 at each
  clip's edge. The area that grabs a trim keeps its size.

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

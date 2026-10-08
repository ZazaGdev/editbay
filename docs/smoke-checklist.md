# Smoke checklist

Most of this is now automated. Run the suites first; only the items under
**Still manual** need a human.

```
npm test           unit tests, pure logic
npm run test:e2e   the real pipeline against generated fixtures
npm run test:smoke the real pipeline against your own footage
npm run test:ui    the real app, clicked by a driver (builds first)
npm run test:all   all four
```

After `npm run dist:test`, `npm run test:ui` also drives the **packaged**
application: that it starts, finds its bundled ffmpeg, imports and exports. That
is the check worth having, because inside the packed archive the binaries are not
real files and nothing reveals it until you press Export.

## Automated: your own footage

`npm run test:smoke` also cuts, reframes and exports your real recordings end to
end, and checks the result is 1080x1920 with the exact frame count and an audio
track. It runs the import pipeline over the files listed in
`test/smoke/media.local.txt` (one path per line, gitignored, machine specific)
or in the `EDITBAY_SMOKE_MEDIA` environment variable. With neither, it skips.

For each file it checks that the import reaches ready, that a waveform and a
filmstrip were written, that the asset describes the file the editor will
actually play rather than the original, that the result has steady timing, and
that a second import is cheap. It prints the decision it made for each file, so
a glance tells you whether it did the sensible thing.

Add a new file to the list whenever you hit footage that behaves oddly.

## Automated: the editor

`npm run test:ui` launches the built app and drives it: importing, adding clips,
selecting, trimming by dragging handles, the trim limits, playhead movement by
keyboard and by scrubbing the ruler, splitting, deleting, undo and redo
including past the start, and drag-to-reorder.

It also covers the monitor: that a picture appears under the playhead and not
past the end of the timeline, that space plays and stops, that playback runs
through a cut rather than halting at it, that an arrow key stops playback, and
that the crop rectangle moves, resizes, holds the output shape when locked,
stays inside the frame, survives moving between clips, and is written into the
document rather than only drawn on screen.

Export is covered twice. `npm run test:e2e` renders real files and probes what
came out: exact frame count, exact resolution, exact frame rate, and one
continuous audio track across a clip that had no sound. `npm run test:ui` drives
an export through the panel, including the preset and mode rules, progress
reaching completion, and the file landing on disk.

## Automated: carrying on where you left off

`test/ui/resume.test.ts` closes the app, sometimes by killing it, and opens it
again. It covers the save changes question on close and on New with each of its
three answers, the project taking its file's name and the export taking it too,
reopening the last project with the playhead, selection, zoom, view, aspect lock
and export settings where they were, a recovery copy offered after a crash and
both Restore and Discard, a project passed on the command line, the recent list,
a second launch handing its file to the window already open, a waveform rebuilt
after the cache was cleared, and relinking a moved folder from the panel.
`test/e2e/resume.test.ts` does the cache and relink cases against real files
without the window, including a conformed file rebuilt from its original.

## Automated: several sequences

`test/ui/sequences.test.ts` makes, duplicates, reshapes, switches, renames,
removes and restores sequences through the window. It checks that reshaping a
copy leaves the original's crops exactly as they were, that each sequence keeps
its own playhead and selection, that an export is named after its sequence,
that a project reopens on the sequence it closed on with each one's place
intact, and that a project from before sequences opens as one.
`test/e2e/export.test.ts` exports a vertical and a landscape sequence of the
same cut and checks each file's size and exact length.

## Still manual

These need a human because they open native dialogs or need eyes on the result.

- [ ] Ctrl+S opens a save dialog, and the file it writes reopens with Ctrl+O
      showing exactly the same timeline.
- [ ] Install from the installer, then double-click a `.editbay` file in
      Explorer: it opens in Editbay. Double-click another while Editbay is open:
      it opens in the same window, after asking about unsaved changes.
- [ ] Close with unsaved changes: the question reads sensibly and each of Save,
      Don't save and Cancel does what it says.
- [ ] Duplicate a finished vertical cut, switch the copy to Landscape, and
      reframe a few clips in it: the vertical one still looks exactly as it did.
- [ ] Move a source file on disk, then open its project: the clip turns red and
      the inspector offers to find it. Relinking restores the cut.
- [ ] The waveform visibly changes between speech and silence on a clip where
      you know you paused. This is the one that decides whether the timeline is
      actually useful for cutting.
- [ ] Playback looks and sounds right: the audio is in sync with the picture,
      and crossing a cut does not stutter or flash.
- [ ] The Output view shows what you expect to get: the right part of the frame,
      at the right shape, with nothing of the source leaking in at the edges.
- [ ] Dragging the crop rectangle feels responsive on a 4K clip rather than
      lagging behind the pointer.
- [ ] The filmstrip on a clip shows the right part of the video, and moving the
      trim handles changes which frames it shows.
- [ ] A 4K phone clip imports in a reasonable time. Note how long against the
      clip's length.
- [ ] Drop five files at once: they process one after another and all five end
      ready, with the window still usable throughout.
- [ ] Closing the window mid-conform leaves no partial file in the cache.
- [ ] An exported vertical file plays right way up and full screen on a phone,
      with the audio in sync from start to finish.
- [ ] Upload one to the platform you actually use and check it is not letterboxed
      or re-cropped.
- [ ] Export a timeline of five or more clips and watch each cut: no flash, no
      repeated frame, no gap in the sound.
- [ ] Note how long an export takes against the length of the timeline.

## Where the cache lives

Derived files are written to `%APPDATA%\editbay\media-cache`, one folder per
source file. Delete that folder to force everything to be reprocessed.

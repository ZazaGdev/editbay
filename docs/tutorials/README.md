# Tutorials

These files are the help inside the app. Press `F1` in Editbay and you are reading them, in a
window with category tabs and one search across all of them. GitHub serves the same files, so
there is no second copy to go stale.

**Adding one needs no code change.** Write a file here and it appears.

## The shape of a file

```markdown
---
title: Save a clip as an asset
category: Layers
keywords: assets, save as asset, reuse, keep, library
---

Keep a trimmed, edited clip in your assets folder to use again.

## Steps

1. Right click a clip on the timeline. {show: clip}
2. Choose [Save as asset]. {show: clip "Right click this clip, then choose Save as asset"}
3. For its sound alone, `Alt`+click the sound first, then right click it.

## Details

The full explanation, in Markdown, as long as it needs to be within the limit below.
```

The window opens an entry on its **Steps**, with **Details** as a second tab, because someone
opening help wants to know what to press, and the why is one click away (plan 101).

- **The lede**, everything above `## Steps`: one sentence saying what this gets you.
- **Steps**, 2 to 6 numbered lines, each one action. The reader can tick them off.
- **Details**, the prose: what happens, the exceptions, where to go next. Required.

- **title**, required. What the entry is called in the list and what search matches first.
- **category**, required, and it must be one of the eight below. An unknown one fails the build.
- **keywords**, optional. Words somebody would actually type that the title does not already
  contain. "pauses" and "dead air" find Remove silences; repeating "silences" here would be
  wasted.
- **media**, optional. A file in `media/`, shown under the first paragraph.

The filename is `NNN-slug.md`. The number fixes the reading order inside a category, which
alphabetical order would not, and leaves room to insert one later without renumbering
everything.

## The categories

`Getting started`, `Cutting`, `Framing`, `Layers`, `Sound`, `Captions`, `Timeline`, `Export`.

Eight, because twelve tabs is a wall and eight is a row. If something genuinely does not fit,
change the list in `src/shared/tutorials.ts`, do not invent a category here: the test will fail
and tell you so.

## The words

One name for each thing, the same one the window uses, so what an entry says is what you see:

| Say | For | Not |
|---|---|---|
| **video track**, **audio track** | V1 and up, A1 and down | row, picture track, lane |
| **clip** | a piece of a source on a track | cut, item |
| **source** | anything in the Source bin | media, asset, footage file |
| **recording** | a source that is a video file | movie, film |
| **image** | a source that is a still picture file, or a GIF | picture, photo, still |
| **text** | words put on with `T` | title, caption (a caption is spoken words) |
| **picture** | what a clip shows, and each of its views in a layout | layer, image |
| **Source view**, **Output view** | the two sides of the monitor | program, preview |
| **sequence** | one edit, one tab | project, which holds them all |
| **timeline** | the panel of tracks at the bottom | edit, sequence |

## Chips and Show me

**Controls go in square brackets**, like `[Save as asset]`. They render as a chip, so the words
look like the thing to press. Use the label exactly as the window shows it. Bold is for
emphasis only, never for a control's name.

**`{show: test-id}` at the end of a step adds a Show me button.** It highlights the element
with that `data-testid` over the editor. Point at a control that is on screen while you work,
not one inside a dialog. For a control that only appears after you act, such as a menu item,
point at the nearest control that is on screen and say what to do with it:
`{show: clip "Right click this clip, then choose Save as asset"}`. Without the quoted text the
callout says "Here". The test fails if no control in the app has that test id.

**`on:kind` says what the control needs first.** A control in the Inspector's Sound group only
exists with a sound clip selected, so its step says so: `{show: sound-clip-denoise on:sound}`.
Show me then selects the sound clip nearest the playhead, or keeps the selection if it already
is one, and rings the control. With no sound clip at all, the callout says what to drop first.
A step about the element itself uses the same kind, `{show: sound-clip on:sound}`, and rings
the one nearest the playhead. The kinds and their "first" words are `NEEDS` in
`src/shared/tutorials.ts`.

**`or:test-id` names the control to ring when the step's own is not there**, as one that only
shows in a mode: `{show: zoom-key or:zoom-mode on:video "Choose Keyframes here, then press Add keyframe"}`.
The quoted text is then said only when the fallback is ringed.

`test/ui/show-me.test.ts` presses every Show me in the real app, on an empty project and on a
full one, and fails on a ring in the wrong place or a "first" hint where there is something.

## How long

**One topic per entry.** Steps answer one question, and Details stay under about 200 words.

If it is running longer, it is two entries. That is not a style preference: search returns
entries, so a long entry that covers four things is four results people cannot find.

Each entry has to stand alone, because search drops people straight into the middle. Repeat just
enough context to make sense without the one before it.

## What Markdown works

The two headings above, paragraphs, bold, bullet and numbered lists, tables, inline code and
`[chips]`.

**Keyboard keys go in backticks**, like `Ctrl+E`. They render as keys, and they show whatever the
reader has actually bound rather than the default, so a rebound key still reads correctly.

Anything more exotic than the list above is not supported on purpose. The renderer is small and
deliberately so.

## Captures

Optional, and most entries do not need one. Use them where the instruction is a gesture:
dragging the crop box, dragging a clip edge, the silence review list.

Put them in `media/` as **silent looping mp4**, not GIF. Ten seconds of a video editor as a GIF
is several megabytes; the same clip as h.264 is a few hundred kilobytes.

Keep the whole of `docs/tutorials/` under **20 MB**. It ships inside the installer and lands in
every clone.

## Checking your work

`npm test` reads every file here and fails if one has no title, an unknown category, no lede, 2
to 6 steps or details, a Show me pointing at a test id the app does not have, or names a capture
that does not exist. It also fails if a "?" in the app links to an entry that is not here. Run it before opening a pull request.

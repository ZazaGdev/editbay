---
title: Name the files you export
category: Export
keywords: filename, pattern, tokens, numbering, project name, index
---

Name exported files after the project, the sequence and the clip, instead of Untitled-1 to 9.

## Steps

1. Press [Export...] in the top bar. {show: open-export}
2. Type in [Name for each file], or [File name] for one video. {show: open-export "Open Export, then type the name"}
3. Press a token, such as [{project}] or [{clip}], to put it in the name. {show: open-export "Open Export, then press a token under Name for each file"}
4. Check the names under Will write before you export.

## Details

The export dialog takes a name pattern, with clickable tokens for the project name, the sequence
name, the clip number and the clip name: [{project}], [{sequence}], [{index}] and [{clip}]. It
shows a **live example** of the result as you type, so you can see what you will get before
committing to it.

This matters most with one file per clip. A folder of `Untitled-1.mp4` through `Untitled-9.mp4`
is much less useful a week later than one named after the project and the take.

Whatever you build, the dialog lists the actual filenames before writing, so a pattern that
produces something unexpected is caught before it fills a folder.

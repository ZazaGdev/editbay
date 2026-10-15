# Third party notices

Editbay's own source is MIT, in `LICENSE`. This file covers everything else: what the
installer carries, what the app downloads later, and what the source depends on.

**The short version.** If you clone this repository and read or build the source, you are
dealing with MIT code. If you download the installer, you are receiving a combined work that
contains GPL-3.0 software, and the installer as a whole is conveyed under GPL-3.0. The rest of
this file says exactly which parts and where their source is.

## Bundled in the installer

### FFmpeg and FFprobe

- **Version:** 9.0.2, the `essentials` Windows release build published by Gyan Doshi
  (`9.0.2-essentials_build-www.gyan.dev`). `ffmpeg.exe` and `ffprobe.exe` both come from
  this one build, downloaded by `npm install` from
  https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2 and checked against its SHA-256
  (`scripts/fetch-ffmpeg.mjs`).
- **Licence:** GPL-3.0-or-later.
- **Source:** the exact revision this build was made from is
  https://github.com/FFmpeg/FFmpeg/commit/946fcce07b . Build configuration and scripts:
  https://www.gyan.dev/ffmpeg/builds/ . The build's own record of its version, source commit
  and full configuration ships with the app as `licences/FFmpeg-build-and-source.txt`.
- **Mac versions:** the same FFmpeg 9.0.2, built for Apple Silicon and Intel Macs by Martin
  Riedl (https://ffmpeg.martin-riedl.de/, build scripts at
  https://git.martin-riedl.de/ffmpeg/build-script), `ffmpeg` and `ffprobe` each downloaded by
  `npm install` on a Mac and checked against its SHA-256. Also GPL-3.0, configured with
  `--enable-gpl --enable-version3` and libx264, libass and libzimg among others; its record
  ships as `licences/FFmpeg-build-and-source-mac.txt`.

This build is configured with `--enable-gpl --enable-version3` and includes libx264, libx265,
libvidstab, librubberband and libvmaf. Those are why the licence is GPL-3.0 rather than LGPL.
Editbay requires libx264, checks for it at startup and refuses to run without it, so switching
to an LGPL build is not a matter of configuration.

**Why Editbay's own source can still be MIT.** Editbay does not link FFmpeg. It runs
`ffmpeg.exe` as a separate operating system process and communicates with it over a command
line and a pipe, the same way a shell script would. The source in this repository contains no
GPL code and is not a derivative work of FFmpeg. The installer is a different matter: it is a
single distributable that contains a GPL-3.0 binary, so that combined work is conveyed under
GPL-3.0.

This is the same position taken by a number of tools that ship FFmpeg alongside their own
code. It is a widely held reading rather than a settled question, and it is written down here
so that anyone who disagrees can see the reasoning and say so.

**Corresponding source: a written offer, per GPL-3.0 section 6(b).** The links above point to
the exact FFmpeg revisions and to the publisher of the builds. The complete Corresponding
Source is more than that: it also covers the libraries these builds link in statically
(libx264, x265, libvidstab, rubberband, libass, aom and the others their configuration lists)
and the scripts used to build them.

For at least three years from the date you received any Editbay installer, and for as long as
that version is offered, anyone may ask for the complete Corresponding Source of the FFmpeg and
FFprobe programs in it, by email to zazagdev@gmail.com or by an issue on this repository. It
will be provided either as a download at no charge or on a physical medium for no more than
the cost of making and sending it. This offer is valid for anyone in possession of the
installer, not only the person who downloaded it.

The installed app carries the same links and this offer in its `licences` folder, alongside
the full GPL-3.0 text.

FFprobe is run as a separate process, like FFmpeg, and used only to read what a file contains.

### Montserrat

- **Licence:** SIL Open Font License 1.1.
- **Copyright:** 2024 The Montserrat.Git Project Authors,
  https://github.com/JulietaUla/Montserrat
- **Full text:** `resources/licences/Montserrat-OFL.txt`, also installed with the app.

`Montserrat-ExtraBold.ttf` is the caption font. FFmpeg burns captions in with it, and the app
window uses its own copy to draw the same captions in the preview. The OFL allows this. It
does not allow selling the font on its own, which nothing here does.

### Anton, Bebas Neue and Poppins

- **Licence:** SIL Open Font License 1.1, each.
- **Copyright:** 2020 The Anton Project Authors, https://github.com/googlefonts/AntonFont ;
  2010 Dharma Type (Bebas Neue); 2020 The Poppins Project Authors,
  https://github.com/itfoundry/Poppins
- **Full text:** `resources/licences/Anton-OFL.txt`, `BebasNeue-OFL.txt` and `Poppins-OFL.txt`,
  also installed with the app.

`Anton-Regular.ttf`, `BebasNeue-Regular.ttf` and `Poppins-Black.ttf`, from the Google Fonts
repository, are the other fonts captions can be drawn in, used as Montserrat is: burned in by
FFmpeg and drawn by the app window from its own copy. Texts can use them too.

### ONNX Runtime

- **Version:** 1.30.0, the `onnxruntime-node` and `onnxruntime-common` npm packages, the
  Windows x64 CPU library only.
- **Licence:** MIT.
- **Copyright:** Microsoft Corporation, https://github.com/microsoft/onnxruntime
- **Full text:** `resources/licences/ONNXRuntime-MIT.txt`, also installed with the app. The
  libraries built into `onnxruntime.dll` (protobuf, abseil, ONNX, Eigen and others) are listed
  with their licences in `resources/licences/ONNXRuntime-ThirdPartyNotices.txt`, Microsoft's
  own notice file from the v1.30.0 tag, also installed.

Runs the face model for Follow face. It is a native library, so it is installed in
`resources/onnxruntime` beside the app rather than bundled into it. The Microsoft Visual C++
runtime files it needs (`msvcp140*.dll`, `vcruntime140*.dll`) ship next to it, as Microsoft's
redistribution terms for those files allow.

### YuNet face detection model

- **File:** `face_detection_yunet_2023mar.onnx`, from the OpenCV Zoo,
  https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
- **Licence:** MIT.
- **Copyright:** 2020 Shiqi Yu.
- **Full text:** `resources/licences/YuNet-MIT.txt`, also installed with the app.

Finds the faces Follow face keeps in the crop. It runs on this PC and nothing is sent anywhere.

## Downloaded after installation, not bundled

Neither of these ships in the installer. Both are fetched once, only when you first ask for
captions, and each is checked against a SHA-256 recorded in the source before it is used. If
you never use captions, Editbay never makes a network request at all.

### whisper.cpp

- **Version:** release `b5130`, the Windows x64 CPU build.
- **Licence:** MIT.
- **Source:** https://github.com/ggml-org/whisper.cpp
- **On a Mac** the program is not downloaded but bundled: `whisper-cli` built from the same tag
  `b5130` by `scripts/build-whisper-mac.sh`, shipped inside the app as `whisper/whisper-cli`
  with whisper.cpp's MIT licence beside it as `whisper/LICENSE`. Only the model is downloaded.

### Whisper speech model

- **File:** `ggml-medium.en-q5_0.bin`, 539 MB, English only.
- **Licence:** MIT, as published with whisper.cpp's model files.
- **Source:** https://huggingface.co/ggerganov/whisper.cpp

The underlying Whisper model weights are from OpenAI and are released under the MIT licence.

## Build and runtime dependencies

These are used to build the app. Electron, React and the icon set are part of what the
installer contains; the rest are build tools only.

| Package | Version | Licence |
| --- | --- | --- |
| Electron | 44.4.3 | MIT |
| React and React DOM | 19.3.0 | MIT |
| scheduler (part of React DOM) | 0.28.0 | MIT |
| lucide-react | 1.47.0 | ISC (the icons drawn from Feather: MIT) |
| Vite | 7.3.6 | MIT |
| electron-vite | 5.x | MIT |
| electron-builder | 26.x | MIT |
| TypeScript | 5.x | Apache-2.0 |
| Vitest | 5.0.1 | MIT |
| playwright-core | 1.63.x | Apache-2.0 |

React, React DOM and scheduler, and lucide-react, are bundled into the app's own code, so their
full texts ship in the `licences` folder as `React-MIT.txt` and `lucide-ISC.txt`.

Electron embeds Chromium and Node.js, whose notices ship with the app as `LICENSE.electron.txt`
and `LICENSES.chromium.html` beside `Editbay.exe`. `npm ls` gives the full
resolved tree for any build.

## In the repository only, not in the installer

- `test/fixtures/face.png`, used by the Follow face tests: a crop of Neil Armstrong's official
  Apollo 11 portrait, a NASA photograph and so in the public domain in the United States.
  Source: https://commons.wikimedia.org/wiki/File:Neil_Armstrong_pose.jpg

## Reporting a problem with this file

If something here is wrong, out of date, or missing an obligation, that is a bug and worth an
issue. Getting attribution right matters more than being quick about it.

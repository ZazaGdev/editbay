# Security

## Reporting something

Use GitHub's private vulnerability reporting on this repository: **Security**, then **Report a
vulnerability**. That keeps the report private until there is a fix.

Please do not open a public issue for anything that could be exploited. For everything else, a
normal issue is the right place.

Expect a first reply within a week. This is one person's side project, so it is worth setting
that expectation honestly rather than promising a schedule that will not be kept.

## What the attack surface actually is

Editbay is a local desktop application. It has no server, no account, no session and no
database. Being specific about what it does is more useful than a policy statement.

**It makes two network requests, ever.** The whisper program and the English speech model, one
each, and only when you first ask for captions. Both are fetched from fixed URLs pinned in the
source, and both are checked against a SHA-256 recorded there before anything runs them. A
changed or corrupted download is refused rather than executed. If you never use captions,
Editbay never opens a socket. Separately, **Get free assets** opens a fixed list of pack pages
in your web browser; Editbay itself downloads nothing from them.

**Nothing is uploaded.** Your footage, your projects and your transcripts stay on your disk.
There is no telemetry and no update check.

**It runs two bundled binaries as separate processes**, ffmpeg and ffprobe, both shipped with
the installer, from one pinned build that is checked against its SHA-256 when it is fetched. It builds their arguments itself and never passes a command line through a
shell. Their inputs are limited to video, sound and picture formats, so a file named like a
video that is really a playlist is refused rather than followed to wherever it points, and a
project that names a playlist as a source, by its name or by what is in the file, opens with
that source missing.

**It runs a few other programs, each by its full path and with fixed arguments:**

- `whisper-cli.exe`, the speech engine, once you have downloaded it. Before every run its
  program and libraries are checked against SHA-256 values in the source, not only at the
  download. If any has changed it is not run: it is deleted, and the next use downloads it
  again.
- Windows' own `tar.exe`, once, to unpack the speech engine's zip after its checksum passes.
- Windows' own `reg.exe`, to register the project file type (see below).
- Windows PowerShell, once after that, with a fixed script that tells Explorer the file type
  changed so the icon updates. Nothing from a project or from the window goes into it.

**It writes to the registry once**, under `HKCU\Software\Classes` only, to make project files
open on a double-click. That needs no administrator rights, it only happens in the installed
build, and it only happens when something has changed.

**It reads OBS's settings files** to find your recording folder, and nothing else in
`%APPDATA%`.

## Things worth knowing

- **The installer is not code signed.** Windows SmartScreen will warn you. Every release
  publishes the installer's SHA-256 so you can verify what you downloaded. If you obtained
  Editbay anywhere other than this repository's releases page, check that hash before running
  it.
- **Project files are JSON and are read as data**, but a project file is still a file from
  somewhere. Opening one from a stranger is no more advisable here than anywhere else.
- **A project that names files on another computer asks first.** Opening a file on a network
  share connects to that computer and signs in with your Windows account, so a project whose
  files are on a share you have not used asks before anything touches it, and keeps them
  offline unless you say Connect. A share you import from through the file picker, relink to,
  or connect to when a project asks is remembered for good, so later projects on it open
  without asking: allow a share only if you trust every project that will name it. A share you
  only drop files from is allowed until Editbay closes. The same holds for everything the window
  loads, not only the paths a project names: the window's own video player also reads
  playlists, so every file it asks for is checked as it asks, and one on a share you have not
  allowed is refused before anything connects.
  A project never makes Editbay write outside its own cache: waveforms and other files made
  from a source always go there, whatever path the project names.
- **The window runs sandboxed** and shows only the app's own page. It cannot open another
  window or navigate anywhere else, and the only permissions it is granted are the microphone,
  full screen, and reading the names of the fonts installed, for the text tool's font list. What it can ask of the rest of the app is a fixed list of actions. Some of
  those take a file path, to import, open, save or export, and trust the window to pass a
  path you chose. That is safe while the window shows nothing but the app's own code, which
  is why the window is kept that way; a bug that let outside content run in it would be
  serious and is in scope. As a second line, the rest of the app does not take the window's
  word where it need not: it opens only files an export wrote, shows only folders on a drive
  or a share you have allowed, and an undo can only bring back a source the project already
  had, with the files the app made for it.
- **Follow face runs ONNX Runtime inside the app**, a native library shipped in
  `resources/onnxruntime` with the YuNet face model. It only ever sees raw pixels ffmpeg has
  already decoded, never a file, and its version is recorded in `THIRD-PARTY-NOTICES.md`.
- **Media files are handled by ffmpeg**, which has its own history of parser vulnerabilities.
  Editbay ships a pinned version and the version is recorded in `THIRD-PARTY-NOTICES.md`. If
  that build is ever found to have a serious flaw, updating it is a release on its own.

## Scope

In scope: anything that lets a file you open run code, reach the network, or read or write
outside the folders Editbay uses.

Out of scope: the SmartScreen warning, which is expected and documented above; the absence of
sandboxing between the app and your own files, which is the point of a video editor; and
anything requiring an attacker who already has your user account.

# Releasing

What it takes to put an installer on the Releases page. The licence and security files make
promises about every release, and this list is how they are kept.

## Before building

1. Everything is committed and pushed. GitHub Actions is switched off for this repo, because
   its runs used up the month's minutes, so every check below runs on the development machine.
2. `package.json` has the new version, and `CHANGELOG.md` has a section for it in place of
   **Unreleased**. Releases are named with two numbers where people see them: 1.0, 1.1, 1.2,
   tagged `v1.1`. `package.json` keeps three, `1.1.0`, because the build tools need it, so the
   downloads' names are set by hand to match: `nsis.artifactName` and `mac.artifactName` in
   `electron-builder.yml`, and `NAME` in `.github/workflows/mac.yml`. From 2.1 each name says
   the system: `Editbay-<version>-Windows-Setup.exe` and `Editbay-<version>-Mac.dmg`, one
   download for every Mac. GitHub turns a space in an upload's name into a dot, so the names
   have none.
3. On a quiet machine, `npm run typecheck` passes, and so does `npm run test:all`: the unit
   tests, the e2e tests, the smoke tests and the app tests (`npm run test:ui`), all of which must
   pass before every release. `npm run test:smoke` needs your own footage; see
   `docs/smoke-checklist.md`, and do its **Still manual** items too.

## Building

```
npm run dist
```

The installer lands in `release/` as `Editbay-<version>-Windows-Setup.exe`. It is packed by the 64-bit
7-Zip at `C:\Program Files\7-Zip\7z.exe` when that is installed, which makes it about 19 MB
smaller than electron-builder's own 7-Zip does; `EDITBAY_7ZIP` names another `7z.exe`, and the
build says which it used. Then:

```
npm run test:packaged
```

which drives the packaged app from `release-test/win-unpacked`: that it starts, finds its ffmpeg,
exports, and ships every licence notice. Build that copy first with `npm run dist:test`. It is
the same build as the installer's except for two switches the test needs to drive it, which the
installed app has off.

Before uploading, check that `release/` holds only this version's files. An installer left over
from an older build is easy to upload by mistake.

## The hash

`SECURITY.md` promises a SHA-256 for every installer, because the installer is not code signed.

```
certutil -hashfile "release\Editbay-<version>-Windows-Setup.exe" SHA256
```

## The release

Tag the commit `v<version>`, publish the source (below), and create the release on the public
repo from its new commit. Attach the installer, and put in the notes:

- first, a short **Which file do I need?**: Windows takes the Setup file, every Mac the Mac file
- what changed, from the changelog
- the SHA-256 from above
- one line saying the installer contains FFmpeg and FFprobe under GPL-3.0, with a link to
  `THIRD-PARTY-NOTICES.md`, which carries the written offer for their complete source

## Publishing the source

This repo is private and keeps all the work: plans, audits, notes and history. The public
`editbay` repo gets one commit per release, holding only the files `scripts/public-files.txt`
lists, so nothing private and none of this repo's history ever reaches it (plan 103). A new
folder or root file stays private until it is added to that list.

Run it after tagging the release here, and before creating the release on GitHub:

```
node scripts/publish-public.mjs <your clone of the public repo> --version <version>
```

It takes the listed files as committed at HEAD, the tagged commit, makes the clone hold exactly those, and
commits them as `Release <version>`. Then it runs the open-source check's scanner on that
commit. On **NO-GO** it takes the commit back off, lists what it found, and stops: fix the
file here, commit, and run it again. A hit a person has checked and found fine (the public
name and email, a word in a licence text) goes into `scripts/public-accepted.json` by file and
match. On **GO** it prints the push command; look the commit over, then push it yourself.

It needs Python and the open-source-check skill's scanner, or `OSCHECK` naming it. Extra
words the scan should look for, such as a workplace name, go one per line in
`.claude/public-check-terms.txt`, which stays private.

Create the release on the public repo, not this one, and attach the installer there.

## The Mac version

Nobody working on Editbay has a Mac, so the Mac version is built and tested on GitHub's Macs
by `.github/workflows/mac.yml` (plan 104). It runs free only on the public repo: this one has
no Mac minutes to spare, and GitHub refuses the job once the month's free minutes are gone.

From 2.1 it is one `.dmg` for every Mac (task 2682): each program in it carries both Apple
Silicon and Intel, and macOS runs the half for its chip. The workflow fetches ffmpeg for both
chips and joins them, builds the speech program for both, and uses ONNX Runtime 1.23.2, the
last with an Intel library, for both.

After publishing the source and pushing it, start **Mac** on the public repo's Actions page,
or `gh workflow run mac.yml --repo ZazaGdev/editbay`. Its one job runs the type check, the
unit and e2e tests, builds the speech program and the `.dmg`, checks every program in it is
signed and has both halves, runs each program on each chip, runs the packaged test against
the app on Apple Silicon and again on Intel through Rosetta, taking a picture of its window
each time, checks no half needs a newer macOS than the app says, and runs the UI suite. Then
run **Mac release check** with that run's id,
`gh workflow run mac-release-check.yml --repo ZazaGdev/editbay --field build_run=<run id>`,
which opens the built `.dmg` on an Apple Silicon Mac and a real Intel one. When both are green:

- download the run's file (`Editbay-<version>-Mac`) and look at both screenshots
- attach the `.dmg` to the release, and put its SHA-256 (the `.sha256` beside it) in the
  notes, with the "how to open it" steps from the README's **Mac** section

While Mac work is being built, tries go to a `mac-dev` branch of the public repo instead, which
starts the workflow on every push: check that branch out in the public clone before running
`publish-public.mjs`, and push it with `git push origin HEAD:mac-dev`. Its `main` moves only at a
release.

**First time only:** create the public repo on GitHub, clone it to a folder of its own (or
`git init` an empty folder and add the remote), run the step, and push.

## If the bundled FFmpeg or FFprobe changes

Both come from one gyan.dev release build, pinned in `scripts/fetch-ffmpeg.mjs` by its URL
and SHA-256, which `npm install` fetches into `vendor/ffmpeg`. To move to another build:

- change the version, URL, folder and SHA-256 there. Take the hash from gyan.dev's own
  `.sha256` file for the same archive, and check the download matches it
- run `npm install`, then `npm run test:e2e` before and after: a new ffmpeg changes how
  options and colours behave, and plan 89 lists what 9.0 changed
- update the version and the source commit in `THIRD-PARTY-NOTICES.md` and
  `resources/licences/README.txt`
- replace `resources/licences/FFmpeg-build-and-source.txt` with the new build's own record,
  `vendor/ffmpeg/README.txt`

The written offer runs for at least three years from the day someone received a given build,
so keep a note of which builds have shipped, and until when each could be downloaded.

# Contributing to Editbay

Contributions are welcome. This file is short, and the unusual part is at the bottom.

## Getting it running

Node 22.12 or newer. Windows, because that is the only platform the app currently builds for.

```
npm install
npm run dev
```

`npm install` downloads a static ffmpeg build. That is what does all the encoding, and the app
refuses to start without it.

## The tests

Five commands, and each covers something the others cannot, plus one that picks among them.

| Command | What it covers |
| --- | --- |
| `npm run typecheck` | Types, including the tests |
| `npm test` | Pure logic in `src/shared`, no window, fast |
| `npm run test:e2e` | The real media pipeline against footage it generates itself |
| `npm run test:ui` | The built app, driven through Playwright: IPC, React state, the pointer, the keyboard |
| `npm run test:smoke` | The pipeline against your own recordings |
| `npm run test:all` | All of them |
| `npm run test:relevant` | The tests that belong to what changed: the default while working |

`npm run test:relevant` is the one to run after a change. It looks at what is not yet committed
(or the last commit, when everything is), runs the unit tests whole, since they take about
fifteen seconds, and picks the slow e2e, smoke and UI tests that belong to the changed files:
a changed test itself, the tests that import a changed file or are named after it, and the UI
tests most often committed together with it. It prints what it picked and why before running.
A change to the dependencies, the build or test settings, the preload bridge, the app start or
a helper most tests share makes it run everything instead, and it says which file caused that.
`-- --list` shows the pick without running it, `-- --since main` covers everything since a
branch or commit, and `-- --full` is the same as `npm run test:all`. Run the full suite before
a release, or when the pick looks too narrow for what the change touches.

`npm test` and `npm run test:e2e` run on a fresh clone with nothing to set up. The e2e suite
generates its own video with the bundled ffmpeg rather than depending on checked-in media.

`npm run test:smoke` needs your own footage, because synthetic fixtures cannot reproduce what a
phone or a screen recorder actually writes. Point it at files with either a
`test/smoke/media.local.txt` holding one path per line, or the `EDITBAY_SMOKE_MEDIA`
environment variable with paths separated by `;`. Both are gitignored. With neither, the suite
skips.

Two things about `npm run test:ui` that will otherwise waste your afternoon:

- It builds first, and the build reads the working tree. Do not run it while something else is
  building in the same checkout.
- Its timing assertions fail now and then on a busy machine. Before believing a failure, check
  for a stray `electron.exe` and run the one file again on its own.

## How changes are made here

**Work starts with a plan file**, in `docs/plans/`, named `YYYY-MM-DD-slug.md`, with five
headings and nothing else required:

- **Goal.** One or two sentences. What is true afterwards that is not true now.
- **Out of scope.** What not to touch. The most useful heading and the one most often left out.
- **Files.** Which files are expected to change, and roughly how.
- **Verification.** Commands to run, and what a pass looks like.
- **Risks.** What could go wrong, and what is already known to be unclear.

Every feature in this app was built that way, over a hundred of them. The point is not
ceremony. It is that the out-of-scope list is written down before anyone starts,
which is what stops a small change becoming a large one.

For a one-line fix, skip it and open a pull request. For anything bigger, open an issue first
and we can agree the shape before you spend the time.

**Whoever implements a plan does not redesign it.** If the plan turns out to be wrong, say
which part rather than working around it, and append what actually happened to the bottom of
the plan file under `## Outcome`.

## What review looks for

The review bar was written down after the same points came up twenty times. Worth reading
before a first pull request. The parts that catch people out:

- **A test is only worth keeping if it fails with the fix taken out.** Put the broken line
  back, run the one test, watch it fail, put the fix back. A test that passes either way is
  worse than no test, because it claims coverage that is not there.
- **Anything that can be a pure function in `src/shared` should be**, and tested in
  `test/unit` without a window. The window holds state and wiring, not rules.
- **Edits go through the `ClipEdit` union and are applied in main**, so they can be undone. An
  edit made by changing the project in the renderer is a bug.
- **Edits that move time** are checked against a linked picture and sound pair, a clip left
  whole across the stretch, and a J-cut or L-cut. Those are the shapes that go out of step.
- **The code is not Prettier formatted.** Match what is around your change.
- **No em dashes or en dashes anywhere**, in code, comments, tests or documentation.
- **Comments say why**, in plain words, the way the rest of the project's do.

## Reporting a bug

Use the issue templates. For anything to do with importing or exporting, the container and
codec of the source file and whether it came from OBS are usually the whole answer, so the
form asks for them.

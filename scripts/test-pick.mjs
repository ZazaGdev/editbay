// Task 28: which tests belong to a change. Pure, so test/unit/test-pick.test.ts
// can hold it to its rules without git or a disk; scripts/test-relevant.mjs
// feeds it the real changed files, test list, imports and history.
//
// The unit tests take about fifteen seconds in full, and the shared modules
// import each other so widely that picking among them saves nothing, so they
// always run whole. The media tests (test/e2e, test/smoke) and the app tests
// (test/ui) are the slow ones, and those are picked, for each changed file:
//
// - a changed test file itself
// - the tests that import the changed file directly
// - the tests named after it (looks.ts, useLooks.ts and Looks.tsx pick looks.test.ts)
// - the tests most often committed together with it, which is how a source
//   file finds the app tests that drive it, since those never import it
//
// A file with too little history of its own borrows that of the files that
// import it, which covers a file just split out of a bigger one.

/** Changing one of these can break any test, so only a full run says anything. */
export const FULL_RUN_FILES = [
  { pattern: /^package(-lock)?\.json$/, reason: 'the dependencies or scripts changed' },
  { pattern: /^vitest\.config\.ts$/, reason: 'the test runner settings changed' },
  { pattern: /^electron\.vite\.config\.ts$/, reason: 'the build settings changed' },
  { pattern: /^tsconfig[^/]*\.json$/, reason: 'the compiler settings changed' },
  { pattern: /^src\/preload\//, reason: 'the bridge between the window and the app changed' },
  { pattern: /^src\/main\/(index|test-mode|test-launch)\.ts$/, reason: 'the app start or its test mode changed' },
  { pattern: /^test\/(ui\/dialogs|e2e\/fixtures|project-helpers)\.ts$/, reason: 'a helper most tests share changed' },
  { pattern: /^scripts\/fetch-ffmpeg\.mjs$/, reason: 'the ffmpeg download changed' },
  { pattern: /^vendor\//, reason: 'the bundled ffmpeg changed' }
]

/** Folders whose tests are picked; test/unit always runs whole. */
export const PICKED_DIRS = ['test/e2e', 'test/smoke', 'test/ui']

/** How many of the tests most often committed with a file are taken. */
export const HISTORY_TOP = 4
/** A file with fewer commits than this borrows the history of its importers. */
export const HISTORY_MIN = 3

const TEST_RE = /\.test\.ts$/

/** Whether a changed file can affect a test at all. Notes and docs cannot, except the tutorials, which tests read. */
export function canAffectTests(file) {
  if (file.startsWith('docs/tutorials/')) return true
  if (file.startsWith('docs/') || file.startsWith('bugfixes')) return false
  if (/\.md$/i.test(file) && !file.includes('/')) return false
  if (file.startsWith('.github/') || file.startsWith('release')) return false
  return true
}

/** The words a file's own name is made of: useLookPicker.tsx gives look and picker. */
export function nameWords(file) {
  const base = file.split('/').pop().replace(/\.(test\.)?[^.]+$/, '')
  return base
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[-_.]+/)
    .filter((w) => w && w !== 'use')
}

function singular(word) {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word
}

/** Whether a test is named after the file: same words, ignoring a plural s. */
export function namedAfter(testFile, file) {
  const a = nameWords(testFile).map(singular).join('-')
  const b = nameWords(file).map(singular).join('-')
  if (!a || !b) return false
  if (a === b) return true
  // The tutorials folder holds one file per topic; all of them feed the tutorials tests.
  return file.startsWith('docs/tutorials/') && a === 'tutorial'
}

/**
 * The tests worth running for a change.
 *
 * @param {object} input
 * @param {string[]} input.changed the changed files, relative, with forward slashes
 * @param {string[]} input.tests every test file under the picked folders
 * @param {(file: string) => string[]} input.importsOf the project files a file imports directly
 * @param {(file: string) => Map<string, number>} input.coChanged for a file, how often each other file was committed with it
 * @param {(file: string) => number} input.commitsOf how many commits touched a file
 * @param {string[]} input.sources every source file, for finding importers
 */
export function pickTests({ changed, tests, importsOf, coChanged, commitsOf, sources }) {
  const relevant = changed.filter(canAffectTests)
  const full = []
  for (const file of relevant) {
    const hit = FULL_RUN_FILES.find((f) => f.pattern.test(file))
    if (hit) full.push(`${file}: ${hit.reason}`)
  }
  if (full.length) return { full, picked: new Map(), unit: true }

  /** test file -> the reasons it was picked */
  const picked = new Map()
  const pick = (test, why) => {
    if (!picked.has(test)) picked.set(test, [])
    if (!picked.get(test).includes(why)) picked.get(test).push(why)
  }

  const testImports = new Map(tests.map((t) => [t, new Set(importsOf(t))]))
  let importers
  const importersOf = (file) => {
    if (!importers) {
      importers = new Map()
      for (const s of sources) {
        for (const dep of importsOf(s)) {
          if (!importers.has(dep)) importers.set(dep, [])
          importers.get(dep).push(s)
        }
      }
    }
    return importers.get(file) ?? []
  }

  const byHistory = (file) => {
    const counts = new Map()
    for (const [other, n] of coChanged(file)) {
      if (tests.includes(other)) counts.set(other, (counts.get(other) ?? 0) + n)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, HISTORY_TOP)
      .map(([t]) => t)
  }

  for (const file of relevant) {
    if (tests.includes(file)) pick(file, 'changed')
    for (const test of tests) {
      if (testImports.get(test).has(file)) pick(test, `imports ${file}`)
      if (test !== file && namedAfter(test, file)) pick(test, `named after ${file}`)
    }
    if (TEST_RE.test(file) || !file.startsWith('src/')) continue
    let fromHistory = byHistory(file)
    let via = file
    if (commitsOf(file) < HISTORY_MIN) {
      // Too new to have a history of its own: borrow the files that use it.
      const users = importersOf(file).filter((u) => commitsOf(u) >= HISTORY_MIN)
      fromHistory = [...new Set(users.flatMap(byHistory))]
      via = users.join(', ')
    }
    for (const test of fromHistory) pick(test, `committed with ${via}`)
  }

  const unit = relevant.length > 0
  return { full, picked, unit }
}

/** Splits picked tests by folder, in a stable order. */
export function byFolder(picked) {
  const out = Object.fromEntries(PICKED_DIRS.map((d) => [d, []]))
  for (const test of [...picked.keys()].sort()) {
    const dir = PICKED_DIRS.find((d) => test.startsWith(`${d}/`))
    if (dir) out[dir].push(test)
  }
  return out
}

// Task 28: `npm run test:relevant` runs the tests that belong to what changed,
// so a change is checked in minutes rather than the half hour a full run takes.
// What it picks, and why, is in scripts/test-pick.mjs.
//
//   npm run test:relevant                 changes not yet committed, or the last commit when there are none
//   npm run test:relevant -- --since main  everything changed since a commit or branch
//   npm run test:relevant -- --list        say what would run, and run nothing
//   npm run test:relevant -- --full        the full run, the same as npm run test:all
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, posix, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PICKED_DIRS, byFolder, pickTests } from './test-pick.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const listOnly = args.includes('--list')
const sinceAt = args.indexOf('--since')
const since = sinceAt >= 0 ? args[sinceAt + 1] : undefined

function git(...a) {
  return execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}
const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean)

function changedFiles() {
  if (since) return { files: [...new Set([...lines(git('diff', '--name-only', `${since}...HEAD`)), ...workingChanges()])], what: `since ${since}` }
  const working = workingChanges()
  if (working.length) return { files: working, what: 'not yet committed' }
  return { files: lines(git('diff', '--name-only', 'HEAD~1', 'HEAD')), what: 'in the last commit' }
}
function workingChanges() {
  return [...new Set([
    ...lines(git('diff', '--name-only', 'HEAD')),
    ...lines(git('ls-files', '--others', '--exclude-standard'))
  ])]
}

function walk(dir) {
  const abs = join(root, dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = posix.join(dir, e.name)
    return e.isDirectory() ? walk(rel) : [rel]
  })
}

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|import\s+)'(\.{1,2}\/[^']+)'/g
const importCache = new Map()
function importsOf(file) {
  if (importCache.has(file)) return importCache.get(file)
  const found = []
  const abs = join(root, file)
  if (existsSync(abs) && /\.(ts|tsx|mjs|js)$/.test(file)) {
    for (const m of readFileSync(abs, 'utf8').matchAll(IMPORT_RE)) {
      const target = resolveImport(file, m[1])
      if (target) found.push(target)
    }
  }
  importCache.set(file, found)
  return found
}
function resolveImport(from, spec) {
  const base = posix.join(posix.dirname(from), spec)
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}/index.ts`, `${base}/index.tsx`]) {
    const abs = join(root, cand)
    if (existsSync(abs) && statSync(abs).isFile()) return cand
  }
  return undefined
}

// The whole history once, as commit -> files, then per file on demand.
let commits
function history() {
  if (!commits) {
    commits = git('log', '--no-merges', '--name-only', '--pretty=tformat:@@commit')
      .split('@@commit')
      .map((block) => lines(block))
      .filter((files) => files.length)
  }
  return commits
}
function coChanged(file) {
  const counts = new Map()
  for (const files of history()) {
    if (!files.includes(file)) continue
    for (const other of files) if (other !== file) counts.set(other, (counts.get(other) ?? 0) + 1)
  }
  return counts
}
function commitsOf(file) {
  return history().filter((files) => files.includes(file)).length
}

function shortReasons(reasons) {
  const shown = reasons.slice(0, 2).join('; ')
  return reasons.length > 2 ? `${shown}; and ${reasons.length - 2} more` : shown
}

function run(label, command, commandArgs) {
  console.log(`\n> ${label}: ${command} ${commandArgs.join(' ')}`)
  const r = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  return r.status === 0
}

if (args.includes('--full')) {
  console.log('Full run, as asked.')
  process.exit(run('everything', 'npm', ['run', 'test:all']) ? 0 : 1)
}

const { files, what } = changedFiles()
const tests = PICKED_DIRS.flatMap(walk).filter((f) => f.endsWith('.test.ts'))
const sources = walk('src').filter((f) => /\.(ts|tsx)$/.test(f))
const result = pickTests({ changed: files, tests, importsOf, coChanged, commitsOf, sources })

console.log(`Changed ${what}: ${files.length ? files.join(', ') : 'nothing'}`)

if (result.full.length) {
  console.log('\nA full run is needed, because:')
  for (const why of result.full) console.log(`  ${why}`)
  if (listOnly) process.exit(0)
  process.exit(run('everything', 'npm', ['run', 'test:all']) ? 0 : 1)
}

const folders = byFolder(result.picked)
console.log(`\ntest/unit: ${result.unit ? 'all of it (about fifteen seconds)' : 'nothing'}`)
for (const dir of PICKED_DIRS) {
  console.log(`${dir}: ${folders[dir].length ? '' : 'nothing'}`)
  for (const test of folders[dir]) console.log(`  ${relative(dir, test)}  (${shortReasons(result.picked.get(test))})`)
}
if (listOnly) process.exit(0)

let ok = true
if (result.unit) ok = run('unit', 'npx', ['vitest', 'run', '--dir', 'test/unit']) && ok
const media = [...folders['test/e2e'], ...folders['test/smoke']]
if (media.length) ok = run('media', 'npx', ['vitest', 'run', ...media]) && ok
if (folders['test/ui'].length) {
  ok = run('build', 'npx', ['electron-vite', 'build']) && ok
  ok = run('app', 'npx', ['vitest', 'run', '--no-file-parallelism', ...folders['test/ui']]) && ok
}
console.log(ok ? '\nThe relevant tests pass.' : '\nSome relevant tests failed.')
process.exit(ok ? 0 : 1)

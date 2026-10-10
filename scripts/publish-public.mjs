// Publish the public files of this repo as one new commit in the public
// editbay repo (plan 103). Run on each release, never on every push:
//
//   node scripts/publish-public.mjs <public repo folder> --version <x.y.z>
//
// Takes the files `scripts/public-files.txt` lists, as committed at HEAD, and
// makes the public repo's folder hold exactly those. Commits them, runs the
// open-source check's scanner on that folder, and takes the commit back off
// again when the scan finds anything not already accepted in
// `scripts/public-accepted.json`. It never pushes: it prints the command.
//
// The scanner is `oscheck.py` from the open-source-check skill, or whatever
// OSCHECK names. Without it nothing is published.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function fail(message) {
  console.error(`Not published: ${message}`)
  process.exit(1)
}

function git(repo, args, opts = {}) {
  // Bytes as committed, never line endings turned on the way in.
  return execFileSync('git', ['-C', repo, '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts })
}

/** The paths the allow-list names: folders ending with /, and single files. */
export function readAllowList(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
}

/** Whether a path in the repo is one the allow-list makes public. */
export function isPublic(path, allowed) {
  return allowed.some((a) => (a.endsWith('/') ? path.startsWith(a) : path === a))
}

/**
 * Links in the public Markdown files to a file or folder that stays private,
 * which would be dead in the public repo, and say what is kept out of it.
 * `tracked` is every path in this repo; `texts` the public files' contents.
 */
export function privateLinks(texts, tracked, allowed) {
  const out = []
  for (const [file, text] of texts) {
    if (!file.endsWith('.md')) continue
    for (const m of text.matchAll(/\]\(([^)\s#]+)[^)]*\)/g)) {
      const link = m[1]
      if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('/')) continue
      const parts = []
      for (const p of [...file.split('/').slice(0, -1), ...link.split('/')]) {
        if (p === '..') parts.pop()
        else if (p !== '.' && p !== '') parts.push(p)
      }
      const path = parts.join('/')
      const kept = tracked.filter((t) => t === path || t.startsWith(`${path}/`))
      if (kept.length > 0 && !kept.some((t) => isPublic(t, allowed))) out.push(`link to a private path in ${file}: ${link}`)
    }
  }
  return out
}

/** Every file committed at HEAD: its path, mode and blob. */
function committedFiles(repo) {
  const out = []
  for (const rec of git(repo, ['ls-tree', '-r', '-z', 'HEAD']).split('\0')) {
    if (rec === '') continue
    const [meta, path] = rec.split('\t')
    const [mode, type, blob] = meta.split(' ')
    if (type === 'blob') out.push({ path, mode, blob })
  }
  return out
}

/** The bytes of many blobs, read through one git process. */
function blobs(repo, ids) {
  const res = spawnSync('git', ['-C', repo, 'cat-file', '--batch'], { input: ids.join('\n') + '\n', maxBuffer: 2 * 1024 * 1024 * 1024 })
  if (res.status !== 0) fail(`git cat-file failed: ${res.stderr}`)
  const buf = res.stdout
  const out = new Map()
  let at = 0
  for (const id of ids) {
    const nl = buf.indexOf(0x0a, at)
    const [sha, , size] = buf.subarray(at, nl).toString('utf8').split(' ')
    const n = Number(size)
    out.set(id, buf.subarray(nl + 1, nl + 1 + n))
    if (sha !== id) fail(`git cat-file answered ${sha} for ${id}`)
    at = nl + 1 + n + 1
  }
  return out
}

/** Every file in a folder, as repo paths with /, leaving out `.git`. */
function filesUnder(root, sub = '') {
  const out = []
  for (const e of readdirSync(join(root, sub), { withFileTypes: true })) {
    const rel = sub === '' ? e.name : `${sub}/${e.name}`
    if (rel === '.git') continue
    if (e.isDirectory()) out.push(...filesUnder(root, rel))
    else out.push(rel)
  }
  return out
}

/** Whether a scan hit is one a person has looked at and accepted. */
export function isAccepted(hit, accepted) {
  const file = hit.where.replace(/:\d+$/, '')
  return accepted.some((a) => {
    const place = a.file.endsWith('/') ? file.startsWith(a.file) : file === a.file
    return place && (a.match === undefined || hit.match.toLowerCase() === a.match.toLowerCase())
  })
}

/** What in a scan stops the publish: anything secret or private, and personal details not accepted. */
export function blockers(scan, accepted) {
  const out = []
  for (const h of scan.files.secrets) out.push(`secret: ${h.what} in ${h.where}`)
  for (const f of scan.files.secret_files) out.push(`secret file: ${f}`)
  for (const h of scan.history.secrets) out.push(`secret in history: ${h.what} in ${h.where}`)
  for (const f of scan.history.secret_files_ever) out.push(`secret file in history: ${f}`)
  for (const f of scan.private_docs.tracked) if (!isAccepted({ where: f, match: '' }, accepted.filter((a) => a.match === undefined))) out.push(`private doc: ${f}`)
  for (const h of scan.files.personal) if (!isAccepted(h, accepted)) out.push(`${h.what} in ${h.where}: ${h.match}`)
  for (const h of scan.history.messages) out.push(`${h.what} in a commit message: ${h.match}`)
  return out
}

function main() {
  const args = process.argv.slice(2)
  const target = args[0]
  const vi = args.indexOf('--version')
  const version = vi >= 0 ? args[vi + 1] : undefined
  const si = args.indexOf('--source')
  const source = resolve(si >= 0 ? args[si + 1] : join(here, '..'))
  if (!target || !version) fail('usage: node scripts/publish-public.mjs <public repo folder> --version <x.y.z>')
  const dest = resolve(target)
  if (!existsSync(join(dest, '.git'))) fail(`${dest} is not a git repo. Clone the public repo there, or run git init for the first release.`)
  if (git(source, ['status', '--porcelain', '--untracked-files=no']).trim() !== '') fail('this repo has changes not committed. Commit them, so what is published is what was released.')

  const scanner = process.env.OSCHECK ?? join(homedir(), '.claude', 'skills', 'open-source-check', 'scripts', 'oscheck.py')
  if (!existsSync(scanner)) fail(`the open-source check's scanner is not at ${scanner}. Install the open-source-check skill, or set OSCHECK.`)

  const allowed = readAllowList(readFileSync(join(source, 'scripts', 'public-files.txt'), 'utf8'))
  const accepted = existsSync(join(source, 'scripts', 'public-accepted.json')) ? JSON.parse(readFileSync(join(source, 'scripts', 'public-accepted.json'), 'utf8')).accepted : []
  const files = committedFiles(source).filter((f) => isPublic(f.path, allowed))
  const links = files.filter((f) => f.mode === '120000')
  if (links.length > 0) fail(`symbolic links are not published: ${links.map((f) => f.path).join(', ')}`)

  const before = spawnSync('git', ['-C', dest, 'rev-parse', '--verify', '-q', 'HEAD'], { encoding: 'utf8' }).stdout.trim() || null
  if (git(dest, ['status', '--porcelain']).trim() !== '') fail(`${dest} has changes of its own. It should hold only what was published.`)

  // Exactly the public files: whatever else is there goes.
  const wanted = new Set(files.map((f) => f.path))
  for (const old of filesUnder(dest)) if (!wanted.has(old)) unlinkSync(join(dest, old))
  const bytes = blobs(source, files.map((f) => f.blob))
  const dead = privateLinks(
    files.map((f) => [f.path, bytes.get(f.blob).toString('utf8')]),
    committedFiles(source).map((f) => f.path),
    allowed
  )
  if (dead.length > 0) fail(`public files link to what stays private:\n  - ${dead.join('\n  - ')}`)
  for (const f of files) {
    mkdirSync(dirname(join(dest, f.path)), { recursive: true })
    writeFileSync(join(dest, f.path), bytes.get(f.blob))
  }
  git(dest, ['add', '-A'])
  if (git(dest, ['status', '--porcelain']).trim() === '') {
    console.log(`Nothing new to publish: ${dest} already holds this release's files.`)
    return
  }
  git(dest, ['commit', '-q', '-m', `Release ${version}`])

  // Back to the release before, or to an empty repo before the first.
  const undo = () => {
    if (before) {
      git(dest, ['reset', '-q', '--hard', before])
      git(dest, ['clean', '-fdq'])
      return
    }
    git(dest, ['update-ref', '-d', 'HEAD'])
    git(dest, ['rm', '-rq', '--cached', '.'])
    for (const d of readdirSync(dest)) if (d !== '.git') rmSync(join(dest, d), { recursive: true, force: true })
  }

  // The scanner names the owner's other projects by the folders beside this
  // one, so it is told them: beside the public copy they would not be found.
  const parent = dirname(source)
  const siblings = readdirSync(parent, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && resolve(parent, e.name) !== source)
    .map((e) => e.name)
  const terms = existsSync(join(source, '.claude', 'public-check-terms.txt')) ? readAllowList(readFileSync(join(source, '.claude', 'public-check-terms.txt'), 'utf8')) : []
  const reports = mkdtempSync(join(tmpdir(), 'editbay-public-check-'))
  // Scanned as a clone alone in a folder of its own: the scanner also takes
  // the folders beside the one it scans for other projects, and beside the
  // public repo's own folder those are whatever happens to be there.
  const alone = join(mkdtempSync(join(tmpdir(), 'editbay-public-copy-')), 'editbay')
  git(dirname(alone), ['clone', '-q', dest, alone])
  const python = process.env.PYTHON ?? 'python'
  const run = spawnSync(python, [scanner, alone, '--out', reports, '--extra', ...siblings, ...terms], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  rmSync(dirname(alone), { recursive: true, force: true })
  const raw = existsSync(reports) ? readdirSync(reports).find((n) => n.endsWith('raw-scan.json')) : undefined
  if (run.status !== 0 || !raw) {
    undo()
    fail(`the open-source check could not run: ${run.stderr || run.error?.message || 'no report written'}`)
  }
  const scan = JSON.parse(readFileSync(join(reports, raw), 'utf8'))
  const stop = blockers(scan, accepted)
  if (stop.length > 0) {
    undo()
    console.error(`NO-GO: ${stop.length} finding${stop.length === 1 ? '' : 's'} in the public files, so the commit was taken back off.`)
    for (const s of stop) console.error(`  - ${s}`)
    console.error(`The full scan is in ${reports}. Fix the file, or, once a person has checked a hit is fine, add it to scripts/public-accepted.json.`)
    process.exit(1)
  }
  console.log(`GO: ${files.length} files committed as "Release ${version}" in ${dest}. The scan is in ${reports}.`)
  console.log(`Look it over, then push it yourself:\n  git -C "${dest}" push origin HEAD:main`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()

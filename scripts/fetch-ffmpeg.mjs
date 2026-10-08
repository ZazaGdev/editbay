// Plan 89: ffmpeg and ffprobe, both from one gyan.dev release build, fetched by
// `npm install` into vendor/ffmpeg. The archive is pinned by URL and checked
// against its SHA-256 before anything comes out of it, so a changed or damaged
// download is refused rather than run. The installer carries the same folder.
//
// A stamp holds the hash of the archive the folder came from, so an install with
// the right build already there downloads nothing.
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BUILD = {
  version: '9.0.2',
  url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
  // The same as gyan.dev publishes for this file.
  sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
  folder: 'ffmpeg-9.0.2-essentials_build'
}

/** What is taken out of the archive: the two programs, and the build's licence and own record. */
const TAKEN = ['bin/ffmpeg.exe', 'bin/ffprobe.exe', 'LICENSE', 'README.txt']

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'vendor', 'ffmpeg')
const stamp = join(target, 'build.sha256')

async function current() {
  if (!TAKEN.every((f) => existsSync(join(target, f.replace('bin/', ''))))) return false
  return (await readFile(stamp, 'utf8').catch(() => '')).trim() === BUILD.sha256
}

async function download(to) {
  const res = await fetch(BUILD.url)
  if (!res.ok || !res.body) throw new Error(`ffmpeg ${BUILD.version}: the download answered ${res.status}`)
  const hash = createHash('sha256')
  const counted = Readable.fromWeb(res.body).on('data', (chunk) => hash.update(chunk))
  await pipeline(counted, createWriteStream(to))
  const seen = hash.digest('hex')
  if (seen !== BUILD.sha256) {
    throw new Error(`ffmpeg ${BUILD.version}: the download's SHA-256 is ${seen}, not ${BUILD.sha256}. Nothing was installed.`)
  }
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('fetch-ffmpeg: Editbay bundles a Windows build only; skipped on this platform.')
    return
  }
  if (await current()) return

  console.log(`fetch-ffmpeg: downloading ffmpeg ${BUILD.version} (about 110 MB)`)
  const scratch = await mkdtemp(join(tmpdir(), 'editbay-ffmpeg-'))
  // Built beside the target and renamed over it, so a failure leaves the old folder or none.
  const staged = `${target}.${process.pid}.tmp`
  try {
    const zip = join(scratch, 'build.zip')
    await download(zip)

    // Windows' own tar, which reads zips. The one Git Bash puts first on PATH does not.
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    const wanted = TAKEN.map((f) => `${BUILD.folder}/${f}`)
    const r = spawnSync(tar, ['-xf', zip, '-C', scratch, ...wanted], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error(`ffmpeg ${BUILD.version}: the archive could not be opened`)

    await rm(staged, { recursive: true, force: true })
    await mkdir(staged, { recursive: true })
    for (const f of TAKEN) await copyFile(join(scratch, BUILD.folder, f), join(staged, f.replace('bin/', '')))
    await writeFile(join(staged, 'build.sha256'), `${BUILD.sha256}\n`)
    await rm(target, { recursive: true, force: true })
    await rename(staged, target)
    console.log(`fetch-ffmpeg: ffmpeg ${BUILD.version} is in vendor/ffmpeg`)
  } finally {
    await rm(scratch, { recursive: true, force: true })
    await rm(staged, { recursive: true, force: true })
  }
}

await main()

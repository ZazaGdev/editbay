// Plan 89: ffmpeg and ffprobe, both from one gyan.dev release build, fetched by
// `npm install` into vendor/ffmpeg. The archive is pinned by URL and checked
// against its SHA-256 before anything comes out of it, so a changed or damaged
// download is refused rather than run. The installer carries the same folder.
//
// Plan 104: on a Mac, one martin-riedl.de release build for the chip being
// built for, its two programs zipped one apiece, pinned and checked the same
// way. The chip is the running Node's, or EDITBAY_TARGET_ARCH (arm64 or x64)
// to fetch the other one.
//
// A stamp holds the hash of the archive the folder came from, so an install with
// the right build already there downloads nothing.
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile, copyFile } from 'node:fs/promises'
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

/**
 * The Mac builds: ffmpeg 9.0.2, the same release as Windows', from
 * ffmpeg.martin-riedl.de, by chip. Each hash is the one the site publishes
 * beside its file, and was checked against the download.
 */
const MAC_SITE = 'https://ffmpeg.martin-riedl.de/download/macos'
const MAC_BUILDS = {
  arm64: {
    ffmpeg: { url: `${MAC_SITE}/arm64/1789931890_9.0.2/ffmpeg.zip`, sha256: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924' },
    ffprobe: { url: `${MAC_SITE}/arm64/1789931890_9.0.2/ffprobe.zip`, sha256: 'fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6' }
  },
  x64: {
    ffmpeg: { url: `${MAC_SITE}/amd64/1789931006_9.0.2/ffmpeg.zip`, sha256: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4' },
    ffprobe: { url: `${MAC_SITE}/amd64/1789931006_9.0.2/ffprobe.zip`, sha256: '2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd' }
  }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'vendor', 'ffmpeg')
const stamp = join(target, 'build.sha256')

async function current(files, sha256) {
  if (!files.every((f) => existsSync(join(target, f)))) return false
  return (await readFile(stamp, 'utf8').catch(() => '')).trim() === sha256
}

async function download(url, sha256, to) {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`ffmpeg ${BUILD.version}: the download answered ${res.status}`)
  const hash = createHash('sha256')
  const counted = Readable.fromWeb(res.body).on('data', (chunk) => hash.update(chunk))
  await pipeline(counted, createWriteStream(to))
  const seen = hash.digest('hex')
  if (seen !== sha256) {
    throw new Error(`ffmpeg ${BUILD.version}: the download's SHA-256 is ${seen}, not ${sha256}. Nothing was installed.`)
  }
}

/** Fill a folder beside the target with `fill`, then rename it over the target, so a failure leaves the old folder or none. */
async function staged(stampText, fill) {
  const scratch = await mkdtemp(join(tmpdir(), 'editbay-ffmpeg-'))
  const staging = `${target}.${process.pid}.tmp`
  try {
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    await fill(scratch, staging)
    await writeFile(join(staging, 'build.sha256'), `${stampText}\n`)
    await rm(target, { recursive: true, force: true })
    await rename(staging, target)
    console.log(`fetch-ffmpeg: ffmpeg ${BUILD.version} is in vendor/ffmpeg`)
  } finally {
    await rm(scratch, { recursive: true, force: true })
    await rm(staging, { recursive: true, force: true })
  }
}

async function windows() {
  const files = TAKEN.map((f) => f.replace('bin/', ''))
  if (await current(files, BUILD.sha256)) return
  console.log(`fetch-ffmpeg: downloading ffmpeg ${BUILD.version} (about 110 MB)`)
  await staged(BUILD.sha256, async (scratch, into) => {
    const zip = join(scratch, 'build.zip')
    await download(BUILD.url, BUILD.sha256, zip)
    // Windows' own tar, which reads zips. The one Git Bash puts first on PATH does not.
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    const wanted = TAKEN.map((f) => `${BUILD.folder}/${f}`)
    const r = spawnSync(tar, ['-xf', zip, '-C', scratch, ...wanted], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error(`ffmpeg ${BUILD.version}: the archive could not be opened`)
    for (const f of TAKEN) await copyFile(join(scratch, BUILD.folder, f), join(into, f.replace('bin/', '')))
  })
}

async function mac() {
  const arch = process.env.EDITBAY_TARGET_ARCH ?? process.arch
  const build = MAC_BUILDS[arch]
  if (!build) throw new Error(`fetch-ffmpeg: no Mac build for the chip ${arch}`)
  const both = `${arch} ${build.ffmpeg.sha256} ${build.ffprobe.sha256}`
  if (await current(['ffmpeg', 'ffprobe'], both)) return
  console.log(`fetch-ffmpeg: downloading ffmpeg ${BUILD.version} for ${arch} Macs (about 60 MB)`)
  await staged(both, async (scratch, into) => {
    for (const name of ['ffmpeg', 'ffprobe']) {
      const zip = join(scratch, `${name}.zip`)
      await download(build[name].url, build[name].sha256, zip)
      const r = spawnSync('/usr/bin/unzip', ['-q', '-o', zip, name, '-d', scratch], { stdio: 'inherit' })
      if (r.status !== 0) throw new Error(`ffmpeg ${BUILD.version}: ${name}.zip could not be opened`)
      await copyFile(join(scratch, name), join(into, name))
      await chmod(join(into, name), 0o755)
    }
  })
}

async function main() {
  if (process.platform === 'win32') return windows()
  if (process.platform === 'darwin') return mac()
  console.log('fetch-ffmpeg: Editbay bundles Windows and Mac builds only; skipped on this platform.')
}

await main()

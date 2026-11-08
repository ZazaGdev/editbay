// The Windows installer, packed by the 64-bit 7-Zip when it is installed (audit 2026-11-07).
//
// electron-builder's own 7-Zip picks a 64 MB window at its best setting, too short to see
// that ffprobe is mostly the same code as ffmpeg; today's 7-Zip picks 256 MB, which took the
// 2.0 app's installer from 154.1 MB to 135.2 MB. The installer's own unpacker, a 32-bit
// 7-Zip 19 inside NSIS, unpacks that in about five seconds. Without the 64-bit 7-Zip,
// electron-builder's own is used and the installer is that much bigger, and this says so.
//
//   node scripts/dist-win.mjs <electron-builder's arguments>
//
// EDITBAY_7ZIP names another 7z.exe.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sevenZip = process.env.EDITBAY_7ZIP ?? 'C:\\Program Files\\7-Zip\\7z.exe'
const env = { ...process.env }
if (existsSync(sevenZip)) {
  env.ELECTRON_BUILDER_7ZIP_PATH = sevenZip
  console.log(`Packing with ${sevenZip}`)
} else {
  console.warn(`No 7-Zip at ${sevenZip}: packing with electron-builder's own, and the installer comes out about 19 MB bigger.`)
}
const built = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), ...process.argv.slice(2)], { env, stdio: 'inherit' })
process.exit(built.status ?? 1)

// Plan 74: the command line for agents, built for Node on its own, apart from
// the app. Electron is not there, so its import is given a stand-in. ffmpeg is
// found in vendor/ffmpeg above the built file, as the app finds it (plan 89).
//
// Built beside the target and renamed over it, so a call running the tool
// while it is rebuilt reads the old file or the new one, never half of one.
import { build } from 'esbuild'
import { rename, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'out', 'cli', 'editbay-cli.cjs')
const scratch = `${target}.${process.pid}.tmp`

try {
  await build({
    entryPoints: [join(root, 'src', 'cli', 'index.ts')],
    outfile: scratch,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    alias: { electron: join(root, 'src', 'cli', 'no-electron.ts') },
    // The built file's own address, which a CommonJS bundle has no import.meta for.
    banner: { js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
    define: { 'import.meta.url': '__importMetaUrl' },
    logLevel: 'warning'
  })
  await rename(scratch, target)
} finally {
  await rm(scratch, { force: true })
}

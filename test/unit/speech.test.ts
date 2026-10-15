import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capture } from '../../src/main/ffmpeg/spawn'
import { SpeechError, downloadFile, engineIntact, engineReady, enginePaths, installEngine, removeEngine, type SpeechFile } from '../../src/main/speech/engine'
import { listened, mixArgs, mixGraph, parseWhisperProgress, whisperArgs } from '../../src/main/speech/transcribe'
import { addSource, createTimeline, setClipAudio, type ProjectMedia, type Timeline } from '../../src/shared/project'

function media(id: string, durationSec: number, overrides: Partial<ProjectMedia> = {}): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mkv`,
    playablePath: `C:\\v\\${id}.mkv`,
    conformed: false,
    conformReasons: [],
    durationSec,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: `C:\\c\\${id}\\peaks.bin`,
    filmstripPath: `C:\\c\\${id}\\filmstrip.jpg`,
    ...overrides
  }
}

describe('running whisper', () => {
  it('asks for English, every token with its time from DTW, the sound events suppressed, and its progress', () => {
    expect(whisperArgs('C:\\s\\model.bin', 'medium.en', 'C:\\t\\mix.wav', 'C:\\t\\words', 7)).toEqual([
      '-m', 'C:\\s\\model.bin',
      '-f', 'C:\\t\\mix.wav',
      '-l', 'en',
      '-ojf',
      '-dtw', 'medium.en',
      '-nfa',
      // Without this, a sentence heard under game sound comes back as
      // [a sound event] and reads as a noise rather than as words.
      '-sns',
      '-t', '7',
      '-pp',
      '-of', 'C:\\t\\words'
    ])
  })

  it('names the model it is running, so the word times land on the right words', () => {
    // The alignment heads belong to one model. Handed another model's, whisper.cpp
    // either refuses to start or puts every word time in the wrong place.
    expect(whisperArgs('m', 'small.en', 'w', 'o', 1)).toContain('small.en')
    expect(whisperArgs('m', 'medium.en', 'w', 'o', 1)).toContain('medium.en')
    expect(whisperArgs('m', 'small.en', 'w', 'o', 1)).not.toContain('medium.en')
  })

  it('reads how far it has got from the last progress it printed', () => {
    expect(parseWhisperProgress('whisper_print_progress_callback: progress =  10%\nwhisper_print_progress_callback: progress =  35%\n')).toBeCloseTo(0.35)
    expect(parseWhisperProgress('whisper_init_from_file: loading model')).toBeNull()
  })
})

/**
 * A recording with three streams on V1 at 0 for its whole 10 seconds, linked,
 * cut into nothing: its first stream heard on A1, the others muted on A2 and
 * A3, and a take on A4 from 2 seconds for 1.
 */
function recorded(): Timeline {
  let t: Timeline = {
    ...createTimeline(30, { width: 1080, height: 1920 }),
    media: [
      media('rec', 10, {
        audioTracks: 3,
        trackFiles: [
          { path: 'C:\\c\\rec\\track-2.m4a', peaksPath: 'C:\\c\\rec\\track-2.bin' },
          { path: 'C:\\c\\rec\\track-3.m4a', peaksPath: 'C:\\c\\rec\\track-3.bin' }
        ]
      }),
      media('take', 1, { hasVideo: false, originalPath: 'D:\\vo\\take.wav', playablePath: 'D:\\vo\\take.wav' })
    ]
  }
  t = addSource(t, { mediaId: 'rec', clipId: 'rec', at: 0, onTrack: 'v1' })
  return addSource(t, { mediaId: 'take', clipId: 'take', at: 60 })
}

describe('what is listened to', () => {
  it('is every heard clip on the tracks chosen, read from its own stream, and not those muted', () => {
    const t = recorded()
    const tracks = t.audioTracks.map((r) => r.id)
    expect(listened(t, tracks).map((c) => [c.path, c.atSec, c.lengthSec])).toEqual([
      ['C:\\v\\rec.mkv', 0, 10],
      ['D:\\vo\\take.wav', 2, 1]
    ])
    // The second stream, heard, is read from its copy.
    const both = setClipAudio(t, 'rec.2', { gain: 0.5, muted: false })
    expect(listened(both, tracks).map((c) => [c.path, c.gain])).toEqual([
      ['C:\\v\\rec.mkv', 1],
      ['C:\\c\\rec\\track-2.m4a', 0.5],
      ['D:\\vo\\take.wav', 1]
    ])
  })

  it('leaves out the tracks not chosen, and a clip turned right down', () => {
    const t = recorded()
    expect(listened(t, [t.audioTracks[3]!.id]).map((c) => c.path)).toEqual(['D:\\vo\\take.wav'])
    expect(listened(setClipAudio(t, 'take', { gain: 0, muted: false }), [t.audioTracks[3]!.id])).toEqual([])
  })
})

describe('the mix', () => {
  const clip = (path: string, fromSec: number, lengthSec: number, atSec: number, gain = 1) => ({ path, fromSec, lengthSec, atSec, gain, label: path, copy: false })

  it('reads each file once however many clips are cut from it, each clip its stretch in samples, delayed to where it starts, summed', () => {
    const { inputs, graph } = mixGraph([clip('a.mkv', 0, 2, 0), clip('a.mkv', 5, 1.5, 2), clip('vo.wav', 0, 1, 1, 0.5)])
    expect(inputs).toEqual(['a.mkv', 'vo.wav'])
    expect(graph.split(';\n')).toEqual([
      '[0:a:0]aresample=16000:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=mono,asplit=2[i0_0][i0_1]',
      '[1:a:0]aresample=16000:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=mono,anull[i1_0]',
      '[i0_0]atrim=start_sample=0:end_sample=32000,asetpts=PTS-STARTPTS,volume=1[m0]',
      '[i0_1]atrim=start_sample=80000:end_sample=104000,asetpts=PTS-STARTPTS,volume=1,adelay=32000S:all=1[m1]',
      '[i1_0]atrim=start_sample=0:end_sample=16000,asetpts=PTS-STARTPTS,volume=0.5,adelay=16000S:all=1[m2]',
      '[m0][m1][m2]amix=inputs=3:duration=longest:normalize=0[sum]',
      // Levelled last, so whisper hears a quiet voice under game sound.
      '[sum]speechnorm=e=12.5:r=0.0001:l=1[out]'
    ])
  })

  it('needs no mixing for one clip, and levels it all the same', () => {
    const parts = mixGraph([clip('a.mkv', 0, 2, 0)]).graph.split(';\n')
    expect(parts.at(-2)).toBe('[m0]anull[sum]')
    expect(parts.at(-1)).toBe('[sum]speechnorm=e=12.5:r=0.0001:l=1[out]')
  })

  it('is written as one channel of 16-bit samples at 16 kHz, its graph read from a file', () => {
    expect(mixArgs(['a.mkv', 'vo.wav'], 'C:\\t\\mix.txt', 'C:\\t\\mix.wav')).toEqual([
      '-i', 'a.mkv',
      '-i', 'vo.wav',
      '-/filter_complex', 'C:\\t\\mix.txt',
      '-map', '[out]',
      '-c:a', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      '-y', 'C:\\t\\mix.wav'
    ])
  })
})

// Windows only: the program is downloaded and unpacked with Windows' tar there, and comes with the app on a Mac (plan 104).
describe.runIf(process.platform === 'win32')('downloading the engine', () => {
  let server: Server
  let base = ''
  const files = new Map<string, Buffer>()
  let dir = ''

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'editbay-speech-'))
    server = createServer((req, res) => {
      const body = files.get(req.url ?? '')
      if (!body) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'content-length': body.length })
      res.end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
  })

  const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
  const served = (name: string, body: Buffer, hash = sha(body)): SpeechFile => {
    files.set(`/${name}`, body)
    return { name, url: `${base}/${name}`, sha256: hash, bytes: body.length }
  }

  it('refuses a file whose SHA-256 is not the one expected, and leaves nothing of it behind', async () => {
    const body = Buffer.from('not the model')
    const file = served('bad.bin', body, sha(Buffer.from('the model')))
    const dest = join(dir, 'bad.bin')
    await expect(downloadFile(file, dest, { fetch, onBytes: () => undefined })).rejects.toThrow(SpeechError)
    await expect(downloadFile(file, dest, { fetch, onBytes: () => undefined })).rejects.toThrow(/not the file expected/)
    expect((await readdir(dir)).filter((f) => f.startsWith('bad'))).toEqual([])
  })

  it('writes the right file under its own name, counting the bytes as they come', async () => {
    const body = Buffer.alloc(300_000, 7)
    const file = served('good.bin', body)
    let counted = 0
    await downloadFile(file, join(dir, 'good.bin'), { fetch, onBytes: (n) => (counted += n) })
    expect(counted).toBe(body.length)
    expect(sha(await readFile(join(dir, 'good.bin')))).toBe(file.sha256)
    expect((await readdir(dir)).filter((f) => f.endsWith('.part'))).toEqual([])
  })

  it('says so plainly when the server has no such file', async () => {
    const file = { name: 'gone.bin', url: `${base}/gone.bin`, sha256: '0'.repeat(64), bytes: 1 }
    await expect(downloadFile(file, join(dir, 'gone.bin'), { fetch, onBytes: () => undefined })).rejects.toThrow(/404/)
  })

  it('fails plainly when the file cannot be written, rather than hanging', async () => {
    const file = served('unwritable.bin', Buffer.alloc(1000, 2))
    await expect(downloadFile(file, join(dir, 'no-such-folder', 'unwritable.bin'), { fetch, onBytes: () => undefined })).rejects.toThrow(
      /could not be saved on this computer \(ENOENT\)/
    )
  })

  it('stops when cancelled, and leaves nothing of it behind', async () => {
    const file = served('slow.bin', Buffer.alloc(50_000_000, 1))
    const controller = new AbortController()
    const dest = join(dir, 'slow.bin')
    const going = downloadFile(file, dest, { fetch, onBytes: () => controller.abort(), signal: controller.signal })
    await expect(going).rejects.toThrow()
    expect((await readdir(dir)).filter((f) => f.startsWith('slow'))).toEqual([])
  })

  it('puts the program and the model in place, unpacked, and is then ready', async () => {
    // A zip shaped like whisper.cpp's: its program in a Release folder.
    const build = join(dir, 'build')
    await mkdir(join(build, 'Release'), { recursive: true })
    await writeFile(join(build, 'Release', 'whisper-cli.exe'), 'program')
    const zip = join(dir, 'engine.zip')
    await capture(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, '-C', build, 'Release'])
    const sources = {
      engine: served('whisper-bin-x64.zip', await readFile(zip)),
      model: { ...served('model.bin', Buffer.from('model')), dtw: 'medium.en' }
    }
    const folder = join(dir, 'speech')
    expect(await engineReady(folder, sources)).toBe(false)
    const seen: number[] = []
    await installEngine(folder, { fetch, onProgress: (f) => seen.push(f), sources })
    expect(await engineReady(folder, sources)).toBe(true)
    expect((await readFile(enginePaths(folder, sources).cli)).toString()).toBe('program')
    expect(seen.at(-1)).toBe(1)
    // The zip goes once it is unpacked.
    expect((await readdir(folder)).sort()).toEqual(['model.bin', 'whisper-b5130'])
  })
})

describe.runIf(process.platform === 'win32')('the engine before each run (audit 2026-10-01)', () => {
  it('runs only while its program and libraries are the ones downloaded, and is taken away when one has changed', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'editbay-engine-'))
    try {
      const cli = enginePaths(folder).cli
      const dir = join(cli, '..')
      await mkdir(dir, { recursive: true })
      await writeFile(cli, 'program')
      await writeFile(join(dir, 'whisper.dll'), 'library')
      const sum = (text: string): string => createHash('sha256').update(text).digest('hex')
      const files = { 'whisper-cli.exe': sum('program'), 'whisper.dll': sum('library') }
      expect(await engineIntact(folder, files)).toBe(true)
      await writeFile(join(dir, 'whisper.dll'), 'something else')
      expect(await engineIntact(folder, files)).toBe(false)
      await rm(join(dir, 'whisper.dll'))
      expect(await engineIntact(folder, files)).toBe(false)
      await removeEngine(folder)
      expect(await engineReady(folder)).toBe(false)
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})

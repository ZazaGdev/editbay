import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'

const ROOT = join(process.cwd(), 'test', '.fixtures')

/**
 * Fixtures for one test file.
 *
 * Each test file gets its own directory. Sharing one would let two files
 * generate and delete the same paths at the same time, which fails in ways that
 * look like product bugs.
 */
export function fixtureSet(name: string): FixtureSet {
  const dir = join(ROOT, name)

  async function generate(file: string, args: string[]): Promise<string> {
    await mkdir(dir, { recursive: true })
    const out = join(dir, file)
    await capture(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args, out])
    return out
  }

  return {
    dir,

    cleanup: () => rm(dir, { recursive: true, force: true }),

    /** Constant 30fps H.264 with 48kHz stereo AAC. Needs no conforming. */
    cleanClip: () =>
      generate('clean.mp4', [
        '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=4',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2',
        '-shortest'
      ]),

    /**
     * Genuinely variable timing. Frames are dropped on two coprime cycles so the
     * gaps between survivors are irregular, and the original timestamps are kept.
     *
     * Note that ffprobe reports a clean 30/1 for both rates on this file. That is
     * the point: it is only detectable from the packet timestamps, exactly like a
     * real screen recording.
     */
    vfrClip: () =>
      generate('vfr.mkv', [
        '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=6',
        '-vf', "select='not(eq(mod(n,7),0)+eq(mod(n,11),0))',setpts=PTS-STARTPTS",
        '-fps_mode', 'passthrough',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast'
      ]),

    /** No audio stream at all. */
    silentClip: () =>
      generate('silent.mp4', [
        '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=3',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast'
      ]),

    /**
     * Shaped like the owner's OBS recordings: a 3840x1080 canvas at 60 fps in
     * Matroska, with two audio tracks. The left 1920 is solid red and the right
     * 1920 solid blue, so which view ended up where can be read back from pixels.
     */
    obsClip: (rate = 60) =>
      generate(rate === 60 ? 'obs.mkv' : `obs-${rate}.mkv`, [
        '-f', 'lavfi', '-i', `color=c=red:s=1920x1080:r=${rate}:d=3`,
        '-f', 'lavfi', '-i', `color=c=blue:s=1920x1080:r=${rate}:d=3`,
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3',
        '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=3',
        '-filter_complex', '[0:v][1:v]hstack=inputs=2[v]',
        '-map', '[v]', '-map', '2:a', '-map', '3:a',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2'
      ]),

    /**
     * Shaped like an OBS recording with three audio tracks, 3 seconds long:
     * track 1 a 440 Hz tone, track 2 an 880 Hz tone, and track 3 silent but
     * for one short beep at exactly 1.00 s of the recording. Track 3 starts
     * 20 ms after the picture, as OBS can start a track, so a copy of it that
     * began at its own first sound would put the beep 20 ms early.
     */
    obsTracksClip: () =>
      generate('obs-tracks.mkv', [
        '-f', 'lavfi', '-i', 'color=c=red:s=1920x1080:r=60:d=3',
        '-f', 'lavfi', '-i', 'color=c=blue:s=1920x1080:r=60:d=3',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3',
        '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=3',
        '-itsoffset', '0.02',
        '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=2.98',
        '-filter_complex',
        "[0:v][1:v]hstack=inputs=2[v];[4:a]volume=volume=0:enable='not(between(t,1.0,1.05))'[beep]",
        '-map', '[v]', '-map', '2:a', '-map', '3:a', '-map', '[beep]',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2'
      ]),

    /**
     * Shaped like the owner's OBS recordings, which carry six audio streams
     * named Track1 to Track6: OBS sends the microphone to streams 1, 4 and 6,
     * and records 2, 3 and 5 though nothing is routed to them. Here 1, 4 and 6
     * are the same 440 Hz tone and 2, 3 and 5 pure silence, under a 3 second
     * 3840x1080 picture at 60 fps, red on the left and blue on the right.
     */
    obsSixClip: () =>
      generate('obs-six.mkv', [
        '-f', 'lavfi', '-i', 'color=c=red:s=1920x1080:r=60:d=3',
        '-f', 'lavfi', '-i', 'color=c=blue:s=1920x1080:r=60:d=3',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3',
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-filter_complex',
        '[0:v][1:v]hstack=inputs=2[v];[2:a]asplit=3[m1][m4][m6];[3:a]atrim=duration=3,asplit=3[s2][s3][s5]',
        '-map', '[v]',
        '-map', '[m1]', '-map', '[s2]', '-map', '[s3]', '-map', '[m4]', '-map', '[s5]', '-map', '[m6]',
        ...[1, 2, 3, 4, 5, 6].flatMap((n) => [`-metadata:s:a:${n - 1}`, `title=Track${n}`]),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2'
      ]),

    /**
     * A solid colour with a tone under it, 30 fps and 320x180.
     *
     * Two of these make a cut where what the export actually did can be read
     * off one pixel and one frequency: a dissolve between red and blue is
     * neither at its middle, and a crossfade has both tones in it at once.
     */
    solidClip: (colour: string, hz: number, seconds = 2, rate = 30) =>
      generate(`solid-${colour}-${hz}-${rate}.mp4`, [
        '-f', 'lavfi', '-i', `color=c=${colour}:s=320x180:r=${rate}:d=${seconds}`,
        '-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=48000:duration=${seconds}`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2',
        '-shortest'
      ]),

    /**
     * A sound file: one second of 44.1 kHz stereo WAV, silent but for a beep
     * from 0.5 s to 0.55 s. At 44.1 kHz so that anything that counts its
     * samples at the export's 48 kHz puts the beep in the wrong place.
     */
    beepWav: () =>
      generate('beep.wav', [
        '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100:duration=1',
        '-af', "volume=volume=0:enable='not(between(t,0.5,0.55))'",
        '-ar', '44100', '-ac', '2'
      ]),

    /**
     * Six seconds of steady hiss at about -45 dB, with a 1 kHz tone at about
     * -20 dB from 2 s to 4 s: a voice over a noisy microphone, to clean up.
     */
    hissyWav: () =>
      generate('hissy.wav', [
        '-f', 'lavfi', '-i', 'anoisesrc=color=white:amplitude=0.006:sample_rate=44100:duration=6',
        '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100:duration=6',
        '-filter_complex', "[1:a]volume=0.1,volume=volume=0:enable='not(between(t,2,4))'[tone];[0:a][tone]amix=inputs=2:normalize=0",
        '-ar', '44100', '-ac', '2'
      ]),

    /**
     * Six seconds of 44.1 kHz WAV, silent but for a 1 kHz tone from 2 s to 4 s:
     * a voice that talks in the middle, which a ducked track comes down under.
     */
    voiceWav: () =>
      generate('voice.wav', [
        '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100:duration=6',
        '-af', "volume=volume=0:enable='not(between(t,2,4))'",
        '-ar', '44100', '-ac', '2'
      ]),

    /** Six seconds of a steady tone as a 44.1 kHz WAV: a song long enough to run across a cut. */
    songWav: () =>
      generate('song.wav', [
        '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100:duration=6',
        '-ar', '44100', '-ac', '2'
      ]),

    /**
     * Six seconds of a steady 440 Hz tone as a 44.1 kHz WAV: music laid under
     * cuts, where a piece read a sample out of place at a cut makes a click.
     */
    toneWav: () =>
      generate('tone.wav', [
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=6',
        '-ar', '44100', '-ac', '2'
      ]),

    /**
     * The clean clip with a keyframe every second, as OBS writes one every
     * second or two: a cut on one seeks straight to it, and the sound has
     * nothing before it to settle on.
     */
    keyedClip: () =>
      generate('keyed.mp4', [
        '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=4',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
        '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2',
        '-shortest'
      ]),

    /**
     * The same tone as AAC in an M4A, as a song usually comes and as every
     * copy of a recording's stream is made: a compressed sound comes out of a
     * seek wrong for its first moment.
     */
    toneM4a: () =>
      generate('tone.m4a', [
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=6',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2'
      ]),

    /** The same beep as an MP3, which a browser seeks only roughly, so import converts it. */
    beepMp3: () =>
      generate('beep.mp3', [
        '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100:duration=1',
        '-af', "volume=volume=0:enable='not(between(t,0.5,0.55))'",
        '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2'
      ]),

    /** A solid red picture, 4 seconds at 30 fps, with a tone: V1 under a picture, easy to tell from it. */
    redClip: () =>
      generate('red.mp4', [
        '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=30:d=4',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest'
      ]),

    /**
     * Solid red at 25 fps, 4 seconds, silent but for a beep at exactly 3.0 s:
     * phone footage whose frames do not land on a 30 fps project's frame times,
     * with a sound that shows whether what comes after a cut is late.
     */
    red25Beep: () =>
      generate('red25-beep.mp4', [
        '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=25:d=4',
        '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=4',
        '-filter_complex', "[1:a]volume=volume=0:enable='not(between(t,3.0,3.05))'[a]",
        '-map', '0:v', '-map', '[a]',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest'
      ]),

    /**
     * Four bands of colour, one above another, 1920x1080 at 30 fps for 2
     * seconds: orange, green, blue and grey, each a quarter of the height. Any
     * frame shape crops the whole height, so each band is at the same height
     * in the Output view and an exported frame (plan 85).
     */
    colourBands: () =>
      generate('colour-bands.mp4', [
        '-f', 'lavfi', '-i', 'color=c=0xC86432:s=1920x270:r=30:d=2',
        '-f', 'lavfi', '-i', 'color=c=0x3CA05A:s=1920x270:r=30:d=2',
        '-f', 'lavfi', '-i', 'color=c=0x4664C8:s=1920x270:r=30:d=2',
        '-f', 'lavfi', '-i', 'color=c=0xB4B4B4:s=1920x270:r=30:d=2',
        '-filter_complex', '[0:v][1:v][2:v][3:v]vstack=inputs=4,format=yuv420p[v]',
        '-map', '[v]',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '4',
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'
      ]),

    /**
     * Solid red at 30 fps, 4 seconds, whose sound starts 0.28 s after its
     * picture, as a phone's or a screen recorder's often does, silent but for
     * a beep at exactly 3.0 s of the recording. The beep is placed by the
     * sound's own timestamps, which already start at 0.28.
     */
    lateSoundBeep: () =>
      generate('late-sound-beep.mp4', [
        '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=30:d=4',
        '-itsoffset', '0.28',
        '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=3.72',
        '-filter_complex', "[1:a]volume=volume=0:enable='not(between(t,3.0,3.05))'[a]",
        '-map', '0:v', '-map', '[a]',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2'
      ]),

    /**
     * A picture whose every frame is a shade lighter than the one before, at
     * 25 fps for 4 seconds, so which of its frames is on screen can be read
     * back from its brightness: frame N is 16 + 2N.
     */
    countingClip: () =>
      generate('counting.mp4', [
        '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=25:d=4',
        '-vf', "geq=lum='16+2*N':cb=128:cr=128",
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-crf', '10'
      ]),

    /**
     * Seven seconds at 30 fps with a tone, 640x360: black with a green box
     * over its middle half, 160 to 480 across and 90 to 270 down. Long
     * enough to zoom in and back out on as a talking head is, and a zoom can
     * be read off one pixel: closer in, the green reaches further up.
     */
    targetClip: () =>
      generate('target.mp4', [
        '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30:d=7,drawbox=x=160:y=90:w=320:h=180:color=green:t=fill',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=7',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2',
        '-shortest'
      ]),

    /** A solid green picture, 3 seconds at 25 fps, with no sound: a picture to lay over V1. */
    greenClip: () =>
      generate('green.mp4', [
        '-f', 'lavfi', '-i', 'color=c=green:s=640x360:r=25:d=3',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast'
      ]),

    /**
     * A 400x200 PNG, clear except for an opaque green box in its middle half,
     * 200x100. Its clear pixels are magenta underneath, so an export that drops
     * the transparency instead of honouring it shows magenta, not what is under it.
     */
    logoPng: () =>
      generate('logo.png', [
        '-f', 'lavfi', '-i', 'color=c=black:s=400x200,format=rgba',
        '-vf',
        "geq=r='if(between(X,100,299)*between(Y,50,149),0,255)':g='if(between(X,100,299)*between(Y,50,149),200,0)':" +
          "b='if(between(X,100,299)*between(Y,50,149),0,255)':a='if(between(X,100,299)*between(Y,50,149),255,0)'",
        '-frames:v', '1'
      ]),

    /**
     * A 200x100 GIF of two frames at 2 a second, looping: green, then magenta,
     * opaque on its left half and clear on its right.
     */
    animGif: () =>
      generate('anim.gif', [
        '-f', 'lavfi', '-i', 'color=c=black:s=200x100:r=2:d=1,format=rgba',
        '-filter_complex',
        "geq=r='if(lt(N,1),0,255)':g='if(lt(N,1),200,0)':b='if(lt(N,1),0,255)':a='if(lt(X,100),255,0)'," +
          'split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128',
        '-loop', '0'
      ]),

    /**
     * Wider than the 4K conform cap, and 10-bit so that it needs conforming at
     * all. Short and low frame rate, because the point is the resolution.
     */
    oversizedClip: () =>
      generate('oversized.mp4', [
        '-f', 'lavfi', '-i', 'testsrc2=size=4200x2364:rate=10:duration=1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p10le', '-profile:v', 'high10', '-preset', 'ultrafast'
      ])
  }
}

export interface FixtureSet {
  dir: string
  cleanup: () => Promise<void>
  cleanClip: () => Promise<string>
  vfrClip: () => Promise<string>
  silentClip: () => Promise<string>
  /** At 60 fps unless another rate is asked for. */
  obsClip: (rate?: number) => Promise<string>
  obsTracksClip: () => Promise<string>
  obsSixClip: () => Promise<string>
  /** A solid colour with a tone under it: `solidClip('red', 440)`. At 30 fps unless another rate is asked for. */
  solidClip: (colour: string, hz: number, seconds?: number, rate?: number) => Promise<string>
  beepWav: () => Promise<string>
  targetClip: () => Promise<string>
  hissyWav: () => Promise<string>
  voiceWav: () => Promise<string>
  songWav: () => Promise<string>
  toneWav: () => Promise<string>
  toneM4a: () => Promise<string>
  keyedClip: () => Promise<string>
  beepMp3: () => Promise<string>
  redClip: () => Promise<string>
  red25Beep: () => Promise<string>
  lateSoundBeep: () => Promise<string>
  colourBands: () => Promise<string>
  countingClip: () => Promise<string>
  greenClip: () => Promise<string>
  logoPng: () => Promise<string>
  animGif: () => Promise<string>
  oversizedClip: () => Promise<string>
}

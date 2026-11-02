// Task 2355: which way of making sound makes Electron ask macOS for the
// microphone, on a Mac whose sound output is also a microphone. Opens a
// window that makes sound one way, named by --variant, and quits after a
// few seconds. The workflow counts the microphone requests each one made.
const { app, BrowserWindow } = require('electron')

const variant = (process.argv.find((a) => a.startsWith('--variant=')) || '--variant=none').slice('--variant='.length)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// A second of silence, as a WAV: 8 kHz, 16-bit, mono.
const WAV = (() => {
  const data = 8000 * 2
  const b = Buffer.alloc(44 + data)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + data, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(8000, 24)
  b.writeUInt32LE(16000, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(data, 40)
  return `data:audio/wav;base64,${b.toString('base64')}`
})()

const PAGES = {
  none: '',
  'context-interactive': `new AudioContext({ latencyHint: 'interactive' })`,
  'context-playback': `new AudioContext({ latencyHint: 'playback' })`,
  'context-resumed': `const c = new AudioContext(); c.resume(); const o = c.createOscillator(); const g = c.createGain(); g.gain.value = 0; o.connect(g).connect(c.destination); o.start()`,
  'audio-element': `const a = new Audio('${WAV}'); a.loop = true; a.play()`,
  // As the preview's players hold a clip: loaded, never played.
  'audio-element-loaded': `const a = document.createElement('audio'); a.preload = 'auto'; a.src = '${WAV}'; document.body.append(a)`,
  'audio-element-loaded-muted': `const a = document.createElement('audio'); a.preload = 'auto'; a.muted = true; a.src = '${WAV}'; document.body.append(a)`
}

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 400, height: 300 })
  const script = PAGES[variant]
  if (script === undefined) {
    console.error(`unknown variant ${variant}`)
    app.exit(2)
    return
  }
  void win.loadURL(`data:text/html,<p>${variant}</p><script>${encodeURIComponent(script)}</script>`)
  setTimeout(() => app.exit(0), 8000)
})

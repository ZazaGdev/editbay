// Task 2355: which way of making sound makes Electron ask macOS for the
// microphone, on a Mac whose sound output is also a microphone. Opens a
// window that makes sound one way, named by --variant, and quits after a
// few seconds. The workflow counts the microphone requests each one made.
const { app, BrowserWindow } = require('electron')

const variant = (process.argv.find((a) => a.startsWith('--variant=')) || '--variant=none').slice('--variant='.length)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// A tenth of a second of silence, as a WAV.
const WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='

const PAGES = {
  none: '',
  'context-interactive': `new AudioContext({ latencyHint: 'interactive' })`,
  'context-playback': `new AudioContext({ latencyHint: 'playback' })`,
  'context-resumed': `const c = new AudioContext(); c.resume(); const o = c.createOscillator(); const g = c.createGain(); g.gain.value = 0; o.connect(g).connect(c.destination); o.start()`,
  'audio-element': `const a = new Audio('${WAV}'); a.loop = true; a.play()`
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

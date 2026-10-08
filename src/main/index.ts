import { app, BrowserWindow, dialog, Menu, session, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { registerIpc, settingsRead } from './ipc'
import { resetProject } from './project/session'
import { verifyFfmpeg } from './ffmpeg/locate'
import { forgetLastProject, guardClose, openDocument, startup } from './project/lifecycle'
import { projectPathFromArgs } from './project/launch'
import { registerFileType, shouldRegisterFileType } from './settings/file-association'
import { cacheRoot, sweepLeftovers } from './media/cache'
import { pruneCache } from './media/prune'
import { cacheInUse } from './media/cache-in-use'
import { isUnderTest, quietDialogs, quietShell, quitWithParent } from './test-mode'
import { testLaunch } from './test-launch'
import { keepTake } from './voiceover/takes'

/**
 * How often a recovery copy is written while there are unsaved changes. The
 * variable exists so the tests can crash the app without waiting a minute.
 */
/**
 * Whether this is a development or test run rather than the installed app:
 * the switches below that only tests and development use are read only then
 * (audit 2026-10-01), so nothing set in the environment changes how the
 * installed app behaves, or, worse, what it loads its window from.
 */
const DEVELOPING = !app.isPackaged

const AUTOSAVE_MS = (DEVELOPING && Number(process.env.EDITBAY_AUTOSAVE_MS)) || 60_000

/**
 * Whether the window is being opened by the UI tests, which drive the real app
 * thirty times over in one run.
 *
 * Shown normally, each of those thirty windows jumps in front of whatever is on
 * the first monitor and takes the keyboard with it, which makes the machine
 * unusable for as long as the suite runs. Out of the way it is opened without
 * being given the focus, see-through and off the side of the screen, so the
 * keyboard stays where it was and nothing flashes up. It is still a real,
 * composited window: Playwright reaches the page through the debugger rather
 * than through the screen, and the preview's own clock goes on running, which
 * a window that was never shown at all would not do.
 */
/**
 * Under the test switch, nothing waits for a person and nothing outlives the
 * run that started it: see test-mode.ts. Never read by the installed app.
 */
const UNDER_TEST = isUnderTest(process.env, app.isPackaged)
// The packaged copy made for the packaged test (`npm run dist:test`) is kept
// out of the way too, but only when both are true: a test's own settings
// folder and the switch. Nobody starting the installed app passes either.
const OUT_OF_THE_WAY =
  (DEVELOPING || testLaunch) && (process.env.EDITBAY_TEST_WINDOW === 'hidden' || UNDER_TEST)
/** The development server the window loads from, in development only. */
const RENDERER_URL = DEVELOPING ? process.env.ELECTRON_RENDERER_URL : undefined

const here = dirname(fileURLToPath(import.meta.url))

// A development run keeps its own settings. Otherwise it would share the
// installed app's single instance lock, and quietly hand itself over to the
// installed app whenever that is open, and it would reopen, autosave and
// offer to recover your real projects.
if (RENDERER_URL) {
  app.setPath('userData', join(app.getPath('appData'), 'Editbay Dev'))
}

/**
 * With no handler of its own, Electron grants every permission a page asks
 * for. The window needs three: the microphone, for a voice over, full screen,
 * for the monitor, and the names of the fonts installed, for text's font
 * list. A camera, and everything else, is refused.
 */
const ALLOWED = new Set(['fullscreen', 'local-fonts'])
function allowMicrophoneOnly(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (ALLOWED.has(permission)) {
      callback(true)
      return
    }
    if (permission !== 'media') {
      callback(false)
      return
    }
    const types = (details as { mediaTypes?: string[] }).mediaTypes ?? []
    callback(!types.includes('video'))
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) => {
    if (ALLOWED.has(permission)) return true
    if (permission !== 'media') return false
    return (details as { mediaType?: string }).mediaType !== 'video'
  })
}

/**
 * The window only ever shows the app's own page. It never opens another
 * window, and never navigates away, whatever a link or a dropped file asks.
 */
function stayOnThePage(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    // Below this the three columns stop fitting beside each other.
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#14161a',
    // The packaged exe carries the icon inside it, so Windows finds it for the
    // window and the taskbar without being told. A development run is
    // Electron's own binary, which carries Electron's icon, so that one is
    // pointed at the file. `build` is not packaged, which is why this is not
    // simply set both ways.
    ...(app.isPackaged ? {} : { icon: join(here, '../../build/icon.ico') }),
    // Never able to take the focus either (task 78): whatever a test does to
    // the window, the keyboard stays with whoever is at the machine. Playwright
    // types into the page through the debugger, which needs no focus.
    ...(OUT_OF_THE_WAY ? { show: false, skipTaskbar: true, opacity: 0, focusable: false } : {}),
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A window nobody can see is a window Chromium slows the timers down in,
      // and the tests time playback. Only under the tests: a real window that
      // is genuinely hidden should be allowed to go quiet.
      ...(OUT_OF_THE_WAY ? { backgroundThrottling: false } : {})
    }
  })
  // Shown without being handed the focus, and only once it has something to
  // draw. Normally Electron shows it as it is made, which is what it should do.
  // A window at no opacity is still a window the mouse can land on, so it is
  // told to let the pointer through: an invisible thing swallowing clicks in
  // the middle of the screen is worse than a visible one. Playwright's own
  // clicks go into the page through the debugger and are not affected.
  if (OUT_OF_THE_WAY) {
    win.setIgnoreMouseEvents(true)
    win.once('ready-to-show', () => win.showInactive())
  }
  guardClose(win)
  stayOnThePage(win)
  // The window's process gone, crashed or killed: drawn again on the project
  // still open here, and that project not opened by itself at the next launch.
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return
    forgetLastProject()
    void keepTake()
    if (!win.isDestroyed()) win.webContents.reload()
  })
  // A window loaded again, from the crash screen, has no recorder: a take it
  // was recording is kept as it stands, and closing no longer says one is
  // still recording (audit 2026-10-08).
  win.webContents.on('did-start-loading', () => void keepTake())

  if (RENDERER_URL) {
    void win.loadURL(RENDERER_URL)
  } else {
    void win.loadFile(join(here, '../renderer/index.html'))
  }
}

// One app, one window. Double-clicking a project while the app is open, or
// starting it again, hands over to the one already running, which asks about
// unsaved changes before opening anything.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv, workingDirectory) => {
    const win = BrowserWindow.getAllWindows()[0] ?? null
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    const path = projectPathFromArgs(argv, workingDirectory)
    if (path) void openDocument(win, path)
  })

  void app.whenReady().then(async () => {
    if (UNDER_TEST) {
      quietDialogs(dialog)
      quietShell(shell)
      quitWithParent(process.ppid, () => app.exit(0))
    }
    // Electron's default menu offers nothing of this app's own, and its hidden
    // accelerators would fire alongside any shortcut you bind: Ctrl+R reloads the
    // window and loses unsaved work, Ctrl+W closes it.
    Menu.setApplicationMenu(null)
    allowMicrophoneOnly()
    registerIpc()
    try {
      await verifyFfmpeg()
    } catch (err) {
      dialog.showErrorBox('ffmpeg is unusable', err instanceof Error ? err.message : String(err))
      app.quit()
      return
    }
    try {
      // The project the app starts with is a new one in the shape you chose last.
      await settingsRead()
      resetProject()
      await startup(app.getPath('userData'), AUTOSAVE_MS, projectPathFromArgs(process.argv, process.cwd()))
    } catch {
      // Whatever went wrong, a window must open: without one, this process
      // would hold the single instance lock and every later launch would hand
      // itself over to an app nobody can see.
    }
    createWindow()

    // What a crash left in the temp folder and the cache, cleared in the
    // background: nothing waits on it, and whatever it cannot remove is left
    // for the next start.
    // Then what no project has used for a long while (audit 2026-10-01).
    void sweepLeftovers({ temp: app.getPath('temp'), cache: cacheRoot() })
      .catch(() => undefined)
      .then(() => pruneCache(cacheRoot(), cacheInUse()))
      .catch(() => undefined)

    // Double-clicking a project opens this copy of the app.
    if (shouldRegisterFileType(app.isPackaged, process.argv)) {
      void registerFileType(process.execPath).catch(() => undefined)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

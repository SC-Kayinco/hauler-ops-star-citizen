const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

// Dev when launched unpackaged (`electron .`); production when packaged.
const isDev = !app.isPackaged
const DEV_URL = 'http://localhost:5173'
// Only treat .png / .jpg / .jpeg as importable screenshots. NOTE: on HDR displays Windows
// saves a .jxr sidecar next to the .png for each capture — we deliberately ignore .jxr (and
// any other format) so the same shot isn't picked up twice and can't be fed to OCR.
const IMG_RE = /\.(png|jpe?g)$/i

// Small persisted config (e.g. the user's chosen screenshot folder).
const configPath = path.join(app.getPath('userData'), 'config.json')
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    return {}
  }
}
function saveConfig(cfg) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2))
  } catch {
    /* best-effort */
  }
}

// Folder OBS drops screenshots into; the app watches it for new captures.
// User-changeable via the folder picker, persisted in config.json.
let capturesDir = loadConfig().capturesDir || path.join(app.getPath('documents'), 'HaulerOps', 'captures')
try {
  fs.mkdirSync(capturesDir, { recursive: true })
} catch {
  /* ignore */
}

let mainWin = null
let watcher = null
// (Re)watch the current captures folder and notify the renderer of new screenshots.
function watchCaptures() {
  if (watcher) {
    try {
      watcher.close()
    } catch {
      /* ignore */
    }
    watcher = null
  }
  try {
    watcher = fs.watch(capturesDir, (_event, filename) => {
      if (filename && IMG_RE.test(filename)) {
        const p = path.join(capturesDir, filename)
        setTimeout(() => {
          if (fs.existsSync(p) && mainWin && !mainWin.isDestroyed()) {
            mainWin.webContents.send('hauler:new-capture', { path: p, name: filename })
          }
        }, 400)
      }
    })
  } catch {
    /* watching is best-effort */
  }
}

function listCaptures() {
  try {
    return fs
      .readdirSync(capturesDir)
      .filter((f) => IMG_RE.test(f))
      .map((f) => {
        const p = path.join(capturesDir, f)
        return { path: p, name: f, mtime: fs.statSync(p).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    return []
  }
}

function mediaTypeFor(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  return 'image/jpeg'
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#06131f',
    autoHideMenuBar: true,
    title: 'HAULER OPS',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Local-only app (loads bundled files, no remote content). Disabling web security
      // lets the OCR worker load its wasm core + traineddata from file:// for full offline use.
      webSecurity: false,
    },
  })

  if (isDev) {
    win.loadURL(DEV_URL)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  // Notify the renderer when OBS drops a new screenshot into the current folder.
  mainWin = win
  watchCaptures()

  return win
}

ipcMain.handle('hauler:get-dir', () => capturesDir)
// Let the user choose a different screenshot folder; persists & re-watches. Returns the
// current dir (new one if chosen, unchanged if cancelled).
ipcMain.handle('hauler:pick-dir', async () => {
  try {
    const res = await dialog.showOpenDialog({
      title: 'Choose your OBS screenshot folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (res.canceled || !res.filePaths.length) return capturesDir
    capturesDir = res.filePaths[0]
    try {
      fs.mkdirSync(capturesDir, { recursive: true })
    } catch {
      /* ignore */
    }
    saveConfig({ ...loadConfig(), capturesDir })
    watchCaptures()
    return capturesDir
  } catch {
    return capturesDir
  }
})
ipcMain.handle('hauler:list-captures', () => listCaptures())
ipcMain.handle('hauler:read-image', (_e, filePath) => {
  try {
    const b = fs.readFileSync(filePath).toString('base64')
    return `data:${mediaTypeFor(filePath)};base64,${b}`
  } catch {
    return null
  }
})

// Pick a .glb/.gltf ship model from anywhere on disk (no rebuild needed).
ipcMain.handle('hauler:pick-model', async () => {
  try {
    const res = await dialog.showOpenDialog({
      title: 'Select a ship model',
      properties: ['openFile'],
      filters: [{ name: '3D model', extensions: ['glb', 'gltf'] }],
    })
    if (res.canceled || !res.filePaths.length) return null
    return res.filePaths[0]
  } catch {
    return null
  }
})

// Read a model file as a data: URL the renderer can hand to the GLTF loader.
ipcMain.handle('hauler:read-model', (_e, filePath) => {
  try {
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const mime = ext === 'gltf' ? 'model/gltf+json' : 'model/gltf-binary'
    const b = fs.readFileSync(filePath).toString('base64')
    return `data:${mime};base64,${b}`
  } catch {
    return null
  }
})

// Auto-update (installer builds only). Checks GitHub Releases on startup for a newer version,
// downloads it in the background, and shows a native notification when it's ready — it then
// installs on next quit. This is the ONLY thing that talks to GitHub: it fetches the public
// release metadata (latest.yml) and asks "is there a newer version?" — it sends nothing about
// the user. The portable build can't self-update, so this is a no-op there. Fully best-effort:
// any failure (offline, portable, etc.) is swallowed so it never disrupts the app.
function initAutoUpdater() {
  if (isDev) return
  let autoUpdater
  try {
    ;({ autoUpdater } = require('electron-updater'))
  } catch {
    return // updater not bundled (e.g. portable) — skip silently
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (err) => {
    console.error('[updater]', (err && err.message) || err)
  })
  autoUpdater.on('update-downloaded', (info) => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('hauler:update-ready', { version: info && info.version })
    }
  })
  try {
    autoUpdater.checkForUpdatesAndNotify()
  } catch {
    /* offline / best-effort */
  }
}

app.whenReady().then(() => {
  createWindow()
  initAutoUpdater()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

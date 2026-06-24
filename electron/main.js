const { app, BrowserWindow, shell, Menu } = require('electron')
const { spawn, exec } = require('child_process')
const path = require('path')
const http = require('http')

let mainWindow = null
let dockerProcess = null
const API_URL = 'http://localhost:8000'
const FRONTEND_URL = 'http://localhost:5173'

// ── Docker ────────────────────────────────────────────────────────────────────

function startDocker() {
  return new Promise((resolve, reject) => {
    const cwd = path.join(__dirname, '..')
    console.log('[gael] Starting Docker Compose in', cwd)

    dockerProcess = spawn('docker', ['compose', 'up', '--build', '--wait'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    dockerProcess.stdout.on('data', d => process.stdout.write('[docker] ' + d))
    dockerProcess.stderr.on('data', d => process.stderr.write('[docker] ' + d))

    dockerProcess.on('error', err => reject(new Error('Docker not found: ' + err.message)))
    // exit code 0 = already up or started cleanly; non-zero = real error
    dockerProcess.on('exit', code => {
      if (code !== 0 && code !== null) console.warn('[gael] docker compose exit code:', code)
    })

    // poll until API responds
    waitForUrl(API_URL + '/health', 120).then(resolve).catch(reject)
  })
}

function stopDocker() {
  return new Promise(resolve => {
    if (dockerProcess) {
      dockerProcess.kill()
      dockerProcess = null
    }
    const cwd = path.join(__dirname, '..')
    exec('docker compose down', { cwd }, () => resolve())
  })
}

function waitForUrl(url, timeoutSec) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutSec * 1000
    const attempt = () => {
      http.get(url, res => {
        if (res.statusCode < 500) return resolve()
        retry()
      }).on('error', retry)
    }
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error(`Timeout waiting for ${url}`))
      setTimeout(attempt, 1000)
    }
    attempt()
  })
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    title: 'Gael',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })

  mainWindow.loadURL(FRONTEND_URL)

  // open external links in the default browser, not in the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

function buildMenu() {
  const template = [
    {
      label: 'Gael',
      submenu: [
        { role: 'about', label: 'À propos de Gael' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Masquer Gael' },
        { role: 'hideOthers', label: 'Masquer les autres' },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter Gael' },
      ],
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'selectAll', label: 'Tout sélectionner' },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        { role: 'reload', label: 'Recharger' },
        { role: 'toggleDevTools', label: 'Outils de développement' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Taille réelle' },
        { role: 'zoomIn', label: 'Agrandir' },
        { role: 'zoomOut', label: 'Réduire' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' },
      ],
    },
    {
      label: 'Fenêtre',
      submenu: [
        { role: 'minimize', label: 'Réduire' },
        { role: 'zoom', label: 'Zoom' },
        { type: 'separator' },
        { role: 'front', label: 'Tout afficher au premier plan' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  buildMenu()

  // Show a loading window while Docker starts
  mainWindow = new BrowserWindow({
    width: 480,
    height: 300,
    resizable: false,
    titleBarStyle: 'hiddenInset',
    title: 'Gael',
    webPreferences: { contextIsolation: true },
  })
  mainWindow.loadFile(path.join(__dirname, 'loading.html'))

  try {
    await startDocker()
    mainWindow.close()
    createWindow()
  } catch (err) {
    console.error('[gael] Startup failed:', err)
    mainWindow.loadFile(path.join(__dirname, 'error.html'))
  }
})

app.on('window-all-closed', async () => {
  await stopDocker()
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// Ensure Docker is stopped if the process is killed
process.on('exit', () => { if (dockerProcess) dockerProcess.kill() })
process.on('SIGINT', () => { stopDocker().then(() => process.exit()) })
process.on('SIGTERM', () => { stopDocker().then(() => process.exit()) })

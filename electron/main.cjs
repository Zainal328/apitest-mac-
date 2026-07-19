// CJS entry: keep it minimal and only import electron here.
// IMPORTANT: unset ELECTRON_RUN_AS_NODE in case the parent shell exports it
delete process.env.ELECTRON_RUN_AS_NODE

const { app, BrowserWindow } = require('electron')
const path = require('node:path')

let mainWindow = null
let serverInfo = null

async function createWindow() {
  const url = require('node:url').pathToFileURL(
    path.join(__dirname, '..', 'server', 'index.mjs')
  ).href
  const mod = await import(url)
  serverInfo = await mod.startServer({ preferredPort: 3000 })
  const port = serverInfo.port

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: '中转 API 测试',
    backgroundColor: '#0b1120',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`)
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(createWindow).catch((e) => {
  console.error('Electron init failed:', e)
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
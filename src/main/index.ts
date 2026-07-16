import { app, shell, BrowserWindow, session, desktopCapturer, ipcMain } from 'electron'
import { join, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// Override user-data path BEFORE anything else touches app paths.
// Lets us run multiple instances side-by-side (e.g. `npm run dev:user2`).
if (process.env.MESH_USER_DATA) {
  app.setPath('userData', process.env.MESH_USER_DATA)
}

// Chromium hides local IPs behind mDNS "*.local" hostnames in ICE candidates.
// On networks where multicast DNS is blocked (managed switches, AP isolation,
// VPN adapters, many Windows setups) those names never resolve, so ICE fails
// even between two machines on the same subnet — the call "connects" at the
// signaling level but no media ever flows. MESH runs on LAN/intranet by
// design, so expose real local IPs and make host candidates directly dialable.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns')

import { initSodium } from './identity'
import {
  registerWindowHandlers,
  registerIdentityHandlers,
  registerRecoveryHandlers,
  registerDatabaseHandlers,
  registerSignalingHandlers,
  registerRelayHandlers,
  registerFriendRequestHandlers,
  registerMessageRequestHandlers,
  registerServerHandlers,
  registerPresenceHandlers,
  registerBlockHandlers,
  registerAvatarHandlers,
  registerNotificationHandlers,
  registerFileHandlers,
  registerDesktopHandlers
} from './ipc-handlers'
import { setNotificationsWindow } from './notifications'
import { openDatabase, closeDatabase } from './database'
import { setMainWindow, disconnectFromSignaling, emitSignaling } from './socket-client'
import { shutdownRelay } from './relay-manager'
import { registerSignalingHostHandlers, startHost, stopHosting } from './signaling-host'
import { registerNetworkScannerHandlers, refreshNetworkSignature } from './network-scanner'
import { getSetting } from './database'

let applicationWindow: BrowserWindow | null = null
let pendingServerInvite: string | null = null

function findServerInvite(args: string[]): string | null {
  for (const value of args) {
    const candidate = String(value || '').trim().replace(/^['"]|['"]$/g, '')
    if (candidate.length <= 4096 && /^mesh:\/\/join(?:[/?]|$)/i.test(candidate)) return candidate
  }
  return null
}

function queueServerInvite(value: string | null): void {
  if (!value) return
  pendingServerInvite = value
  if (applicationWindow && !applicationWindow.isDestroyed()) {
    if (applicationWindow.isMinimized()) applicationWindow.restore()
    applicationWindow.show()
    applicationWindow.focus()
    applicationWindow.webContents.send('app:server-invite', value)
  }
}

pendingServerInvite = findServerInvite(process.argv)

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    queueServerInvite(findServerInvite(commandLine))
    if (applicationWindow && !applicationWindow.isDestroyed()) {
      if (applicationWindow.isMinimized()) applicationWindow.restore()
      applicationWindow.show()
      applicationWindow.focus()
    }
  })

  app.on('open-url', (event, url) => {
    event.preventDefault()
    queueServerInvite(findServerInvite([url]))
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#0f0f0f',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  applicationWindow = mainWindow

  mainWindow.on('closed', () => {
    if (applicationWindow === mainWindow) applicationWindow = null
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Register window control IPC handlers (need mainWindow reference)
  registerWindowHandlers(mainWindow)

  // Expose mainWindow to socket-client so it can forward signaling events
  setMainWindow(mainWindow)
  setNotificationsWindow(mainWindow)

  // Register relay handlers (node-turn runs in-process)
  registerRelayHandlers()

  // Electron >= 25 requires an explicit handler for getDisplayMedia().
  // Without this, screen-share calls from the renderer are silently blocked.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      // Grant the first source (primary screen) automatically.
      // In the future we can show a picker UI.
      callback({ video: sources[0] })
    }).catch(() => {
      callback({ video: undefined as any })
    })
  })

  // Load the renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.mesh.app')

  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient('mesh', process.execPath, [resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('mesh')
  }

  ipcMain.handle('app:consume-server-invite', () => {
    const invite = pendingServerInvite
    pendingServerInvite = null
    return invite
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize libsodium before anything else
  await initSodium()

  // Register IPC handlers that don't need a window reference
  registerIdentityHandlers()

  // Open the database (tables created automatically)
  openDatabase()
  registerDatabaseHandlers()
  registerRecoveryHandlers()

  // Register signaling handlers (socket.io client lives in main process)
  registerSignalingHandlers()

  // Register friend-request orchestration handlers
  registerFriendRequestHandlers()

  // Register message-request orchestration handlers
  registerMessageRequestHandlers()

  // Register community server orchestration handlers
  registerServerHandlers()

  // Register presence / discovery handlers (Task 4)
  registerPresenceHandlers()

  // Register block-system handlers (Task 5)
  registerBlockHandlers()

  // Register avatar / profile-picture handlers (Task 7)
  registerAvatarHandlers()

  // Register desktop notifications handler (Task 8)
  registerNotificationHandlers()

  // Register file transfer handlers
  registerFileHandlers()

  // Register desktop capturer handler (screen-share source picker)
  registerDesktopHandlers()

  // Register embedded signaling-host handlers (Fix 1/2) and auto-start
  // if the user previously enabled "Host Signaling Server".
  registerSignalingHostHandlers()

  // Kick off a network-topology scan in the background so the UI has a
  // cached {localIp, routerWanIp, publicIp, upnpEnabled} on first render.
  // The scanner has its own 3s timeouts — never blocks app startup.
  registerNetworkScannerHandlers()
  refreshNetworkSignature().catch(() => { /* non-fatal */ })
  try {
    const raw = getSetting('network')
    const net = raw ? JSON.parse(raw) : null
    if (net?.hostSignaling) {
      const primary = Number.isFinite(net.hostPort) ? net.hostPort : 3000
      await startHost(primary)
      // Restore any additional independent host ports (multi-hosting).
      const extras: number[] = Array.isArray(net.extraHostPorts) ? net.extraHostPorts : []
      for (const p of extras) {
        if (p !== primary) await startHost(p)
      }
    }
  } catch (err) {
    console.warn('[signaling-host] auto-start failed:', err)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // Announce offline to friends before tearing down the socket.
  try { emitSignaling('status:update', { status: 'offline', invisible: false }) } catch { /* ignore */ }
})

app.on('will-quit', () => {
  shutdownRelay()
  disconnectFromSignaling()
  // Best-effort: stop the embedded signaling server (non-blocking).
  stopHosting().catch(() => { /* ignore */ })
  closeDatabase()
})

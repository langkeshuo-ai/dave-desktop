import { Tray, Menu, app, BrowserWindow, nativeImage } from "electron"
import { setQuitting } from "./lifecycle"
import { existsSync } from "node:fs"
import log from "electron-log"

// Idempotency guard — same reason as registerIpcHandlers in ipc.ts:
// electron-vite's CJS-shim banner can cause this module's side-effecting
// top-level code to run twice in dev/preview configurations. Without this
// guard the user would see two tray icons.
let trayCreated = false

function createTrayIcon(iconPath: string): Electron.NativeImage {
  // Prefer the resource icon — it's 256×256 so Electron downscales to tray size.
  if (iconPath && existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  }
  // Fallback: 16×16 blue dot (only when no icon resource exists).
  const size = 16
  const buf = Buffer.alloc(size * size * 4, 0)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x - size / 2,
        cy = y - size / 2
      const dist = Math.sqrt(cx * cx + cy * cy)
      if (dist < size / 2 - 1) {
        const idx = (y * size + x) * 4
        buf[idx] = 59
        buf[idx + 1] = 130
        buf[idx + 2] = 246
        buf[idx + 3] = 255
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size })
}

export function createTray(mainWindow: BrowserWindow, iconPath: string): Tray | null {
  if (trayCreated) {
    log.warn("createTray called twice — skipping duplicate tray creation")
    return null
  }
  trayCreated = true

  const tray = new Tray(createTrayIcon(iconPath))
  tray.setToolTip("Dave Desktop")

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "打开 Dave",
      click: () => {
        if (mainWindow.isDestroyed()) return
        mainWindow.show()
        mainWindow.focus()
      },
    },
    { type: "separator" },
    {
      label: "新建会话",
      click: () => {
        if (mainWindow.isDestroyed()) return
        mainWindow.show()
        mainWindow.webContents.send("menu-action", "new-session")
      },
    },
    { type: "separator" },
    {
      label: "设置",
      click: () => {
        if (mainWindow.isDestroyed()) return
        mainWindow.show()
        mainWindow.webContents.send("menu-action", "open-settings")
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        setQuitting(true)
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)

  tray.on("double-click", () => {
    if (mainWindow.isDestroyed()) return
    mainWindow.show()
    mainWindow.focus()
  })

  return tray
}

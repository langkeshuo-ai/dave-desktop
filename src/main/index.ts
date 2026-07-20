import { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut } from "electron"
import { join } from "node:path"
import { existsSync, writeFileSync } from "node:fs"
import { registerIpcHandlers } from "./ipc"
import { createTray } from "./tray"
import { getStore } from "./store"
import { setQuitting, isAppQuitting } from "./lifecycle"
import { trackEvent } from "./telemetry-store"
import { checkStartupBudget, COLD_WINDOW_BUDGET_MS } from "../shared/telemetry"
import log from "electron-log"
import windowStateKeeper from "electron-window-state"

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

// 启动时刻锚点:ready-to-show 时算 elapsedMs,作为 cold_window 预算的基准。
// 放在模块顶层以覆盖初始化路径(preload 注册前的早期 error 也算)。
const processStartedAt = Date.now()

// Idempotency guard — same reason as registerIpcHandlers in ipc.ts:
// electron-vite's CJS-shim banner can cause this module's top-level code
// to run twice in dev/preview configurations. Without this guard the
// app would create duplicate windows, duplicate event listeners, and
// duplicate tray icons.
//
// All side-effect-producing code (app.on, app.whenReady, app.set*, process.on)
// lives inside this block so the second execution is a complete no-op.
let initialized = false
if (!initialized) {
  initialized = true

  // Single-instance lock: secondary launches focus the existing window instead of
  // starting a second process — this is the standard Electron pattern (electron-reload /
  // VSCode / Slack all do this). Cheap, MIT-licensed, no extra deps required.
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  } else {
    app.on("second-instance", () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
    })
  }

  app.whenReady().then(() => {
    // Configure electron-log to write under userData so users can find crash info.
    log.transports.file.resolvePathFn = () => join(app.getPath("userData"), "dave-desktop.log")
    log.transports.file.level = "info"
    log.info("Dave Desktop starting up…")

    ensureDefaultIcon()
    // Store init used to throw "ElectronStore is not a constructor" under the
    // packaged CJS main + pure-ESM electron-store, which aborted this then()
    // before createWindow — the portable .exe looked "dead". Fail loudly in
    // the log but still surface a window so the user is not stuck tray-less.
    try {
      getStore()
    } catch (err) {
      log.error("getStore() failed during startup:", err)
    }

    setupAppMenu()

    registerIpcHandlers({
      getMainWindow: () => mainWindow,
      showWindow: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      },
    })

    mainWindow = createWindow()
    tray = createTray(mainWindow, iconPath("ico") || iconPath("png"))
    // Win has no native File menu — re-bind Cmd/Ctrl+N / , as focus-scoped shortcuts
    // so they don't steal keys from other apps when Dave is in the background.
    registerFocusScopedShortcuts()

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow()
      } else if (mainWindow) {
        mainWindow.show()
      }
    })

    if (process.platform === "darwin" && app.dock) {
      const dockIcon = iconPath("png") || undefined
      if (dockIcon) app.dock.setIcon(dockIcon)
    }
  })

  app.on("before-quit", () => {
    setQuitting(true)
  })

  app.on("will-quit", () => {
    globalShortcut.unregisterAll()
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  app.setAppUserModelId("com.dave.desktop")

  // Render unhandled errors / crashes to the log file so users can attach it to bug reports.
  process.on("uncaughtException", (err) => log.error("uncaughtException:", err))
  process.on("unhandledRejection", (reason) => log.error("unhandledRejection:", reason))
} // end if (!initialized)

/* =========================================================================
   Function declarations — no side effects, safe to re-declare.
   ========================================================================= */

// isAppQuitting/setQuitting moved to ./lifecycle.ts to avoid a circular import
// back into this module from tray.ts (which rollup previously resolved by
// inlining this file's top-level side effects twice).

function iconPath(ext: string): string {
  const icon = join(__dirname, "../../resources/icon." + ext)
  if (existsSync(icon)) return icon
  return ""
}

function tryLoadDevUrl(win: BrowserWindow): void {
  const http = require("node:http")
  const req = http.get("http://localhost:5173", () => {
    win.loadURL("http://localhost:5173")
    win.webContents.openDevTools({ mode: "detach" })
  })
  req.on("error", () => {
    win.loadFile(join(__dirname, "../renderer/index.html"))
  })
  req.setTimeout(1500, () => {
    req.destroy()
    win.loadFile(join(__dirname, "../renderer/index.html"))
  })
}

function ensureDefaultIcon(): void {
  const icoPath = join(__dirname, "../../resources/icon.ico")
  const pngPath = join(__dirname, "../../resources/icon.png")
  if (existsSync(icoPath) || existsSync(pngPath)) return

  // Minimal 16x16 RGBA fallback (solid blue dot) so tray/window can still load an icon.
  const size = 16
  const buf = Buffer.alloc(size * size * 4, 0)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x - size / 2,
        cy = y - size / 2
      const dist = Math.sqrt(cx * cx + cy * cy)
      if (dist < size / 2 - 1) {
        const idx = (y * size + x) * 4
        buf[idx] = 59      // B
        buf[idx + 1] = 130 // G
        buf[idx + 2] = 246 // R
        buf[idx + 3] = 255 // A
      }
    }
  }
  writeFileSync(pngPath, buf)
}

function createWindow(): BrowserWindow {
  // Persist window size/position/maximized state across launches. electron-window-state
  // is the community standard (used by VSCode/Slack/Atom), MIT, ~50k weekly downloads.
  const winState = windowStateKeeper({
    defaultWidth: 1200,
    defaultHeight: 800,
    file: "dave-desktop-window-state.json",
  })

  const win = new BrowserWindow({
    x: winState.x,
    y: winState.y,
    width: winState.width,
    height: winState.height,
    minWidth: 800,
    minHeight: 600,
    show: true,
    title: "Dave Desktop",
    icon: iconPath("ico") || iconPath("png") || undefined,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  winState.manage(win)

  win.on("ready-to-show", () => {
    if (!isAppQuitting()) win.show()
    // 性能打点:主进程拉起 → 主窗口 ready-to-show(用户实际看到主界面)的延迟。
    // 用于核对 cold_window 预算(目标 < COLD_WINDOW_BUDGET_MS)。
    const elapsedMs = Date.now() - processStartedAt
    const verdict = checkStartupBudget("cold_window", elapsedMs)
    trackEvent("first_window_shown", {
      elapsedMs: String(elapsedMs),
      within: verdict.within ? "1" : "0",
      budgetMs: String(COLD_WINDOW_BUDGET_MS),
    })
  })

  win.on("close", (event) => {
    if (!isAppQuitting()) {
      event.preventDefault()
      win.hide()
    }
  })

  win.on("closed", () => {
    mainWindow = null
  })

  // Capture renderer console + uncaught errors into electron-log so the user
  // can paste the real "渲染出错" stack from the log file instead of guessing.
  win.webContents.on("console-message", (_e, level, message, line, source) => {
    const msg = `renderer[${line}] ${message} (${source})`
    if (level >= 3) log.error(msg)
    else if (level === 2) log.warn(msg)
    else log.info(msg)
  })
  win.webContents.on("render-process-gone", (_e, details) => {
    log.error("render-process-gone:", details)
    // 渲染进程崩溃(OOM / 渲染死锁)时主动重载,避免用户面对永久白屏。
    // 仅在非退出状态下重载,且只重试一次以防重载循环。
    if (details.reason !== "crashed" || isAppQuitting()) return
    if ((win as unknown as { _reloadAttempted?: boolean })._reloadAttempted) {
      log.error("renderer reload already attempted once — giving up to avoid loop")
      return
    }
    ;(win as unknown as { _reloadAttempted?: boolean })._reloadAttempted = true
    setTimeout(() => {
      try { win.reload() } catch (err) { log.error("renderer reload failed:", err) }
    }, 500)
  })
  win.webContents.on("preload-error", (_e, preloadPath, error) => {
    log.error("preload-error in", preloadPath, ":", error)
  })
  win.webContents.on("did-fail-load", (_e, code, desc, url, isMain) => {
    log.error(`did-fail-load code=${code} desc=${desc} url=${url} isMain=${isMain}`)
  })

  if (!app.isPackaged) {
    tryLoadDevUrl(win)
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"))
  }

  return win
}

// Application menu: macOS keeps a minimal native menu (Cmd+Q / standard roles).
// Windows/Linux hide the menu bar entirely — File/Edit/View/Window look alien
// next to the Cursor-style chrome; shortcuts live in the title bar / tray.
function setupAppMenu(): void {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null)
    return
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function sendMenuAction(action: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send("menu-action", action)
}

/** Register Ctrl/Cmd+N and Ctrl/Cmd+, only while a Dave window is focused. */
function registerFocusScopedShortcuts(): void {
  // 监听器幂等 — 早期版本每次 focus 都 addListener,导致切换窗口时累积。
  // 用闭包内 boolean 标志,只在第一次 focus 时绑定一次。
  let bound = false
  const bind = () => {
    if (bound) return
    try {
      globalShortcut.unregisterAll()
      globalShortcut.register("CommandOrControl+N", () => sendMenuAction("new-session"))
      globalShortcut.register("CommandOrControl+,", () => sendMenuAction("open-settings"))
      globalShortcut.register("CommandOrControl+K", () => sendMenuAction("open-palette"))
      bound = true
    } catch (err) {
      log.warn("globalShortcut bind failed:", err)
    }
  }
  const unbind = () => {
    if (!bound) return
    try {
      globalShortcut.unregisterAll()
    } catch {
      /* ignore */
    }
    bound = false
  }

  app.on("browser-window-focus", bind)
  app.on("browser-window-blur", () => {
    // Delay: switching between our own windows fires blur then focus.
    setTimeout(() => {
      if (BrowserWindow.getFocusedWindow()) return
      unbind()
    }, 50)
  })
  if (BrowserWindow.getFocusedWindow()) bind()
}
